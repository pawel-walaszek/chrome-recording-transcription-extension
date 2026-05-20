import {
  makeAuthorizationHeader,
  Meet2NoteAuthError
} from './extensionAuth'
import { makeMeet2NoteUrl } from './meet2noteConfig'

export type UploadAsset = 'video_audio' | 'microphone'

export interface UploadSessionState {
  recordingId: string
  uploadToken: string
  expiresAt: string
  recommendedChunkSizeBytes?: number
  maxAssetSizeBytes?: number
}

export interface UploadRecordingInput {
  title: string
  meetingId?: string
  meetingTitle?: string
  startedAt?: string
  durationMs?: number
  videoBlob: Blob
  microphoneBlob?: Blob | null
  uploadSession?: UploadSessionState | null
  onUploadSession?: (session: UploadSessionState) => void | Promise<void>
}

export interface UploadRecordingResult {
  recordingId: string
  assets: UploadAsset[]
}

export interface UploadProgress {
  asset: UploadAsset
  loadedBytes: number
  totalBytes: number
  assetLoadedBytes: number
  assetTotalBytes: number
}

interface InitUploadResponse extends UploadSessionState {
  uploadMode?: string
}

interface UploadAssetState {
  recordingId: string
  asset: UploadAsset
  status: 'initialized' | 'uploading' | 'complete'
  sizeBytes: number
  chunkSizeBytes: number
  totalChunks: number
  receivedChunks: number[]
  receivedBytes: number
}

interface UploadChunkResponse {
  recordingId: string
  asset: UploadAsset
  chunkIndex: number
  status: 'accepted'
  sizeBytes: number
  receivedBytes: number
  totalBytes: number
}

const INIT_UPLOAD_TIMEOUT_MS = 30_000
const COMPLETE_UPLOAD_TIMEOUT_MS = 30_000
const ASSET_METADATA_TIMEOUT_MS = 30_000
const ASSET_COMPLETE_TIMEOUT_MS = 10 * 60_000
const CHUNK_UPLOAD_TIMEOUT_MS = 5 * 60_000
const DEFAULT_CHUNK_SIZE_BYTES = 16 * 1024 * 1024
const MAX_CHUNK_SIZE_BYTES = 32 * 1024 * 1024
const SESSION_EXPIRY_SKEW_MS = 60_000

function httpError(operation: string, response: Response): Error {
  if (response.status === 401 || response.status === 403) {
    return new Meet2NoteAuthError(`Meet2Note connection required for ${operation}.`, response.status)
  }
  return new Error(`${operation} failed with HTTP ${response.status}`)
}

