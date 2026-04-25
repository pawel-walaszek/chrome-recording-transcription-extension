export const MIC_DEVICE_ID_KEY = 'preferredMicDeviceId'
export const MIC_LABEL_KEY = 'preferredMicLabel'
export const MIC_PREFERENCE_KEYS = [MIC_DEVICE_ID_KEY, MIC_LABEL_KEY]

export interface MicPreferences {
  preferredMicDeviceId: string | null
  preferredMicLabel: string | null
}

export function getChromeRuntimeError(operation: string): Error | null {
  const runtimeError = chrome.runtime.lastError
  if (!runtimeError) return null
  return new Error(`chrome.storage.local.${operation} failed: ${runtimeError.message}`)
}

export function getMicPreferences(): Promise<MicPreferences> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(MIC_PREFERENCE_KEYS, (items) => {
      const error = getChromeRuntimeError('get')
      if (error) {
        reject(error)
        return
      }

      resolve({
        preferredMicDeviceId: items[MIC_DEVICE_ID_KEY] ?? null,
        preferredMicLabel: items[MIC_LABEL_KEY] ?? null
      })
    })
  })
}

export function setMicPreferences(preferences: MicPreferences): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({
      [MIC_DEVICE_ID_KEY]: preferences.preferredMicDeviceId,
      [MIC_LABEL_KEY]: preferences.preferredMicLabel
    }, () => {
      const error = getChromeRuntimeError('set')
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

export function clearMicPreferences(): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(MIC_PREFERENCE_KEYS, () => {
      const error = getChromeRuntimeError('remove')
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}
