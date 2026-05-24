import {
  makeAuthorizationHeader,
  Meet2NoteAuthError
} from './extensionAuth'
import { fetchWithTimeout, normalizeErrorBody } from './httpClientUtils'
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
    },
    REPORT_EXTENSION_DIAGNOSTIC_TIMEOUT_MS,
    'extension diagnostic report timed out after 30 seconds'
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
