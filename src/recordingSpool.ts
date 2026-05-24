import type {
  RecordingHistoryItem,
  RecordingUploadAsset
} from './recordingHistory'
import { normalizeRecordingHistoryItem } from './recordingHistory'

export const RECORDING_SPOOL_DB_NAME = 'meet2noteRecordingSpool'
const DB_VERSION = 1
export const RECORDING_SPOOL_RECORDINGS_STORE = 'recordings'
export const RECORDING_SPOOL_CHUNKS_STORE = 'chunks'
const LOCAL_ID_INDEX = 'localId'
const ASSET_INDEX = 'localIdAsset'

export const SPOOL_SCHEMA_VERSION = 1

export interface RecordingSpoolUploadSession {
  recordingId: string
  uploadToken: string
  expiresAt: string | null
  recommendedChunkSizeBytes?: number
  maxAssetSizeBytes?: number
}

export interface RecordingSpoolRecord extends RecordingHistoryItem {
  schemaVersion: number
  videoMimeType: string
  microphoneMimeType: string | null
  uploadSession?: RecordingSpoolUploadSession | null
}

export interface RecordingSpoolChunk {
  id: string
  localId: string
  asset: RecordingUploadAsset
  localIdAsset: string
  sequence: number
  blob: Blob
  sizeBytes: number
  mimeType: string
  createdAt: string
}

export interface RecordingSpoolChunkAssetStats {
  chunks: number
  bytes: number
  firstChunkCreatedAt: string | null
  lastChunkCreatedAt: string | null
}

export interface OrphanedSpoolChunkGroup {
  localId: string
  chunks: number
  bytes: number
  firstChunkCreatedAt: string | null
  lastChunkCreatedAt: string | null
  assets: Record<string, RecordingSpoolChunkAssetStats>
}

let dbPromise: Promise<IDBDatabase> | null = null
let spoolWriteQueue: Promise<unknown> = Promise.resolve()

function openSpoolDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(RECORDING_SPOOL_DB_NAME, DB_VERSION)
    request.onerror = () => {
      dbPromise = null
      reject(request.error || new Error('Could not open recording spool.'))
    }
    request.onblocked = () => {
      dbPromise = null
      reject(new Error('Recording spool upgrade is blocked by another extension context.'))
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(RECORDING_SPOOL_RECORDINGS_STORE)) {
        db.createObjectStore(RECORDING_SPOOL_RECORDINGS_STORE, { keyPath: 'localId' })
      }
      if (!db.objectStoreNames.contains(RECORDING_SPOOL_CHUNKS_STORE)) {
        const chunks = db.createObjectStore(RECORDING_SPOOL_CHUNKS_STORE, { keyPath: 'id' })
        chunks.createIndex(LOCAL_ID_INDEX, 'localId', { unique: false })
        chunks.createIndex(ASSET_INDEX, 'localIdAsset', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
  })

  return dbPromise
}

function transactionComplete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('Recording spool transaction failed.'))
    tx.onabort = () => reject(tx.error || new Error('Recording spool transaction aborted.'))
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Recording spool request failed.'))
  })
}

