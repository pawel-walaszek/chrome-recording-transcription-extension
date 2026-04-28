import {
  makeAuthorizationHeader,
  Meet2NoteAuthError
} from './extensionAuth'
import { makeMeet2NoteUrl } from './meet2noteConfig'

export type BackendRecordingStatus = 'pending' | 'processing' | 'ready' | 'failed'

export interface BackendRecordingListItem {
  id: string
  title: string
  status: BackendRecordingStatus
  durationMs: number | null
  createdAt: string
  updatedAt: string
}

const LIST_RECORDINGS_TIMEOUT_MS = 30_000

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  return fetch(url, {
    ...init,
    signal: controller.signal
  }).catch((error) => {
    if (controller.signal.aborted) {
      throw new Error(`recordings list timed out after ${Math.round(timeoutMs / 1000)} seconds`)
    }
    throw error
  }).finally(() => {
    clearTimeout(timeoutId)
  })
}

function isBackendRecordingStatus(value: unknown): value is BackendRecordingStatus {
  return value === 'pending' ||
    value === 'processing' ||
    value === 'ready' ||
    value === 'failed'
}

function parseBackendRecording(value: unknown): BackendRecordingListItem | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  const status = record.status
  const createdAt = typeof record.createdAt === 'string' ? record.createdAt.trim() : ''
  const updatedAtRaw = typeof record.updatedAt === 'string' ? record.updatedAt.trim() : ''
  const updatedAt = updatedAtRaw || createdAt

  if (!id || !isBackendRecordingStatus(status) || !createdAt) return null

  return {
    id,
    title: title || 'Meet2Note recording',
    status,
    durationMs: typeof record.durationMs === 'number' && Number.isFinite(record.durationMs)
      ? record.durationMs
      : null,
    createdAt,
    updatedAt
  }
}

export async function listMeet2NoteRecordings(extensionToken: string): Promise<BackendRecordingListItem[]> {
  const token = extensionToken.trim()
  if (!token) throw new Meet2NoteAuthError('Connect to Meet2Note before loading recordings.')

  const response = await fetchWithTimeout(
    makeMeet2NoteUrl('/api/recordings'),
    {
      method: 'GET',
      headers: {
        Authorization: makeAuthorizationHeader(token)
      }
    },
    LIST_RECORDINGS_TIMEOUT_MS
  )

  if (response.status === 401 || response.status === 403) {
    throw new Meet2NoteAuthError('Meet2Note connection required for recordings list.', response.status)
  }
  if (!response.ok) throw new Error(`recordings list failed with HTTP ${response.status}`)

  const data = await response.json().catch(() => null)
  if (!Array.isArray(data)) throw new Error('recordings list returned invalid JSON')

  return data
    .map(parseBackendRecording)
    .filter((item): item is BackendRecordingListItem => item !== null)
}
