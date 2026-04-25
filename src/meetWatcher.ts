// src/meetWatcher.ts

import { captureException, initDiagnostics } from './diagnostics'

initDiagnostics('meetWatcher')

const MEETING_PATH_RE = /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:$|[/?#])/i
const POLL_MS = 1000
const ABSENT_CONFIRMATIONS = 3

let lastSentInMeeting: boolean | null = null
let absentCount = 0

function hasMeetingPath(): boolean {
  return location.hostname === 'meet.google.com' && MEETING_PATH_RE.test(location.pathname)
}

function normalize(text: string | null | undefined): string {
  return (text || '').trim().toLowerCase()
}

function looksLikeLeaveControl(label: string | null): boolean {
  const value = normalize(label)
  return value.includes('leave call') ||
    value.includes('leave meeting') ||
    value.includes('hang up') ||
    value.includes('opuść') ||
    value.includes('opusc') ||
    value.includes('rozłącz') ||
    value.includes('rozlacz') ||
    value.includes('zakończ połączenie') ||
    value.includes('zakoncz polaczenie')
}

function hasLeaveControl(): boolean {
  const controls = document.querySelectorAll<HTMLElement>(
    'button[aria-label], div[role="button"][aria-label], button[data-tooltip], div[role="button"][data-tooltip]'
  )

  for (let index = 0; index < controls.length; index += 1) {
    const control = controls[index]
    const label = control.getAttribute('aria-label') ||
      control.getAttribute('data-tooltip') ||
      control.title ||
      control.textContent
    if (looksLikeLeaveControl(label)) return true
  }

  return false
}

function detectInMeeting(): boolean {
  return hasMeetingPath() && hasLeaveControl()
}

function sendMeetingState(inMeeting: boolean): void {
  if (lastSentInMeeting === inMeeting) return
  lastSentInMeeting = inMeeting
  chrome.runtime.sendMessage({
    type: 'MEET_MEETING_STATE',
    inMeeting,
    url: location.href,
    title: document.title
  }).catch((error) => {
    captureException(error, { operation: 'sendMeetingState' })
  })
}

function tick(): void {
  try {
    const detected = detectInMeeting()
    if (detected) {
      absentCount = 0
      sendMeetingState(true)
      return
    }

    if (lastSentInMeeting === true) {
      absentCount += 1
      if (absentCount >= ABSENT_CONFIRMATIONS) {
        sendMeetingState(false)
      }
      return
    }

    sendMeetingState(false)
  } catch (error) {
    captureException(error, { operation: 'tick' })
  }
}

tick()
setInterval(tick, POLL_MS)

const observer = new MutationObserver(() => tick())
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['aria-label', 'data-tooltip', 'role']
})
