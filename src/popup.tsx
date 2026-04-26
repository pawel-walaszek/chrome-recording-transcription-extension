// src/popup.tsx

import {
  CheckCircleOutlined,
  CloudUploadOutlined,
  LoadingOutlined,
  SettingOutlined,
  VideoCameraOutlined
} from '@ant-design/icons'
import { Alert, Button, ConfigProvider, Divider, Flex, Space, Typography, theme } from 'antd'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { captureException, initDiagnostics } from './diagnostics'
import { getMicPreferences, MIC_DEVICE_ID_KEY, MIC_LABEL_KEY } from './micPreferences'

initDiagnostics('popup')

type UploadStatus = 'idle' | 'uploading' | 'upload_retrying' | 'uploaded'

interface RecordingStatus {
  recording: boolean
  starting: boolean
  stopping: boolean
  recordingStartedAt: number | null
}

interface UploadState {
  status: UploadStatus
  error: string | null
  nextRetryAt: number | null
}

const { Text } = Typography
const START_RECORDING_POPUP_DELAY_MS = 3_000

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  if (!hours) return `${mm}:${ss}`
  return `${hours}:${mm}:${ss}`
}

function isUploadStatus(value: unknown): value is UploadStatus {
  return value === 'idle' || value === 'uploading' || value === 'upload_retrying' || value === 'uploaded'
}

async function openMicSetupTab(): Promise<void> {
  await chrome.tabs.create({ url: chrome.runtime.getURL('micsetup.html') })
}

async function readMicStatus(): Promise<string> {
  const prefs = await getMicPreferences()
  return `Mic: ${prefs.preferredMicDeviceId ? (prefs.preferredMicLabel || 'Selected microphone') : 'Default microphone'}`
}

async function readMicButtonLabel(): Promise<{ label: string; title: string }> {
  if (!('permissions' in navigator)) {
    return {
      label: 'Microphone Settings',
      title: 'Choose which microphone should be included in recordings'
    }
  }

  try {
    const status = await (navigator as any).permissions.query({ name: 'microphone' })
    if (status.state === 'granted') {
      return {
        label: 'Microphone Settings',
        title: 'Choose which microphone should be included in recordings'
      }
    }
    if (status.state === 'denied') {
      return {
        label: 'Microphone Settings',
        title: 'Open microphone settings to review blocked access'
      }
    }
  } catch {
    return {
      label: 'Microphone Settings',
      title: 'Choose which microphone should be included in recordings'
    }
  }

  return {
    label: 'Enable Microphone',
    title: 'Grant microphone permission so your voice is included in recordings'
  }
}

function getRecordingText(recordingState: RecordingStatus, uploadState: UploadState, now: number): string {
  if (uploadState.status === 'uploaded') return 'Uploaded'
  if (uploadState.status === 'uploading') return 'Uploading...'
  if (uploadState.status === 'upload_retrying') {
    const waitMs = typeof uploadState.nextRetryAt === 'number'
      ? Math.max(0, uploadState.nextRetryAt - now)
      : 0
    const waitSeconds = Math.ceil(waitMs / 1000)
    return uploadState.error
      ? `Upload failed. Retrying in ${waitSeconds}s.`
      : `Retrying upload in ${waitSeconds}s.`
  }
  if (recordingState.starting) return 'Starting recording...'
  if (recordingState.stopping) return 'Stopping recording...'
  if (recordingState.recording) {
    const startedAt = recordingState.recordingStartedAt ?? now
    return `Recording: ${formatDuration(now - startedAt)}`
  }
  return 'Not recording'
}

function getRecordingButtonText(recordingState: RecordingStatus, uploadState: UploadState): string {
  if (uploadState.status === 'uploading') return 'Uploading...'
  if (uploadState.status === 'upload_retrying') return 'Retrying Upload...'
  if (recordingState.starting) return 'Starting...'
  if (recordingState.stopping) return 'Stopping...'
  return recordingState.recording ? 'Stop & Upload' : 'Start Recording'
}