async function fetchWithTimeout(
  operation: string,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${operation} timed out after ${Math.round(timeoutMs / 1000)} seconds`)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

async function parseJsonObject(response: Response, operation: string): Promise<Record<string, unknown>> {
  const data = await response.json().catch(() => null)
  if (!data || typeof data !== 'object') throw new Error(`${operation} returned invalid JSON`)
  return data as Record<string, unknown>
}

async function parseInitResponse(response: Response): Promise<InitUploadResponse> {
  const data = await parseJsonObject(response, 'init upload')

  const recordingId = data.recordingId
  const uploadToken = data.uploadToken
  const expiresAt = data.expiresAt
  const uploadMode = data.uploadMode

  if (typeof recordingId !== 'string' || !recordingId) throw new Error('init upload missing recordingId')
  if (typeof uploadToken !== 'string' || !uploadToken) throw new Error('init upload missing uploadToken')
  if (typeof expiresAt !== 'string' || !expiresAt) throw new Error('init upload missing expiresAt')
  if (uploadMode !== undefined && uploadMode !== 'chunked') {
    throw new Error(`unsupported upload mode: ${String(uploadMode)}`)
  }

  return {
    recordingId,
    uploadToken,
    expiresAt,
    uploadMode: typeof uploadMode === 'string' ? uploadMode : undefined,
    recommendedChunkSizeBytes: numberOrUndefined(data.recommendedChunkSizeBytes),
    maxAssetSizeBytes: numberOrUndefined(data.maxAssetSizeBytes)
  }
}

function parseReceivedChunks(value: unknown, totalChunks: number): number[] {
  if (!Array.isArray(value)) return []
  const chunks: number[] = []
  const seen = new Set<number>()
  for (const item of value) {
    if (!Number.isInteger(item) || item < 0 || item >= totalChunks || seen.has(item)) continue
    seen.add(item)
    chunks.push(item)
  }
  return chunks.sort((a, b) => a - b)
}

async function parseAssetState(response: Response, operation: string): Promise<UploadAssetState> {
  const data = await parseJsonObject(response, operation)
  const recordingId = data.recordingId
  const asset = data.asset
  const status = data.status
  const sizeBytes = data.sizeBytes
  const chunkSizeBytes = data.chunkSizeBytes
  const totalChunks = data.totalChunks
  const receivedBytes = data.receivedBytes

  if (typeof recordingId !== 'string' || !recordingId) throw new Error(`${operation} missing recordingId`)
  if (asset !== 'video_audio' && asset !== 'microphone') throw new Error(`${operation} returned invalid asset`)
  if (status !== 'initialized' && status !== 'uploading' && status !== 'complete') {
    throw new Error(`${operation} returned invalid asset status`)
  }
  if (typeof sizeBytes !== 'number' || !Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error(`${operation} returned invalid sizeBytes`)
  }
  if (typeof chunkSizeBytes !== 'number' || !Number.isInteger(chunkSizeBytes) || chunkSizeBytes <= 0) {
    throw new Error(`${operation} returned invalid chunkSizeBytes`)
  }
  if (typeof totalChunks !== 'number' || !Number.isInteger(totalChunks) || totalChunks <= 0) {
    throw new Error(`${operation} returned invalid totalChunks`)
  }
  if (typeof receivedBytes !== 'number' || !Number.isInteger(receivedBytes) || receivedBytes < 0) {
    throw new Error(`${operation} returned invalid receivedBytes`)
  }

  return {
    recordingId,
    asset,
    status,
    sizeBytes,
    chunkSizeBytes,
    totalChunks,
    receivedChunks: parseReceivedChunks(data.receivedChunks, totalChunks),
    receivedBytes
  }
}

async function parseChunkResponse(response: Response, operation: string): Promise<UploadChunkResponse> {
  const data = await parseJsonObject(response, operation)
  const recordingId = data.recordingId
  const asset = data.asset
  const chunkIndex = data.chunkIndex
  const status = data.status
  const sizeBytes = data.sizeBytes
  const receivedBytes = data.receivedBytes
  const totalBytes = data.totalBytes

  if (typeof recordingId !== 'string' || !recordingId) throw new Error(`${operation} missing recordingId`)
  if (asset !== 'video_audio' && asset !== 'microphone') throw new Error(`${operation} returned invalid asset`)
  if (typeof chunkIndex !== 'number' || !Number.isInteger(chunkIndex) || chunkIndex < 0) {
    throw new Error(`${operation} returned invalid chunkIndex`)
  }
  if (status !== 'accepted') throw new Error(`${operation} returned invalid status`)
  if (typeof sizeBytes !== 'number' || !Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error(`${operation} returned invalid sizeBytes`)
  }
  if (typeof receivedBytes !== 'number' || !Number.isInteger(receivedBytes) || receivedBytes < 0) {
    throw new Error(`${operation} returned invalid receivedBytes`)
  }
  if (typeof totalBytes !== 'number' || !Number.isInteger(totalBytes) || totalBytes <= 0) {
    throw new Error(`${operation} returned invalid totalBytes`)
  }

  return {
    recordingId,
    asset,
    chunkIndex,
    status,
    sizeBytes,
    receivedBytes,
    totalBytes
  }
}

async function uploadAuthHeaders(extensionToken: string): Promise<{ Authorization: string }> {
  const token = extensionToken.trim()
  if (!token) throw new Meet2NoteAuthError('Connect to Meet2Note before uploading.')
  return { Authorization: makeAuthorizationHeader(token) }
}

function isUsableSession(session: UploadSessionState | null | undefined): session is UploadSessionState {
  if (!session?.recordingId || !session.uploadToken || !session.expiresAt) return false
  const expiresAtMs = Date.parse(session.expiresAt)
  return Number.isFinite(expiresAtMs) && expiresAtMs > Date.now() + SESSION_EXPIRY_SKEW_MS
}

async function initUpload(
  input: UploadRecordingInput,
  authHeaders: { Authorization: string }
): Promise<InitUploadResponse> {
  const body: Record<string, unknown> = {
    title: input.title
  }

  if (input.meetingId) body.meetingId = input.meetingId
  if (input.meetingTitle) body.meetingTitle = input.meetingTitle
  if (input.startedAt) body.startedAt = input.startedAt
  if (typeof input.durationMs === 'number' && input.durationMs > 0) body.durationMs = Math.floor(input.durationMs)

  const response = await fetchWithTimeout(
    'init upload',
    makeMeet2NoteUrl('/api/upload/init'),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders
      },
      body: JSON.stringify(body)
    },
    INIT_UPLOAD_TIMEOUT_MS
  )

  if (!response.ok) throw httpError('init upload', response)
  return parseInitResponse(response)
}

async function ensureUploadSession(
  input: UploadRecordingInput,
  authHeaders: { Authorization: string }
): Promise<UploadSessionState> {
  if (isUsableSession(input.uploadSession)) return input.uploadSession

  const session = await initUpload(input, authHeaders)
  await input.onUploadSession?.(session)
  return session
}

function assetContentType(asset: UploadAsset): 'video/webm' | 'audio/webm' {
  return asset === 'video_audio' ? 'video/webm' : 'audio/webm'
}

function resolveChunkSize(session: UploadSessionState, blob: Blob): number {
  const recommended = session.recommendedChunkSizeBytes
  const chunkSize = typeof recommended === 'number' && Number.isFinite(recommended) && recommended > 0
    ? Math.floor(recommended)
    : DEFAULT_CHUNK_SIZE_BYTES
  return Math.max(1, Math.min(blob.size, MAX_CHUNK_SIZE_BYTES, chunkSize))
}

function expectedChunkSize(blob: Blob, chunkSizeBytes: number, chunkIndex: number, totalChunks: number): number {
  if (chunkIndex === totalChunks - 1) {
    return blob.size - chunkSizeBytes * (totalChunks - 1)
  }
  return chunkSizeBytes
}

function sumReceivedBytes(receivedChunks: Set<number>, blob: Blob, chunkSizeBytes: number, totalChunks: number): number {
  let total = 0
  receivedChunks.forEach((chunkIndex) => {
    total += expectedChunkSize(blob, chunkSizeBytes, chunkIndex, totalChunks)
  })
  return Math.min(blob.size, total)
}

async function initAsset(
  session: UploadSessionState,
  asset: UploadAsset,
  blob: Blob,
  chunkSizeBytes: number,
  authHeaders: { Authorization: string }
): Promise<UploadAssetState> {
  const operation = `init ${asset} asset`
  const totalChunks = Math.ceil(blob.size / chunkSizeBytes)
  const response = await fetchWithTimeout(
    operation,
    makeMeet2NoteUrl(`/api/upload/${encodeURIComponent(session.recordingId)}/assets/${asset}`),
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Upload-Token': session.uploadToken,
        ...authHeaders
      },
      body: JSON.stringify({
        contentType: assetContentType(asset),
        sizeBytes: blob.size,
        chunkSizeBytes,
        totalChunks
      })
    },
    ASSET_METADATA_TIMEOUT_MS
  )

  if (!response.ok) throw httpError(operation, response)
  return parseAssetState(response, operation)
}

async function getAssetState(
  session: UploadSessionState,
  asset: UploadAsset,
  authHeaders: { Authorization: string }
): Promise<UploadAssetState> {
  const operation = `get ${asset} asset state`
  const response = await fetchWithTimeout(
    operation,
    makeMeet2NoteUrl(`/api/upload/${encodeURIComponent(session.recordingId)}/assets/${asset}`),
    {
      method: 'GET',
      headers: {
        'X-Upload-Token': session.uploadToken,
        ...authHeaders
      }
    },
    ASSET_METADATA_TIMEOUT_MS
  )

  if (!response.ok) throw httpError(operation, response)
  return parseAssetState(response, operation)
}

async function uploadChunk(
  session: UploadSessionState,
  asset: UploadAsset,
  chunkIndex: number,
  chunk: Blob,
  authHeaders: { Authorization: string },
  onChunkProgress?: (loadedBytes: number) => void
): Promise<UploadChunkResponse> {
  return new Promise<UploadChunkResponse>((resolve, reject) => {
    const operation = `upload ${asset} chunk ${chunkIndex}`
    const xhr = new XMLHttpRequest()
    let settled = false
    const timeoutId = setTimeout(() => {
      if (settled) return
      settled = true
      try { xhr.abort() } catch {}
      reject(new Error(`${operation} timed out after ${Math.round(CHUNK_UPLOAD_TIMEOUT_MS / 1000)} seconds`))
    }, CHUNK_UPLOAD_TIMEOUT_MS)

    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      callback()
    }

    xhr.upload.onprogress = (event) => {
      onChunkProgress?.(Math.min(chunk.size, Math.max(0, event.loaded)))
    }

    xhr.onload = () => {
      settle(() => {
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(httpError(operation, new Response(null, { status: xhr.status })))
          return
        }

        const response = new Response(xhr.responseText, {
          status: xhr.status,
          headers: { 'Content-Type': 'application/json' }
        })
        parseChunkResponse(response, operation).then(resolve, reject)
      })
    }

    xhr.onerror = () => {
      settle(() => reject(new Error(`${operation} failed with a network error`)))
    }

    xhr.onabort = () => {
      settle(() => reject(new Error(`${operation} was aborted`)))
    }

    xhr.open(
      'PUT',
      makeMeet2NoteUrl(`/api/upload/${encodeURIComponent(session.recordingId)}/assets/${asset}/chunks/${chunkIndex}`)
    )
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    xhr.setRequestHeader('X-Upload-Token', session.uploadToken)
    xhr.setRequestHeader('Authorization', authHeaders.Authorization)
    xhr.send(chunk)
  })
}

async function completeAsset(
  session: UploadSessionState,
  asset: UploadAsset,
  authHeaders: { Authorization: string }
): Promise<UploadAssetState> {
  const operation = `complete ${asset} asset`
  const response = await fetchWithTimeout(
    operation,
    makeMeet2NoteUrl(`/api/upload/${encodeURIComponent(session.recordingId)}/assets/${asset}/complete`),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Upload-Token': session.uploadToken,
        ...authHeaders
      },
      body: '{}'
    },
    ASSET_COMPLETE_TIMEOUT_MS
  )

  if (!response.ok) throw httpError(operation, response)
  return parseAssetState(response, operation)
}

async function completeUpload(
  session: UploadSessionState,
  assets: UploadAsset[],
  authHeaders: { Authorization: string }
): Promise<void> {
  const response = await fetchWithTimeout(
    'complete upload',
    makeMeet2NoteUrl(`/api/upload/${encodeURIComponent(session.recordingId)}/complete`),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Upload-Token': session.uploadToken,
        ...authHeaders
      },
      body: JSON.stringify({ assets })
    },
    COMPLETE_UPLOAD_TIMEOUT_MS
  )

  if (!response.ok) throw httpError('complete upload', response)
}

async function uploadAssetChunks(
  session: UploadSessionState,
  asset: UploadAsset,
  blob: Blob,
  authHeaders: { Authorization: string },
  reportProgress: (asset: UploadAsset, assetLoadedBytes: number, assetTotalBytes: number) => void
): Promise<void> {
  const chunkSizeBytes = resolveChunkSize(session, blob)
  const initialized = await initAsset(session, asset, blob, chunkSizeBytes, authHeaders)
  const state = initialized.status === 'complete'
    ? initialized
    : await getAssetState(session, asset, authHeaders)

  const receivedChunks = new Set(state.receivedChunks)
  let acceptedBytes = Math.max(
    state.receivedBytes,
    sumReceivedBytes(receivedChunks, blob, state.chunkSizeBytes, state.totalChunks)
  )

  reportProgress(asset, acceptedBytes, blob.size)

  for (let chunkIndex = 0; chunkIndex < state.totalChunks; chunkIndex += 1) {
    if (receivedChunks.has(chunkIndex)) continue

    const start = chunkIndex * state.chunkSizeBytes
    const end = Math.min(blob.size, start + state.chunkSizeBytes)
    const chunk = blob.slice(start, end)
    const acceptedBeforeChunk = acceptedBytes
    const response = await uploadChunk(
      session,
      asset,
      chunkIndex,
      chunk,
      authHeaders,
      loadedBytes => reportProgress(asset, acceptedBeforeChunk + loadedBytes, blob.size)
    )

    receivedChunks.add(chunkIndex)
    acceptedBytes = Math.max(
      response.receivedBytes,
      sumReceivedBytes(receivedChunks, blob, state.chunkSizeBytes, state.totalChunks)
    )
    reportProgress(asset, acceptedBytes, blob.size)
  }

  await completeAsset(session, asset, authHeaders)
  reportProgress(asset, blob.size, blob.size)
}

export async function uploadRecordingOnce(
  input: UploadRecordingInput,
  extensionToken: string,
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadRecordingResult> {
  const authHeaders = await uploadAuthHeaders(extensionToken)
  const session = await ensureUploadSession(input, authHeaders)
  const assets: UploadAsset[] = ['video_audio']
  const totalBytes = input.videoBlob.size + (input.microphoneBlob?.size || 0)
  const loadedByAsset: Record<UploadAsset, number> = {
    video_audio: 0,
    microphone: 0
  }
  const reportProgress = (asset: UploadAsset, assetLoadedBytes: number, assetTotalBytes: number) => {
    loadedByAsset[asset] = Math.min(assetTotalBytes, Math.max(0, assetLoadedBytes))
    onProgress?.({
      asset,
      loadedBytes: loadedByAsset.video_audio + loadedByAsset.microphone,
      totalBytes,
      assetLoadedBytes: loadedByAsset[asset],
      assetTotalBytes
    })
  }

  await uploadAssetChunks(session, 'video_audio', input.videoBlob, authHeaders, reportProgress)

  if (input.microphoneBlob && input.microphoneBlob.size > 0) {
    await uploadAssetChunks(session, 'microphone', input.microphoneBlob, authHeaders, reportProgress)
    assets.push('microphone')
  }

  await completeUpload(session, assets, authHeaders)

  return {
    recordingId: session.recordingId,
    assets
  }
}
