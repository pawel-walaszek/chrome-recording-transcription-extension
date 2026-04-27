import * as Sentry from '@sentry/browser'

declare const __SENTRY_DSN__: string
declare const __SENTRY_ENVIRONMENT__: string
declare const __EXTENSION_VERSION__: string

let initialized = false
let componentName = 'unknown'

function getExtensionVersion(): string {
  return __EXTENSION_VERSION__ || 'unknown'
}

function hasSentryDsn(): boolean {
  return typeof __SENTRY_DSN__ === 'string' && __SENTRY_DSN__.trim().length > 0
}

export function initDiagnostics(component: string): void {
  componentName = component
  if (initialized || !hasSentryDsn()) return

  initialized = true
  try {
    // MV3 contexts (service worker, offscreen, popup, callback page) are not a
    // normal browser app. Keep Sentry in manual mode to avoid extension-specific
    // warnings and unstable default integrations touching unsupported globals.
    Sentry.init({
      dsn: __SENTRY_DSN__,
      environment: __SENTRY_ENVIRONMENT__ || 'chrome-extension-dev',
      release: `google-meet-recorder@${getExtensionVersion()}`,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      skipBrowserExtensionCheck: true,
      defaultIntegrations: false,
      maxBreadcrumbs: 20,
      beforeBreadcrumb(breadcrumb) {
        if (breadcrumb.category === 'console') return null
        return breadcrumb
      },
      beforeSend(event) {
        event.request = undefined
        event.server_name = undefined
        event.user = undefined
        event.tags = {
          ...event.tags,
          extension_component: componentName,
          extension_id: chrome.runtime.id
        }
        return event
      }
    })
    Sentry.setTag('extension_component', componentName)
    Sentry.setContext('extension', {
      id: chrome.runtime.id,
      version: getExtensionVersion()
    })
  } catch (error) {
    console.error('[diagnostics] Sentry init failed', error)
  }
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return
  try {
    Sentry.withScope((scope) => {
      scope.setTag('extension_component', componentName)
      if (context) scope.setContext('context', context)
      Sentry.captureException(error)
    })
  } catch (captureError) {
    console.error('[diagnostics] Sentry captureException failed', captureError)
  }
}

export function captureMessage(
  message: string,
  level: 'debug' | 'info' | 'warning' | 'error' = 'info',
  context?: Record<string, unknown>
): void {
  if (!initialized) return
  try {
    Sentry.withScope((scope) => {
      scope.setTag('extension_component', componentName)
      if (context) scope.setContext('context', context)
      Sentry.captureMessage(message, level)
    })
  } catch (captureError) {
    console.error('[diagnostics] Sentry captureMessage failed', captureError)
  }
}
