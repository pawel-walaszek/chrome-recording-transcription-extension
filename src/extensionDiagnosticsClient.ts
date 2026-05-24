import {
  makeAuthorizationHeader,
  Meet2NoteAuthError
} from './extensionAuth'
import { makeMeet2NoteUrl } from './meet2noteConfig'

const REPORT_EXTENSION_DIAGNOSTIC_TIMEOUT_MS = 30_000

export interface ExtensionDiagnosticEvent {
  eventId: string
  type: string
  severity: 'debug' | 'info' | 'warning' | 'error'
  occurredAt: string
  source: 'chrome_extension'
  schemaVersion: number
  payload: Record<string, unknown>
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
  const timeoutId = setTimeout(() => controller.abort(), REPORT_EXTENSION_DIAGNOSTIC_TIMEOUT_MS)
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('extension diagnostic report timed out after 30 seconds')
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function reportExtensionDiagnostic(
  event: ExtensionDiagnosticEvent,
  extensionToken: string
): Promise<void> {
  const token = extensionToken.trim()
  if (!token) throw new Meet2NoteAuthError('Connect to Meet2Note before reporting extension diagnostics.')

  const response = await fetchWithTimeout(
    makeMeet2NoteUrl('/api/extension/diagnostics'),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: makeAuthorizationHeader(token)
      },
      body: JSON.stringify(event)
    }
  )

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Meet2NoteAuthError('Meet2Note connection required to report extension diagnostics.', response.status)
    }
    const detail = normalizeErrorBody(await response.text().catch(() => null))
    const suffix = detail ? `: ${detail}` : ''
    throw new Error(`extension diagnostic report failed with HTTP ${response.status}${suffix}`)
  }
}
