// src/popup.ts

import { captureException, initDiagnostics } from './diagnostics'
import { getMicPreferences, MIC_DEVICE_ID_KEY, MIC_LABEL_KEY } from './micPreferences'

initDiagnostics('popup')

const micBtn = document.getElementById('enable-mic') as HTMLButtonElement | null;
const micStatusEl = document.getElementById('mic-status') as HTMLDivElement | null;
const recordingToggleBtn = document.getElementById('recording-toggle') as HTMLButtonElement | null;
const recordingStatusEl = document.getElementById('recording-status') as HTMLDivElement | null;

let recordingTimerId: number | null = null;
let isRecording = false;
let isStarting = false;
let isStopping = false;
let currentRecordingStartedAt: number | null = null;
type UploadStatus = 'idle' | 'uploading' | 'upload_retrying' | 'uploaded';
let uploadStatus: UploadStatus = 'idle';
let uploadRetryTimerId: number | null = null;

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  if (!hours) return `${mm}:${ss}`;
  return `${hours}:${mm}:${ss}`;
}

function stopRecordingTimer(clearStatus = true) {
  if (recordingTimerId !== null) {
    window.clearInterval(recordingTimerId);
    recordingTimerId = null;
  }
  if (clearStatus && recordingStatusEl) recordingStatusEl.textContent = 'Not recording';
}

function stopUploadRetryTimer() {
  if (uploadRetryTimerId !== null) {
    window.clearInterval(uploadRetryTimerId);
    uploadRetryTimerId = null;
  }
}

function startRecordingTimer(startedAt?: number | null) {
  if (!recordingStatusEl) return;
  if (recordingTimerId !== null) window.clearInterval(recordingTimerId);
  const baseStartedAt = typeof startedAt === 'number'
    ? startedAt
    : currentRecordingStartedAt ?? Date.now();
  currentRecordingStartedAt = baseStartedAt;
  const render = () => {
    recordingStatusEl.textContent = `Recording: ${formatDuration(Date.now() - baseStartedAt)}`;
  };
  render();
  recordingTimerId = window.setInterval(render, 1000);
}

function setUI(
  recording: boolean,
  recordingStartedAt?: number | null,
  starting = isStarting,
  stopping = isStopping
) {
  isRecording = recording;
  isStarting = starting;
  isStopping = stopping;
  if (typeof recordingStartedAt === 'number') currentRecordingStartedAt = recordingStartedAt;
  if (!recording && !starting && !stopping) currentRecordingStartedAt = null;
  if (!recordingToggleBtn) return;
  if (uploadStatus === 'uploading' || uploadStatus === 'upload_retrying') {
    stopRecordingTimer(false);
    recordingToggleBtn.disabled = true;
    recordingToggleBtn.textContent = uploadStatus === 'uploading' ? 'Uploading...' : 'Retrying Upload...';
    return;
  }
  if (isStarting) {
    stopRecordingTimer(false);
    recordingToggleBtn.disabled = true;
    recordingToggleBtn.textContent = 'Starting...';
    if (recordingStatusEl) recordingStatusEl.textContent = 'Starting recording...';
    return;
  }
  if (isStopping) {
    stopRecordingTimer(false);
    recordingToggleBtn.disabled = true;
    recordingToggleBtn.textContent = 'Stopping...';
    if (recordingStatusEl) recordingStatusEl.textContent = 'Stopping recording...';
    return;
  }
  recordingToggleBtn.disabled = false;
  recordingToggleBtn.textContent = recording ? 'Stop & Upload' : 'Start Recording';
  if (recording) {
    startRecordingTimer(recordingStartedAt);
  } else {
    stopRecordingTimer();
  }
}

function setUploadUI(status: UploadStatus, error?: string | null, nextRetryAt?: number | null) {
  uploadStatus = status;
  stopUploadRetryTimer();

  if (status === 'idle') {
    if (!isRecording && recordingStatusEl) recordingStatusEl.textContent = 'Not recording';
    setUI(isRecording, currentRecordingStartedAt);
    return;
  }

  if (status === 'uploaded') {
    setUI(false, null, false, false);
    if (recordingStatusEl) recordingStatusEl.textContent = 'Uploaded';
    return;
  }

  const renderRetry = () => {
    if (!recordingStatusEl) return;
    if (status === 'uploading') {
      recordingStatusEl.textContent = 'Uploading...';
      return;
    }
    const waitMs = typeof nextRetryAt === 'number' ? Math.max(0, nextRetryAt - Date.now()) : 0;
    const waitSeconds = Math.ceil(waitMs / 1000);
    recordingStatusEl.textContent = error
      ? `Upload failed. Retrying in ${waitSeconds}s.`
      : `Retrying upload in ${waitSeconds}s.`;
  };

  renderRetry();
  if (status === 'upload_retrying') {
    uploadRetryTimerId = window.setInterval(renderRetry, 1000);
  }
  setUI(false, null, false, false);
}

function toast(msg: string) {
  console.log('[popup]', msg);
}

// Otwiera pełną kartę do nadania uprawnienia mikrofonu.
async function openMicSetupTab() {
  await chrome.tabs.create({ url: chrome.runtime.getURL('micsetup.html') });
}

async function refreshMicStatus() {
  if (!micStatusEl) return
  try {
    const prefs = await getMicPreferences()
    micStatusEl.textContent = `Mic: ${prefs.preferredMicDeviceId ? (prefs.preferredMicLabel || 'Selected microphone') : 'Default microphone'}`
  } catch {
    micStatusEl.textContent = ''
  }
}

