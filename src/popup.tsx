// src/popup.tsx

import {
  CheckOutlined,
  CloudUploadOutlined,
  LinkOutlined,
  LoadingOutlined,
  LogoutOutlined,
  SettingOutlined,
  VideoCameraOutlined
} from '@ant-design/icons'
import { Alert, Button, ConfigProvider, Divider, Flex, Tag, Typography, theme } from 'antd'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { captureException, initDiagnostics } from './diagnostics'
import {
  disconnectMeet2Note,
  getMeet2NoteConnection,
  MEET2NOTE_AUTH_ERROR_KEY,
  MEET2NOTE_CONNECTED_AT_KEY,
  MEET2NOTE_CONNECTED_USER_KEY,
  MEET2NOTE_EXTENSION_TOKEN_KEY,
  startMeet2NoteConnectFlow,
  type Meet2NoteConnection
} from './extensionAuth'
import { getMicPreferences, MIC_DEVICE_ID_KEY, MIC_LABEL_KEY } from './micPreferences'
import {
  isLocalOnlyFailureWithoutRecording,
  normalizeRecordingHistory,
  POPUP_RECORDING_HISTORY_LIMIT,
  type RecordingHistoryItem,
  type RecordingUploadStatus
} from './recordingHistory'

initDiagnostics('popup')

interface RecordingStatus {
  recording: boolean
  starting: boolean
  stopping: boolean
  recordingStartedAt: number | null
}

const { Text } = Typography
const START_RECORDING_POPUP_DELAY_MS = 3_000
const MEET2NOTE_BRAND_ICON_URL = chrome.runtime.getURL('icons/meet2note-favicon.svg')
const POPUP_WIDTH = 252
const HEADER_ACTION_ICON_STYLE: React.CSSProperties = {
  fontSize: 16,
  lineHeight: 1
}
const POPUP_UI_CACHE_KEY = 'meet2notePopupUiCache'

interface PopupUiCache {
  connection: Meet2NoteConnection | null
  recentRecordings: RecordingHistoryItem[]
}

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

function getRecordingButtonText(recordingState: RecordingStatus): string {
  if (recordingState.starting) return 'Starting...'
  if (recordingState.stopping) return 'Stopping...'
  return recordingState.recording ? 'Stop & Upload' : 'Start Recording'
}

function sanitizeRecordingHistory(value: unknown, nowMs = Date.now()): RecordingHistoryItem[] {
  return normalizeRecordingHistory(value, nowMs).slice(0, POPUP_RECORDING_HISTORY_LIMIT)
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function getHistoryStatusText(item: RecordingHistoryItem, now: number): string {
  if (item.status === 'recording') return 'Recording - saved locally'
  if (item.status === 'finalizing') return 'Saving local recording'
  if (item.status === 'upload_queued') {
    if (item.nextRetryAt && item.nextRetryAt > now) {
      return `Retrying in ${Math.ceil((item.nextRetryAt - now) / 1000)}s`
    }
    return 'Waiting to upload'
  }
  if (item.status === 'uploading') return item.attempt > 1 ? `Uploading, attempt ${item.attempt}` : 'Uploading...'
  if (item.status === 'processing_queued') return 'Waiting for processing'
  if (item.status === 'processing') return 'Processing in Meet2Note'
  if (item.status === 'ready') return 'Ready in Meet2Note'
  if (item.status === 'canceled') return 'Canceled'
  if (item.status === 'expired') return 'Expired in Meet2Note'
  if (item.failureReason === 'auth_required') return 'Reconnect to upload'
  if (item.failureReason === 'local_error') return item.error || 'Local save failed'
  if (item.failureReason === 'unrecoverable') return item.error || 'Recording could not be recovered'
  return item.error || 'Upload failed'
}

function getHistoryTagColor(status: RecordingUploadStatus): string {
  if (status === 'ready') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'upload_queued' || status === 'processing_queued') return 'warning'
  if (status === 'finalizing' || status === 'uploading' || status === 'processing') return 'processing'
  return 'default'
}

