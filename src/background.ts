// src/background.ts

import { captureException, captureMessage, initDiagnostics } from './diagnostics'
import { clearMicPreferences, getMicPreferences, type MicPreferences } from './micPreferences'

initDiagnostics('background')

let offscreenPort: chrome.runtime.Port | null = null
let offscreenReady = false
let lastKnownRecording = false
let currentRecordingTabId: number | null = null
let autoStopMeetTabId: number | null = null
let recordingStartedAt: number | null = null
const meetTabsInMeeting = new Set<number>()

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
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

function persistRecordingState(recording: boolean, startedAt: number | null): void {
  try {
    void (chrome.storage as any)?.session?.set?.({
      recording,
      recordingStartedAt: startedAt
    })?.catch?.(() => {})
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
  currentRecordingTabId = null
  autoStopMeetTabId = null
  recordingStartedAt = null
  persistRecordingState(false, null)
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
      lastKnownRecording = !!msg.recording
      if (lastKnownRecording && !recordingStartedAt) recordingStartedAt = Date.now()
      if (!lastKnownRecording) recordingStartedAt = null
      persistRecordingState(lastKnownRecording, recordingStartedAt)
      setBadge(lastKnownRecording, currentRecordingTabId)
      chrome.runtime.sendMessage({
        type: 'RECORDING_STATE',
        recording: lastKnownRecording,
        recordingStartedAt
      }).catch(() => {})
      if (!lastKnownRecording) {
        currentRecordingTabId = null
        autoStopMeetTabId = null
      }
    }

    if (msg?.type === 'OFFSCREEN_SAVE') {
      const filename =
        (typeof msg.filename === 'string' && msg.filename.trim())
          ? msg.filename
          : `google-meet-recording-${Date.now()}.webm`

      if (msg.blobUrl) {
        bglog('Saving OFFSCREEN_SAVE via blobUrl', filename)
        chrome.downloads.download({ url: msg.blobUrl, filename, saveAs: true }, () => {
          if (chrome.runtime.lastError) {
            bglog('downloads.download error:', chrome.runtime.lastError.message)
            captureMessage('downloads.download error', 'error', {
              operation: 'OFFSCREEN_SAVE',
              error: chrome.runtime.lastError.message
            })
          } else {
            chrome.runtime.sendMessage({ type: 'RECORDING_SAVED', filename }).catch(() => {})
          }
          setTimeout(() => {
            try { offscreenPort?.postMessage({ type: 'REVOKE_BLOB_URL', blobUrl: msg.blobUrl }) } catch {}
          }, 10_000)
        })
        return
      }
    }
  })

  port.onDisconnect.addListener(() => {
    bglog('Offscreen disconnected')
    offscreenPort = null
    offscreenReady = false
    lastKnownRecording = false
    currentRecordingTabId = null
    autoStopMeetTabId = null
    recordingStartedAt = null
    persistRecordingState(false, null)
    setBadge(false)
  })
})

function postToOffscreen(msg: any): Promise<any> {
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
    }, 15000)
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
  await ensureOffscreen()
  let response: any = { ok: true }
  if (offscreenPort) {
    response = await postToOffscreen({ type: 'OFFSCREEN_STOP', reason })
    bglog('postToOffscreen(OFFSCREEN_STOP) response', response)
  }
  lastKnownRecording = false
  setBadge(false, currentRecordingTabId)
  currentRecordingTabId = null
  autoStopMeetTabId = null
  recordingStartedAt = null
  persistRecordingState(false, null)
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
      bglog('Popup requested START_RECORDING for tabId', tabId)

      try {
        const start = async () => {
          await ensureOffscreen()
          bglog('ensureOffscreen() completed')

          const streamId = await getStreamIdForTab(tabId)
          const micPreferences = await getMicPreferencesForOffscreen()
          const r = await postToOffscreen({ type: 'OFFSCREEN_START', streamId, micPreferences })
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
          currentRecordingTabId = tabId
          autoStopMeetTabId = meetTabsInMeeting.has(tabId)
            ? (typeof msg.autoStopMeetTabId === 'number' ? msg.autoStopMeetTabId : tabId)
            : null
          if (!recordingStartedAt) recordingStartedAt = Date.now()
          persistRecordingState(true, recordingStartedAt)
          setBadge(true, tabId)
          chrome.runtime.sendMessage({
            type: 'RECORDING_STATE',
            recording: true,
            recordingStartedAt,
            warning: r.warning
          }).catch(() => {})
          sendResponse({ ok: true, micIncluded: r.micIncluded, warning: r.warning, recordingStartedAt })
        } else {
          sendResponse({ ok: false, error: r?.error || 'Failed to start' })
        }
      } catch (e: any) {
        bglog('OFFSCREEN_START failed', e)
        captureException(e, { operation: 'START_RECORDING' })
        await resetOffscreen()
        sendResponse({ ok: false, error: `OFFSCREEN_START failed: ${e?.message || e}` })
      }
      return
    }

    if (msg?.type === 'STOP_RECORDING') {
      try {
        await stopRecording('USER_STOP')
        sendResponse({ ok: true })
      } catch (e: any) {
        captureException(e, { operation: 'STOP_RECORDING' })
        sendResponse({ ok: false, error: `STOP failed: ${e?.message || e}` })
      }
      return
    }

    if (msg?.type === 'GET_RECORDING_STATUS') {
      if (!lastKnownRecording) {
        try {
          const sessionState = await (chrome.storage as any)?.session?.get?.(['recording', 'recordingStartedAt'])
          lastKnownRecording = !!sessionState?.recording
          recordingStartedAt = typeof sessionState?.recordingStartedAt === 'number'
            ? sessionState.recordingStartedAt
            : null
        } catch {}
      }
      sendResponse({ recording: lastKnownRecording, recordingStartedAt })
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
