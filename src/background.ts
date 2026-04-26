// src/background.ts

import { captureException, initDiagnostics } from './diagnostics'
import { getMeet2NoteExtensionToken } from './extensionAuth'
import { clearMicPreferences, getMicPreferences, type MicPreferences } from './micPreferences'

initDiagnostics('background')

let offscreenPort: chrome.runtime.Port | null = null
let offscreenReady = false
let lastKnownRecording = false
let recordingStarting = false
let recordingStartingTabId: number | null = null
let recordingStartRequestedAt: number | null = null
let recordingStopping = false
let currentRecordingTabId: number | null = null
let autoStopMeetTabId: number | null = null
let recordingStartedAt: number | null = null
const meetTabsInMeeting = new Set<number>()

type UploadStatus = 'idle' | 'uploading' | 'upload_retrying' | 'uploaded' | 'auth_required'

let currentUploadStatus: UploadStatus = 'idle'
let currentUploadError: string | null = null
let currentUploadNextRetryAt: number | null = null
let currentUploadedRecordingId: string | null = null

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
const DEFAULT_OFFSCREEN_RESPONSE_TIMEOUT_MS = 15_000
const STOP_OFFSCREEN_RESPONSE_TIMEOUT_MS = 3_000
function bglog(...a: any[]) { console.log('[background]', ...a) }
function setBadge(recording: boolean, tabId?: number | null) {
  const details: chrome.action.BadgeTextDetails = { text: recording ? 'REC' : '' }
  if (typeof tabId === 'number') details.tabId = tabId
  chrome.action.setBadgeText(details).catch?.(() => {})
}

function setMeetReadyBadge(tabId: number, ready: boolean) {
  if (lastKnownRecording && currentRecordingTabId === tabId) return
  chrome.action.setBadgeText({ tabId, text: ready ? 'RDY' : '' }).catch?.(() => {})
}

function clearRecordingAfterConfirmedStop(stoppedTabId: number | null): void {
  lastKnownRecording = false
  recordingStopping = false
  setBadge(false, stoppedTabId)
  currentRecordingTabId = null
  autoStopMeetTabId = null
  recordingStartedAt = null
  persistRecordingState(false, null)
  broadcastRecordingState()

  if (typeof stoppedTabId === 'number' && meetTabsInMeeting.has(stoppedTabId)) {
    setMeetReadyBadge(stoppedTabId, true)
  }
}

function persistRecordingState(recording: boolean, startedAt: number | null): void {
  try {
    void (chrome.storage as any)?.session?.set?.({
      recording,
      recordingStartedAt: startedAt,
      recordingStarting,
      recordingStartingTabId,
      recordingStartRequestedAt,
      recordingStopping
    })?.catch?.(() => {})
  } catch {}
}

function broadcastRecordingState(extra?: Record<string, unknown>): void {
  chrome.runtime.sendMessage({
    type: 'RECORDING_STATE',
    recording: lastKnownRecording,
    recordingStartedAt,
    starting: recordingStarting,
    startingTabId: recordingStartingTabId,
    startRequestedAt: recordingStartRequestedAt,
    stopping: recordingStopping,
    ...extra
  }).catch(() => {})
}

function setRecordingStarting(starting: boolean, tabId: number | null = null): void {
  recordingStarting = starting
  recordingStartingTabId = starting ? tabId : null
  recordingStartRequestedAt = starting ? Date.now() : null
  persistRecordingState(lastKnownRecording, recordingStartedAt)
  broadcastRecordingState()
}

function setRecordingStopping(stopping: boolean): void {
  recordingStopping = stopping
  persistRecordingState(lastKnownRecording, recordingStartedAt)
  broadcastRecordingState()
}

function persistUploadState(): void {
  try {
    void (chrome.storage as any)?.session?.set?.({
      uploadStatus: currentUploadStatus,
      uploadError: currentUploadError,
      uploadNextRetryAt: currentUploadNextRetryAt,
      uploadedRecordingId: currentUploadedRecordingId
    })?.catch?.(() => {})
  } catch {}
}

function setUploadState(
  status: UploadStatus,
  extra?: {
    error?: string | null
    nextRetryAt?: number | null
    recordingId?: string | null
  }
): void {
  currentUploadStatus = status
  currentUploadError = extra?.error ?? null
  currentUploadNextRetryAt = extra?.nextRetryAt ?? null
  currentUploadedRecordingId = extra?.recordingId ?? (status === 'uploaded' ? currentUploadedRecordingId : null)
  persistUploadState()
  chrome.runtime.sendMessage({
    type: 'UPLOAD_STATE',
    status: currentUploadStatus,
    error: currentUploadError,
    nextRetryAt: currentUploadNextRetryAt,
    recordingId: currentUploadedRecordingId
  }).catch(() => {})
}

