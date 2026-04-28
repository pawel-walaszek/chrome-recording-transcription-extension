let componentName = 'offscreen'

export function initDiagnostics(component: string): void {
  componentName = component
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  console.warn(`[${componentName}] captured exception`, error, context)
}

export function captureMessage(
  message: string,
  level: 'debug' | 'info' | 'warning' | 'error' = 'info',
  context?: Record<string, unknown>
): void {
  const log = level === 'error'
    ? console.error
    : level === 'warning'
      ? console.warn
      : level === 'debug'
        ? console.debug
        : console.info
  log(`[${componentName}] ${message}`, context)
}
