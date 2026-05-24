import { MEET2NOTE_EXTENSION_TOKEN_KEY } from './extensionAuth'
import {
  RECORDING_SPOOL_CHUNKS_STORE,
  RECORDING_SPOOL_DB_NAME,
  RECORDING_SPOOL_RECORDINGS_STORE
} from './recordingSpool'
const DEBUG_REDACTED_STORAGE_KEYS = new Set([
  MEET2NOTE_EXTENSION_TOKEN_KEY,
  'meet2noteConnectState',
  'extensionToken',
  'uploadToken'
])

export interface DebugAssetStats {
  chunks: number
  bytes: number
  firstChunkCreatedAt: string | null
  lastChunkCreatedAt: string | null
}

export interface DebugChunkStats {
  chunks: number
  bytes: number
  firstChunkCreatedAt: string | null
  lastChunkCreatedAt: string | null
  assets: Record<string, DebugAssetStats>
}

export interface DebugSpoolRecordSummary {
  localId: string | null
  status: string | null
  failureReason: string | null
  error: string | null
  title: string | null
  createdAt: string | null
  updatedAt: string | null
  startedAt: string | null
  stoppedAt: string | null
  attempt: number | null
  nextRetryAt: number | null
  backendRecordingId: string | null
  uploadSession: Record<string, unknown> | null
  assets: unknown[]
  videoBytes: number | null
  microphoneBytes: number | null
  chunkStats: DebugChunkStats | null
  countsAgainstSpoolCapacity: boolean
  uploadable: boolean
}

export interface DebugSnapshot {
  generatedAt: string
  extension: {
    id: string
    version: string
  }
  runtime: {
    pageUrl: string
    userAgent: string
  }
  summary: {
    spoolRecordCount: number
    spoolBlockingCount: number
    spoolUploadableCount: number
    spoolWithBackendIdCount: number
    spoolWithoutBackendIdCount: number
    spoolByStatus: Record<string, number>
    historyCount: number
    historyByStatus: Record<string, number>
    totalChunks: number
    totalChunkBytes: number
  }
  spool: {
    available: boolean
    stores: string[]
    records: DebugSpoolRecordSummary[]
    chunkStatsByLocalId: Record<string, DebugChunkStats>
  }
  storageLocal: Record<string, unknown>
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'))
  })
}

function transactionComplete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed.'))
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted.'))
  })
}

async function spoolDatabaseExists(): Promise<boolean> {
  if (typeof indexedDB.databases !== 'function') return true
  const databases = await indexedDB.databases()
  return databases.some(db => db.name === RECORDING_SPOOL_DB_NAME)
}

async function openDebugSpoolDb(): Promise<IDBDatabase | null> {
  if (!await spoolDatabaseExists()) return null
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(RECORDING_SPOOL_DB_NAME)
    request.onerror = () => reject(request.error || new Error('Could not open recording spool.'))
    request.onsuccess = () => resolve(request.result)
  })
}

function getRecordString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value ? value : null
}

function getRecordNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getRecordTimestamp(record: Record<string, unknown>, key: string): string | null {
  const value = getRecordString(record, key)
  if (!value) return null
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return null
  return new Date(timestamp).toISOString()
}

function countsAgainstSpoolCapacity(record: Record<string, unknown>): boolean {
  return record.status === 'recording' ||
    record.status === 'finalizing' ||
    record.status === 'upload_queued' ||
    record.status === 'uploading' ||
    (record.status === 'failed' && record.failureReason === 'auth_required')
}

function isUploadableDebugRecord(record: Record<string, unknown>): boolean {
  return record.status === 'upload_queued' ||
    record.status === 'uploading' ||
    (record.status === 'failed' && record.failureReason === 'auth_required')
}

function redactedToken(value: unknown): Record<string, unknown> {
  return {
    redacted: true,
    present: typeof value === 'string' ? value.trim().length > 0 : value != null,
    length: typeof value === 'string' ? value.length : null
  }
}