function isUploadBlockingNewRecording(): boolean {
  return currentUploadStatus === 'uploading' || currentUploadStatus === 'upload_retrying'
}

function isUploadStatus(value: unknown): value is UploadStatus {
  return value === 'idle' ||
    value === 'uploading' ||
    value === 'upload_retrying' ||
    value === 'uploaded' ||
    value === 'auth_required'
}

async function hydrateUploadStateFromSession(): Promise<void> {
  try {
    const sessionState = await chrome.storage.session.get([
      'uploadStatus',
      'uploadError',
      'uploadNextRetryAt',
      'uploadedRecordingId'
    ])
    if (isUploadStatus(sessionState?.uploadStatus)) {
      currentUploadStatus = sessionState.uploadStatus
    }
    currentUploadError = typeof sessionState?.uploadError === 'string' ? sessionState.uploadError : null
    currentUploadNextRetryAt = typeof sessionState?.uploadNextRetryAt === 'number' ? sessionState.uploadNextRetryAt : null
    currentUploadedRecordingId = typeof sessionState?.uploadedRecordingId === 'string' ? sessionState.uploadedRecordingId : null
  } catch {}
}

async function getMicPreferencesForOffscreen(): Promise<MicPreferences> {
  try {
    return await getMicPreferences()
  } catch (e) {
    bglog('getMicPreferences failed; continuing without saved microphone preference', e)
    captureException(e, { operation: 'getMicPreferencesForOffscreen' })
    return {
      preferredMicDeviceId: null,
      preferredMicLabel: null
    }
  }
}

async function hasOffscreenContext(): Promise<boolean> {
  try {
    const getContexts = (chrome.runtime as any).getContexts as
      | ((q: { contextTypes: ('OFFSCREEN_DOCUMENT' | string)[] }) => Promise<any[]>)
      | undefined
    if (getContexts) {
      const ctx = await getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).catch(() => [])
      return Array.isArray(ctx) && ctx.length > 0
    }
  } catch {}
  try { return !!(await (chrome.offscreen as any).hasDocument?.()) } catch { return false }
}

async function ensureOffscreen(): Promise<void> {
  const have = await hasOffscreenContext()
  if (!have) {
    bglog('Creating offscreen document…')
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL('offscreen.html'),
      reasons: ['BLOBS', 'AUDIO_PLAYBACK', 'USER_MEDIA'],
      justification: 'Record tab audio+video in offscreen using MediaRecorder'
    })
  }

  for (let i = 0; i < 10 && !(offscreenPort && offscreenReady); i++) {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'OFFSCREEN_PING' })
      if (res?.ok) { bglog('Offscreen responded to PING'); break }
    } catch {}
    await wait(100)
  }

  if (!(offscreenPort && offscreenReady)) {
    try { await chrome.runtime.sendMessage({ type: 'OFFSCREEN_CONNECT' }) } catch {}
  }

  for (let i = 0; i < 50; i++) {
    if (offscreenPort && offscreenReady) return
    await wait(100)
  }
  throw new Error('Offscreen did not become ready')
}

