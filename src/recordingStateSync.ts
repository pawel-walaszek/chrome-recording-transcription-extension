import { makeAuthorizationHeader, Meet2NoteAuthError } from './extensionAuth'
import { makeMeet2NoteUrl } from './meet2noteConfig'
import type { RecordingFailureReason, RecordingHistoryItem, RecordingUploadStatus } from './recordingHistory'

export type ExtensionMutableRecordingStatus = Extract<
  RecordingUploadStatus,
  'recording' | 'finalizing' | 'upload_queued' | 'uploading' | 'failed' | 'canceled'
>

const EXTENSION_MUTABLE_RECORDING_STATUSES = new Set<RecordingUploadStatus>([
  'recording',
  'finalizing',
  'upload_queued',
  'uploading',
  'failed',
  'canceled'
])

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SYNC_EXTENSION_STATE_TIMEOUT_MS = 30_000
const FAILURE_STAGE_BY_REASON: Record<RecordingFailureReason, string> = {
  auth_required: 'authorization',
  local_error: 'local_recording',
  unrecoverable: 'local_recording',
  upload_error: 'uploading'
}
const FAILURE_REASON_BY_REASON: Record<RecordingFailureReason, string> = {
  auth_required: 'Meet2Note connection is required before this recording can upload.',
  local_error: 'Recording failed locally in the browser.',
  unrecoverable: 'Recording could not be finalized in the browser.',
  upload_error: 'Recording upload failed in the extension.'
}

export interface SyncExtensionRecordingStateResult {
  recordingId: string
}

export function isExtensionMutableRecordingStatus(
  status: RecordingUploadStatus
): status is ExtensionMutableRecordingStatus {
  return EXTENSION_MUTABLE_RECORDING_STATUSES.has(status)
}

export function resolveExtensionRecordingId(item: RecordingHistoryItem): string | null {
  if (item.backendRecordingId && UUID_PATTERN.test(item.backendRecordingId)) return item.backendRecordingId
  if (UUID_PATTERN.test(item.localId)) return item.localId
  return null
}

function normalizeErrorBody(body: string | null): string | null {
  if (!body) return null
  const trimmed = body.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      const message = record.message
      const error = record.error
      if (Array.isArray(message)) return message.map(String).join('; ').slice(0, 500)
      if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 500)
      if (typeof error === 'string' && error.trim()) return error.trim().slice(0, 500)
    }
  } catch {}
  return trimmed.slice(0, 500)
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), SYNC_EXTENSION_STATE_TIMEOUT_MS)
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('sync extension recording state timed out after 30 seconds')
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

function titleForSync(title: string): string {
  const normalizedTitle = title.trim() || 'Browser recording'
  return normalizedTitle.slice(0, 255)
}

function textForSync(value: string | null | undefined, fallback: string, maxLength: number): string {
  const normalized = (value || fallback).trim() || fallback
  return normalized.slice(0, maxLength)
}

function isIsoDateString(value: string): boolean {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp)
}

function timestampForSync(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  return date.toISOString()
}

function applyFailureDetails(body: Record<string, unknown>, item: RecordingHistoryItem): void {
  const fallbackFailureReason = item.failureReason
    ? FAILURE_REASON_BY_REASON[item.failureReason]
    : 'Recording failed in the extension.'

  body.failureStage = item.failureReason
    ? FAILURE_STAGE_BY_REASON[item.failureReason]
    : 'local_recording'
  body.failureReason = textForSync(item.error, fallbackFailureReason, 255)
  body.failureMessage = textForSync(
    [
      item.error ? `Extension error: ${item.error}` : null,
      item.failureReason ? `Local failure reason: ${item.failureReason}` : null,
      `Local recording id: ${item.localId}`
    ].filter(Boolean).join('\n'),
    fallbackFailureReason,
    1000
  )

  if (typeof item.attempt === 'number' && Number.isFinite(item.attempt) && item.attempt >= 0) {
    body.retryCount = Math.floor(item.attempt)
  }

  const nextRetryAt = timestampForSync(item.nextRetryAt)
  if (nextRetryAt) body.nextRetryAt = nextRetryAt
}

export async function syncExtensionRecordingState(
  item: RecordingHistoryItem,
  extensionToken: string
): Promise<SyncExtensionRecordingStateResult> {
  if (!isExtensionMutableRecordingStatus(item.status)) {
    throw new Error(`Recording status is backend-owned and cannot be synced by the extension: ${item.status}`)
  }

  const recordingId = resolveExtensionRecordingId(item)
  if (!recordingId) {
    throw new Error(`Recording localId is not a backend-compatible UUID: ${item.localId}`)
  }

  const body: Record<string, unknown> = {
    title: titleForSync(item.title),
    status: item.status
  }

  if (item.startedAt && isIsoDateString(item.startedAt)) body.startedAt = item.startedAt
  if (typeof item.durationMs === 'number' && Number.isFinite(item.durationMs) && item.durationMs >= 0) {
    body.durationMs = Math.floor(item.durationMs)
  }
  if (item.status === 'uploading' &&
    typeof item.uploadProgressPercent === 'number' &&
    Number.isFinite(item.uploadProgressPercent)) {
    body.uploadProgressPercent = Math.max(0, Math.min(100, Math.floor(item.uploadProgressPercent)))
  }
  if (item.meetingId) body.meetingId = item.meetingId
  if (item.tabUrl && /^https:\/\//i.test(item.tabUrl)) body.meetingUrl = item.tabUrl
  if (item.status === 'failed') applyFailureDetails(body, item)

  const response = await fetchWithTimeout(
    makeMeet2NoteUrl(`/api/recordings/${encodeURIComponent(recordingId)}/extension-state`),
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: makeAuthorizationHeader(extensionToken)
      },
      body: JSON.stringify(body)
    }
  )

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Meet2NoteAuthError('Meet2Note connection required to synchronize recording state.', response.status)
    }
    const detail = normalizeErrorBody(await response.text().catch(() => null))
    const suffix = detail ? `: ${detail}` : ''
    throw new Error(`sync extension recording state failed with HTTP ${response.status}${suffix}`)
  }

  return { recordingId }
}
