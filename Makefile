COMPOSE ?= docker compose
HOST_UID ?= $(shell id -u)
HOST_GID ?= $(shell id -g)
SENTRY_DSN ?= $(shell scripts/sentry-public-dsn.sh || true)
SENTRY_ENVIRONMENT ?= chrome-extension-dev
UPLOAD_API_BASE_URL ?= https://meet2note.com
export HOST_UID
export HOST_GID
export SENTRY_DSN
export SENTRY_ENVIRONMENT
export UPLOAD_API_BASE_URL

.PHONY: build check shell clean deps-clean prepare-deps package zip

build: prepare-deps
	$(COMPOSE) run --rm builder ./node_modules/.bin/webpack --mode=production

check: prepare-deps
	$(COMPOSE) run --rm builder sh -lc './node_modules/.bin/tsc --noEmit && ./node_modules/.bin/webpack --mode=production'

package: build
	./scripts/package-extension.sh

zip: package

shell: prepare-deps
	$(COMPOSE) run --rm builder sh

clean:
	rm -rf dist

deps-clean:
	$(COMPOSE) down --volumes --remove-orphans

prepare-deps:
	$(COMPOSE) run --rm --user root builder sh -lc 'mkdir -p /workspace/node_modules /workspace/dist /home/node/.npm && chown "$$HOST_UID:$$HOST_GID" /workspace /workspace/dist && npm ci; status=$$?; chown "$$HOST_UID:$$HOST_GID" /workspace /workspace/dist; chown -R "$$HOST_UID:$$HOST_GID" /workspace/node_modules /home/node/.npm; exit $$status'
