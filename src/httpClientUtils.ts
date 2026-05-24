export function normalizeErrorBody(body: string | null, maxLength = 500): string | null {
  if (!body) return null
  const trimmed = body.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      const message = record.message
      const error = record.error
      if (Array.isArray(message)) return message.map(String).join('; ').slice(0, maxLength)
      if (typeof message === 'string' && message.trim()) return message.trim().slice(0, maxLength)
      if (typeof error === 'string' && error.trim()) return error.trim().slice(0, maxLength)
    }
  } catch {}
  return trimmed.slice(0, maxLength)
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string
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
      throw new Error(timeoutMessage)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}
