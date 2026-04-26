import { makeMeet2NoteUrl } from './meet2noteConfig'

export interface Meet2NoteUser {
  id?: string
  email?: string
  displayName?: string
}

export interface Meet2NoteConnection {
  connected: boolean
  user: Meet2NoteUser | null
  connectedAt: string | null
  authError: string | null
}

interface StoredConnection {
  meet2noteExtensionToken?: unknown
  meet2noteConnectedUser?: unknown
  meet2noteConnectedAt?: unknown
  meet2noteAuthError?: unknown
}

interface StoredConnectState {
  meet2noteConnectState?: unknown
  meet2noteConnectStartedAt?: unknown
}

interface ExtensionTokenResponse {
  extensionToken?: unknown
  tokenType?: unknown
  user?: unknown
  createdAt?: unknown
}

export const MEET2NOTE_EXTENSION_TOKEN_KEY = 'meet2noteExtensionToken'
export const MEET2NOTE_CONNECTED_USER_KEY = 'meet2noteConnectedUser'
export const MEET2NOTE_CONNECTED_AT_KEY = 'meet2noteConnectedAt'
export const MEET2NOTE_AUTH_ERROR_KEY = 'meet2noteAuthError'
export const MEET2NOTE_CONNECT_STATE_KEY = 'meet2noteConnectState'
export const MEET2NOTE_CONNECT_STARTED_AT_KEY = 'meet2noteConnectStartedAt'

const CONNECT_STATE_TTL_MS = 10 * 60_000
const TOKEN_EXCHANGE_TIMEOUT_MS = 30_000

export class Meet2NoteAuthError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'Meet2NoteAuthError'
    this.status = status
  }
}

export function isMeet2NoteAuthError(error: unknown): error is Meet2NoteAuthError {
  return error instanceof Meet2NoteAuthError ||
    (typeof error === 'object' && error !== null && (error as Error).name === 'Meet2NoteAuthError')
}

function storageGet<T>(keys: string[]): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (items) => {
      const runtimeError = chrome.runtime.lastError
      if (runtimeError) return reject(new Error(runtimeError.message))
      resolve(items as T)
    })
  })
}

function storageSet(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      const runtimeError = chrome.runtime.lastError
      if (runtimeError) return reject(new Error(runtimeError.message))
      resolve()
    })
  })
}

function storageRemove(keys: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      const runtimeError = chrome.runtime.lastError
      if (runtimeError) return reject(new Error(runtimeError.message))
      resolve()
    })
  })
}

function sanitizeUser(value: unknown): Meet2NoteUser | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  return {
    id: typeof record.id === 'string' ? record.id : undefined,
    email: typeof record.email === 'string' ? record.email : undefined,
    displayName: typeof record.displayName === 'string' ? record.displayName : undefined
  }
}

