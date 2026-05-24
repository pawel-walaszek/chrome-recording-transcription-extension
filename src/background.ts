// src/background.ts

import { captureException, initDiagnostics } from './diagnostics'
import {
  getMeet2NoteExtensionToken,
  isMeet2NoteAuthError,
  markMeet2NoteReconnectRequired,
  MEET2NOTE_EXTENSION_TOKEN_KEY
} from './extensionAuth'
import { clearMicPreferences, getMicPreferences, type MicPreferences } from './micPreferences'
import {
  isLocalOnlyFailureWithoutRecording,
  normalizeRecordingHistory,
  POPUP_RECORDING_HISTORY_LIMIT,
  readRecordingHistory,
  updateRecordingHistory,
  upsertRecordingHistoryItem,
  type RecordingHistoryItem
} from './recordingHistory'
import { listMeet2NoteRecordings, type BackendRecordingListItem } from './recordingsClient'

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
let lastRecordingError: string | null = null
const meetTabsInMeeting = new Set<number>()
let recentRecordings: RecordingHistoryItem[] = []
let backendRecordings: RecordingHistoryItem[] = []
let backendRecordingsRefreshPromise: Promise<void> | null = null
let backendRecordingsLastRefreshedAt = 0
let localMaintenanceWakePromise: Promise<unknown> | null = null
let localMaintenanceLastWokeAt = 0
const BACKEND_RECORDINGS_REFRESH_THROTTLE_MS = 15_000

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
const DEFAULT_OFFSCREEN_RESPONSE_TIMEOUT_MS = 15_000
const LOCAL_MAINTENANCE_OFFSCREEN_RESPONSE_TIMEOUT_MS = 60_000
const LOCAL_MAINTENANCE_WAKE_INTERVAL_MS = 60_000
const STOP_OFFSCREEN_RESPONSE_TIMEOUT_MS = 3_000
const EXTENSION_LOCAL_RECORDING_FAILURE_STAGE = 'local_recording'
const EXTENSION_ORPHANED_CHUNKS_FAILURE_STAGE = 'local_spool_orphaned_chunks'
type CaptureSource = 'tab' | 'desktop'

interface CaptureStreamRequest {
  streamId: string
  captureSource: CaptureSource
  canRequestAudioTrack: boolean
}

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

function restoreMeetReadyBadges(preferredTabId?: number | null): void {
  if (lastKnownRecording) return

  const readyTabIds = new Set(meetTabsInMeeting)
  if (typeof preferredTabId === 'number' && meetTabsInMeeting.has(preferredTabId)) {
    readyTabIds.add(preferredTabId)
  }

  for (const tabId of readyTabIds) {
    setMeetReadyBadge(tabId, true)
  }
}

function clearRecordingBadges(preferredReadyTabId?: number | null): void {
  void (async () => {
    try {
      await chrome.action.setBadgeText({ text: '' })
      const tabs = await chrome.tabs.query({})
      await Promise.all(tabs.map((tab) => (
        typeof tab.id === 'number'
          ? chrome.action.setBadgeText({ tabId: tab.id, text: '' })
          : Promise.resolve()
      )))
    } catch (e) {
      captureException(e, { operation: 'clearRecordingBadges' })
      setBadge(false, preferredReadyTabId)
      setBadge(false)
    } finally {
      restoreMeetReadyBadges(preferredReadyTabId)
    }
  })()
}

function clearRecordingAfterConfirmedStop(stoppedTabId: number | null): void {
  lastKnownRecording = false
  recordingStopping = false
  currentRecordingTabId = null
  autoStopMeetTabId = null
  recordingStartedAt = null
  persistRecordingState(false, null)
  clearRecordingBadges(stoppedTabId)
  broadcastRecordingState()
}

