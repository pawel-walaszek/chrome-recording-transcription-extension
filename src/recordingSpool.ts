import type {
  RecordingHistoryItem,
  RecordingUploadAsset,
  RecordingUploadStatus
} from './recordingHistory'

const DB_NAME = 'meet2noteRecordingSpool'
const DB_VERSION = 1
const RECORDINGS_STORE = 'recordings'
const CHUNKS_STORE = 'chunks'
const LOCAL_ID_INDEX = 'localId'
const ASSET_INDEX = 'localIdAsset'

export const SPOOL_SCHEMA_VERSION = 1

export interface RecordingSpoolRecord extends RecordingHistoryItem {
  schemaVersion: number
  videoMimeType: string
  microphoneMimeType: string | null
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

let dbPromise: Promise<IDBDatabase> | null = null
let spoolWriteQueue: Promise<unknown> = Promise.resolve()

function openSpoolDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
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
      if (!db.objectStoreNames.contains(RECORDINGS_STORE)) {
        db.createObjectStore(RECORDINGS_STORE, { keyPath: 'localId' })
      }
      if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
        const chunks = db.createObjectStore(CHUNKS_STORE, { keyPath: 'id' })
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

function isUploadableStatus(status: RecordingUploadStatus): boolean {
  return status === 'queued' ||
    status === 'uploading' ||
    status === 'retrying' ||
    status === 'auth_required'
}

function countsAgainstSpoolCapacity(status: RecordingUploadStatus): boolean {
  return status === 'recording' ||
    status === 'finalizing' ||
    status === 'queued' ||
    status === 'uploading' ||
    status === 'retrying' ||
    status === 'auth_required'
}

export async function createSpoolRecording(record: RecordingSpoolRecord): Promise<void> {
  await enqueueSpoolWrite(async () => {
    const db = await openSpoolDb()
    const tx = db.transaction(RECORDINGS_STORE, 'readwrite')
    tx.objectStore(RECORDINGS_STORE).put(record)
    await transactionComplete(tx)
  })
}

export async function updateSpoolRecording(record: RecordingSpoolRecord): Promise<void> {
  await createSpoolRecording(record)
}

export async function getSpoolRecording(localId: string): Promise<RecordingSpoolRecord | null> {
  const db = await openSpoolDb()
  const tx = db.transaction(RECORDINGS_STORE, 'readonly')
  const result = await requestResult<RecordingSpoolRecord | undefined>(
    tx.objectStore(RECORDINGS_STORE).get(localId)
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
    const tx = db.transaction(CHUNKS_STORE, 'readwrite')
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
    tx.objectStore(CHUNKS_STORE).put(chunk)
    await transactionComplete(tx)
    return chunk.sizeBytes
  })
}

export async function listSpoolRecordings(): Promise<RecordingSpoolRecord[]> {
  const db = await openSpoolDb()
  const tx = db.transaction(RECORDINGS_STORE, 'readonly')
  const result = await requestResult<RecordingSpoolRecord[]>(
    tx.objectStore(RECORDINGS_STORE).getAll()
  )
  return result
}

export async function listUploadableSpoolRecordings(): Promise<RecordingSpoolRecord[]> {
  const records = await listSpoolRecordings()
  return records
    .filter(record => isUploadableStatus(record.status))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function listInterruptedSpoolRecordings(): Promise<RecordingSpoolRecord[]> {
  const records = await listSpoolRecordings()
  return records.filter(record => record.status === 'recording' || record.status === 'finalizing')
}

async function getChunksByIndex(localId: string, asset: RecordingUploadAsset): Promise<RecordingSpoolChunk[]> {
  const db = await openSpoolDb()
  const tx = db.transaction(CHUNKS_STORE, 'readonly')
  const index = tx.objectStore(CHUNKS_STORE).index(ASSET_INDEX)
  const chunks = await requestResult<RecordingSpoolChunk[]>(
    index.getAll(localIdAsset(localId, asset))
  )
  return chunks.sort((a, b) => a.sequence - b.sequence)
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
    getChunksByIndex(localId, 'video_audio'),
    getChunksByIndex(localId, 'microphone')
  ])
  return {
    video_audio: videoChunks.length,
    microphone: microphoneChunks.length
  }
}

export async function deleteSpoolChunks(localId: string): Promise<void> {
  await enqueueSpoolWrite(async () => {
    const db = await openSpoolDb()
    const tx = db.transaction(CHUNKS_STORE, 'readwrite')
    const store = tx.objectStore(CHUNKS_STORE)
    const index = store.index(LOCAL_ID_INDEX)
    const keys = await requestResult<IDBValidKey[]>(index.getAllKeys(localId))
    for (const key of keys) store.delete(key)
    await transactionComplete(tx)
  })
}

export async function getSpoolUsage(): Promise<{ recordings: number; bytes: number }> {
  const db = await openSpoolDb()
  const [records, chunks] = await Promise.all([
    requestResult<RecordingSpoolRecord[]>(
      db.transaction(RECORDINGS_STORE, 'readonly').objectStore(RECORDINGS_STORE).getAll()
    ),
    requestResult<RecordingSpoolChunk[]>(
      db.transaction(CHUNKS_STORE, 'readonly').objectStore(CHUNKS_STORE).getAll()
    )
  ])
  return {
    recordings: records.filter(record => countsAgainstSpoolCapacity(record.status)).length,
    bytes: chunks.reduce((total, chunk) => total + chunk.sizeBytes, 0)
  }
}
