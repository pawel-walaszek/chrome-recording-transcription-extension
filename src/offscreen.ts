// src/offscreen.ts

import { captureException, captureMessage, initDiagnostics } from './diagnostics'
import type { MicPreferences } from './micPreferences'
import { uploadRecordingOnce, type UploadRecordingInput } from './uploadClient'

initDiagnostics('offscreen')

// Włączone oznacza przygotowanie osobnego assetu mikrofonu do uploadu.
// UWAGA: offscreen nie może pokazać początkowej prośby o uprawnienie mikrofonu.
// Trzeba raz przygotować uprawnienie mikrofonu z widocznej strony
// (popup/opcje/karta rozszerzenia) przez navigator.mediaDevices.getUserMedia({ audio: true }).
const WANT_MIC_ASSET = true
const MEDIA_CAPTURE_TIMEOUT_MS = 10_000
const UPLOAD_RETRY_INTERVAL_MS = 15_000

window.addEventListener('error', (e) => {
  console.error('[offscreen] window.onerror', e?.message, e?.error)
  captureException(e?.error || e?.message, { operation: 'window.onerror' })
})
window.addEventListener('unhandledrejection', (e: any) => {
  console.error('[offscreen] unhandledrejection', e?.reason || e)
  captureException(e?.reason || e, { operation: 'unhandledrejection' })
})
console.log('[offscreen] script loaded')

// Obsługa portu.
let portRef: chrome.runtime.Port | null = null
function log(...a: any[]) { console.log('[offscreen]', ...a) }

function connectPort(): chrome.runtime.Port {
  try { portRef?.disconnect() } catch {}
  const p: chrome.runtime.Port = chrome.runtime.connect({ name: 'offscreen' })
  p.onDisconnect.addListener(() => { log('Port disconnected'); portRef = null })
  // Poinformuj tło, że offscreen działa.
  p.postMessage({ type: 'OFFSCREEN_READY' })
  log('READY signaled via Port')
  portRef = p
  return p
}
function getPort(): chrome.runtime.Port { return portRef ?? connectPort() }
function respond(req: any, payload: any) { getPort().postMessage({ __respFor: req?.__id, payload }) }

// Popup używa tego do przełączania przycisków.
function pushState(recording: boolean, extra?: Record<string, any>) {
  if (recording && !currentRecordingStartedAtMs) currentRecordingStartedAtMs = Date.now()
  const recordingStartedAt = recording ? currentRecordingStartedAtMs : null
  try {
    (chrome.storage as any)?.session?.set?.({
      recording,
      recordingStartedAt
    }).catch?.(() => {})
  } catch {}
  getPort().postMessage({ type: 'RECORDING_STATE', recording, recordingStartedAt, ...extra })
}

type UploadStatus = 'idle' | 'uploading' | 'upload_retrying' | 'uploaded'

function pushUploadState(status: UploadStatus, extra?: Record<string, any>) {
  getPort().postMessage({ type: 'UPLOAD_STATE', status, ...extra })
}

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))

let activeStreams = new Set<MediaStream>()
let activeAudioContexts = new Set<AudioContext>()
let activeAudioNodes = new Set<AudioNode>()
let activeIntervals = new Set<number>()

function trackStream<T extends MediaStream | null>(stream: T): T {
  if (stream) activeStreams.add(stream)
  return stream
}

function trackAudioContext<T extends AudioContext>(ctx: T): T {
  activeAudioContexts.add(ctx)
  return ctx
}

function trackAudioNode<T extends AudioNode>(node: T): T {
  activeAudioNodes.add(node)
  return node
}

function cleanupRecordingResources() {
  activeIntervals.forEach((id) => { try { clearInterval(id) } catch {} })
  activeIntervals.clear()

  activeAudioNodes.forEach((node) => {
    try { node.disconnect() } catch {}
  })
  activeAudioNodes.clear()

  activeStreams.forEach((stream) => {
    try { stream.getTracks().forEach((track) => track.stop()) } catch {}
  })
  activeStreams.clear()

  activeAudioContexts.forEach((ctx) => {
    try { void ctx.close().catch(() => {}) } catch {}
  })
  activeAudioContexts.clear()
}

