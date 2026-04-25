// src/popup.ts

import { captureException, initDiagnostics } from './diagnostics'
import { getMicPreferences, MIC_DEVICE_ID_KEY, MIC_LABEL_KEY } from './micPreferences'

initDiagnostics('popup')

const micBtn = document.getElementById('enable-mic') as HTMLButtonElement | null;
const micStatusEl = document.getElementById('mic-status') as HTMLDivElement | null;
const startBtn = document.getElementById('start-rec') as HTMLButtonElement | null;
const stopBtn = document.getElementById('stop-rec') as HTMLButtonElement | null;

function setUI(recording: boolean) {
  if (!startBtn || !stopBtn) return;
  startBtn.disabled = recording;
  stopBtn.disabled = !recording;
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
    setUI(!!st?.recording);
  } catch {
    setUI(false);
  }
  refreshMicButton().catch(() => {});
})();

// Reakcja na komunikaty stanu z tła/offscreen.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'RECORDING_STATE') setUI(!!msg.recording);
  if (msg?.type === 'RECORDING_SAVED') {
    toast(`Saved: ${msg.filename || 'recording.webm'}`);
    setUI(false);
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

// Start nagrywania.
startBtn?.addEventListener('click', async () => {
  if (!startBtn || !stopBtn || inFlight) return;
  inFlight = true;
  startBtn.disabled = true;

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
    if (resp.ok === false) throw new Error(resp.error || 'Failed to start');

    setUI(true);
    toast('Recording started');
    if (resp.warning === 'NO_MIC_AUDIO') {
      alert('Recording started, but microphone audio is unavailable. The file will contain tab audio only.');
    }
  } catch (e: any) {
    console.error('[popup] START_RECORDING error', e);
    captureException(e, { operation: 'START_RECORDING' });
    setUI(false);
    alert(`Failed to start recording:\n${e?.message || e}`);
  } finally {
    inFlight = false;
  }
});

// Stop nagrywania.
stopBtn?.addEventListener('click', async () => {
  if (!startBtn || !stopBtn || inFlight) return;
  inFlight = true;
  stopBtn.disabled = true;

  try {
    const resp = await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
    if (!resp) throw new Error('No response from background');
    if (resp.ok === false) throw new Error(resp.error || 'Failed to stop');
    toast('Stopping… finalizing…');
  } catch (e: any) {
    console.error('[popup] STOP_RECORDING error', e);
    captureException(e, { operation: 'STOP_RECORDING' });
    alert(`Failed to stop recording:\n${e?.message || e}`);
    setUI(false);
  } finally {
    inFlight = false;
  }
});