async function resetOffscreen(): Promise<void> {
  try { offscreenPort?.disconnect() } catch {}
  offscreenPort = null
  offscreenReady = false
  lastKnownRecording = false
  recordingStarting = false
  recordingStartingTabId = null
  recordingStartRequestedAt = null
  recordingStopping = false
  currentRecordingTabId = null
  autoStopMeetTabId = null
  recordingStartedAt = null
  persistRecordingState(false, null)
  setUploadState('idle')
  setBadge(false)

  try {
    if (await hasOffscreenContext()) {
      await chrome.offscreen.closeDocument()
      await wait(250)
    }
  } catch (e) {
    bglog('Offscreen reset failed', e)
    captureException(e, { operation: 'resetOffscreen' })
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'offscreen') return
  bglog('Offscreen connected')
  offscreenPort = port
  offscreenReady = false

  port.onMessage.addListener((msg: any) => {
    if (msg?.type === 'OFFSCREEN_READY') {
      offscreenReady = true
      bglog('Offscreen is READY (Port)')
    }

    if (msg?.type === 'RECORDING_STATE') {
      const stateTabId = currentRecordingTabId
      lastKnownRecording = !!msg.recording
      const incomingStartedAt = typeof msg.recordingStartedAt === 'number' ? msg.recordingStartedAt : null
      if (lastKnownRecording) {
        recordingStarting = false
        recordingStartingTabId = null
        recordingStartRequestedAt = null
      }
      if (lastKnownRecording && incomingStartedAt) recordingStartedAt = incomingStartedAt
      if (lastKnownRecording && !recordingStartedAt) recordingStartedAt = Date.now()
      if (!lastKnownRecording) {
        recordingStartedAt = null
        recordingStopping = false
      }
      persistRecordingState(lastKnownRecording, recordingStartedAt)
      setBadge(lastKnownRecording, currentRecordingTabId)
      if (!lastKnownRecording && typeof stateTabId === 'number' && meetTabsInMeeting.has(stateTabId)) {
        setMeetReadyBadge(stateTabId, true)
      }
      broadcastRecordingState()
      if (!lastKnownRecording) {
        currentRecordingTabId = null
        autoStopMeetTabId = null
      }
    }

    if (msg?.type === 'UPLOAD_STATE') {
      const status = typeof msg.status === 'string' ? msg.status as UploadStatus : 'idle'
      if (isUploadStatus(status)) {
        setUploadState(status, {
          error: typeof msg.error === 'string' ? msg.error : null,
          nextRetryAt: typeof msg.nextRetryAt === 'number' ? msg.nextRetryAt : null,
          recordingId: typeof msg.recordingId === 'string' ? msg.recordingId : null
        })
      }
    }
  })

  port.onDisconnect.addListener(() => {
    bglog('Offscreen disconnected')
    offscreenPort = null
    offscreenReady = false
    lastKnownRecording = false
    recordingStarting = false
    recordingStartingTabId = null
    recordingStartRequestedAt = null
    recordingStopping = false
    currentRecordingTabId = null
    autoStopMeetTabId = null
    recordingStartedAt = null
    persistRecordingState(false, null)
    if (currentUploadStatus !== 'uploading' && currentUploadStatus !== 'upload_retrying') {
      setUploadState('idle')
    }
    setBadge(false)
  })
})

function postToOffscreen(msg: any, timeoutMs = DEFAULT_OFFSCREEN_RESPONSE_TIMEOUT_MS): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!offscreenPort) return reject(new Error('Offscreen port not connected'))
    const port = offscreenPort
    const id = Math.random().toString(36).slice(2)
    msg.__id = id
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const listener = (m: any) => {
      if (m && m.__respFor === id) {
        port.onMessage.removeListener(listener)
        if (timeoutId) clearTimeout(timeoutId)
        resolve(m.payload)
      }
    }

    port.onMessage.addListener(listener)
    port.postMessage(msg)

    timeoutId = setTimeout(() => {
      try { port.onMessage.removeListener(listener) } catch {}
      reject(new Error('Offscreen response timeout'))
    }, timeoutMs)
  })
}

function isRecoverableOffscreenStartFailure(error: unknown): boolean {
  const message = `${error || ''}`
  return message.includes('Offscreen response timeout') ||
    message.includes('Offscreen port not connected') ||
    message.includes('Cannot capture a tab with an active stream')
}

// Helper streamId po stronie tła.
function getStreamIdForTab(tabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id?: string) => {
        const err = chrome.runtime.lastError
        if (err) return reject(new Error(err.message))
        if (!id) return reject(new Error('Empty streamId'))
        resolve(id)
      })
    } catch (e) {
      reject(e as any)
    }
  })
}