function withStreamTimeout(
  promise: Promise<MediaStream>,
  label: string,
  timeoutMs = MEDIA_CAPTURE_TIMEOUT_MS
): Promise<MediaStream> {
  let settled = false
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`${label} timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    promise.then((stream) => {
      if (settled) {
        try { stream.getTracks().forEach((track) => track.stop()) } catch {}
        return
      }
      settled = true
      clearTimeout(timeout)
      resolve(trackStream(stream))
    }).catch((error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    })
  })
}

function makeMicAudioConstraints(deviceId?: string | null): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  }
}

function getOverconstrainedConstraint(error: DOMException): string | null {
  const constraint = (error as DOMException & { constraint?: unknown }).constraint
  return typeof constraint === 'string' ? constraint : null
}

function isMissingSelectedMicError(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false
  if (error.name === 'NotFoundError') return true
  if (error.name !== 'OverconstrainedError') return false

  return getOverconstrainedConstraint(error) === 'deviceId'
}

// Prosty jednokanałowy miernik RMS do debugowania.
function attachRmsMeter(track: MediaStreamTrack, label: 'RAW' | 'MIC' | 'FINAL') {
  try {
    const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext
    const ctx = trackAudioContext(new AC())
    void ctx.resume().catch(() => {})
    const src = trackAudioNode(ctx.createMediaStreamSource(new MediaStream([track])))
    const analyser = trackAudioNode(ctx.createAnalyser())
    analyser.fftSize = 256
    const buf = new Uint8Array(analyser.frequencyBinCount)
    src.connect(analyser)
    const id = window.setInterval(() => {
      analyser.getByteTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) {
        const x = (buf[i] - 128) / 128
        sum += x * x
      }
      const rms = Math.sqrt(sum / buf.length)
      console.log('[offscreen]', `${label} input level (rms):`, rms.toFixed(3))
    }, 1000)
    activeIntervals.add(id)
    track.addEventListener('ended', () => {
      try { clearInterval(id) } catch {}
      activeIntervals.delete(id)
    })
  } catch (e) {
    log('meter setup failed (non-fatal)', e)
    captureException(e, { operation: 'attachRmsMeter' })
  }
}

// Nagrywanie i upload.
async function requestClearMicPreferences(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'CLEAR_MIC_PREFERENCES' })
    if (response?.ok === false) {
      log('clear saved microphone preference failed:', response.error)
    }
  } catch (e) {
    log('clear saved microphone preference failed:', e)
    captureException(e, { operation: 'requestClearMicPreferences' })
  }
}

async function maybeGetMicStream(prefs: MicPreferences): Promise<MediaStream | null> {
  if (!WANT_MIC_ASSET) return null

  if (prefs.preferredMicDeviceId) {
    try {
      const mic = await withStreamTimeout(
        navigator.mediaDevices.getUserMedia({
          audio: makeMicAudioConstraints(prefs.preferredMicDeviceId)
        }),
        'selected mic getUserMedia'
      )
      const t = mic.getAudioTracks()[0]
      log('selected mic stream acquired:', prefs.preferredMicLabel || prefs.preferredMicDeviceId, 'track:', !!t, 'muted:', t?.muted, 'enabled:', t?.enabled)
      return mic
    } catch (e) {
      log('selected mic getUserMedia failed; falling back to default mic:', prefs.preferredMicLabel || prefs.preferredMicDeviceId, e)
      captureException(e, { operation: 'selectedMicGetUserMedia' })
      if (isMissingSelectedMicError(e)) {
        log('selected mic is no longer available; clearing saved microphone preference')
        await requestClearMicPreferences()
      }
    }
  }

  try {
    // Działa tylko wtedy, gdy źródło rozszerzenia ma już nadane uprawnienie mikrofonu.
    const mic = await withStreamTimeout(
      navigator.mediaDevices.getUserMedia({
        audio: makeMicAudioConstraints()
      }),
      'mic getUserMedia'
    )
    const t = mic.getAudioTracks()[0]
    log('mic stream acquired:', !!t, 'muted:', t?.muted, 'enabled:', t?.enabled)
    return mic
  } catch (e) {
    log('mic getUserMedia failed (continuing without mic):', e)
    captureException(e, { operation: 'defaultMicGetUserMedia' })
    return null
  }
}

function routeTabAudioToOutput(tabStream: MediaStream): void {
  const tabAudio = tabStream.getAudioTracks()[0]
  if (!tabAudio) return

  const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext
  const ctx = trackAudioContext(new AC())
  void ctx.resume().catch(() => {})

  try {
    const tabSource = trackAudioNode(ctx.createMediaStreamSource(new MediaStream([tabAudio])))
    // Chrome tabCapture może odciąć lokalny odsłuch przechwytywanej karty.
    tabSource.connect(ctx.destination)
  } catch (err) {
    log('tab source connect failed for local playback', err)
    captureException(err, { operation: 'mixTabAudio' })
  }
}

// Buduje ograniczenia z użyciem streamId. Najpierw próbuje 'tab', potem 'desktop'.
function makeConstraints(streamId: string, source: 'tab' | 'desktop'): MediaStreamConstraints {
  const mandatory = { chromeMediaSource: source, chromeMediaSourceId: streamId } as any
  return {
    audio: {
      mandatory,
      optional: [{ googDisableLocalEcho: false }]
    } as any,
    video: {
      mandatory: {
        ...mandatory,
        maxWidth: 1920,
        maxHeight: 1080,
        maxFrameRate: 30
      }
    } as any
  }
}

// Próbuje nagrywać z użyciem streamId.
async function captureWithStreamId(streamId: string): Promise<MediaStream> {
  try {
    log(`Attempting getUserMedia with streamId ${streamId} source= tab`)
    const s = await withStreamTimeout(
      navigator.mediaDevices.getUserMedia(makeConstraints(streamId, 'tab')),
      'tab getUserMedia'
    )
    return s
  } catch (e1: any) {
    log('[gUM] failed for chromeMediaSource=tab:', e1?.name || e1, e1?.message || e1)
    captureException(e1, { operation: 'tabCaptureGetUserMedia' })
  }
  log(`Attempting getUserMedia with streamId ${streamId} source= desktop`)
  return await withStreamTimeout(
    navigator.mediaDevices.getUserMedia(makeConstraints(streamId, 'desktop')),
    'desktop getUserMedia'
  )
}

let mediaRecorder: MediaRecorder | null = null
let microphoneRecorder: MediaRecorder | null = null
let chunks: BlobPart[] = []
let microphoneChunks: BlobPart[] = []
let capturing = false
let uploadInProgress = false
let currentRecordingStartedAtMs: number | null = null
let currentRecordingContext: RecordingContext | null = null
let microphoneStoppedPromise: Promise<Blob | null> | null = null
let resolveMicrophoneStopped: ((blob: Blob | null) => void) | null = null

interface RecordingContext {
  tabUrl?: string | null
  tabTitle?: string | null
}

interface RecordingStartInfo {
  micIncluded: boolean
  warning?: string
}

function chooseVideoMime(): string {
  return MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
    ? 'video/webm;codecs=vp8,opus'
    : 'video/webm'
}

function chooseMicrophoneMime(): string {
  return MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm'
}

function inferMeetingId(url?: string | null): string | undefined {
  try {
    if (!url) return undefined
    const u = new URL(url)
    if (u.hostname !== 'meet.google.com') return undefined
    const suffix = u.pathname.split('/').filter(Boolean).pop()
    if (!suffix) return undefined
    return /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i.test(suffix) ? suffix : undefined
  } catch {
    return undefined
  }
}

function fallbackTitleFromUrl(url?: string | null): string {
  try {
    if (!url) return 'Browser recording'
    const u = new URL(url)
    const path = u.pathname.split('/').filter(Boolean).pop()
    return path ? `${u.hostname}/${path}` : u.hostname
  } catch {
    return 'Browser recording'
  }
}

function buildUploadInput(videoBlob: Blob, microphoneBlob: Blob | null): UploadRecordingInput {
  const now = Date.now()
  const startedAtMs = currentRecordingStartedAtMs || now
  const tabTitle = currentRecordingContext?.tabTitle?.trim()
  const tabUrl = currentRecordingContext?.tabUrl || null
  const meetingId = inferMeetingId(tabUrl)
  const title = tabTitle || fallbackTitleFromUrl(tabUrl)

  return {
    title,
    meetingId,
    meetingTitle: tabTitle || undefined,
    startedAt: new Date(startedAtMs).toISOString(),
    durationMs: Math.max(1, now - startedAtMs),
    videoBlob,
    microphoneBlob: microphoneBlob && microphoneBlob.size > 0 ? microphoneBlob : null
  }
}

async function uploadRecordingUntilSuccess(input: UploadRecordingInput, attempt = 1): Promise<void> {
  uploadInProgress = true
  pushUploadState(attempt === 1 ? 'uploading' : 'upload_retrying', { attempt })

  try {
    const result = await uploadRecordingOnce(input)
    uploadInProgress = false
    pushUploadState('uploaded', {
      attempt,
      recordingId: result.recordingId,
      assets: result.assets
    })
    log('Upload completed', { recordingId: result.recordingId, assets: result.assets, attempt })
  } catch (e) {
    captureException(e, {
      operation: 'uploadRecordingUntilSuccess',
      attempt,
      nextRetryMs: UPLOAD_RETRY_INTERVAL_MS
    })
    const nextRetryAt = Date.now() + UPLOAD_RETRY_INTERVAL_MS
    log('Upload failed; retrying in 15 seconds', e)
    pushUploadState('upload_retrying', {
      attempt,
      error: e instanceof Error ? e.message : String(e),
      nextRetryAt
    })
    await sleep(UPLOAD_RETRY_INTERVAL_MS)
    return uploadRecordingUntilSuccess(input, attempt + 1)
  }
}

function stopActiveRecorders(): void {
  if (microphoneRecorder && microphoneRecorder.state !== 'inactive') {
    try { microphoneRecorder.stop() } catch (e) { log('microphone recorder stop failed', e); resolveMicrophoneStop(null) }
  }
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop()
  }
}

function resolveMicrophoneStop(blob: Blob | null): void {
  const resolver: ((blob: Blob | null) => void) | null = resolveMicrophoneStopped
  if (typeof resolver === 'function') resolver(blob)
}

async function prepareAndRecord(
  baseStream: MediaStream,
  micPreferences: MicPreferences,
  recordingContext: RecordingContext
): Promise<RecordingStartInfo> {
  trackStream(baseStream)
  currentRecordingStartedAtMs = Date.now()
  currentRecordingContext = recordingContext
  const a = baseStream.getAudioTracks()
  const v = baseStream.getVideoTracks()
  log('getUserMedia() tracks:', {
    audioCount: a.length,
    videoCount: v.length,
    audioMuted: a[0]?.muted,
    audioEnabled: a[0]?.enabled
  })
  a.forEach((t) => { try { t.enabled = true } catch {} })

  if (!a.length) {
    pushState(false, { warning: 'NO_TAB_AUDIO' })
  } else {
    const T = a[0]
    console.log('[offscreen] audio track settings:', T?.getSettings?.())
    console.log('[offscreen] audio track muted/enabled:', T?.muted, T?.enabled)
    T?.addEventListener('mute', () => console.log('[offscreen] track MUTED'))
    T?.addEventListener('unmute', () => console.log('[offscreen] track UNMUTED'))
  }
  if (!v.length) throw new Error('No video track in captured stream')

  // Mierniki debugowe.
  const rawAudio = baseStream.getAudioTracks()[0]
  if (rawAudio) attachRmsMeter(rawAudio, 'RAW')
  routeTabAudioToOutput(baseStream)

  const micStream = await maybeGetMicStream(micPreferences)
  const micTrack = micStream?.getAudioTracks()[0] || null
  if (micTrack) {
    log('mic track ready for separate asset:', 'muted:', micTrack.muted, 'enabled:', micTrack.enabled)
    attachRmsMeter(micTrack, 'MIC')
  } else if (WANT_MIC_ASSET) {
    captureMessage('microphone stream unavailable; recording tab audio only', 'warning', {
      operation: 'prepareAndRecord'
    })
  }

  const finalAudio = baseStream.getAudioTracks()[0]
  if (finalAudio) attachRmsMeter(finalAudio, 'FINAL')
  if (!finalAudio) log('WARNING: final stream has NO audio track — recording will be silent')
  if (!finalAudio) captureMessage('final stream has no audio track', 'warning', { operation: 'prepareAndRecord' })

  log('video_audio stream tracks -> video:', baseStream.getVideoTracks().length, 'audio:', baseStream.getAudioTracks().length)

  // Kontrola bezpieczeństwa; nie jest fatalna.
  if (rawAudio) {
    try {
      const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext
      const ctx = trackAudioContext(new AC())
      await ctx.resume().catch(() => {})
      const src = trackAudioNode(ctx.createMediaStreamSource(new MediaStream([rawAudio])))
      const analyser = trackAudioNode(ctx.createAnalyser())
      analyser.fftSize = 256
      const buf = new Uint8Array(analyser.frequencyBinCount)
      src.connect(analyser)
      await sleep(1000)
      analyser.getByteTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) {
        const x = (buf[i] - 128) / 128
        sum += x * x
      }
      const rms = Math.sqrt(sum / buf.length)
      if (rms < 0.005) log('no audio energy detected before start')
    } catch {}
  }

  chunks = []
  microphoneChunks = []
  const mime = chooseVideoMime()
  const microphoneMime = chooseMicrophoneMime()

  microphoneStoppedPromise = Promise.resolve(null)
  resolveMicrophoneStopped = null

  if (micTrack) {
    try {
      const microphoneStream = trackStream(new MediaStream([micTrack]))
      microphoneStoppedPromise = new Promise<Blob | null>((resolve) => {
        resolveMicrophoneStopped = resolve
      })
      microphoneRecorder = new MediaRecorder(microphoneStream, {
        mimeType: microphoneMime,
        audioBitsPerSecond: 128_000
      })

      microphoneRecorder.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size) microphoneChunks.push(e.data)
      }

      microphoneRecorder.onerror = (e: any) => {
        log('Microphone MediaRecorder error', e)
        captureException(e, { operation: 'MicrophoneMediaRecorder.onerror' })
        resolveMicrophoneStop(null)
      }

      microphoneRecorder.onstop = () => {
        const microphoneBlob = new Blob(microphoneChunks, { type: microphoneMime })
        log('Microphone finalized; chunks =', microphoneChunks.length, 'blob.size =', microphoneBlob.size)
        resolveMicrophoneStop(microphoneBlob.size > 0 ? microphoneBlob : null)
      }
    } catch (e) {
      log('microphone recorder setup failed; continuing with video_audio only', e)
      captureException(e, { operation: 'setupMicrophoneRecorder' })
      microphoneRecorder = null
      microphoneStoppedPromise = Promise.resolve(null)
    }
  }

  mediaRecorder = new MediaRecorder(baseStream, {
    mimeType: mime,
    videoBitsPerSecond: 3_000_000,
    audioBitsPerSecond: 128_000
  })

  const started = new Promise<void>((resolve, reject) => {
    const startTimeout = setTimeout(() => reject(new Error('MediaRecorder did not start (timeout)')), 4000)

    mediaRecorder!.onstart = () => {
      clearTimeout(startTimeout)
      capturing = true
      pushState(true)
      log('MediaRecorder started')
      resolve()
    }

    mediaRecorder!.onerror = (e: any) => {
      clearTimeout(startTimeout)
      log('MediaRecorder error', e)
      captureException(e, { operation: 'MediaRecorder.onerror' })
      try { baseStream.getTracks().forEach(t => t.stop()) } catch {}
      cleanupRecordingResources()
      mediaRecorder = null
      microphoneRecorder = null
      capturing = false
      pushState(false)
      reject(new Error(e?.name || 'MediaRecorder error'))
    }

    mediaRecorder!.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size) chunks.push(e.data)
    }

    mediaRecorder!.onstop = async () => {
      try {
        const videoBlob = new Blob(chunks, { type: mime })
        const microphoneBlob = microphoneStoppedPromise ? await microphoneStoppedPromise : null
        log('Finalizing; video chunks =', chunks.length, 'video blob.size =', videoBlob.size, 'microphone blob.size =', microphoneBlob?.size || 0)

        const uploadInput = buildUploadInput(videoBlob, microphoneBlob)
        void uploadRecordingUntilSuccess(uploadInput).catch((e) => {
          log('Unexpected upload retry loop failure', e)
          captureException(e, { operation: 'uploadRecordingUntilSuccess.unhandled' })
        })
      } catch (e) {
        log('Finalize/Upload failed', e)
        captureException(e, { operation: 'finalizeRecording' })
      } finally {
        cleanupRecordingResources()
        mediaRecorder = null
        microphoneRecorder = null
        chunks = []
        microphoneChunks = []
        capturing = false
        pushState(false)
      }
    }
  })

  if (microphoneRecorder) {
    try {
      microphoneRecorder.start(1000)
    } catch (e) {
      log('microphone recorder start failed; continuing with video_audio only', e)
      captureException(e, { operation: 'startMicrophoneRecorder' })
      resolveMicrophoneStop(null)
      microphoneRecorder = null
    }
  }
  mediaRecorder.start(1000)

  // Jeśli karta nawiguje albo kończy się ścieżka wideo, zatrzymaj automatycznie.
  baseStream.getVideoTracks()[0]?.addEventListener('ended', () => {
    log('Video track ended')
    if (mediaRecorder && capturing) { try { stopActiveRecorders() } catch {} }
  })

  await started
  return {
    micIncluded: !!micTrack,
    warning: micTrack ? undefined : 'NO_MIC_AUDIO'
  }
}

async function startRecordingFromStreamId(
  streamId: string,
  micPreferences: MicPreferences,
  recordingContext: RecordingContext
): Promise<RecordingStartInfo> {
  if (capturing) {
    log('Already recording; ignoring start')
    return { micIncluded: true }
  }
  if (uploadInProgress) {
    throw new Error('Upload is still in progress')
  }
  cleanupRecordingResources()
  try {
    const baseStream = await captureWithStreamId(streamId)
    return await prepareAndRecord(baseStream, micPreferences, recordingContext)
  } catch (e) {
    cleanupRecordingResources()
    captureException(e, { operation: 'startRecordingFromStreamId' })
    mediaRecorder = null
    microphoneRecorder = null
    chunks = []
    microphoneChunks = []
    capturing = false
    pushState(false)
    throw e
  }
}

function stopRecording() {
  if (!mediaRecorder || !capturing) {
    console.warn('[offscreen] Stop called but not recording')
    throw new Error('Not currently recording')
  }
  try { stopActiveRecorders() } catch (e) { console.error('[offscreen] Stop error', e); captureException(e, { operation: 'stopRecording' }); throw e }
}

// RPC przez port.
const rpcPort = getPort()
rpcPort.onMessage.addListener(async (msg: any) => {
  try {
    if (msg?.type === 'OFFSCREEN_START') {
      const streamId = msg.streamId as string | undefined
      if (!streamId) return respond(msg, { ok: false, error: 'Missing streamId' })
      const micPreferences = (msg.micPreferences || {
        preferredMicDeviceId: null,
        preferredMicLabel: null
      }) as MicPreferences
      const recordingContext = (msg.recordingContext || {}) as RecordingContext
      try {
        // Poczekaj, aż nagrywanie faktycznie wystartuje.
        const recordingInfo = await startRecordingFromStreamId(streamId, micPreferences, recordingContext)
        return respond(msg, { ok: true, ...recordingInfo })
      } catch (e: any) {
        captureException(e, { operation: 'OFFSCREEN_START' })
        return respond(msg, { ok: false, error: `${e?.name || 'Error'}: ${e?.message || e}` })
      }
    }

    if (msg?.type === 'OFFSCREEN_START_TAB') {
      // Tło musi dostarczyć streamId.
      return respond(msg, { ok: false, error: 'Use OFFSCREEN_START with streamId from background' })
    }

    if (msg?.type === 'OFFSCREEN_STOP') {
      try { stopRecording(); return respond(msg, { ok: true }) }
      catch (e) { return respond(msg, { ok: false, error: String(e) }) }
    }

    if (msg?.type === 'OFFSCREEN_STATUS') {
      let recording = false
      try {
        const res = await (chrome.storage as any)?.session?.get?.(['recording'])
        recording = !!res?.recording
      } catch {}
      return respond(msg, { recording, uploadInProgress })
    }

    if (msg?.type === 'DIAG_ECHO') {
      return respond(msg, { ok: true, pong: 'offscreen-alive' })
    }

  } catch (e) {
    console.error('[offscreen] error', e)
    captureException(e, { operation: 'rpcPort.onMessage' })
    respond(msg, { ok: false, error: String(e) })
  }
})

// Pozwala tłu sprawdzić stan, zanim port będzie gotowy.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  try {
    if (msg?.type === 'OFFSCREEN_PING') { sendResponse({ ok: true, via: 'onMessage' }); return true }
    if (msg?.type === 'OFFSCREEN_CONNECT') { connectPort(); sendResponse({ ok: true }); return true }
  } catch (e) { sendResponse({ ok: false, error: String(e) }) }
  return false
})