function sanitizeDebugValue(value: unknown, key?: string): unknown {
  if (key && DEBUG_REDACTED_STORAGE_KEYS.has(key)) return redactedToken(value)
  if (value instanceof Blob) {
    return {
      blob: true,
      type: value.type || null,
      size: value.size
    }
  }
  if (Array.isArray(value)) return value.map(item => sanitizeDebugValue(item))
  if (!value || typeof value !== 'object') return value

  const output: Record<string, unknown> = {}
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    output[childKey] = sanitizeDebugValue(childValue, childKey)
  }
  return output
}

function sanitizeUploadSession(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  const session = value as Record<string, unknown>
  return {
    recordingId: sanitizeDebugValue(session.recordingId),
    uploadToken: redactedToken(session.uploadToken),
    expiresAt: sanitizeDebugValue(session.expiresAt),
    recommendedChunkSizeBytes: sanitizeDebugValue(session.recommendedChunkSizeBytes),
    maxAssetSizeBytes: sanitizeDebugValue(session.maxAssetSizeBytes)
  }
}

function summarizeDebugSpoolRecord(
  value: unknown,
  chunkStatsByLocalId: Record<string, DebugChunkStats>
): DebugSpoolRecordSummary {
  const record = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
  const localId = getRecordString(record, 'localId')
  return {
    localId,
    status: getRecordString(record, 'status'),
    failureReason: getRecordString(record, 'failureReason'),
    error: getRecordString(record, 'error'),
    title: getRecordString(record, 'title'),
    createdAt: getRecordString(record, 'createdAt'),
    updatedAt: getRecordString(record, 'updatedAt'),
    startedAt: getRecordString(record, 'startedAt'),
    stoppedAt: getRecordString(record, 'stoppedAt'),
    attempt: getRecordNumber(record, 'attempt'),
    nextRetryAt: getRecordNumber(record, 'nextRetryAt'),
    backendRecordingId: getRecordString(record, 'backendRecordingId'),
    uploadSession: sanitizeUploadSession(record.uploadSession),
    assets: Array.isArray(record.assets) ? record.assets.map(item => sanitizeDebugValue(item)) : [],
    videoBytes: getRecordNumber(record, 'videoBytes'),
    microphoneBytes: getRecordNumber(record, 'microphoneBytes'),
    chunkStats: localId ? chunkStatsByLocalId[localId] || null : null,
    countsAgainstSpoolCapacity: countsAgainstSpoolCapacity(record),
    uploadable: isUploadableDebugRecord(record)
  }
}

function addDebugChunkStats(
  chunkStatsByLocalId: Record<string, DebugChunkStats>,
  localId: string,
  asset: string,
  bytes: number,
  createdAt: string | null
): void {
  const localStats = chunkStatsByLocalId[localId] || {
    chunks: 0,
    bytes: 0,
    firstChunkCreatedAt: null,
    lastChunkCreatedAt: null,
    assets: {}
  }
  const assetStats = localStats.assets[asset] || {
    chunks: 0,
    bytes: 0,
    firstChunkCreatedAt: null,
    lastChunkCreatedAt: null
  }
  assetStats.chunks += 1
  assetStats.bytes += bytes
  localStats.chunks += 1
  localStats.bytes += bytes
  if (createdAt) {
    if (!assetStats.firstChunkCreatedAt || createdAt < assetStats.firstChunkCreatedAt) {
      assetStats.firstChunkCreatedAt = createdAt
    }
    if (!assetStats.lastChunkCreatedAt || createdAt > assetStats.lastChunkCreatedAt) {
      assetStats.lastChunkCreatedAt = createdAt
    }
    if (!localStats.firstChunkCreatedAt || createdAt < localStats.firstChunkCreatedAt) {
      localStats.firstChunkCreatedAt = createdAt
    }
    if (!localStats.lastChunkCreatedAt || createdAt > localStats.lastChunkCreatedAt) {
      localStats.lastChunkCreatedAt = createdAt
    }
  }
  localStats.assets[asset] = assetStats
  chunkStatsByLocalId[localId] = localStats
}

