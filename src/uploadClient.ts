import { captureException } from './diagnostics'

declare const __UPLOAD_API_BASE_URL__: string

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

interface InitUploadResponse {
  recordingId: string
  uploadToken: string
  expiresAt: string
}

const DEFAULT_UPLOAD_API_BASE_URL = 'https://meet2note.com'
const INIT_UPLOAD_TIMEOUT_MS = 30_000
const COMPLETE_UPLOAD_TIMEOUT_MS = 30_000
const ASSET_UPLOAD_TIMEOUT_MS = 5 * 60_000

function getUploadApiBaseUrl(): string {
  const raw = typeof __UPLOAD_API_BASE_URL__ === 'string' && __UPLOAD_API_BASE_URL__.trim()
    ? __UPLOAD_API_BASE_URL__.trim()
    : DEFAULT_UPLOAD_API_BASE_URL

  return raw.replace(/\/+$/, '')
}

function makeUrl(path: string): string {
  return `${getUploadApiBaseUrl()}${path}`
}

function httpError(operation: string, response: Response): Error {
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

async function initUpload(input: UploadRecordingInput): Promise<InitUploadResponse> {
  const body: Record<string, unknown> = {
    title: input.title
  }

  if (input.meetingId) body.meetingId = input.meetingId
  if (input.meetingTitle) body.meetingTitle = input.meetingTitle
  if (input.startedAt) body.startedAt = input.startedAt
  if (typeof input.durationMs === 'number' && input.durationMs > 0) body.durationMs = Math.floor(input.durationMs)

  const response = await fetchWithTimeout(
    'init upload',
    makeUrl('/api/upload/init'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  blob: Blob
): Promise<void> {
  const response = await fetchWithTimeout(
    `upload ${path}`,
    makeUrl(`/api/upload/${encodeURIComponent(recordingId)}/${path}`),
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Upload-Token': uploadToken
      },
      body: blob
    },
    ASSET_UPLOAD_TIMEOUT_MS
  )

  if (!response.ok) throw httpError(`upload ${path}`, response)
}

async function completeUpload(
  recordingId: string,
  uploadToken: string,
  assets: UploadAsset[]
): Promise<void> {
  const response = await fetchWithTimeout(
    'complete upload',
    makeUrl(`/api/upload/${encodeURIComponent(recordingId)}/complete`),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Upload-Token': uploadToken
      },
      body: JSON.stringify({ assets })
    },
    COMPLETE_UPLOAD_TIMEOUT_MS
  )

  if (!response.ok) throw httpError('complete upload', response)
}

export async function uploadRecordingOnce(input: UploadRecordingInput): Promise<UploadRecordingResult> {
  try {
    const session = await initUpload(input)
    const assets: UploadAsset[] = ['video_audio']

    await uploadAsset(session.recordingId, session.uploadToken, 'video', input.videoBlob)

    if (input.microphoneBlob && input.microphoneBlob.size > 0) {
      await uploadAsset(session.recordingId, session.uploadToken, 'microphone', input.microphoneBlob)
      assets.push('microphone')
    }

    await completeUpload(session.recordingId, session.uploadToken, assets)

    return {
      recordingId: session.recordingId,
      assets
    }
  } catch (error) {
    captureException(error, {
      operation: 'uploadRecordingOnce',
      hasMicrophoneAsset: !!input.microphoneBlob,
      videoBytes: input.videoBlob.size,
      microphoneBytes: input.microphoneBlob?.size || 0
    })
    throw error
  }
}
