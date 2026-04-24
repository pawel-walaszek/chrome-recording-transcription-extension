# Scripts

Helper scripts for local project workflows. The default build and validation entrypoints are Make targets backed by Docker Compose.

## Available scripts

- `smoke-test.sh` - runs the local validation command used before manual Chrome extension testing.

Prefer `make check` for day-to-day validation. Use scripts directly only when a Make target points to them or when debugging the helper itself.

Run scripts from the repository root.
