import {
  CopyOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { Alert, Button, ConfigProvider, Flex, Tag, Typography, theme } from 'antd'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { captureException, initDiagnostics } from './diagnostics'
import { readDebugSnapshot, type DebugSnapshot } from './debugSnapshot'

initDiagnostics('debug')

const { Text, Title } = Typography

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function App(): React.ReactElement {
  const [snapshot, setSnapshot] = useState<DebugSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const snapshotJson = useMemo(
    () => snapshot ? JSON.stringify(snapshot, null, 2) : '',
    [snapshot]
  )

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSnapshot(await readDebugSnapshot())
    } catch (err) {
      console.error('[debug] snapshot error', err)
      captureException(err, { operation: 'readDebugSnapshot.debugPage' })
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const copyJson = useCallback(async () => {
    if (!snapshotJson) return
    try {
      await navigator.clipboard.writeText(snapshotJson)
    } catch (err) {
      console.error('[debug] copy snapshot error', err)
      captureException(err, { operation: 'copyDebugSnapshot.debugPage' })
      setError(`Could not copy debug snapshot: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [snapshotJson])

  useEffect(() => {
    void refresh()
  }, [refresh])

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
      <Flex vertical gap={16} style={{ minHeight: '100vh', padding: 24, background: '#f6f8fa' }}>
        <Flex align="center" justify="space-between" gap={12} wrap>
          <Flex vertical gap={2}>
            <Title level={3} style={{ margin: 0 }}>
              Meet2Note Debug
            </Title>
            <Text type="secondary">
              Local extension storage and recording spool snapshot
            </Text>
          </Flex>
          <Flex gap={8}>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={refresh}>
              Refresh
            </Button>
            <Button disabled={!snapshotJson} icon={<CopyOutlined />} onClick={copyJson} type="primary">
              Copy JSON
            </Button>
          </Flex>
        </Flex>

        {error ? (
          <Alert message={error} showIcon type="error" />
        ) : null}

        {snapshot ? (
          <Flex vertical gap={12}>
            <Flex gap={8} wrap>
              <Tag color="blue">spool: {snapshot.summary.spoolRecordCount}</Tag>
              <Tag color="warning">blocking: {snapshot.summary.spoolBlockingCount}</Tag>
              <Tag color="processing">uploadable: {snapshot.summary.spoolUploadableCount}</Tag>
              <Tag>history: {snapshot.summary.historyCount}</Tag>
              <Tag>chunks: {snapshot.summary.totalChunks}</Tag>
              <Tag>bytes: {formatBytes(snapshot.summary.totalChunkBytes)}</Tag>
              <Tag>version: {snapshot.extension.version}</Tag>
            </Flex>
            <pre
              style={{
                background: '#111827',
                borderRadius: 4,
                color: '#f9fafb',
                fontSize: 12,
                lineHeight: 1.45,
                margin: 0,
                minHeight: 420,
                overflow: 'auto',
                padding: 16,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }}
            >
              {snapshotJson}
            </pre>
          </Flex>
        ) : (
          <Text type="secondary">
            {loading ? 'Loading debug snapshot...' : 'No debug snapshot loaded'}
          </Text>
        )}
      </Flex>
    </ConfigProvider>
  )
}

const rootElement = document.getElementById('root')
if (rootElement) {
  createRoot(rootElement).render(<App />)
}