function App(): React.ReactElement {
  const [recordingState, setRecordingState] = useState<RecordingStatus>({
    recording: false,
    starting: false,
    stopping: false,
    recordingStartedAt: null
  })
  const [uploadState, setUploadState] = useState<UploadState>({
    status: 'idle',
    error: null,
    nextRetryAt: null
  })
  const [micStatus, setMicStatus] = useState('')
  const [micButton, setMicButton] = useState({
    label: 'Microphone Settings',
    title: 'Choose which microphone should be included in recordings'
  })
  const [now, setNow] = useState(Date.now())
  const [inFlight, setInFlight] = useState(false)
  const inFlightRef = useRef(false)

  useEffect(() => {
    if (!recordingState.recording && uploadState.status !== 'upload_retrying') return undefined

    setNow(Date.now())
    const timerId = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timerId)
  }, [recordingState.recording, uploadState.status])

  const refreshMic = useCallback(async () => {
    const [button, status] = await Promise.all([
      readMicButtonLabel(),
      readMicStatus().catch(() => '')
    ])
    setMicButton(button)
    setMicStatus(status)
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const status = await chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATUS' })
        const startedAt = status?.recordingStartedAt ?? status?.startRequestedAt ?? null
        setRecordingState({
          recording: !!status?.recording,
          starting: !!status?.starting,
          stopping: !!status?.stopping,
          recordingStartedAt: typeof startedAt === 'number' ? startedAt : null
        })
        setUploadState({
          status: isUploadStatus(status?.uploadStatus) ? status.uploadStatus : 'idle',
          error: typeof status?.uploadError === 'string' ? status.uploadError : null,
          nextRetryAt: typeof status?.uploadNextRetryAt === 'number' ? status.uploadNextRetryAt : null
        })
      } catch {
        setRecordingState({
          recording: false,
          starting: false,
          stopping: false,
          recordingStartedAt: null
        })
      }
      await refreshMic().catch(() => {})
    })()
  }, [refreshMic])

  useEffect(() => {
    if (!('permissions' in navigator)) return undefined

    let mounted = true
    let permissionStatus: PermissionStatus | null = null
    const refreshOnPermissionChange = () => {
      refreshMic().catch(() => {})
    }

    void (async () => {
      try {
        const status = await (navigator as any).permissions.query({ name: 'microphone' }) as PermissionStatus
        if (!mounted) return
        permissionStatus = status
        status.onchange = refreshOnPermissionChange
      } catch {
        permissionStatus = null
      }
    })()

    return () => {
      mounted = false
      if (permissionStatus) permissionStatus.onchange = null
    }
  }, [refreshMic])

  useEffect(() => {
    const messageListener = (msg: any) => {
      if (msg?.type === 'RECORDING_STATE') {
        const startedAt = msg.recordingStartedAt ?? msg.startRequestedAt ?? null
        setRecordingState({
          recording: !!msg.recording,
          starting: !!msg.starting,
          stopping: !!msg.stopping,
          recordingStartedAt: typeof startedAt === 'number' ? startedAt : null
        })
      }

      if (msg?.type === 'UPLOAD_STATE' && isUploadStatus(msg.status)) {
        setUploadState({
          status: msg.status,
          error: typeof msg.error === 'string' ? msg.error : null,
          nextRetryAt: typeof msg.nextRetryAt === 'number' ? msg.nextRetryAt : null
        })
      }
    }

    const storageListener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: chrome.storage.AreaName
    ) => {
      if (areaName !== 'local') return
      if (changes[MIC_DEVICE_ID_KEY] || changes[MIC_LABEL_KEY]) {
        refreshMic().catch(() => {})
      }
    }

    chrome.runtime.onMessage.addListener(messageListener)
    chrome.storage.onChanged.addListener(storageListener)
    return () => {
      chrome.runtime.onMessage.removeListener(messageListener)
      chrome.storage.onChanged.removeListener(storageListener)
    }
  }, [refreshMic])

  const recordingText = useMemo(
    () => getRecordingText(recordingState, uploadState, now),
    [recordingState, uploadState, now]
  )
  const recordingButtonText = getRecordingButtonText(recordingState, uploadState)
  const uploadBlocksAction = uploadState.status === 'uploading' || uploadState.status === 'upload_retrying'
  const actionDisabled = inFlight || recordingState.starting || recordingState.stopping || uploadBlocksAction

  const openSettings = useCallback(async () => {
    try {
      await openMicSetupTab()
    } catch (error) {
      console.error('[popup] mic settings flow error', error)
      captureException(error, { operation: 'openMicSetupTab' })
      alert('Could not open the microphone setup page. Please try again.')
    }
  }, [])

  const startRecording = useCallback(async () => {
    inFlightRef.current = true
    setInFlight(true)
    setRecordingState({
      recording: false,
      starting: true,
      stopping: false,
      recordingStartedAt: null
    })

    try {
      if ('permissions' in navigator) {
        try {
          const status = await (navigator as any).permissions.query({ name: 'microphone' })
          if (status.state !== 'granted') {
            try {
              const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
              stream.getTracks().forEach(track => track.stop())
            } catch {
              // Continue with tab audio only.
            }
          }
        } catch {
          // Ignore unavailable permission state.
        }
      }

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) throw new Error('No active tab')

      const response = await chrome.runtime.sendMessage({ type: 'START_RECORDING', tabId: tab.id })
      if (!response) throw new Error('No response from background')
      if (response.starting) {
        setRecordingState({
          recording: false,
          starting: true,
          stopping: false,
          recordingStartedAt: null
        })
        return
      }
      if (response.stopping) {
        setRecordingState(previous => ({
          ...previous,
          stopping: true,
          starting: false
        }))
        return
      }
      if (response.ok === false) throw new Error(response.error || 'Failed to start')

      const startedAt = response.recordingStartedAt ?? Date.now()
      setRecordingState({
        recording: true,
        starting: false,
        stopping: false,
        recordingStartedAt: typeof startedAt === 'number' ? startedAt : Date.now()
      })
      console.log('[popup] Recording started')
      if (response.warning === 'NO_MIC_AUDIO') {
        alert('Recording started, but microphone audio is unavailable. The file will contain tab audio only.')
      }
      window.setTimeout(() => window.close(), START_RECORDING_POPUP_DELAY_MS)
    } catch (error: any) {
      console.error('[popup] START_RECORDING error', error)
      captureException(error, { operation: 'START_RECORDING' })
      setRecordingState({
        recording: false,
        starting: false,
        stopping: false,
        recordingStartedAt: null
      })
      alert(`Failed to start recording:\n${error?.message || error}`)
    } finally {
      inFlightRef.current = false
      setInFlight(false)
    }
  }, [])

  const stopRecording = useCallback(async () => {
    inFlightRef.current = true
    setInFlight(true)
    setRecordingState(previous => ({
      ...previous,
      recording: true,
      starting: false,
      stopping: true
    }))

    try {
      const response = await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' })
      if (!response) throw new Error('No response from background')
      if (response.ok === false) throw new Error(response.error || 'Failed to stop')
      setRecordingState({
        recording: false,
        starting: false,
        stopping: false,
        recordingStartedAt: null
      })
      console.log('[popup] Stopping... uploading...')
    } catch (error: any) {
      console.error('[popup] STOP_RECORDING error', error)
      captureException(error, { operation: 'STOP_RECORDING' })
      alert(`Failed to stop recording:\n${error?.message || error}`)
      setRecordingState({
        recording: false,
        starting: false,
        stopping: false,
        recordingStartedAt: null
      })
    } finally {
      inFlightRef.current = false
      setInFlight(false)
    }
  }, [])

  const toggleRecording = useCallback(async () => {
    if (inFlightRef.current) return
    if (recordingState.recording) {
      await stopRecording()
    } else {
      await startRecording()
    }
  }, [recordingState.recording, startRecording, stopRecording])

  const actionIcon = uploadBlocksAction || recordingState.starting || recordingState.stopping || inFlight
    ? <LoadingOutlined />
    : recordingState.recording
      ? <CloudUploadOutlined />
      : <VideoCameraOutlined />

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          borderRadius: 4,
          fontSize: 13
        }
      }}
    >
      <Flex vertical gap={8} style={{ width: 232, padding: 10 }}>
        <Button
          block
          icon={<SettingOutlined />}
          onClick={openSettings}
          title={micButton.title}
        >
          {micButton.label}
        </Button>
        <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.25 }}>
          {micStatus || 'Mic: Default microphone'}
        </Text>
        <Divider style={{ margin: '4px 0' }} />
        <Button
          block
          disabled={actionDisabled}
          icon={actionIcon}
          onClick={toggleRecording}
          type={recordingState.recording ? 'default' : 'primary'}
        >
          {recordingButtonText}
        </Button>
        <Space size={6} align="start">
          {uploadState.status === 'uploaded' ? <CheckCircleOutlined style={{ color: '#389e0d' }} /> : null}
          <Text style={{ fontSize: 12, lineHeight: 1.25 }}>{recordingText}</Text>
        </Space>
        {uploadState.status === 'upload_retrying' && uploadState.error ? (
          <Alert
            type="warning"
            showIcon={false}
            message={uploadState.error}
            style={{ fontSize: 12, padding: '4px 8px' }}
          />
        ) : null}
      </Flex>
    </ConfigProvider>
  )
}

const rootElement = document.getElementById('root')
if (rootElement) {
  createRoot(rootElement).render(<App />)
}