function persistRecordingState(recording: boolean, startedAt: number | null): void {
  try {
    void (chrome.storage as any)?.session?.set?.({
      recording,
      recordingStartedAt: startedAt,
      recordingStarting,
      recordingStartingTabId,
      recordingStartRequestedAt,
      recordingStopping,
      lastRecordingError
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
    error: lastRecordingError,
    ...extra
  }).catch(() => {})
}

function setRecordingStarting(starting: boolean, tabId: number | null = null): void {
  recordingStarting = starting
  recordingStartingTabId = starting ? tabId : null
  recordingStartRequestedAt = starting ? Date.now() : null
  if (starting) lastRecordingError = null
  persistRecordingState(lastKnownRecording, recordingStartedAt)
  broadcastRecordingState()
}

function setLastRecordingError(error: unknown): void {
  lastRecordingError = getErrorMessage(error) || 'Recording could not start.'
  persistRecordingState(lastKnownRecording, recordingStartedAt)
  broadcastRecordingState()
}

function setRecordingStopping(stopping: boolean): void {
  recordingStopping = stopping
  persistRecordingState(lastKnownRecording, recordingStartedAt)
  broadcastRecordingState()
}

async function hydrateRecentRecordings(): Promise<RecordingHistoryItem[]> {
  try {
    recentRecordings = mergeRecordingHistory(await readRecordingHistory(), backendRecordings)
      .slice(0, POPUP_RECORDING_HISTORY_LIMIT)
    return recentRecordings
  } catch {}
  return recentRecordings
}

async function refreshRecentRecordingsFromBackend(): Promise<RecordingHistoryItem[]> {
  backendRecordings = await readBackendRecordingHistory()
  const localHistory = await pruneBackendOwnedLocalHistory(backendRecordings)
  recentRecordings = mergeRecordingHistory(localHistory, backendRecordings).slice(0, POPUP_RECORDING_HISTORY_LIMIT)
  return recentRecordings
}

async function pruneBackendOwnedLocalHistory(
  backendHistory: RecordingHistoryItem[]
): Promise<RecordingHistoryItem[]> {
  if (!backendHistory.length) return readRecordingHistory()

  const backendIds = new Set(
    backendHistory
      .map(item => item.backendRecordingId)
      .filter((backendId): backendId is string => typeof backendId === 'string' && backendId.length > 0)
  )
  if (!backendIds.size) return readRecordingHistory()

  return updateRecordingHistory((currentHistory) => {
    let changed = false
    const pruned = currentHistory.filter((item) => {
      if (!item.backendRecordingId || !backendIds.has(item.backendRecordingId)) return true
      if (isLocalOnlyPopupHistoryItem(item)) return true
      changed = true
      return false
    })
    return changed ? pruned : currentHistory
  })
}

function backendRecordingToHistoryItem(recording: BackendRecordingListItem): RecordingHistoryItem {
  const recordedAt = recording.startedAt || recording.createdAt
  return {
    localId: `backend:${recording.id}`,
    status: recording.status,
    title: recording.title,
    startedAt: recordedAt,
    stoppedAt: recording.updatedAt || recording.createdAt,
    durationMs: recording.durationMs ?? 0,
    videoBytes: 0,
    microphoneBytes: 0,
    attempt: 0,
    nextRetryAt: null,
    backendRecordingId: recording.id,
    assets: [],
    error: recording.status === 'failed' ? 'Processing failed in Meet2Note.' : null,
    failureReason: recording.status === 'failed' ? 'upload_error' : null,
    displayTimeline: recording.displayTimeline,
    createdAt: recording.createdAt,
    updatedAt: recording.updatedAt || recording.createdAt
  }
}

function shouldShowBackendRecordingInExtension(recording: BackendRecordingListItem): boolean {
  if (recording.status !== 'failed') return true
  if (recording.failureStage === EXTENSION_ORPHANED_CHUNKS_FAILURE_STAGE) return false
  if (
    recording.failureStage === EXTENSION_LOCAL_RECORDING_FAILURE_STAGE &&
    recording.failureMessage?.includes('Local recording id:')
  ) {
    return false
  }
  return true
}

async function readBackendRecordingHistory(): Promise<RecordingHistoryItem[]> {
  const token = await getMeet2NoteExtensionToken().catch(() => null)
  if (!token) return []

  try {
    const recordings = await listMeet2NoteRecordings(token)
    return recordings
      .filter(shouldShowBackendRecordingInExtension)
      .map(backendRecordingToHistoryItem)
  } catch (e) {
    bglog('Backend recordings list failed', e)
    captureException(e, { operation: 'readBackendRecordingHistory' })
    return []
  }
}

function mergeRecordingHistory(
  localHistory: RecordingHistoryItem[],
  backendHistory: RecordingHistoryItem[]
): RecordingHistoryItem[] {
  const normalizedLocalHistory = normalizeRecordingHistory(localHistory)
  const normalizedBackendHistory = normalizeRecordingHistory(backendHistory)

  if (!normalizedBackendHistory.length) return normalizedLocalHistory

  const localByBackendId = new Map<string, RecordingHistoryItem>()

  for (const item of normalizedLocalHistory) {
    if (item.backendRecordingId) {
      localByBackendId.set(item.backendRecordingId, item)
    }
  }

  const backendMergedHistory = normalizedBackendHistory.map((backendItem) => {
    const backendId = backendItem.backendRecordingId
    const existing = backendId ? localByBackendId.get(backendId) : undefined
    if (!existing) return backendItem

    return {
      ...existing,
      status: backendItem.status,
      title: mergedRecordingTitle(existing, backendItem),
      startedAt: backendItem.startedAt,
      stoppedAt: backendItem.stoppedAt,
      durationMs: backendItem.durationMs > 0 ? backendItem.durationMs : existing.durationMs,
      backendRecordingId: backendId,
      error: backendItem.error,
      failureReason: backendItem.failureReason,
      displayTimeline: backendItem.displayTimeline,
      createdAt: backendItem.createdAt,
      updatedAt: backendItem.updatedAt
    }
  })

  const backendIds = new Set(
    backendMergedHistory
      .map(item => item.backendRecordingId)
      .filter((backendId): backendId is string => typeof backendId === 'string' && backendId.length > 0)
  )
  const localOnlyActionableHistory = normalizedLocalHistory.filter((item) => (
    isLocalOnlyPopupHistoryItem(item) &&
    (!item.backendRecordingId || !backendIds.has(item.backendRecordingId))
  ))

  return sortRecordingHistoryForDisplay([
    ...localOnlyActionableHistory,
    ...backendMergedHistory
  ])
}

function mergedRecordingTitle(existing: RecordingHistoryItem, backendItem: RecordingHistoryItem): string {
  if (backendItem.title && (!existing.title || existing.title === 'Browser recording')) {
    return backendItem.title
  }
  return existing.title || backendItem.title
}

function recordingDisplayTimestamp(item: RecordingHistoryItem): number {
  const primary = Date.parse(item.startedAt || item.createdAt)
  if (Number.isFinite(primary)) return primary
  const fallback = Date.parse(item.createdAt || item.updatedAt)
  return Number.isFinite(fallback) ? fallback : 0
}

function recordingCreatedTimestamp(item: RecordingHistoryItem): number {
  const createdAt = Date.parse(item.createdAt)
  return Number.isFinite(createdAt) ? createdAt : 0
}

function recordingStableSortId(item: RecordingHistoryItem): string {
  return item.backendRecordingId || item.localId
}

function sortRecordingHistoryForDisplay(items: RecordingHistoryItem[]): RecordingHistoryItem[] {
  return [...items].sort((a, b) =>
    recordingDisplayTimestamp(b) - recordingDisplayTimestamp(a) ||
    recordingCreatedTimestamp(b) - recordingCreatedTimestamp(a) ||
    recordingStableSortId(b).localeCompare(recordingStableSortId(a))
  )
}

function isLocalOnlyPopupHistoryItem(item: RecordingHistoryItem): boolean {
  return item.status === 'recording' ||
    item.status === 'finalizing' ||
    item.status === 'upload_queued' ||
    item.status === 'uploading' ||
    (item.status === 'failed' && item.failureReason === 'auth_required') ||
    isLocalOnlyFailureWithoutRecording(item)
}

function scheduleBackendRecordingsRefresh(force = false): Promise<void> | null {
  const now = Date.now()
  if (backendRecordingsRefreshPromise) return backendRecordingsRefreshPromise
  if (!force && now - backendRecordingsLastRefreshedAt < BACKEND_RECORDINGS_REFRESH_THROTTLE_MS) return null

  backendRecordingsRefreshPromise = refreshRecentRecordingsFromBackend()
    .then(() => {
      backendRecordingsLastRefreshedAt = Date.now()
      broadcastUploadQueueState()
    })
    .catch((e: any) => {
      captureException(e, { operation: 'scheduleBackendRecordingsRefresh' })
    })
    .finally(() => {
      backendRecordingsRefreshPromise = null
    })

  return backendRecordingsRefreshPromise
}

async function refreshRecentRecordingsForPopup(): Promise<void> {
  await hydrateRecentRecordings()
  scheduleBackendRecordingsRefresh()
}

function broadcastUploadQueueState(items = recentRecordings): void {
  chrome.runtime.sendMessage({
    type: 'UPLOAD_QUEUE_STATE',
    items
  }).catch(() => {})
}

function hasPendingLocalUpload(items = recentRecordings): boolean {
  return items.some(item =>
    item.status === 'upload_queued' ||
    item.status === 'uploading' ||
    (item.status === 'failed' && (item.failureReason === 'auth_required' || !item.backendRecordingId)) ||
    (item.status === 'canceled' && !item.backendRecordingId) ||
    item.status === 'recording' ||
    item.status === 'finalizing'
  )
}

async function hasPendingLocalUploadInHistory(): Promise<boolean> {
  try {
    return hasPendingLocalUpload(await readRecordingHistory())
  } catch (e) {
    captureException(e, { operation: 'hasPendingLocalUploadInHistory' })
    return hasPendingLocalUpload()
  }
}

async function runOffscreenLocalMaintenance(): Promise<unknown> {
  await ensureOffscreen()
  if (offscreenPort) {
    const response = await postToOffscreen(
      { type: 'OFFSCREEN_RUN_LOCAL_MAINTENANCE' },
      LOCAL_MAINTENANCE_OFFSCREEN_RESPONSE_TIMEOUT_MS
    ).catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }))
    return response
  }
  return { ok: false, error: 'Offscreen port not connected' }
}

