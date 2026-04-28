import type { UploadAsset } from './uploadClient'

export type RecordingUploadStatus =
  | 'recording'
  | 'finalizing'
  | 'upload_queued'
  | 'uploading'
  | 'processing_queued'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'canceled'
  | 'expired'

export type RecordingFailureReason =
  | 'auth_required'
  | 'local_error'
  | 'unrecoverable'
  | 'upload_error'

export type RecordingUploadAsset = UploadAsset

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
  failureReason: RecordingFailureReason | null
  createdAt: string
  updatedAt: string
}

export const RECORDING_HISTORY_KEY = 'meet2noteRecordingHistory'
export const RECORDING_HISTORY_LIMIT = 10
export const POPUP_RECORDING_HISTORY_LIMIT = 5

type StoredRecordingHistory = Partial<Record<typeof RECORDING_HISTORY_KEY, unknown>>

let recordingHistoryWriteQueue: Promise<unknown> = Promise.resolve()

const NON_TERMINAL_STATUSES = new Set<RecordingUploadStatus>([
  'recording',
  'finalizing',
  'upload_queued',
  'uploading'
])

export function isTerminalRecordingStatus(status: RecordingUploadStatus): boolean {
  return status === 'processing_queued' ||
    status === 'processing' ||
    status === 'ready' ||
    status === 'failed' ||
    status === 'canceled' ||
    status === 'expired'
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

function normalizeRecordingUploadStatus(value: unknown): RecordingUploadStatus | null {
  if (value === 'queued' || value === 'retrying') return 'upload_queued'
  if (value === 'uploaded' || value === 'pending') return 'processing_queued'
  if (value === 'auth_required' || value === 'local_error' || value === 'failed_unrecoverable') return 'failed'
  if (value === 'upload_queued' ||
    value === 'uploading' ||
    value === 'recording' ||
    value === 'finalizing' ||
    value === 'processing_queued' ||
    value === 'processing' ||
    value === 'ready' ||
    value === 'failed' ||
    value === 'canceled' ||
    value === 'expired') return value
  return null
}

function normalizeFailureReason(status: unknown, value: unknown): RecordingFailureReason | null {
  if (value === 'auth_required' ||
    value === 'local_error' ||
    value === 'unrecoverable' ||
    value === 'upload_error') return value
  if (status === 'auth_required') return 'auth_required'
  if (status === 'local_error') return 'local_error'
  if (status === 'failed_unrecoverable') return 'unrecoverable'
  return null
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
  const rawStatus = record.status
  const status = normalizeRecordingUploadStatus(rawStatus)
  if (!localId || !status) return null

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
    failureReason: status === 'failed' ? normalizeFailureReason(rawStatus, record.failureReason) : null,
    createdAt,
    updatedAt
  }
}

export function normalizeRecordingHistoryItem(value: unknown): RecordingHistoryItem | null {
  return sanitizeHistoryItem(value)
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

function enqueueRecordingHistoryWrite<T>(operation: () => Promise<T>): Promise<T> {
  const run = recordingHistoryWriteQueue.catch(() => undefined).then(operation)
  recordingHistoryWriteQueue = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

async function writeRecordingHistoryInternal(items: RecordingHistoryItem[]): Promise<RecordingHistoryItem[]> {
  const normalized = normalizeRecordingHistory(items)
  await storageSet({ [RECORDING_HISTORY_KEY]: normalized })
  return normalized
}

export async function readRecordingHistory(): Promise<RecordingHistoryItem[]> {
  const items = await storageGet<StoredRecordingHistory>([RECORDING_HISTORY_KEY])
  return normalizeRecordingHistory(items[RECORDING_HISTORY_KEY])
}

export async function writeRecordingHistory(items: RecordingHistoryItem[]): Promise<RecordingHistoryItem[]> {
  return enqueueRecordingHistoryWrite(() => writeRecordingHistoryInternal(items))
}

export async function updateRecordingHistory(
  updater: (items: RecordingHistoryItem[]) => RecordingHistoryItem[] | Promise<RecordingHistoryItem[]>
): Promise<RecordingHistoryItem[]> {
  return enqueueRecordingHistoryWrite(async () => {
    const history = await readRecordingHistory()
    const next = await updater(history)
    return writeRecordingHistoryInternal(next)
  })
}

export async function upsertRecordingHistoryItem(item: RecordingHistoryItem): Promise<RecordingHistoryItem[]> {
  return updateRecordingHistory((history) => {
    const index = history.findIndex(existing => existing.localId === item.localId)
    const next = [...history]
    if (index >= 0) {
      next[index] = item
    } else {
      next.unshift(item)
    }
    return next
  })
}

export async function markIncompleteRecordingsFailed(message: string): Promise<RecordingHistoryItem[]> {
  return updateRecordingHistory((history) => {
    const now = new Date().toISOString()
    let changed = false
    const next = history.map((item) => {
      if (!NON_TERMINAL_STATUSES.has(item.status)) return item
      changed = true
      return {
        ...item,
        status: 'failed' as const,
        error: message,
        failureReason: 'unrecoverable' as const,
        nextRetryAt: null,
        updatedAt: now
      }
    })
    return changed ? next : history
  })
}