function enqueueSpoolWrite<T>(operation: () => Promise<T>): Promise<T> {
  const run = spoolWriteQueue.catch(() => undefined).then(operation)
  spoolWriteQueue = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

function localIdAsset(localId: string, asset: RecordingUploadAsset): string {
  return `${localId}:${asset}`
}

function isUploadableRecord(record: RecordingSpoolRecord): boolean {
  return record.status === 'upload_queued' ||
    record.status === 'uploading' ||
    (record.status === 'failed' && record.failureReason === 'auth_required')
}

function countsAgainstSpoolCapacity(record: RecordingSpoolRecord): boolean {
  return record.status === 'recording' ||
    record.status === 'finalizing' ||
    record.status === 'upload_queued' ||
    record.status === 'uploading' ||
    (record.status === 'failed' && record.failureReason === 'auth_required')
}

function normalizeSpoolRecord(record: RecordingSpoolRecord): RecordingSpoolRecord {
  const normalizedHistory = normalizeRecordingHistoryItem(record)
  if (!normalizedHistory) return record
  return {
    ...record,
    ...normalizedHistory,
    schemaVersion: typeof record.schemaVersion === 'number' ? record.schemaVersion : SPOOL_SCHEMA_VERSION,
    videoMimeType: typeof record.videoMimeType === 'string' && record.videoMimeType
      ? record.videoMimeType
      : 'video/webm',
    microphoneMimeType: typeof record.microphoneMimeType === 'string' && record.microphoneMimeType
      ? record.microphoneMimeType
      : null,
    uploadSession: normalizeUploadSession(record.uploadSession)
  }
}

function normalizeUploadSession(value: unknown): RecordingSpoolUploadSession | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const recordingId = record.recordingId
  const uploadToken = record.uploadToken
  const expiresAt = record.expiresAt ?? null
  if (typeof recordingId !== 'string' || !recordingId) return null
  if (typeof uploadToken !== 'string' || !uploadToken) return null
  if (expiresAt !== null && (typeof expiresAt !== 'string' || !expiresAt)) return null

  return {
    recordingId,
    uploadToken,
    expiresAt,
    recommendedChunkSizeBytes: positiveNumberOrUndefined(record.recommendedChunkSizeBytes),
    maxAssetSizeBytes: positiveNumberOrUndefined(record.maxAssetSizeBytes)
  }
}

function positiveNumberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

function normalizeChunkTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return null
  return new Date(timestamp).toISOString()
}

function updateChunkStatsTimestamp(
  stats: RecordingSpoolChunkAssetStats,
  createdAt: string | null
): void {
  if (!createdAt) return
  if (!stats.firstChunkCreatedAt || createdAt < stats.firstChunkCreatedAt) {
    stats.firstChunkCreatedAt = createdAt
  }
  if (!stats.lastChunkCreatedAt || createdAt > stats.lastChunkCreatedAt) {
    stats.lastChunkCreatedAt = createdAt
  }
}

function emptyChunkStats(): RecordingSpoolChunkAssetStats {
  return {
    chunks: 0,
    bytes: 0,
    firstChunkCreatedAt: null,
    lastChunkCreatedAt: null
  }
}

export async function createSpoolRecording(record: RecordingSpoolRecord): Promise<void> {
  await enqueueSpoolWrite(async () => {
    const db = await openSpoolDb()
    const tx = db.transaction(RECORDING_SPOOL_RECORDINGS_STORE, 'readwrite')
    tx.objectStore(RECORDING_SPOOL_RECORDINGS_STORE).put(record)
    await transactionComplete(tx)
  })
}

export async function updateSpoolRecording(record: RecordingSpoolRecord): Promise<void> {
  await createSpoolRecording(record)
}

export async function getSpoolRecording(localId: string): Promise<RecordingSpoolRecord | null> {
  const db = await openSpoolDb()
  const tx = db.transaction(RECORDING_SPOOL_RECORDINGS_STORE, 'readonly')
  const result = await requestResult<RecordingSpoolRecord | undefined>(
    tx.objectStore(RECORDING_SPOOL_RECORDINGS_STORE).get(localId)
  )
  return result || null
}

export async function appendSpoolChunk(params: {
  localId: string
  asset: RecordingUploadAsset
  sequence: number
  blob: Blob
  mimeType: string
}): Promise<number> {
  return enqueueSpoolWrite(async () => {
    const db = await openSpoolDb()
    const tx = db.transaction(RECORDING_SPOOL_CHUNKS_STORE, 'readwrite')
    const chunk: RecordingSpoolChunk = {
      id: `${params.localId}:${params.asset}:${params.sequence}`,
      localId: params.localId,
      asset: params.asset,
      localIdAsset: localIdAsset(params.localId, params.asset),
      sequence: params.sequence,
      blob: params.blob,
      sizeBytes: params.blob.size,
      mimeType: params.mimeType,
      createdAt: new Date().toISOString()
    }
    tx.objectStore(RECORDING_SPOOL_CHUNKS_STORE).put(chunk)
    await transactionComplete(tx)
    return chunk.sizeBytes
  })
}

