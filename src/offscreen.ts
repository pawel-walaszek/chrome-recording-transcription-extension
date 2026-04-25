// src/offscreen.ts

import { clearMicPreferences, getMicPreferences } from './micPreferences'

// Włączone oznacza dodanie lokalnego mikrofonu do miksu nagrania.
// UWAGA: offscreen nie może pokazać początkowej prośby o uprawnienie mikrofonu.
// Trzeba raz przygotować uprawnienie mikrofonu z widocznej strony
// (popup/opcje/karta rozszerzenia) przez navigator.mediaDevices.getUserMedia({ audio: true }).
const WANT_MIC_MIX = true
const MEDIA_CAPTURE_TIMEOUT_MS = 10_000

window.addEventListener('error', (e) => {
  console.error('[offscreen] window.onerror', e?.message, e?.error)
})
window.addEventListener('unhandledrejection', (e: any) => {
  console.error('[offscreen] unhandledrejection', e?.reason || e)
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
  try { (chrome.storage as any)?.session?.set?.({ recording }).catch?.(() => {}) } catch {}
  getPort().postMessage({ type: 'RECORDING_STATE', recording, ...extra })
}

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))

let activeStreams = new Set<MediaStream>()
let activeAudioContexts = new Set<AudioContext>()
let activeIntervals = new Set<number>()

function trackStream<T extends MediaStream | null>(stream: T): T {
  if (stream) activeStreams.add(stream)
  return stream
}

function trackAudioContext<T extends AudioContext>(ctx: T): T {
  activeAudioContexts.add(ctx)
  return ctx
}