async function readDebugSpool(): Promise<DebugSnapshot['spool']> {
  const db = await openDebugSpoolDb()
  if (!db) {
    return {
      available: false,
      stores: [],
      records: [],
      chunkStatsByLocalId: {}
    }
  }

  try {
    const stores = Array.from(db.objectStoreNames)
    let rawRecords: unknown[] = []
    const chunkStatsByLocalId: Record<string, DebugChunkStats> = {}

    if (stores.includes(RECORDING_SPOOL_RECORDINGS_STORE)) {
      const tx = db.transaction(RECORDING_SPOOL_RECORDINGS_STORE, 'readonly')
      rawRecords = await requestResult<unknown[]>(tx.objectStore(RECORDING_SPOOL_RECORDINGS_STORE).getAll())
      await transactionComplete(tx)
    }

    if (stores.includes(RECORDING_SPOOL_CHUNKS_STORE)) {
      const tx = db.transaction(RECORDING_SPOOL_CHUNKS_STORE, 'readonly')
      const store = tx.objectStore(RECORDING_SPOOL_CHUNKS_STORE)
      await new Promise<void>((resolve, reject) => {
        const request = store.openCursor()
        request.onerror = () => reject(request.error || new Error('Recording spool cursor failed.'))
        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor) {
            resolve()
            return
          }

          const chunk = cursor.value && typeof cursor.value === 'object'
            ? cursor.value as Record<string, unknown>
            : {}
          const localId = getRecordString(chunk, 'localId') || 'missing-localId'
          const asset = getRecordString(chunk, 'asset') || 'missing-asset'
          const createdAt = getRecordTimestamp(chunk, 'createdAt')
          const blob = chunk.blob instanceof Blob ? chunk.blob : null
          const size = getRecordNumber(chunk, 'sizeBytes') ?? blob?.size ?? 0
          addDebugChunkStats(chunkStatsByLocalId, localId, asset, size, createdAt)
          cursor.continue()
        }
      })
      await transactionComplete(tx)
    }

    const records = rawRecords
      .map(record => summarizeDebugSpoolRecord(record, chunkStatsByLocalId))
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))

    return {
      available: true,
      stores,
      records,
      chunkStatsByLocalId
    }
  } finally {
    db.close()
  }
}

function readChromeStorageLocal(): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(null, (items) => {
      const runtimeError = chrome.runtime.lastError
      if (runtimeError) return reject(new Error(runtimeError.message))
      const output: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(items)) output[key] = sanitizeDebugValue(value, key)
      resolve(output)
    })
  })
}

function countByStatus(items: Array<{ status?: unknown }>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) {
    const status = typeof item.status === 'string' && item.status ? item.status : 'missing'
    counts[status] = (counts[status] || 0) + 1
  }
  return counts
}

export async function readDebugSnapshot(): Promise<DebugSnapshot> {
  const [spool, storageLocal] = await Promise.all([
    readDebugSpool(),
    readChromeStorageLocal()
  ])
  const historyValue = storageLocal.meet2noteRecordingHistory
  const history = Array.isArray(historyValue)
    ? historyValue.filter(item => item && typeof item === 'object') as Array<{ status?: unknown }>
    : []
  const totalChunks = Object.values(spool.chunkStatsByLocalId)
    .reduce((sum, item) => sum + item.chunks, 0)
  const totalChunkBytes = Object.values(spool.chunkStatsByLocalId)
    .reduce((sum, item) => sum + item.bytes, 0)

  return {
    generatedAt: new Date().toISOString(),
    extension: {
      id: chrome.runtime.id,
      version: chrome.runtime.getManifest().version
    },
    runtime: {
      pageUrl: window.location.href,
      userAgent: navigator.userAgent
    },
    summary: {
      spoolRecordCount: spool.records.length,
      spoolBlockingCount: spool.records.filter(record => record.countsAgainstSpoolCapacity).length,
      spoolUploadableCount: spool.records.filter(record => record.uploadable).length,
      spoolWithBackendIdCount: spool.records.filter(record => !!record.backendRecordingId).length,
      spoolWithoutBackendIdCount: spool.records.filter(record => !record.backendRecordingId).length,
      spoolByStatus: countByStatus(spool.records),
      historyCount: history.length,
      historyByStatus: countByStatus(history),
      totalChunks,
      totalChunkBytes
    },
    spool,
    storageLocal
  }
}
