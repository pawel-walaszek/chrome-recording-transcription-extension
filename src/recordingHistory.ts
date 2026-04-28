export type RecordingUploadStatus =
  | 'queued'
  | 'uploading'
  | 'retrying'
  | 'uploaded'
  | 'auth_required'
  | 'failed'

export type RecordingUploadAsset = 'video_audio' | 'microphone'

export interface RecordingHistoryItem {
  localId: string
  status: RecordingUploadStatus
  title: string
  meetingId?: string
  meetingTitle?: string
  tabUrl?: string
  startedAt: string
  stoppedAt: string
  durationMs: number
  videoBytes: number
  microphoneBytes: number
  attempt: number
  nextRetryAt: number | null
  backendRecordingId: string | null
  assets: RecordingUploadAsset[]
  error: string | null
  createdAt: string
  updatedAt: string
}

interface StoredRecordingHistory {
  meet2noteRecordingHistory?: unknown
}

export const RECORDING_HISTORY_KEY = 'meet2noteRecordingHistory'
export const RECORDING_HISTORY_LIMIT = 10
export const POPUP_RECORDING_HISTORY_LIMIT = 5

const NON_TERMINAL_STATUSES = new Set<RecordingUploadStatus>([
  'queued',
  'uploading',
  'retrying',
  'auth_required'
])

export function isTerminalRecordingStatus(status: RecordingUploadStatus): boolean {
  return status === 'uploaded' || status === 'failed'
}

export function generateRecordingLocalId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `rec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}

function storageGet<T>(keys: string[]): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (items) => {
      const runtimeError = chrome.runtime.lastError
      if (runtimeError) return reject(new Error(runtimeError.message))
      resolve(items as T)
    })
  })
}

function storageSet(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      const runtimeError = chrome.runtime.lastError
      if (runtimeError) return reject(new Error(runtimeError.message))
      resolve()
    })
  })
}

function isRecordingUploadStatus(value: unknown): value is RecordingUploadStatus {
  return value === 'queued' ||
    value === 'uploading' ||
    value === 'retrying' ||
    value === 'uploaded' ||
    value === 'auth_required' ||
    value === 'failed'
}

function sanitizeAssets(value: unknown): RecordingUploadAsset[] {
  if (!Array.isArray(value)) return []
  const assets: RecordingUploadAsset[] = []
  for (const asset of value) {
    if (asset === 'video_audio' || asset === 'microphone') assets.push(asset)
  }
  return assets
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function sanitizeHistoryItem(value: unknown): RecordingHistoryItem | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const localId = optionalString(record.localId)
  const status = record.status
  if (!localId || !isRecordingUploadStatus(status)) return null

  const now = new Date().toISOString()
  const title = optionalString(record.title) || 'Browser recording'
  const startedAt = optionalString(record.startedAt) || now
  const stoppedAt = optionalString(record.stoppedAt) || startedAt
  const createdAt = optionalString(record.createdAt) || startedAt
  const updatedAt = optionalString(record.updatedAt) || createdAt

  return {
    localId,
    status,
    title,
    meetingId: optionalString(record.meetingId),
    meetingTitle: optionalString(record.meetingTitle),
    tabUrl: optionalString(record.tabUrl),
    startedAt,
    stoppedAt,
    durationMs: numberOrZero(record.durationMs),
    videoBytes: numberOrZero(record.videoBytes),
    microphoneBytes: numberOrZero(record.microphoneBytes),
    attempt: Math.max(0, Math.floor(numberOrZero(record.attempt))),
    nextRetryAt: nullableNumber(record.nextRetryAt),
    backendRecordingId: nullableString(record.backendRecordingId),
    assets: sanitizeAssets(record.assets),
    error: nullableString(record.error),
    createdAt,
    updatedAt
  }
}

export function normalizeRecordingHistory(value: unknown): RecordingHistoryItem[] {
  if (!Array.isArray(value)) return []
  const unique = new Map<string, RecordingHistoryItem>()
  for (const item of value) {
    const sanitized = sanitizeHistoryItem(item)
    if (sanitized) unique.set(sanitized.localId, sanitized)
  }
  return trimRecordingHistory(Array.from(unique.values()))
}

export function trimRecordingHistory(items: RecordingHistoryItem[]): RecordingHistoryItem[] {
  const sorted = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const kept: RecordingHistoryItem[] = []
  let terminalCount = 0

  for (const item of sorted) {
    if (isTerminalRecordingStatus(item.status)) {
      terminalCount += 1
      if (terminalCount > RECORDING_HISTORY_LIMIT) continue
    }
    kept.push(item)
  }

  return kept
}

export async function readRecordingHistory(): Promise<RecordingHistoryItem[]> {
  const items = await storageGet<StoredRecordingHistory>([RECORDING_HISTORY_KEY])
  return normalizeRecordingHistory(items.meet2noteRecordingHistory)
}

export async function writeRecordingHistory(items: RecordingHistoryItem[]): Promise<RecordingHistoryItem[]> {
  const normalized = normalizeRecordingHistory(items)
  await storageSet({ [RECORDING_HISTORY_KEY]: normalized })
  return normalized
}

export async function upsertRecordingHistoryItem(item: RecordingHistoryItem): Promise<RecordingHistoryItem[]> {
  const history = await readRecordingHistory()
  const index = history.findIndex(existing => existing.localId === item.localId)
  const next = [...history]
  if (index >= 0) {
    next[index] = item
  } else {
    next.unshift(item)
  }
  return writeRecordingHistory(next)
}

export async function markIncompleteRecordingsFailed(message: string): Promise<RecordingHistoryItem[]> {
  const history = await readRecordingHistory()
  const now = new Date().toISOString()
  let changed = false
  const next = history.map((item) => {
    if (!NON_TERMINAL_STATUSES.has(item.status)) return item
    changed = true
    return {
      ...item,
      status: 'failed' as const,
      error: message,
      nextRetryAt: null,
      updatedAt: now
    }
  })
  return changed ? writeRecordingHistory(next) : history
}
