declare const __UPLOAD_API_BASE_URL__: string

const DEFAULT_MEET2NOTE_BASE_URL = 'https://meet2note.com'

export function getMeet2NoteBaseUrl(): string {
  const raw = typeof __UPLOAD_API_BASE_URL__ === 'string' && __UPLOAD_API_BASE_URL__.trim()
    ? __UPLOAD_API_BASE_URL__.trim()
    : DEFAULT_MEET2NOTE_BASE_URL

  return raw.replace(/\/+$/, '')
}

export function makeMeet2NoteUrl(path: string): string {
  return `${getMeet2NoteBaseUrl()}${path}`
}