// Odzwierciedla stan uprawnienia mikrofonu w etykiecie przycisku.
async function refreshMicButton() {
  if (!micBtn) return;
  micBtn.disabled = false;
  if (!('permissions' in navigator)) {
    micBtn.textContent = 'Microphone Settings';
    micBtn.title = 'Choose which microphone should be included in recordings';
    await refreshMicStatus();
    return;
  }
  try {
    // @ts-ignore - Chrome obsługuje tę nazwę uprawnienia.
    const status = await (navigator as any).permissions.query({ name: 'microphone' });
    const set = () => {
      micBtn.textContent =
        status.state === 'granted'
          ? 'Microphone Settings'
          : status.state === 'denied'
          ? 'Microphone Settings'
          : 'Enable Microphone';
      micBtn.disabled = false;
      micBtn.title =
        status.state === 'granted'
          ? 'Choose which microphone should be included in recordings'
          : status.state === 'denied'
          ? 'Open microphone settings to review blocked access'
          : 'Grant microphone permission so your voice is included in recordings';
    };
    set();
    status.onchange = () => {
      set();
      refreshMicStatus().catch(() => {});
    };
  } catch {
    // Permissions API może nie być dostępne.
    micBtn.textContent = 'Microphone Settings';
    micBtn.title = 'Choose which microphone should be included in recordings';
  }
  await refreshMicStatus();
}

// Inicjalizacja: odczyt bieżącego stanu nagrywania i aktualizacja UI.
void (async () => {
  try {
    const st = await chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATUS' });
    uploadStatus = st?.uploadStatus || 'idle';
    setUI(!!st?.recording, st?.recordingStartedAt ?? st?.startRequestedAt ?? null, !!st?.starting, !!st?.stopping);
    setUploadUI(uploadStatus, st?.uploadError ?? null, st?.uploadNextRetryAt ?? null);
  } catch {
    setUI(false, null, false, false);
  }
  refreshMicButton().catch(() => {});
})();

// Reakcja na komunikaty stanu z tła/offscreen.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'RECORDING_STATE') {
    setUI(!!msg.recording, msg.recordingStartedAt ?? msg.startRequestedAt ?? null, !!msg.starting, !!msg.stopping);
  }
  if (msg?.type === 'UPLOAD_STATE') {
    const status = msg.status as UploadStatus | undefined;
    if (status === 'idle' || status === 'uploading' || status === 'upload_retrying' || status === 'uploaded') {
      setUploadUI(status, typeof msg.error === 'string' ? msg.error : null, typeof msg.nextRetryAt === 'number' ? msg.nextRetryAt : null);
    }
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes[MIC_DEVICE_ID_KEY] || changes[MIC_LABEL_KEY]) {
    refreshMicStatus().catch(() => {});
  }
});

// Otwiera konfigurację mikrofonu.
micBtn?.addEventListener('click', async () => {
  try {
    await openMicSetupTab();
  } catch (e) {
    console.error('[popup] mic enable flow error', e);
    captureException(e, { operation: 'openMicSetupTab' });
    alert('Could not open the microphone setup page. Please try again.');
  }
});

let inFlight = false;

async function startRecording() {
  if (!recordingToggleBtn) return;
  inFlight = true;
  setUI(false, null, true, false);

  try {
    // Automatyczne przygotowanie mikrofonu, jeśli nie ma jeszcze uprawnienia.
    if ('permissions' in navigator) {
      try {
        // @ts-ignore
        const status = await (navigator as any).permissions.query({ name: 'microphone' });
        if (status.state !== 'granted') {
          try {
            const s = await navigator.mediaDevices.getUserMedia({ audio: true });
            s.getTracks().forEach(t => t.stop());
          } catch { 
            // Kontynuuj tylko z audio karty.
            }
        }
      } catch { 
        // Nic nie rób.
        }
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab');

    const resp = await chrome.runtime.sendMessage({ type: 'START_RECORDING', tabId: tab.id });
    if (!resp) throw new Error('No response from background');
    if (resp.starting) {
      setUI(false, null, true, false);
      return;
    }
    if (resp.stopping) {
      setUI(isRecording, null, false, true);
      return;
    }
    if (resp.recording) {
      setUI(true, resp.recordingStartedAt ?? null, false, false);
      return;
    }
    if (resp.ok === false) throw new Error(resp.error || 'Failed to start');

    setUI(true, resp.recordingStartedAt ?? null, false, false);
    toast('Recording started');
    if (resp.warning === 'NO_MIC_AUDIO') {
      alert('Recording started, but microphone audio is unavailable. The file will contain tab audio only.');
    }
  } catch (e: any) {
    console.error('[popup] START_RECORDING error', e);
    captureException(e, { operation: 'START_RECORDING' });
    setUI(false, null, false, false);
    alert(`Failed to start recording:\n${e?.message || e}`);
  } finally {
    inFlight = false;
  }
}

async function stopRecording() {
  if (!recordingToggleBtn) return;
  inFlight = true;
  setUI(true, null, false, true);

  try {
    const resp = await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
    if (!resp) throw new Error('No response from background');
    if (resp.ok === false) throw new Error(resp.error || 'Failed to stop');
    toast('Stopping... uploading...');
  } catch (e: any) {
    console.error('[popup] STOP_RECORDING error', e);
    captureException(e, { operation: 'STOP_RECORDING' });
    alert(`Failed to stop recording:\n${e?.message || e}`);
    setUI(false, null, false, false);
  } finally {
    inFlight = false;
  }
}

// Start albo stop nagrywania, zależnie od bieżącego stanu.
recordingToggleBtn?.addEventListener('click', async () => {
  if (inFlight) return;
  if (isRecording) {
    await stopRecording();
  } else {
    await startRecording();
  }
});