async function readOffscreenRecordingStatus(): Promise<Record<string, unknown> | null> {
  if (!offscreenPort && !await hasOffscreenContext().catch(() => false)) return null
  await ensureOffscreen()
  if (!offscreenPort) return null
  const response = await postToOffscreen(
    { type: 'OFFSCREEN_STATUS' },
    DEFAULT_OFFSCREEN_RESPONSE_TIMEOUT_MS
  ).catch(() => null)
  return response && typeof response === 'object'
    ? response as Record<string, unknown>
    : null
}

function wakeOffscreenForLocalMaintenance(): void {
  void Promise.all([
    hasPendingLocalUploadInHistory(),
    getMeet2NoteExtensionToken().catch(() => null)
  ])
    .then(async ([hasPendingUploads, token]) => {
      if (!hasPendingUploads && !token) return undefined
      if (!hasPendingUploads && Date.now() - localMaintenanceLastWokeAt < LOCAL_MAINTENANCE_WAKE_INTERVAL_MS) {
        return undefined
      }
      if (localMaintenanceWakePromise) return localMaintenanceWakePromise
      localMaintenanceLastWokeAt = Date.now()
      localMaintenanceWakePromise = runOffscreenLocalMaintenance()
        .finally(() => {
          localMaintenanceWakePromise = null
        })
      await localMaintenanceWakePromise
      return undefined
    })
    .catch((e) => {
      bglog('Failed to wake offscreen for local maintenance', e)
      captureException(e, { operation: 'wakeOffscreenForLocalMaintenance' })
    })
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
  clearRecordingBadges()

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
      if (lastKnownRecording) {
        setBadge(true, currentRecordingTabId)
      } else {
        clearRecordingBadges(stateTabId)
      }
      broadcastRecordingState()
      if (!lastKnownRecording) {
        currentRecordingTabId = null
        autoStopMeetTabId = null
      }
    }

    if (msg?.type === 'UPLOAD_QUEUE_STATE' && Array.isArray(msg.items)) {
      recentRecordings = mergeRecordingHistory(
        normalizeRecordingHistory(msg.items),
        backendRecordings
      ).slice(0, POPUP_RECORDING_HISTORY_LIMIT)
      broadcastUploadQueueState()
      scheduleBackendRecordingsRefresh()
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
    clearRecordingBadges()

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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return `${error || ''}`
}