function readPopupUiCache(): PopupUiCache {
  try {
    const raw = window.localStorage.getItem(POPUP_UI_CACHE_KEY)
    if (!raw) return { connection: null, recentRecordings: [] }
    const parsed = JSON.parse(raw) as Partial<PopupUiCache>
    return {
      connection: parsed.connection && typeof parsed.connection === 'object'
        ? {
            connected: !!parsed.connection.connected,
            user: parsed.connection.user || null,
            connectedAt: typeof parsed.connection.connectedAt === 'string' ? parsed.connection.connectedAt : null,
            authError: typeof parsed.connection.authError === 'string' ? parsed.connection.authError : null
          }
        : null,
      recentRecordings: sanitizeRecordingHistory(parsed.recentRecordings)
    }
  } catch {
    return { connection: null, recentRecordings: [] }
  }
}

function writePopupUiCache(cache: PopupUiCache): void {
  try {
    window.localStorage.setItem(POPUP_UI_CACHE_KEY, JSON.stringify(cache))
  } catch {}
}

function PopupHeader({
  actionTitle,
  icon,
  onAction
}: {
  actionTitle: string
  icon: React.ReactNode
  onAction: () => void
}): React.ReactElement {
  return (
    <Flex align="center" justify="space-between" gap={10}>
      <Flex align="center" gap={10}>
        <img
          alt="Meet2Note"
          src={MEET2NOTE_BRAND_ICON_URL}
          style={{ width: 28, height: 28, display: 'block', borderRadius: 8 }}
        />
        <Flex vertical gap={0}>
          <Text strong style={{ fontSize: 14, lineHeight: 1.1 }}>
            Meet2Note
          </Text>
          <Text type="secondary" style={{ fontSize: 11, lineHeight: 1.2 }}>
            Just meet. We note.
          </Text>
        </Flex>
      </Flex>
      <Button
        aria-label={actionTitle}
        icon={icon}
        onClick={onAction}
        title={actionTitle}
        type="text"
      />
    </Flex>
  )
}

