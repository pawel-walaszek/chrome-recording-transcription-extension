# System Map

## Purpose

This repository builds a Chrome Manifest V3 extension that works on `https://meet.google.com/*`.

The extension saves Google Meet captions as a local `.txt` transcript and can record the current Meet tab to a local `.webm` file. Recording and transcript export happen in the browser.

## Components

| Component | Path | Role |
| --- | --- | --- |
| Manifest | `manifest.json` | Declares MV3 metadata, permissions, content scripts, background worker, and accessible resources. |
| Popup | `popup.html`, `src/popup.ts` | User controls for transcript download, microphone permission, and recording start/stop. |
| Background service worker | `src/background.ts` | Coordinates tab capture, offscreen document lifecycle, recording state, badge, and downloads. |
| Offscreen recorder | `offscreen.html`, `src/offscreen.ts` | Captures tab media, optionally mixes microphone audio, records via `MediaRecorder`, and returns a blob URL for download. |
| Mic setup page | `micsetup.html`, `src/micsetup.ts` | Visible extension page used to request microphone permission when popup prompting is unreliable. |
| Caption collector | `src/scrapingScript.ts` | Content script that observes Google Meet caption DOM and buffers transcript lines. |
| Build | `webpack.config.js`, `tsconfig.json` | Compiles TypeScript entrypoints and copies static extension files into `dist/`. |

## Runtime Boundaries

- Host scope is limited to Google Meet via `host_permissions`.
- Output files are saved locally through the Chrome Downloads API.
- The extension does not require a backend service, database, or cloud storage.
- `dist/` is generated build output and should not be edited manually.

## Local Validation

1. Install dependencies with `npm install` or `npm ci`.
2. Run `npm run check`.
3. Load `dist/` in `chrome://extensions`.
4. Test on a Google Meet page with captions enabled for transcript behavior.
5. Test recording start/stop and download behavior when touching capture, offscreen, or permission code.
