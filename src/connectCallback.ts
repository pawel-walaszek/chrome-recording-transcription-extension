import { captureException, initDiagnostics } from './diagnostics'
import { exchangeMeet2NoteConnectionCode } from './extensionAuth'

initDiagnostics('connectCallback')

const statusElement = document.getElementById('status')
const detailElement = document.getElementById('detail')

function setStatus(title: string, detail: string, state: 'pending' | 'success' | 'error'): void {
  document.body.dataset.state = state
  if (statusElement) statusElement.textContent = title
  if (detailElement) detailElement.textContent = detail
}

async function handleCallback(): Promise<void> {
  const params = new URLSearchParams(window.location.search)
  const error = params.get('error')
  const code = params.get('code') || ''
  const state = params.get('state') || ''

  if (error) {
    throw new Error(`Meet2Note returned an error: ${error}`)
  }

  await exchangeMeet2NoteConnectionCode(code, state)
  setStatus('Connected to Meet2Note', 'You can close this tab and return to the extension.', 'success')
  window.setTimeout(() => window.close(), 2500)
}

setStatus('Connecting to Meet2Note...', 'Finishing extension connection.', 'pending')
handleCallback().catch((error) => {
  console.error('[connect-callback] connection failed', error)
  captureException(error, { operation: 'connectCallback' })
  setStatus(
    'Connection failed',
    error instanceof Error ? error.message : 'Start the connection flow again from the extension popup.',
    'error'
  )
})