function isRecoverableOffscreenStartFailure(error: unknown): boolean {
  const message = `${error || ''}`
  return message.includes('Offscreen response timeout') ||
    message.includes('Offscreen port not connected') ||
    message.includes('Cannot capture a tab with an active stream')
}

function shouldFallbackToDesktopCapture(error: unknown): boolean {
  const message = getErrorMessage(error)
  if (!message) return false
  if (message.includes('Screen/tab selection was canceled')) return false
  if (message.includes('Already recording')) return false
  if (message.includes('Recording is still stopping')) return false
  return message.includes('OFFSCREEN_START') ||
    message.includes('tabCapture') ||
    message.includes('getMediaStreamId') ||
    message.includes('getUserMedia') ||
    message.includes('Could not start') ||
    message.includes('Permission denied') ||
    message.includes('NotAllowedError') ||
    message.includes('NotReadableError') ||
    message.includes('No video track') ||
    message.includes('media stream') ||
    message.includes('capture')
}

// Helper streamId po stronie tła.
function getStreamIdForTab(tabId: number): Promise<CaptureStreamRequest> {
  return new Promise((resolve, reject) => {
    try {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId?: string) => {
        const err = chrome.runtime.lastError
        if (err) return reject(new Error(err.message))
        if (!streamId) return reject(new Error('Empty streamId'))
        resolve({
          streamId,
          captureSource: 'tab',
          canRequestAudioTrack: true
        })
      })
    } catch (e) {
      reject(e as any)
    }
  })
}

