import {
  makeAuthorizationHeader,
  Meet2NoteAuthError
} from './extensionAuth'
import { fetchWithTimeout } from './httpClientUtils'
import { makeMeet2NoteUrl } from './meet2noteConfig'

export type BackendRecordingStatus = 'processing_queued' | 'processing' | 'ready' | 'failed' | 'expired'

export interface BackendRecordingListItem {
  id: string
  title: string
  status: BackendRecordingStatus
  durationMs: number | null
  startedAt: string | null
  createdAt: string
  updatedAt: string
  displayTimeline?: string
}

const LIST_RECORDINGS_TIMEOUT_MS = 30_000

function normalizeBackendRecordingStatus(value: unknown): BackendRecordingStatus | null {
  if (value === 'pending') return 'processing_queued'
  if (value === 'processing_queued' ||
    value === 'processing' ||
    value === 'ready' ||
    value === 'failed' ||
    value === 'expired') return value
  return null
}

function parseBackendRecording(value: unknown): BackendRecordingListItem | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  const status = normalizeBackendRecordingStatus(record.status)
  const startedAtRaw = typeof record.startedAt === 'string' ? record.startedAt.trim() : ''
  const createdAt = typeof record.createdAt === 'string' ? record.createdAt.trim() : ''
  const updatedAtRaw = typeof record.updatedAt === 'string' ? record.updatedAt.trim() : ''
  const updatedAt = updatedAtRaw || createdAt
  const displayTimeline = typeof record.displayTimeline === 'string' ? record.displayTimeline.trim() : ''

  if (!id || !status || !createdAt) return null

  return {
    id,
    title: title || 'Meet2Note recording',
    status,
    durationMs: typeof record.durationMs === 'number' && Number.isFinite(record.durationMs)
      ? record.durationMs
      : null,
    startedAt: startedAtRaw || null,
    createdAt,
    updatedAt,
    ...(displayTimeline ? { displayTimeline } : {})
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
    LIST_RECORDINGS_TIMEOUT_MS,
    `recordings list timed out after ${Math.round(LIST_RECORDINGS_TIMEOUT_MS / 1000)} seconds`
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