function generateState(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

function normalizeStoredToken(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function getMeet2NoteConnection(): Promise<Meet2NoteConnection> {
  const items = await storageGet<StoredConnection>([
    MEET2NOTE_EXTENSION_TOKEN_KEY,
    MEET2NOTE_CONNECTED_USER_KEY,
    MEET2NOTE_CONNECTED_AT_KEY,
    MEET2NOTE_AUTH_ERROR_KEY
  ])
  const token = normalizeStoredToken(items.meet2noteExtensionToken)

  return {
    connected: token.length > 0,
    user: token ? sanitizeUser(items.meet2noteConnectedUser) : null,
    connectedAt: typeof items.meet2noteConnectedAt === 'string' ? items.meet2noteConnectedAt : null,
    authError: typeof items.meet2noteAuthError === 'string' ? items.meet2noteAuthError : null
  }
}

export async function getMeet2NoteExtensionToken(): Promise<string | null> {
  const items = await storageGet<StoredConnection>([MEET2NOTE_EXTENSION_TOKEN_KEY])
  const token = normalizeStoredToken(items.meet2noteExtensionToken)
  return token || null
}

export async function requireMeet2NoteExtensionToken(): Promise<string> {
  const token = await getMeet2NoteExtensionToken()
  if (!token) throw new Meet2NoteAuthError('Connect to Meet2Note before uploading.')
  return token
}

export function makeAuthorizationHeader(token: string): string {
  return `Bearer ${token}`
}

export async function startMeet2NoteConnectFlow(): Promise<void> {
  const state = generateState()
  const redirectUri = chrome.runtime.getURL('connect-callback.html')
  const url = new URL(makeMeet2NoteUrl('/extension/connect'))
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)

  await storageSet({
    [MEET2NOTE_CONNECT_STATE_KEY]: state,
    [MEET2NOTE_CONNECT_STARTED_AT_KEY]: Date.now(),
    [MEET2NOTE_AUTH_ERROR_KEY]: null
  })

  await chrome.tabs.create({ url: url.toString() })
}

export async function markMeet2NoteReconnectRequired(message: string): Promise<void> {
  await storageRemove([
    MEET2NOTE_EXTENSION_TOKEN_KEY,
    MEET2NOTE_CONNECTED_USER_KEY,
    MEET2NOTE_CONNECTED_AT_KEY
  ])
  await storageSet({ [MEET2NOTE_AUTH_ERROR_KEY]: message })
}

export async function clearMeet2NoteAuthError(): Promise<void> {
  await storageRemove([MEET2NOTE_AUTH_ERROR_KEY])
}

export async function disconnectMeet2Note(): Promise<void> {
  await storageRemove([
    MEET2NOTE_EXTENSION_TOKEN_KEY,
    MEET2NOTE_CONNECTED_USER_KEY,
    MEET2NOTE_CONNECTED_AT_KEY,
    MEET2NOTE_AUTH_ERROR_KEY,
    MEET2NOTE_CONNECT_STATE_KEY,
    MEET2NOTE_CONNECT_STARTED_AT_KEY
  ])
}

async function validateReturnedState(returnedState: string): Promise<void> {
  const items = await storageGet<StoredConnectState>([
    MEET2NOTE_CONNECT_STATE_KEY,
    MEET2NOTE_CONNECT_STARTED_AT_KEY
  ])
  const expectedState = typeof items.meet2noteConnectState === 'string'
    ? items.meet2noteConnectState
    : ''
  const startedAt = typeof items.meet2noteConnectStartedAt === 'number'
    ? items.meet2noteConnectStartedAt
    : 0

  if (!expectedState || expectedState !== returnedState) {
    await storageRemove([MEET2NOTE_CONNECT_STATE_KEY, MEET2NOTE_CONNECT_STARTED_AT_KEY])
    throw new Error('Connection state does not match. Start the connection flow again.')
  }

  if (!startedAt || Date.now() - startedAt > CONNECT_STATE_TTL_MS) {
    await storageRemove([MEET2NOTE_CONNECT_STATE_KEY, MEET2NOTE_CONNECT_STARTED_AT_KEY])
    throw new Error('Connection state expired. Start the connection flow again.')
  }
}

function parseTokenResponse(data: ExtensionTokenResponse): {
  extensionToken: string
  user: Meet2NoteUser | null
  createdAt: string
} {
  const extensionToken = typeof data.extensionToken === 'string' ? data.extensionToken : ''
  const tokenType = typeof data.tokenType === 'string' ? data.tokenType : 'Bearer'
  if (!extensionToken) throw new Error('Backend did not return extensionToken.')
  if (tokenType !== 'Bearer') throw new Error('Backend returned unsupported token type.')

  return {
    extensionToken,
    user: sanitizeUser(data.user),
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString()
  }
}

async function fetchTokenExchange(code: string): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TOKEN_EXCHANGE_TIMEOUT_MS)

  try {
    return await fetch(makeMeet2NoteUrl('/api/extension/token'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
      signal: controller.signal
    })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Meet2Note connection timed out after ${Math.round(TOKEN_EXCHANGE_TIMEOUT_MS / 1000)} seconds.`)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function exchangeMeet2NoteConnectionCode(code: string, state: string): Promise<void> {
  if (!code) throw new Error('Missing connection code.')
  if (!state) throw new Error('Missing connection state.')

  await validateReturnedState(state)

  const response = await fetchTokenExchange(code)

  if (!response.ok) {
    throw new Error(`Meet2Note connection failed with HTTP ${response.status}.`)
  }

  const data = await response.json().catch(() => null) as ExtensionTokenResponse | null
  if (!data || typeof data !== 'object') throw new Error('Meet2Note connection returned invalid JSON.')
  const parsed = parseTokenResponse(data)

  await storageSet({
    [MEET2NOTE_EXTENSION_TOKEN_KEY]: parsed.extensionToken,
    [MEET2NOTE_CONNECTED_USER_KEY]: parsed.user,
    [MEET2NOTE_CONNECTED_AT_KEY]: parsed.createdAt
  })
  await storageRemove([
    MEET2NOTE_CONNECT_STATE_KEY,
    MEET2NOTE_CONNECT_STARTED_AT_KEY,
    MEET2NOTE_AUTH_ERROR_KEY
  ])
}
