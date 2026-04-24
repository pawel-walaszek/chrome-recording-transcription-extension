COMPOSE ?= docker compose
HOST_UID ?= $(shell id -u)
HOST_GID ?= $(shell id -g)
export HOST_UID
export HOST_GID

.PHONY: build check shell clean deps-clean prepare-deps

build: prepare-deps
	$(COMPOSE) run --rm builder ./node_modules/.bin/webpack --mode=production

check: prepare-deps
	$(COMPOSE) run --rm builder sh -lc './node_modules/.bin/tsc --noEmit && ./node_modules/.bin/webpack --mode=production'

shell: prepare-deps
	$(COMPOSE) run --rm builder sh

clean:
	rm -rf dist

deps-clean:
	$(COMPOSE) down --volumes --remove-orphans

prepare-deps:
	$(COMPOSE) run --rm --user root builder sh -lc 'mkdir -p /workspace/node_modules /workspace/dist /home/node/.npm && npm ci && chown "$$HOST_UID:$$HOST_GID" /workspace /workspace/dist && chown -R "$$HOST_UID:$$HOST_GID" /workspace/node_modules /home/node/.npm'
