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

  const response = await fetch(makeUrl('/api/upload/init'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

  if (!response.ok) throw httpError('init upload', response)
  return parseInitResponse(response)
}

async function uploadAsset(
  recordingId: string,
  uploadToken: string,
  path: 'video' | 'microphone',
  blob: Blob
): Promise<void> {
  const response = await fetch(makeUrl(`/api/upload/${encodeURIComponent(recordingId)}/${path}`), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Upload-Token': uploadToken
    },
    body: blob
  })

  if (!response.ok) throw httpError(`upload ${path}`, response)
}

async function completeUpload(
  recordingId: string,
  uploadToken: string,
  assets: UploadAsset[]
): Promise<void> {
  const response = await fetch(makeUrl(`/api/upload/${encodeURIComponent(recordingId)}/complete`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Upload-Token': uploadToken
    },
    body: JSON.stringify({ assets })
  })

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
