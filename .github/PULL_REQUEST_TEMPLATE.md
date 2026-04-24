# Goal

Briefly describe what changes and why.

## Scope

1. 
2. 

## Verification

1. `make check`
2. Manual Chrome extension smoke test, if browser behavior changed:
   a) load `dist/` in `chrome://extensions`
   b) test transcript download on Google Meet
   c) test recording start/stop when capture or offscreen code changed

## Chrome Extension Impact

- [ ] `manifest.json` permissions unchanged.
- [ ] If permissions changed, the reason is explained in this PR.
- [ ] Generated `dist/` files are not committed.

## Checklist

- [ ] The change is limited to the stated scope.
- [ ] Documentation was updated when needed.
- [ ] No secrets, recordings, transcripts, or local artifacts were added.