async function stopRecording(reason: string): Promise<any> {
  bglog('Stopping recording:', reason)
  const stoppedTabId = currentRecordingTabId
  recordingStarting = false
  recordingStartingTabId = null
  recordingStartRequestedAt = null
  setRecordingStopping(true)
  await ensureOffscreen()
  let response: any = { ok: true }
  if (offscreenPort) {
    try {
      response = await postToOffscreen(
        { type: 'OFFSCREEN_STOP', reason },
        STOP_OFFSCREEN_RESPONSE_TIMEOUT_MS
      )
      bglog('postToOffscreen(OFFSCREEN_STOP) response', response)
    } catch (e: any) {
      if (`${e?.message || e}`.includes('Offscreen response timeout')) {
        bglog('OFFSCREEN_STOP timed out; clearing UI stop state and waiting for async offscreen state if it arrives', e)
        captureException(e, { operation: 'STOP_RECORDING.timeout' })
        clearRecordingAfterConfirmedStop(stoppedTabId)
        return { ok: true, warning: 'STOP_TIMEOUT_STATE_CLEARED' }
      }
      setRecordingStopping(false)
      throw e
    }
  }

  if (response?.ok === false) {
    setRecordingStopping(false)
    throw new Error(response.error || 'OFFSCREEN_STOP failed')
  }

  clearRecordingAfterConfirmedStop(stoppedTabId)
  return response
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type === 'MEET_MEETING_STATE') {
      const tabId = _sender.tab?.id
      if (typeof tabId !== 'number') { sendResponse({ ok: false, error: 'Missing sender tab' }); return }

      if (msg.inMeeting) {
        bglog('Meet meeting detected on tab', tabId)
        meetTabsInMeeting.add(tabId)
        if (lastKnownRecording && currentRecordingTabId === tabId && autoStopMeetTabId === null) {
          autoStopMeetTabId = tabId
        }
        setMeetReadyBadge(tabId, true)
      } else {
        bglog('Meet meeting left on tab', tabId)
        const wasConfirmedInMeeting = meetTabsInMeeting.has(tabId)
        meetTabsInMeeting.delete(tabId)
        setMeetReadyBadge(tabId, false)
        if (wasConfirmedInMeeting && lastKnownRecording && autoStopMeetTabId === tabId) {
          try {
            await stopRecording('MEET_LEFT')
            sendResponse({ ok: true, stopped: true })
          } catch (e: any) {
            captureException(e, { operation: 'MEET_AUTO_STOP' })
            sendResponse({ ok: false, error: `AUTO_STOP failed: ${e?.message || e}` })
          }
          return
        }
      }

      sendResponse({ ok: true })
      return
    }

    if (msg?.type === 'START_RECORDING') {
      const tabId: number | undefined = msg.tabId
      if (typeof tabId !== 'number') { sendResponse({ ok: false, error: 'Missing tabId' }); return }
      if (recordingStarting || recordingStopping) {
        sendResponse({
          ok: true,
          starting: recordingStarting,
          stopping: recordingStopping,
          startRequestedAt: recordingStartRequestedAt
        })
        return
      }
      if (lastKnownRecording) {
        sendResponse({ ok: true, recording: true, recordingStartedAt })
        return
      }
      await hydrateUploadStateFromSession()
      if (isUploadBlockingNewRecording()) {
        sendResponse({ ok: false, error: 'Upload is still in progress' })
        return
      }
      bglog('Popup requested START_RECORDING for tabId', tabId)
      setRecordingStarting(true, tabId)

      try {
        const start = async () => {
          await ensureOffscreen()
          bglog('ensureOffscreen() completed')

          const streamId = await getStreamIdForTab(tabId)
          const micPreferences = await getMicPreferencesForOffscreen()
          const tab = await chrome.tabs.get(tabId).catch(() => null)
          const r = await postToOffscreen({
            type: 'OFFSCREEN_START',
            streamId,
            micPreferences,
            recordingContext: {
              tabUrl: tab?.url || null,
              tabTitle: tab?.title || null
            }
          })
          bglog('postToOffscreen(OFFSCREEN_START) response', r)
          return r
        }

        const startWithRecovery = async () => {
          const first = await start()
          if (first?.ok !== false || !isRecoverableOffscreenStartFailure(first?.error)) return first

          bglog('OFFSCREEN_START returned recoverable error; resetting offscreen and retrying once', first?.error)
          await resetOffscreen()
          return await start()
        }

        let r: any
        try {
          r = await startWithRecovery()
        } catch (e: any) {
          if (!isRecoverableOffscreenStartFailure(e?.message || e)) throw e
          bglog('OFFSCREEN_START failed with recoverable transport error; resetting offscreen and retrying once')
          await resetOffscreen()
          r = await start()
        }

        if (r?.ok) {
          lastKnownRecording = true
          recordingStarting = false
          recordingStartingTabId = null
          recordingStartRequestedAt = null
          currentRecordingTabId = tabId
          autoStopMeetTabId = meetTabsInMeeting.has(tabId)
            ? (typeof msg.autoStopMeetTabId === 'number' ? msg.autoStopMeetTabId : tabId)
            : null
          if (!recordingStartedAt) recordingStartedAt = Date.now()
          persistRecordingState(true, recordingStartedAt)
          if (currentUploadStatus === 'uploaded') setUploadState('idle')
          setBadge(true, tabId)
          broadcastRecordingState({ warning: r.warning })
          sendResponse({ ok: true, micIncluded: r.micIncluded, warning: r.warning, recordingStartedAt })
        } else {
          setRecordingStarting(false)
          sendResponse({ ok: false, error: r?.error || 'Failed to start' })
        }
      } catch (e: any) {
        bglog('OFFSCREEN_START failed', e)
        captureException(e, { operation: 'START_RECORDING' })
        await resetOffscreen()
        setRecordingStarting(false)
        sendResponse({ ok: false, error: `OFFSCREEN_START failed: ${e?.message || e}` })
      }
      return
    }

    if (msg?.type === 'STOP_RECORDING') {
      try {
        const response = await stopRecording('USER_STOP')
        if (response?.ok === false) {
          sendResponse({ ok: false, error: response.error || 'Failed to stop' })
          return
        }
        sendResponse({
          ok: true,
          warning: typeof response?.warning === 'string' ? response.warning : undefined
        })
      } catch (e: any) {
        captureException(e, { operation: 'STOP_RECORDING' })
        sendResponse({ ok: false, error: `STOP failed: ${e?.message || e}` })
      }
      return
    }

    if (msg?.type === 'GET_RECORDING_STATUS') {
      try {
        const sessionState = await (chrome.storage as any)?.session?.get?.([
          'recording',
          'recordingStartedAt',
          'recordingStarting',
          'recordingStartingTabId',
          'recordingStartRequestedAt',
          'recordingStopping',
          'uploadStatus',
          'uploadError',
          'uploadNextRetryAt',
          'uploadedRecordingId'
        ])
        lastKnownRecording = !!sessionState?.recording
        recordingStartedAt = typeof sessionState?.recordingStartedAt === 'number'
          ? sessionState.recordingStartedAt
          : null
        recordingStarting = !!sessionState?.recordingStarting
        recordingStartingTabId = typeof sessionState?.recordingStartingTabId === 'number'
          ? sessionState.recordingStartingTabId
          : null
        recordingStartRequestedAt = typeof sessionState?.recordingStartRequestedAt === 'number'
          ? sessionState.recordingStartRequestedAt
          : null
        recordingStopping = !!sessionState?.recordingStopping
        if (isUploadStatus(sessionState?.uploadStatus)) {
          currentUploadStatus = sessionState.uploadStatus
        }
        currentUploadError = typeof sessionState?.uploadError === 'string' ? sessionState.uploadError : null
        currentUploadNextRetryAt = typeof sessionState?.uploadNextRetryAt === 'number' ? sessionState.uploadNextRetryAt : null
        currentUploadedRecordingId = typeof sessionState?.uploadedRecordingId === 'string' ? sessionState.uploadedRecordingId : null
      } catch {}
      sendResponse({
        recording: lastKnownRecording,
        recordingStartedAt,
        starting: recordingStarting,
        startingTabId: recordingStartingTabId,
        startRequestedAt: recordingStartRequestedAt,
        stopping: recordingStopping,
        uploadStatus: currentUploadStatus,
        uploadError: currentUploadError,
        uploadNextRetryAt: currentUploadNextRetryAt,
        uploadedRecordingId: currentUploadedRecordingId
      })
      return
    }

    if (msg?.type === 'CLEAR_MIC_PREFERENCES') {
      try {
        await clearMicPreferences()
        sendResponse({ ok: true })
      } catch (e: any) {
        captureException(e, { operation: 'CLEAR_MIC_PREFERENCES' })
        sendResponse({ ok: false, error: e?.message || String(e) })
      }
      return
    }

    if (msg?.type === 'GET_MEET2NOTE_EXTENSION_TOKEN') {
      try {
        const token = await getMeet2NoteExtensionToken()
        if (typeof token === 'string' && token.trim()) {
          sendResponse({ ok: true, token })
        } else {
          sendResponse({ ok: false, error: 'Connect to Meet2Note before uploading.' })
        }
      } catch (e: any) {
        captureException(e, { operation: 'GET_MEET2NOTE_EXTENSION_TOKEN' })
        sendResponse({ ok: false, error: e?.message || String(e) })
      }
      return
    }
  })().catch((err) => {
    console.error('[background] top-level error', err)
    captureException(err, { operation: 'runtime.onMessage' })
    sendResponse({ ok: false, error: String(err) })
  })

  return true
})

chrome.runtime.onSuspend?.addListener(async () => {
  try { if (offscreenPort) await postToOffscreen({ type: 'OFFSCREEN_STOP' }) } catch {}
  setBadge(false)
})
