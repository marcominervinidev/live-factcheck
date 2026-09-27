# All targets run their tools inside containers; the host needs only Docker and Git.
# Exception: secrets-init and hooks-install touch host paths by design.
SHELL := /bin/sh
TB := scripts/tb
COMPOSE := docker compose
DEV := $(COMPOSE) -f docker-compose.yml -f compose.dev.yaml
SECRETS_DIR ?= $(HOME)/.config/live-factcheck/secrets
TRIVY := aquasec/trivy:0.74.0
IMAGES := caddy web gateway transcription claim-extractor fact-checker

.PHONY: help up up-local dev down logs ready check-ports lint test test-unit test-integration \
        test-api test-e2e eval scan toolbox toolbox-down install secrets-init hooks-install

help: ## List targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-16s %s\n", $$1, $$2}'

## ---- stack
up: ## Build and start the stack, wait until every service is healthy
	$(COMPOSE) up -d --build --wait

up-local: ## Stack with local speech-to-text (profile local-stt; arrives in phase 2)
	@echo "The local-stt profile arrives in phase 2 (stt-local). Starting the default stack."
	$(COMPOSE) --profile local-stt up -d --build --wait

dev: ## Dev mode: dev images with hot reload via docker compose watch
	$(DEV) up -d --build --wait
	$(DEV) watch --no-up

down: ## Stop the stack (volumes are kept)
	$(COMPOSE) down

logs: ## Follow the logs of all services
	$(COMPOSE) logs -f --tail=100

ready: ## Check /readyz of every service and the app through Caddy
	@scripts/ready.sh

check-ports: ## Verify that only caddy publishes host ports
	@scripts/check-ports.sh

## ---- quality (stages from brief 13.2)
lint: ## Stage 0: typecheck, lint, format check, boundaries, MCP config parity
	$(TB) pnpm typecheck
	$(TB) pnpm lint
	$(TB) pnpm format:check
	$(TB) pnpm depcruise
	$(TB) node scripts/ci/check-mcp-parity.mjs

test-unit: ## Stage 1: unit tests of all workspaces
	$(TB) pnpm test:unit

test-integration: ## Stage 2a: integration tests with Testcontainers (backend); 2b follows in TP6
	$(TB) pnpm test:int

test-api: ## Stage 3: system/API tests against the stack (arrive in TP6)
	@echo "No API tests yet: tests/api arrives in TP6 of phase 0."

test-e2e: ## Stage 4: E2E tests with Playwright (arrive in TP6)
	@echo "No E2E tests yet: tests/e2e arrives in TP6 of phase 0."

test: lint test-unit test-integration test-api test-e2e ## Stages 0-4

eval: ## Stage 5: LLM evaluation (arrives in phase 1)
	@echo "The eval set and pnpm eval arrive in phase 1."

scan: ## Trivy scan of all local images: critical vulnerabilities and embedded secrets fail
	@status=0; for image in $(IMAGES); do \
	  echo "== lfc/$$image:local"; \
	  docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v lfc-trivy-cache:/root/.cache $(TRIVY) \
	    image --scanners vuln,secret --severity CRITICAL --exit-code 1 --no-progress --quiet --table-mode detailed \
	    lfc/$$image:local || status=1; \
	done; exit $$status

## ---- tooling
toolbox: ## Build and start the dev toolbox container
	$(COMPOSE) -f compose.toolbox.yaml up -d --build --wait toolbox

toolbox-down: ## Stop the dev toolbox container
	$(COMPOSE) -f compose.toolbox.yaml down

install: ## Install workspace dependencies (frozen lockfile)
	$(TB) pnpm install --frozen-lockfile

secrets-init: ## Create SECRETS_DIR outside the repo (internal secrets random, API keys empty)
	@scripts/secrets-init.sh "$(SECRETS_DIR)"

hooks-install: ## Install the git pre-commit shim (runs lefthook in the toolbox)
	@install -m 0755 scripts/git-pre-commit.sh "$$(git rev-parse --git-path hooks)/pre-commit"
	@echo "pre-commit hook installed -> scripts/git-pre-commit.sh"