function chooseDesktopStream(): Promise<CaptureStreamRequest> {
  return new Promise((resolve, reject) => {
    try {
      chrome.desktopCapture.chooseDesktopMedia(['tab', 'audio'], (streamId, options) => {
        const err = chrome.runtime.lastError
        if (err) return reject(new Error(err.message))
        if (!streamId) return reject(new Error('Screen/tab selection was canceled.'))
        resolve({
          streamId,
          captureSource: 'desktop',
          canRequestAudioTrack: options?.canRequestAudioTrack !== false
        })
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

  if (response?.stopping || response?.alreadyStopping) {
    return response
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
      bglog('Popup requested START_RECORDING for tabId', tabId)
      setRecordingStarting(true, tabId)

      try {
        const start = async (captureRequestFactory: () => Promise<CaptureStreamRequest>) => {
          await ensureOffscreen()
          bglog('ensureOffscreen() completed')

          const captureRequest = await captureRequestFactory()
          const micPreferences = await getMicPreferencesForOffscreen()
          const tab = await chrome.tabs.get(tabId).catch(() => null)
          const r = await postToOffscreen({
            type: 'OFFSCREEN_START',
            streamId: captureRequest.streamId,
            captureSource: captureRequest.captureSource,
            canRequestAudioTrack: captureRequest.canRequestAudioTrack,
            micPreferences,
            recordingContext: {
              tabUrl: tab?.url || null,
              tabTitle: tab?.title || null
            }
          })
          bglog('postToOffscreen(OFFSCREEN_START) response', r)
          return r
        }

        const startWithRecovery = async (captureRequestFactory: () => Promise<CaptureStreamRequest>) => {
          const first = await start(captureRequestFactory)
          if (first?.ok !== false || !isRecoverableOffscreenStartFailure(first?.error)) return first

          bglog('OFFSCREEN_START returned recoverable error; resetting offscreen and retrying once', first?.error)
          await resetOffscreen()
          return await start(captureRequestFactory)
        }

        let r: any
        let tabCaptureFailure: unknown = null
        try {
          r = await startWithRecovery(() => getStreamIdForTab(tabId))
        } catch (e: any) {
          tabCaptureFailure = e
          if (!isRecoverableOffscreenStartFailure(e?.message || e)) {
            r = { ok: false, error: e?.message || String(e) }
          } else {
            bglog('OFFSCREEN_START failed with recoverable transport error; resetting offscreen and retrying once')
            await resetOffscreen()
            try {
              r = await start(() => getStreamIdForTab(tabId))
            } catch (retryError: any) {
              tabCaptureFailure = retryError
              r = { ok: false, error: retryError?.message || String(retryError) }
            }
          }
        }

        if (r?.ok === false) tabCaptureFailure = r.error
        if (r?.ok === false && shouldFallbackToDesktopCapture(tabCaptureFailure)) {
          bglog('Tab capture failed; falling back to desktop capture picker', tabCaptureFailure)
          await resetOffscreen()
          setRecordingStarting(true, tabId)
          r = await startWithRecovery(chooseDesktopStream)
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
          setBadge(true, tabId)
          broadcastRecordingState({ warning: r.warning })
          sendResponse({ ok: true, micIncluded: r.micIncluded, warning: r.warning, recordingStartedAt })
        } else {
          setRecordingStarting(false)
          setLastRecordingError(r?.error || 'Failed to start')
          sendResponse({ ok: false, error: r?.error || 'Failed to start' })
        }
      } catch (e: any) {
        bglog('OFFSCREEN_START failed', e)
        captureException(e, { operation: 'START_RECORDING' })
        await resetOffscreen()
        setRecordingStarting(false)
        setLastRecordingError(`OFFSCREEN_START failed: ${e?.message || e}`)
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
          stopping: !!response?.stopping,
          alreadyStopping: !!response?.alreadyStopping,
          alreadyStopped: !!response?.alreadyStopped,
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
          'lastRecordingError'
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
        lastRecordingError = typeof sessionState?.lastRecordingError === 'string'
          ? sessionState.lastRecordingError
          : null

        const offscreenStatus = await readOffscreenRecordingStatus()
        if (offscreenStatus) {
          const offscreenRecording = !!offscreenStatus.recording
          const offscreenStartedAt = typeof offscreenStatus.recordingStartedAt === 'number'
            ? offscreenStatus.recordingStartedAt
            : null
          if (offscreenRecording) {
            lastKnownRecording = true
            recordingStarting = false
            recordingStopping = false
            if (offscreenStartedAt) recordingStartedAt = offscreenStartedAt
            if (!recordingStartedAt) recordingStartedAt = Date.now()
            persistRecordingState(true, recordingStartedAt)
            setBadge(true, currentRecordingTabId)
          } else if (!recordingStarting && !recordingStopping) {
            lastKnownRecording = false
            recordingStartedAt = null
            persistRecordingState(false, null)
          }
        }

        if (!lastKnownRecording && !recordingStarting && !recordingStopping) {
          clearRecordingBadges(currentRecordingTabId)
        }
        await refreshRecentRecordingsForPopup()
        if (msg.forceBackendRefresh === true) {
          await scheduleBackendRecordingsRefresh(true)
        }
      } catch {}
      if (!lastKnownRecording && !recordingStarting && !recordingStopping) {
        wakeOffscreenForLocalMaintenance()
      }
      sendResponse({
        recording: lastKnownRecording,
        recordingStartedAt,
        starting: recordingStarting,
        startingTabId: recordingStartingTabId,
        startRequestedAt: recordingStartRequestedAt,
        stopping: recordingStopping,
        error: lastRecordingError,
        recentRecordings
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

    if (msg?.type === 'DEBUG_RUN_LOCAL_MAINTENANCE') {
      try {
        const result = await runOffscreenLocalMaintenance()
        sendResponse(result)
      } catch (e: any) {
        captureException(e, { operation: 'DEBUG_RUN_LOCAL_MAINTENANCE' })
        sendResponse({ ok: false, error: e?.message || String(e) })
      }
      return
    }

    if (msg?.type === 'UPSERT_RECORDING_HISTORY_ITEM') {
      const [item] = normalizeRecordingHistory([msg.item])
      if (!item) {
        sendResponse({ ok: false, error: 'Invalid recording history item' })
        return
      }

      try {
        const localHistory = await upsertRecordingHistoryItem(item)
        recentRecordings = mergeRecordingHistory(localHistory, backendRecordings).slice(0, POPUP_RECORDING_HISTORY_LIMIT)
        broadcastUploadQueueState()
        sendResponse({ ok: true, items: recentRecordings })

        if (item.status === 'processing_queued' && item.backendRecordingId) {
          scheduleBackendRecordingsRefresh(true)
        }
      } catch (e: any) {
        captureException(e, { operation: 'UPSERT_RECORDING_HISTORY_ITEM' })
        sendResponse({ ok: false, error: e?.message || String(e) })
      }
      return
    }

    if (msg?.type === 'READ_RECORDING_HISTORY') {
      try {
        await hydrateRecentRecordings()
        scheduleBackendRecordingsRefresh()
        wakeOffscreenForLocalMaintenance()
        sendResponse({ ok: true, items: recentRecordings })
      } catch (e: any) {
        captureException(e, { operation: 'READ_RECORDING_HISTORY' })
        sendResponse({ ok: false, error: e?.message || String(e), items: recentRecordings })
      }
      return
    }

    if (msg?.type === 'DELETE_RECORDING_HISTORY_ITEM') {
      const localId = typeof msg.localId === 'string' ? msg.localId.trim() : ''
      if (!localId) {
        sendResponse({ ok: false, error: 'Invalid recording localId' })
        return
      }

      try {
        const localHistory = await updateRecordingHistory((history) =>
          history.filter(item => item.localId !== localId)
        )
        recentRecordings = mergeRecordingHistory(localHistory, backendRecordings).slice(0, POPUP_RECORDING_HISTORY_LIMIT)
        broadcastUploadQueueState()
        sendResponse({ ok: true, items: recentRecordings })
      } catch (e: any) {
        captureException(e, { operation: 'DELETE_RECORDING_HISTORY_ITEM', localId })
        sendResponse({ ok: false, error: e?.message || String(e) })
      }
      return
    }

    if (msg?.type === 'READ_LOCAL_RECORDING_HISTORY') {
      try {
        const items = await readRecordingHistory()
        sendResponse({ ok: true, items })
      } catch (e: any) {
        captureException(e, { operation: 'READ_LOCAL_RECORDING_HISTORY' })
        sendResponse({ ok: false, error: e?.message || String(e), items: [] })
      }
      return
    }

    if (msg?.type === 'MARK_MEET2NOTE_RECONNECT_REQUIRED') {
      const message = typeof msg.message === 'string' && msg.message.trim()
        ? msg.message
        : 'Connect to Meet2Note before uploading.'
      try {
        await markMeet2NoteReconnectRequired(message)
        sendResponse({ ok: true })
      } catch (e: any) {
        captureException(e, { operation: 'MARK_MEET2NOTE_RECONNECT_REQUIRED' })
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

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return
  const tokenChange = changes[MEET2NOTE_EXTENSION_TOKEN_KEY]
  if (!tokenChange || typeof tokenChange.newValue !== 'string' || !tokenChange.newValue.trim()) return
  if (!offscreenPort) {
    wakeOffscreenForLocalMaintenance()
    return
  }

  postToOffscreen({ type: 'OFFSCREEN_REQUEUE_AUTH_REQUIRED_UPLOADS' }).catch((e) => {
    bglog('OFFSCREEN_REQUEUE_AUTH_REQUIRED_UPLOADS failed', e)
    captureException(e, { operation: 'OFFSCREEN_REQUEUE_AUTH_REQUIRED_UPLOADS' })
  })
})

chrome.runtime.onSuspend?.addListener(() => {
  persistRecordingState(lastKnownRecording, recordingStartedAt)
})

async function hydrateRecordingRuntimeState(): Promise<void> {
  try {
    const sessionState = await (chrome.storage as any)?.session?.get?.([
      'recording',
      'recordingStartedAt',
      'recordingStarting',
      'recordingStartingTabId',
      'recordingStartRequestedAt',
      'recordingStopping',
      'lastRecordingError'
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
    lastRecordingError = typeof sessionState?.lastRecordingError === 'string'
      ? sessionState.lastRecordingError
      : null

    if (lastKnownRecording) {
      setBadge(true, currentRecordingTabId)
      return
    }

    if (!recordingStarting && !recordingStopping) {
      clearRecordingBadges(currentRecordingTabId)
    }
  } catch (e) {
    captureException(e, { operation: 'hydrateRecordingRuntimeState' })
  }
}

async function initializeRecentRecordings(): Promise<void> {
  await hydrateRecordingRuntimeState()
  await hydrateRecentRecordings()
  scheduleBackendRecordingsRefresh()
  wakeOffscreenForLocalMaintenance()
}

void initializeRecentRecordings().catch((e) => {
  bglog('Initial recording history hydration failed', e)
  captureException(e, { operation: 'initializeRecentRecordings' })
})
