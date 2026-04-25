// src/micsetup.ts

import { captureException, initDiagnostics } from './diagnostics'
import { clearMicPreferences, getMicPreferences, setMicPreferences } from './micPreferences'

initDiagnostics('micsetup')

const DEFAULT_MIC_VALUE = '__default__'

function describeError(error: unknown): string {
  if (error instanceof DOMException) return `${error.name}: ${error.message}`
  if (error instanceof Error) return error.message
  return String(error)
}

document.addEventListener('DOMContentLoaded', () => {
  const refreshBtn = document.getElementById('enable') as HTMLButtonElement | null
  const saveBtn = document.getElementById('save-mic') as HTMLButtonElement | null
  const selectEl = document.getElementById('mic-select') as HTMLSelectElement | null
  const statusEl = document.getElementById('status') as HTMLParagraphElement | null

  if (!refreshBtn || !saveBtn || !selectEl || !statusEl) return

  const setStatus = (message: string) => { statusEl.textContent = message }

  const requestPermission = async (): Promise<boolean> => {
    setStatus('Requesting microphone permission...')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach(track => track.stop())
      return true
    } catch (error) {
      console.error('[micsetup] getUserMedia error:', error)
      captureException(error, { operation: 'requestPermission' })
      setStatus(`Microphone blocked: ${describeError(error)}. Check Chrome and OS settings.`)
      return false
    }
  }

  const renderDevices = async () => {
    selectEl.disabled = true
    saveBtn.disabled = true
    selectEl.replaceChildren()

    const prefs = await getMicPreferences()
    const devices = await navigator.mediaDevices.enumerateDevices()
    const audioInputs = devices.filter(device => device.kind === 'audioinput')

    const defaultOption = new Option('Default microphone', DEFAULT_MIC_VALUE)
    selectEl.append(defaultOption)

    audioInputs.forEach((device, index) => {
      const label = device.label || `Microphone ${index + 1}`
      selectEl.append(new Option(label, device.deviceId))
    })

    if (prefs.preferredMicDeviceId && audioInputs.some(device => device.deviceId === prefs.preferredMicDeviceId)) {
      selectEl.value = prefs.preferredMicDeviceId
    } else {
      selectEl.value = DEFAULT_MIC_VALUE
      if (prefs.preferredMicDeviceId) {
        await clearMicPreferences()
      }
    }

    selectEl.disabled = false
    saveBtn.disabled = false
    setStatus(audioInputs.length
      ? 'Choose a microphone and save.'
      : 'No microphone devices found. Default microphone will be used when available.')
  }

  const loadDevices = async () => {
    const allowed = await requestPermission()
    if (!allowed) return

    try {
      await renderDevices()
    } catch (error) {
      console.error('[micsetup] enumerateDevices error:', error)
      captureException(error, { operation: 'loadDevices' })
      setStatus(`Could not list microphones: ${describeError(error)}`)
    }
  }

  refreshBtn.addEventListener('click', () => {
    loadDevices().catch((error) => {
      console.error('[micsetup] refresh error:', error)
      captureException(error, { operation: 'refreshDevices' })
      setStatus(`Could not refresh microphones: ${describeError(error)}`)
    })
  })

  saveBtn.addEventListener('click', async () => {
    try {
      const selectedValue = selectEl.value
      if (selectedValue === DEFAULT_MIC_VALUE) {
        await clearMicPreferences()
        setStatus('Saved: Default microphone.')
        return
      }

      const selectedOption = selectEl.selectedOptions[0]
      await setMicPreferences({
        preferredMicDeviceId: selectedValue,
        preferredMicLabel: selectedOption?.textContent || 'Selected microphone'
      })
      setStatus(`Saved: ${selectedOption?.textContent || 'Selected microphone'}.`)
    } catch (error) {
      console.error('[micsetup] save error:', error)
      captureException(error, { operation: 'saveMicrophone' })
      setStatus(`Could not save microphone: ${describeError(error)}`)
    }
  })

  loadDevices().catch((error) => {
    console.error('[micsetup] initial load error:', error)
    captureException(error, { operation: 'initialLoad' })
    setStatus(`Could not load microphones: ${describeError(error)}`)
  })
})
