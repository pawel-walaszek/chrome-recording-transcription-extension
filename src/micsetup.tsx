// src/micsetup.tsx

import { ReloadOutlined, SaveOutlined } from '@ant-design/icons'
import { Alert, Button, ConfigProvider, Flex, Select, Space, Typography, theme } from 'antd'
import React, { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { captureException, initDiagnostics } from './diagnostics'
import { clearMicPreferences, getMicPreferences, setMicPreferences } from './micPreferences'

initDiagnostics('micsetup')

const DEFAULT_MIC_VALUE = '__default__'
const PSEUDO_DEVICE_IDS = new Set(['default', 'communications'])

interface MicOption {
  label: string
  value: string
}

const { Text, Title } = Typography

function describeError(error: unknown): string {
  if (error instanceof DOMException) return `${error.name}: ${error.message}`
  if (error instanceof Error) return error.message
  return String(error)
}

function App(): React.ReactElement {
  const [options, setOptions] = useState<MicOption[]>([
    { label: 'Default microphone', value: DEFAULT_MIC_VALUE }
  ])
  const [selectedMic, setSelectedMic] = useState(DEFAULT_MIC_VALUE)
  const [status, setStatus] = useState('Choose a microphone and save.')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const requestPermission = useCallback(async (): Promise<boolean> => {
    setStatus('Requesting microphone permission...')
    setErrorMessage(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach(track => track.stop())
      return true
    } catch (error) {
      console.error('[micsetup] getUserMedia error:', error)
      captureException(error, { operation: 'requestPermission' })
      const message = `Microphone blocked: ${describeError(error)}. Check Chrome and OS settings.`
      setErrorMessage(message)
      setStatus(message)
      return false
    }
  }, [])

  const renderDevices = useCallback(async () => {
    const prefs = await getMicPreferences()
    const devices = await navigator.mediaDevices.enumerateDevices()
    const audioInputs = devices.filter(device =>
      device.kind === 'audioinput' && !PSEUDO_DEVICE_IDS.has(device.deviceId)
    )
    const nextOptions: MicOption[] = [
      { label: 'Default microphone', value: DEFAULT_MIC_VALUE },
      ...audioInputs.map((device, index) => ({
        label: device.label || `Microphone ${index + 1}`,
        value: device.deviceId
      }))
    ]

    setOptions(nextOptions)

    if (prefs.preferredMicDeviceId && audioInputs.some(device => device.deviceId === prefs.preferredMicDeviceId)) {
      setSelectedMic(prefs.preferredMicDeviceId)
    } else {
      setSelectedMic(DEFAULT_MIC_VALUE)
      if (prefs.preferredMicDeviceId) {
        await clearMicPreferences()
      }
    }

    setErrorMessage(null)
    setStatus(audioInputs.length
      ? 'Choose a microphone and save.'
      : 'No microphone devices found. Default microphone will be used when available.')
  }, [])

  const loadDevices = useCallback(async () => {
    setLoading(true)
    try {
      const allowed = await requestPermission()
      if (!allowed) return
      await renderDevices()
    } catch (error) {
      console.error('[micsetup] enumerateDevices error:', error)
      captureException(error, { operation: 'loadDevices' })
      const message = `Could not list microphones: ${describeError(error)}`
      setErrorMessage(message)
      setStatus(message)
    } finally {
      setLoading(false)
    }
  }, [renderDevices, requestPermission])

  useEffect(() => {
    loadDevices().catch((error) => {
      console.error('[micsetup] initial load error:', error)
      captureException(error, { operation: 'initialLoad' })
      const message = `Could not load microphones: ${describeError(error)}`
      setErrorMessage(message)
      setStatus(message)
    })
  }, [loadDevices])

  useEffect(() => {
    const refreshOnDeviceChange = () => {
      renderDevices().catch((error) => {
        console.error('[micsetup] devicechange refresh error:', error)
        captureException(error, { operation: 'devicechangeRefresh' })
        const message = `Could not refresh microphones: ${describeError(error)}`
        setErrorMessage(message)
        setStatus(message)
      })
    }

    navigator.mediaDevices.addEventListener?.('devicechange', refreshOnDeviceChange)
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', refreshOnDeviceChange)
  }, [renderDevices])

  const saveMicrophone = useCallback(async () => {
    setSaving(true)
    setErrorMessage(null)
    try {
      if (selectedMic === DEFAULT_MIC_VALUE) {
        await clearMicPreferences()
        setStatus('Saved: Default microphone.')
        return
      }

      const selectedOption = options.find(option => option.value === selectedMic)
      await setMicPreferences({
        preferredMicDeviceId: selectedMic,
        preferredMicLabel: selectedOption?.label || 'Selected microphone'
      })
      setStatus(`Saved: ${selectedOption?.label || 'Selected microphone'}.`)
    } catch (error) {
      console.error('[micsetup] save error:', error)
      captureException(error, { operation: 'saveMicrophone' })
      const message = `Could not save microphone: ${describeError(error)}`
      setErrorMessage(message)
      setStatus(message)
    } finally {
      setSaving(false)
    }
  }, [options, selectedMic])

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          borderRadius: 4,
          fontSize: 14
        }
      }}
    >
      <Flex vertical gap={16} style={{ maxWidth: 520, padding: 24 }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>Microphone Settings</Title>
          <Text type="secondary">Choose which microphone should be recorded.</Text>
        </div>
        {errorMessage ? (
          <Alert type="error" showIcon message={errorMessage} />
        ) : null}
        <Space>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => loadDevices()}>
            Enable / Refresh Microphones
          </Button>
        </Space>
        <Flex vertical gap={6}>
          <Text strong>Microphone</Text>
          <Select
            disabled={loading}
            options={options}
            value={selectedMic}
            onChange={setSelectedMic}
            style={{ maxWidth: 360 }}
          />
        </Flex>
        <Space>
          <Button
            icon={<SaveOutlined />}
            loading={saving}
            onClick={saveMicrophone}
            type="primary"
          >
            Save Microphone
          </Button>
        </Space>
        <Text>{status}</Text>
      </Flex>
    </ConfigProvider>
  )
}

const rootElement = document.getElementById('root')
if (rootElement) {
  createRoot(rootElement).render(<App />)
}
