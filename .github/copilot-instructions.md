# GitHub Copilot Instructions

Follow these rules when generating code, comments, or review feedback in this repository.

## Project Context

- This is a Chrome Manifest V3 extension for Google Meet.
- Source code is TypeScript in `src/`.
- webpack builds JavaScript entrypoints and copies `manifest.json` plus HTML files to `dist/`.
- There is no backend service, database, or deployment target.

## Review Priorities

1. Functional regressions in transcript collection, tab capture, offscreen recording, downloads, and microphone permission flow.
2. Security and privacy risks, especially unnecessary Chrome permissions or data leaving the browser.
3. Missing validation for changed behavior.
4. Inconsistency with the existing simple TypeScript/webpack structure.
5. Unnecessary complexity or broad refactors.

## Style

- Keep public README and user-facing extension text in English unless the task explicitly changes that.
- Keep agent/process documentation in Polish when it targets the local workflow.
- Avoid cosmetic review comments unless they affect behavior, maintainability, or readability.
- Prefer small, concrete suggestions tied to a specific file and scenario.

## Validation

- Use `make check` for code/config changes.
- Ask for or describe manual Chrome extension testing when browser behavior changes.