function App(): React.ReactElement {
  const initialCache = useMemo(readPopupUiCache, [])
  const [recordingState, setRecordingState] = useState<RecordingStatus>({
    recording: false,
    starting: false,
    stopping: false,
    recordingStartedAt: null
  })
  const [recentRecordings, setRecentRecordings] = useState<RecordingHistoryItem[]>(initialCache.recentRecordings)
  const [micStatus, setMicStatus] = useState('')
  const [micButton, setMicButton] = useState({
    label: 'Microphone Settings',
    title: 'Choose which microphone should be included in recordings'
  })
  const [meet2NoteConnection, setMeet2NoteConnection] = useState<Meet2NoteConnection | null>(initialCache.connection)
  const [now, setNow] = useState(Date.now())
  const [inFlight, setInFlight] = useState(false)
  const [connectingMeet2Note, setConnectingMeet2Note] = useState(false)
  const [disconnectingMeet2Note, setDisconnectingMeet2Note] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const inFlightRef = useRef(false)

  useEffect(() => {
    const hasPendingRetry = recentRecordings.some(item => item.status === 'upload_queued' && item.nextRetryAt && item.nextRetryAt > Date.now())
    const hasTimedLocalFailure = recentRecordings.some(isLocalOnlyFailureWithoutRecording)
    if (!recordingState.recording && !hasPendingRetry && !hasTimedLocalFailure) return undefined

    setNow(Date.now())
    const timerId = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timerId)
  }, [recordingState.recording, recentRecordings])

  const refreshMic = useCallback(async () => {
    const [button, status] = await Promise.all([
      readMicButtonLabel(),
      readMicStatus().catch(() => '')
    ])
    setMicButton(button)
    setMicStatus(status)
  }, [])

  const refreshMeet2NoteConnection = useCallback(async () => {
    const connection = await getMeet2NoteConnection()
    setMeet2NoteConnection(connection)
  }, [])

  useEffect(() => {
    writePopupUiCache({
      connection: meet2NoteConnection,
      recentRecordings
    })
  }, [meet2NoteConnection, recentRecordings])

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
        setRecentRecordings(sanitizeRecordingHistory(status?.recentRecordings))
      } catch {
        setRecordingState({
          recording: false,
          starting: false,
          stopping: false,
          recordingStartedAt: null
        })
      }
      await Promise.all([
        refreshMic().catch(() => {}),
        refreshMeet2NoteConnection().catch(() => {})
      ])
    })()
  }, [refreshMic, refreshMeet2NoteConnection])

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

      if (msg?.type === 'UPLOAD_QUEUE_STATE') {
        setRecentRecordings(sanitizeRecordingHistory(msg.items))
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
      if (
        changes[MEET2NOTE_EXTENSION_TOKEN_KEY] ||
        changes[MEET2NOTE_CONNECTED_USER_KEY] ||
        changes[MEET2NOTE_CONNECTED_AT_KEY] ||
        changes[MEET2NOTE_AUTH_ERROR_KEY]
      ) {
        refreshMeet2NoteConnection().catch(() => {})
      }
    }

    chrome.runtime.onMessage.addListener(messageListener)
    chrome.storage.onChanged.addListener(storageListener)
    return () => {
      chrome.runtime.onMessage.removeListener(messageListener)
      chrome.storage.onChanged.removeListener(storageListener)
    }
  }, [refreshMic, refreshMeet2NoteConnection])

  const visibleRecentRecordings = useMemo(
    () => sanitizeRecordingHistory(recentRecordings, now),
    [recentRecordings, now]
  )
  const recordingButtonText = getRecordingButtonText(recordingState)
  const connectionLoaded = meet2NoteConnection !== null
  const recordingControlsAvailable = meet2NoteConnection?.connected === true
  const connectionActionDisabled = recordingState.recording ||
    recordingState.starting ||
    recordingState.stopping
  const actionDisabled = !recordingControlsAvailable ||
    inFlight ||
    recordingState.starting ||
    recordingState.stopping
  const authRequiredUpload = visibleRecentRecordings.find(item => item.status === 'failed' && item.failureReason === 'auth_required')
  const connectionErrorMessage = meet2NoteConnection?.authError ||
    authRequiredUpload?.error ||
    null
  const recentRecordingsEmptyText = 'No recordings from this browser yet'

  const openSettings = useCallback(async () => {
    try {
      await openMicSetupTab()
    } catch (error) {
      console.error('[popup] mic settings flow error', error)
      captureException(error, { operation: 'openMicSetupTab' })
      alert('Could not open the microphone setup page. Please try again.')
    }
  }, [])

  const connectMeet2Note = useCallback(async () => {
    setConnectingMeet2Note(true)
    try {
      await startMeet2NoteConnectFlow()
      window.close()
    } catch (error) {
      console.error('[popup] Meet2Note connect flow error', error)
      captureException(error, { operation: 'startMeet2NoteConnectFlow' })
      alert(`Could not open Meet2Note connection:\n${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setConnectingMeet2Note(false)
    }
  }, [])

  const disconnectMeet2NoteAccount = useCallback(async () => {
    setDisconnectingMeet2Note(true)
    try {
      await disconnectMeet2Note()
      await refreshMeet2NoteConnection()
    } catch (error) {
      console.error('[popup] Meet2Note disconnect flow error', error)
      captureException(error, { operation: 'disconnectMeet2Note' })
      alert(`Could not disconnect Meet2Note:\n${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setDisconnectingMeet2Note(false)
    }
  }, [refreshMeet2NoteConnection])

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
      if (response.stopping || response.alreadyStopping) {
        setRecordingState(previous => ({
          ...previous,
          recording: true,
          starting: false,
          stopping: true
        }))
      } else {
        setRecordingState({
          recording: false,
          starting: false,
          stopping: false,
          recordingStartedAt: null
        })
      }
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

  const actionIcon = recordingState.starting || recordingState.stopping || inFlight
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
      <Flex vertical gap={8} style={{ width: POPUP_WIDTH, padding: 10 }}>
        <PopupHeader
          actionTitle={settingsOpen ? 'Save and close settings' : 'Settings'}
          icon={settingsOpen
            ? <CheckOutlined style={HEADER_ACTION_ICON_STYLE} />
            : <SettingOutlined style={HEADER_ACTION_ICON_STYLE} />}
          onAction={() => setSettingsOpen(open => !open)}
        />
        <Divider style={{ margin: '2px 0 4px' }} />
        {settingsOpen ? (
          <>
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
            {!connectionLoaded ? (
              <Button block disabled icon={<LoadingOutlined />}>
                Loading settings...
              </Button>
            ) : meet2NoteConnection.connected ? (
              <Flex vertical gap={6}>
                <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.25 }}>
                  Connected: {meet2NoteConnection.user?.email || meet2NoteConnection.user?.displayName || 'Meet2Note'}
                </Text>
                <Button
                  block
                  danger
                  disabled={connectionActionDisabled}
                  icon={<LogoutOutlined />}
                  loading={disconnectingMeet2Note}
                  onClick={disconnectMeet2NoteAccount}
                  size="small"
                >
                  Disconnect
                </Button>
              </Flex>
            ) : (
              <Flex vertical gap={6}>
                <Button
                  block
                  disabled={disconnectingMeet2Note}
                  icon={<LinkOutlined />}
                  loading={connectingMeet2Note}
                  onClick={connectMeet2Note}
                  type="primary"
                >
                  Connect to Meet2Note
                </Button>
                <Text type={meet2NoteConnection.authError ? 'danger' : 'secondary'} style={{ fontSize: 12, lineHeight: 1.25 }}>
                  {meet2NoteConnection.authError ? 'Reconnect to Meet2Note' : 'Not connected'}
                </Text>
                {connectionErrorMessage ? (
                  <Alert
                    type="error"
                    showIcon={false}
                    message={connectionErrorMessage}
                    style={{ fontSize: 12, padding: '4px 8px' }}
                  />
                ) : null}
              </Flex>
            )}
          </>
        ) : (
          <>
            {!connectionLoaded ? (
              <Button block disabled icon={<LoadingOutlined />}>
                Loading...
              </Button>
            ) : recordingControlsAvailable ? (
              <Button
                block
                disabled={actionDisabled}
                icon={actionIcon}
                onClick={toggleRecording}
                type={recordingState.recording ? 'default' : 'primary'}
              >
                {recordingButtonText}
              </Button>
            ) : (
              <Button
                block
                disabled={disconnectingMeet2Note}
                icon={<LinkOutlined />}
                loading={connectingMeet2Note}
                onClick={connectMeet2Note}
                type="primary"
              >
                Connect to Meet2Note
              </Button>
            )}
            {connectionErrorMessage && !recordingControlsAvailable ? (
              <Alert
                type="error"
                showIcon={false}
                message={connectionErrorMessage}
                style={{ fontSize: 12, padding: '4px 8px' }}
              />
            ) : null}
            <Divider style={{ margin: '4px 0' }} />
            <Flex vertical gap={6}>
              <Text strong style={{ fontSize: 12, lineHeight: 1.2 }}>
                Recordings
              </Text>
              {visibleRecentRecordings.length ? (
                visibleRecentRecordings.map(item => (
                  <Flex
                    key={item.localId}
                    vertical
                    gap={3}
                    style={{ borderTop: '1px solid #f0f0f0', paddingTop: 5 }}
                  >
                    <Flex align="center" justify="space-between" gap={6}>
                      <Text
                        title={item.title}
                        style={{
                          fontSize: 12,
                          lineHeight: 1.2,
                          maxWidth: 150,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {item.title}
                      </Text>
                      <Tag
                        color={getHistoryTagColor(item.status)}
                        style={{ marginInlineEnd: 0, fontSize: 10, lineHeight: '16px' }}
                      >
                        {item.status}
                      </Tag>
                    </Flex>
                    <Text type="secondary" style={{ fontSize: 11, lineHeight: 1.2 }}>
                      {formatTime(item.startedAt)} · {formatDuration(item.durationMs)}
                    </Text>
                    <Text
                      type={item.status === 'failed' ? 'danger' : 'secondary'}
                      style={{ fontSize: 11, lineHeight: 1.2 }}
                    >
                      {getHistoryStatusText(item, now)}
                    </Text>
                  </Flex>
                ))
              ) : (
                <Text type="secondary" style={{ fontSize: 11, lineHeight: 1.2 }}>
                  {recentRecordingsEmptyText}
                </Text>
              )}
            </Flex>
          </>
        )}
      </Flex>
    </ConfigProvider>
  )
}

const rootElement = document.getElementById('root')
if (rootElement) {
  createRoot(rootElement).render(<App />)
}