export async function listSpoolRecordings(): Promise<RecordingSpoolRecord[]> {
  const db = await openSpoolDb()
  const tx = db.transaction(RECORDING_SPOOL_RECORDINGS_STORE, 'readonly')
  const result = await requestResult<RecordingSpoolRecord[]>(
    tx.objectStore(RECORDING_SPOOL_RECORDINGS_STORE).getAll()
  )
  return result.map(normalizeSpoolRecord)
}

export async function listUploadableSpoolRecordings(): Promise<RecordingSpoolRecord[]> {
  const records = await listSpoolRecordings()
  return records
    .filter(record => isUploadableRecord(record))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function listInterruptedSpoolRecordings(): Promise<RecordingSpoolRecord[]> {
  const records = await listSpoolRecordings()
  return records.filter(record => record.status === 'recording' || record.status === 'finalizing')
}

export async function listOrphanedSpoolChunkGroups(options: {
  gracePeriodMs: number
  nowMs?: number
}): Promise<OrphanedSpoolChunkGroup[]> {
  const db = await openSpoolDb()
  const nowMs = options.nowMs ?? Date.now()
  const gracePeriodMs = Math.max(0, options.gracePeriodMs)
  const recordsTx = db.transaction(RECORDING_SPOOL_RECORDINGS_STORE, 'readonly')
  const records = await requestResult<RecordingSpoolRecord[]>(
    recordsTx.objectStore(RECORDING_SPOOL_RECORDINGS_STORE).getAll()
  )
  await transactionComplete(recordsTx)

  const knownLocalIds = new Set(records.map(record => record.localId))
  const groups: Record<string, OrphanedSpoolChunkGroup> = {}
  const chunksTx = db.transaction(RECORDING_SPOOL_CHUNKS_STORE, 'readonly')
  const store = chunksTx.objectStore(RECORDING_SPOOL_CHUNKS_STORE)
  await new Promise<void>((resolve, reject) => {
    const request = store.openCursor()
    request.onerror = () => reject(request.error || new Error('Recording spool cursor failed.'))
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        resolve()
        return
      }

      const chunk = cursor.value as Partial<RecordingSpoolChunk>
      const localId = typeof chunk.localId === 'string' && chunk.localId
        ? chunk.localId
        : 'missing-localId'
      if (!knownLocalIds.has(localId)) {
        const asset = typeof chunk.asset === 'string' && chunk.asset ? chunk.asset : 'missing-asset'
        const bytes = typeof chunk.sizeBytes === 'number' && Number.isFinite(chunk.sizeBytes)
          ? chunk.sizeBytes
          : chunk.blob instanceof Blob
            ? chunk.blob.size
            : 0
        const createdAt = normalizeChunkTimestamp(chunk.createdAt)
        const group = groups[localId] || {
          localId,
          chunks: 0,
          bytes: 0,
          firstChunkCreatedAt: null,
          lastChunkCreatedAt: null,
          assets: {}
        }
        const assetStats = group.assets[asset] || emptyChunkStats()
        assetStats.chunks += 1
        assetStats.bytes += bytes
        updateChunkStatsTimestamp(assetStats, createdAt)
        group.chunks += 1
        group.bytes += bytes
        updateChunkStatsTimestamp(group, createdAt)
        group.assets[asset] = assetStats
        groups[localId] = group
      }

      cursor.continue()
    }
  })
  await transactionComplete(chunksTx)

  return Object.values(groups)
    .filter(group => {
      if (!group.lastChunkCreatedAt) return false
      const lastChunkMs = Date.parse(group.lastChunkCreatedAt)
      return Number.isFinite(lastChunkMs) && nowMs - lastChunkMs >= gracePeriodMs
    })
    .sort((a, b) => String(a.firstChunkCreatedAt).localeCompare(String(b.firstChunkCreatedAt)))
}

export async function assertSpoolAvailable(): Promise<void> {
  const db = await openSpoolDb()
  const tx = db.transaction(RECORDING_SPOOL_RECORDINGS_STORE, 'readonly')
  const complete = transactionComplete(tx)
  await Promise.all([
    requestResult<number>(tx.objectStore(RECORDING_SPOOL_RECORDINGS_STORE).count()),
    complete
  ])
}