function cleanupRecordingResources() {
  activeIntervals.forEach((id) => { try { clearInterval(id) } catch {} })
  activeIntervals.clear()

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

function inferSuffixFromActiveTabUrl(url?: string | null): string {
  try {
    if (!url) return 'google-meet'
    const u = new URL(url)
    const last = u.pathname.split('/').pop() || 'google-meet'
    return last
  } catch { return 'google-meet' }
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
function attachRmsMeter(track: MediaStreamTrack, label: 'RAW' | 'FINAL') {
  try {
    const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext
    const ctx = trackAudioContext(new AC())
    void ctx.resume().catch(() => {})
    const src = ctx.createMediaStreamSource(new MediaStream([track]))
    const analyser = ctx.createAnalyser()
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
  }
}

// Nagrywanie i miksowanie.
async function maybeGetMicStream(): Promise<MediaStream | null> {
  if (!WANT_MIC_MIX) return null
  const prefs = await getMicPreferences()

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
      if (isMissingSelectedMicError(e)) {
        log('selected mic is no longer available; clearing saved microphone preference')
        await clearMicPreferences()
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
    return null
  }
}

function mixAudio(tabStream: MediaStream, micStream: MediaStream | null): MediaStream {
  const tabAudio = tabStream.getAudioTracks()[0]
  if (!micStream || !tabAudio) return tabStream

  const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext
  const ctx = trackAudioContext(new AC())
  void ctx.resume().catch(() => {})
  const dst = ctx.createMediaStreamDestination()

  try {
    const tabSource = ctx.createMediaStreamSource(new MediaStream([tabAudio]))
    tabSource.connect(dst)
  } catch (err) {
    log('tab source connect failed for mixing; using tab audio only', err)
    return tabStream
  }

  try {
    const micTrack = micStream.getAudioTracks()[0]
    if (micTrack) {
      const micSource = ctx.createMediaStreamSource(new MediaStream([micTrack]))
      micSource.connect(dst)
    }
  } catch (e) {
    log('mic source connect failed; continuing with tab audio only', e)
  }

  const final = new MediaStream([
    ...tabStream.getVideoTracks(),
    ...dst.stream.getAudioTracks()
  ])
  trackStream(final)

  // NIE zatrzymuj tutaj tabAudio; zatrzymanie zabije źródło nadrzędne.
  return final
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
  }
  log(`Attempting getUserMedia with streamId ${streamId} source= desktop`)
  return await withStreamTimeout(
    navigator.mediaDevices.getUserMedia(makeConstraints(streamId, 'desktop')),
    'desktop getUserMedia'
  )
}

let mediaRecorder: MediaRecorder | null = null
let chunks: BlobPart[] = []
let capturing = false

async function prepareAndRecord(baseStream: MediaStream): Promise<void> {
  trackStream(baseStream)
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

  const micStream = await maybeGetMicStream()
  const mixedStream = mixAudio(baseStream, micStream)

  const finalAudio = mixedStream.getAudioTracks()[0]
  if (finalAudio) attachRmsMeter(finalAudio, 'FINAL')
  if (!finalAudio) log('WARNING: final stream has NO audio track — recording will be silent')

  log('final stream tracks -> video:', mixedStream.getVideoTracks().length, 'audio:', mixedStream.getAudioTracks().length)

  // Kontrola bezpieczeństwa; nie jest fatalna.
  if (rawAudio) {
    try {
      const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext
      const ctx = trackAudioContext(new AC())
      await ctx.resume().catch(() => {})
      const src = ctx.createMediaStreamSource(new MediaStream([rawAudio]))
      const analyser = ctx.createAnalyser()
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
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
    ? 'video/webm;codecs=vp8,opus'
    : 'video/webm'

  mediaRecorder = new MediaRecorder(mixedStream, {
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
      try { mixedStream.getTracks().forEach(t => t.stop()) } catch {}
      cleanupRecordingResources()
      mediaRecorder = null
      capturing = false
      pushState(false)
      reject(new Error(e?.name || 'MediaRecorder error'))
    }

    mediaRecorder!.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size) chunks.push(e.data)
    }

    mediaRecorder!.onstop = async () => {
      try {
        const blob = new Blob(chunks, { type: mime })
        log('Finalizing; chunks =', chunks.length, 'blob.size =', blob.size)

        // Sufiks nazwy pliku.
        let suffix = 'google-meet'
        try {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
          suffix = inferSuffixFromActiveTabUrl(tabs[0]?.url || null)
        } catch {}

        const filename = `google-meet-recording-${suffix}-${Date.now()}.webm`
        const blobUrl = URL.createObjectURL(blob)
        getPort().postMessage({ type: 'OFFSCREEN_SAVE', filename, blobUrl })
      } catch (e) {
        log('Finalize/Save failed', e)
      } finally {
        cleanupRecordingResources()
        mediaRecorder = null
        chunks = []
        capturing = false
        pushState(false)
      }
    }
  })

  mediaRecorder.start(1000)

  // Jeśli karta nawiguje albo kończy się ścieżka wideo, zatrzymaj automatycznie.
  mixedStream.getVideoTracks()[0]?.addEventListener('ended', () => {
    log('Video track ended')
    if (mediaRecorder && capturing) { try { mediaRecorder.stop() } catch {} }
  })

  await started
}

async function startRecordingFromStreamId(streamId: string): Promise<void> {
  if (capturing) { log('Already recording; ignoring start'); return }
  cleanupRecordingResources()
  try {
    const baseStream = await captureWithStreamId(streamId)
    await prepareAndRecord(baseStream)
  } catch (e) {
    cleanupRecordingResources()
    mediaRecorder = null
    chunks = []
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
  try { mediaRecorder.stop() } catch (e) { console.error('[offscreen] Stop error', e); throw e }
}

// RPC przez port.
const rpcPort = getPort()
rpcPort.onMessage.addListener(async (msg: any) => {
  try {
    if (msg?.type === 'OFFSCREEN_START') {
      const streamId = msg.streamId as string | undefined
      if (!streamId) return respond(msg, { ok: false, error: 'Missing streamId' })
      try {
        // Poczekaj, aż nagrywanie faktycznie wystartuje.
        await startRecordingFromStreamId(streamId)
        return respond(msg, { ok: true })
      } catch (e: any) {
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
      return respond(msg, { recording })
    }

    if (msg?.type === 'DIAG_ECHO') {
      return respond(msg, { ok: true, pong: 'offscreen-alive' })
    }

    if (msg?.type === 'REVOKE_BLOB_URL' && typeof msg.blobUrl === 'string') {
      try { URL.revokeObjectURL(msg.blobUrl) } catch {}
      return
    }
  } catch (e) {
    console.error('[offscreen] error', e)
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
