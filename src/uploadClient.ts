import {
  makeAuthorizationHeader,
  Meet2NoteAuthError
} from './extensionAuth'
import { makeMeet2NoteUrl } from './meet2noteConfig'

export type UploadAsset = 'video_audio' | 'microphone'

export interface UploadRecordingInput {
  title: string
  meetingId?: string
  meetingTitle?: string
  startedAt?: string
  durationMs?: number
  videoBlob: Blob
  microphoneBlob?: Blob | null
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

interface InitUploadResponse {
  recordingId: string
  uploadToken: string
  expiresAt: string
}

const INIT_UPLOAD_TIMEOUT_MS = 30_000
const COMPLETE_UPLOAD_TIMEOUT_MS = 30_000
const ASSET_UPLOAD_TIMEOUT_MS = 20 * 60_000

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

async function parseInitResponse(response: Response): Promise<InitUploadResponse> {
  const data = await response.json().catch(() => null)
  if (!data || typeof data !== 'object') throw new Error('init upload returned invalid JSON')

  const recordingId = (data as { recordingId?: unknown }).recordingId
  const uploadToken = (data as { uploadToken?: unknown }).uploadToken
  const expiresAt = (data as { expiresAt?: unknown }).expiresAt

  if (typeof recordingId !== 'string' || !recordingId) throw new Error('init upload missing recordingId')
  if (typeof uploadToken !== 'string' || !uploadToken) throw new Error('init upload missing uploadToken')
  if (typeof expiresAt !== 'string' || !expiresAt) throw new Error('init upload missing expiresAt')

  return { recordingId, uploadToken, expiresAt }
}

async function uploadAuthHeaders(extensionToken: string): Promise<{ Authorization: string }> {
  const token = extensionToken.trim()
  if (!token) throw new Meet2NoteAuthError('Connect to Meet2Note before uploading.')
  return { Authorization: makeAuthorizationHeader(token) }
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

async function uploadAsset(
  recordingId: string,
  uploadToken: string,
  path: 'video' | 'microphone',
  blob: Blob,
  authHeaders: { Authorization: string },
  onAssetProgress?: (loadedBytes: number) => void
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const operation = `upload ${path}`
    const xhr = new XMLHttpRequest()
    let settled = false
    const timeoutId = setTimeout(() => {
      if (settled) return
      settled = true
      try { xhr.abort() } catch {}
      reject(new Error(`${operation} timed out after ${Math.round(ASSET_UPLOAD_TIMEOUT_MS / 1000)} seconds`))
    }, ASSET_UPLOAD_TIMEOUT_MS)

    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      callback()
    }

    xhr.upload.onprogress = (event) => {
      onAssetProgress?.(Math.min(blob.size, Math.max(0, event.loaded)))
    }

    xhr.onload = () => {
      settle(() => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onAssetProgress?.(blob.size)
          resolve()
          return
        }

        reject(httpError(operation, new Response(null, { status: xhr.status })))
      })
    }

    xhr.onerror = () => {
      settle(() => reject(new Error(`${operation} failed with a network error`)))
    }

    xhr.onabort = () => {
      settle(() => reject(new Error(`${operation} was aborted`)))
    }

    xhr.open('PUT', makeMeet2NoteUrl(`/api/upload/${encodeURIComponent(recordingId)}/${path}`))
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    xhr.setRequestHeader('X-Upload-Token', uploadToken)
    xhr.setRequestHeader('Authorization', authHeaders.Authorization)
    xhr.send(blob)
  })
}

async function completeUpload(
  recordingId: string,
  uploadToken: string,
  assets: UploadAsset[],
  authHeaders: { Authorization: string }
): Promise<void> {
  const response = await fetchWithTimeout(
    'complete upload',
    makeMeet2NoteUrl(`/api/upload/${encodeURIComponent(recordingId)}/complete`),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Upload-Token': uploadToken,
        ...authHeaders
      },
      body: JSON.stringify({ assets })
    },
    COMPLETE_UPLOAD_TIMEOUT_MS
  )

  if (!response.ok) throw httpError('complete upload', response)
}

export async function uploadRecordingOnce(
  input: UploadRecordingInput,
  extensionToken: string,
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadRecordingResult> {
  const authHeaders = await uploadAuthHeaders(extensionToken)
  const session = await initUpload(input, authHeaders)
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

  reportProgress('video_audio', 0, input.videoBlob.size)
  await uploadAsset(
    session.recordingId,
    session.uploadToken,
    'video',
    input.videoBlob,
    authHeaders,
    loadedBytes => reportProgress('video_audio', loadedBytes, input.videoBlob.size)
  )

  if (input.microphoneBlob && input.microphoneBlob.size > 0) {
    reportProgress('microphone', 0, input.microphoneBlob.size)
    await uploadAsset(
      session.recordingId,
      session.uploadToken,
      'microphone',
      input.microphoneBlob,
      authHeaders,
      loadedBytes => reportProgress('microphone', loadedBytes, input.microphoneBlob!.size)
    )
    assets.push('microphone')
  }

  await completeUpload(session.recordingId, session.uploadToken, assets, authHeaders)

  return {
    recordingId: session.recordingId,
    assets
  }
}