async function getChunksByIndex(localId: string, asset: RecordingUploadAsset): Promise<RecordingSpoolChunk[]> {
  const db = await openSpoolDb()
  const tx = db.transaction(RECORDING_SPOOL_CHUNKS_STORE, 'readonly')
  const index = tx.objectStore(RECORDING_SPOOL_CHUNKS_STORE).index(ASSET_INDEX)
  const chunks = await requestResult<RecordingSpoolChunk[]>(
    index.getAll(localIdAsset(localId, asset))
  )
  return chunks.sort((a, b) => a.sequence - b.sequence)
}

async function countChunksByIndex(localId: string, asset: RecordingUploadAsset): Promise<number> {
  const db = await openSpoolDb()
  const tx = db.transaction(RECORDING_SPOOL_CHUNKS_STORE, 'readonly')
  const index = tx.objectStore(RECORDING_SPOOL_CHUNKS_STORE).index(ASSET_INDEX)
  return requestResult<number>(index.count(localIdAsset(localId, asset)))
}

export async function readSpoolAssetBlob(
  localId: string,
  asset: RecordingUploadAsset,
  fallbackMimeType: string
): Promise<Blob | null> {
  const chunks = await getChunksByIndex(localId, asset)
  if (!chunks.length) return null
  const mimeType = chunks.find(chunk => chunk.mimeType)?.mimeType || fallbackMimeType
  return new Blob(chunks.map(chunk => chunk.blob), { type: mimeType })
}

export async function getSpoolChunkCounts(localId: string): Promise<Record<RecordingUploadAsset, number>> {
  const [videoChunks, microphoneChunks] = await Promise.all([
    countChunksByIndex(localId, 'video_audio'),
    countChunksByIndex(localId, 'microphone')
  ])
  return {
    video_audio: videoChunks,
    microphone: microphoneChunks
  }
}

export async function deleteSpoolChunks(localId: string): Promise<void> {
  await enqueueSpoolWrite(async () => {
    const db = await openSpoolDb()
    const tx = db.transaction(RECORDING_SPOOL_CHUNKS_STORE, 'readwrite')
    const store = tx.objectStore(RECORDING_SPOOL_CHUNKS_STORE)
    const index = store.index(LOCAL_ID_INDEX)
    const keys = await requestResult<IDBValidKey[]>(index.getAllKeys(localId))
    for (const key of keys) store.delete(key)
    await transactionComplete(tx)
  })
}

export async function deleteSpoolRecording(localId: string): Promise<void> {
  await enqueueSpoolWrite(async () => {
    const db = await openSpoolDb()
    const tx = db.transaction(RECORDING_SPOOL_RECORDINGS_STORE, 'readwrite')
    tx.objectStore(RECORDING_SPOOL_RECORDINGS_STORE).delete(localId)
    await transactionComplete(tx)
  })
}

async function sumChunkSizes(): Promise<number> {
  const db = await openSpoolDb()
  const tx = db.transaction(RECORDING_SPOOL_CHUNKS_STORE, 'readonly')
  const store = tx.objectStore(RECORDING_SPOOL_CHUNKS_STORE)
  const complete = transactionComplete(tx)
  let totalBytes = 0

  await new Promise<void>((resolve, reject) => {
    const request = store.openCursor()
    request.onerror = () => reject(request.error || new Error('Recording spool cursor failed.'))
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        resolve()
        return
      }
      const chunk = cursor.value as RecordingSpoolChunk
      totalBytes += chunk.sizeBytes
      cursor.continue()
    }
  })
  await complete
  return totalBytes
}

export async function getSpoolUsage(): Promise<{ recordings: number; bytes: number }> {
  const db = await openSpoolDb()
  const [records, bytes] = await Promise.all([
    requestResult<RecordingSpoolRecord[]>(
      db.transaction(RECORDING_SPOOL_RECORDINGS_STORE, 'readonly')
        .objectStore(RECORDING_SPOOL_RECORDINGS_STORE)
        .getAll()
    ),
    sumChunkSizes()
  ])
  return {
    recordings: records.filter(record => countsAgainstSpoolCapacity(record)).length,
    bytes
  }
}
