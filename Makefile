# All targets run their tools inside containers; the host needs only Docker and Git.
# Exception: secrets-init and hooks-install touch host paths by design.
SHELL := /bin/sh
TB := scripts/tb
# Compose reads the settings from .env by default. ENV_FILE picks another file for one call:
# `make up ENV_FILE=.env.example` starts the stack on the mock defaults. The file replaces .env
# as a whole, ports, LAN_HOST and SECRETS_DIR included. Only the command line sets it, never the
# environment.
ENV_FILE :=
COMPOSE := docker compose $(if $(ENV_FILE),--env-file $(ENV_FILE))
DEV := $(COMPOSE) -f docker-compose.yml -f compose.dev.yaml
# The configured stack with the test overlay: eval and redteam measure the providers it runs.
# Stages 3 and 4 and the ZAP scan run like CI instead, through scripts/stack-test.sh.
TEST := $(COMPOSE) -f docker-compose.yml -f compose.test.yaml
SECRETS_DIR ?= $(HOME)/.config/live-factcheck/secrets
TRIVY := aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969
# Keep the tag in sync with the sast job in .github/workflows/pr.yml.
SEMGREP := semgrep/semgrep:1.178.0
PLAYWRIGHT := docker run --rm --ipc=host -e CI -v $(CURDIR):/workspace mcr.microsoft.com/playwright:v1.63.0-noble
# stt-local exists only with the local-stt profile (make up-local); CI builds and scans it on every PR.
IMAGES := caddy web gateway transcription claim-extractor fact-checker explainer
# make up builds :local, the stack test targets build :test (make scan SCAN_TAG=test after a test run).
SCAN_TAG ?= local

# The stack test targets share the project lfc-test and start with `down -v`; in parallel they
# would remove each other's stack.
.NOTPARALLEL:

.PHONY: help up up-local dev down logs ready check-ports lint test test-unit test-integration stt-probe \
        test-api test-e2e zap redteam llm-scan sast eval scan toolbox toolbox-down install secrets-init hooks-install

help: ## List targets
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-16s %s\n", $$1, $$2}'

## ---- stack
up: ## Build and start the stack, wait until every service is healthy
	$(COMPOSE) up -d --build --wait

up-local: ## Stack with local speech-to-text in a container (profile local-stt; first start downloads the model)
	STT_PROVIDER=local STT_MODEL=$${LOCAL_STT_MODEL:-small} LOCAL_STT_URL=ws://stt-local:8000/v1/stream \
	  $(COMPOSE) --profile local-stt up -d --build --wait

dev: ## Dev mode: dev images with hot reload via docker compose watch
	$(DEV) up -d --build --wait
	$(DEV) watch --no-up

down: ## Stop the stack incl. profile services like stt-local (volumes are kept)
	$(COMPOSE) --profile '*' down

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
	$(TB) node scripts/ci/check-mcp-parity.ts

test-unit: ## Stage 1: unit tests of all workspaces
	$(TB) pnpm test:unit

test-integration: ## Stages 2a (backend, Testcontainers; Docker socket) and 2b (frontend, Playwright)
	$(COMPOSE) -f compose.toolbox.yaml --profile docker run --rm toolbox-docker \
	  pnpm --filter '!@lfc/web' -r --if-present test:int
	$(PLAYWRIGHT) sh -c 'cd /workspace/apps/web && node_modules/.bin/playwright test -c tests/playwright.config.ts'

test-api: ## Stage 3: API tests on a fresh mock stack (own project lfc-test, removed afterwards)
	scripts/stack-test.sh run --rm api-tests

test-e2e: ## Stage 4: E2E browser tests on a fresh mock stack (Chromium, WebKit/iPhone)
	scripts/stack-test.sh run --rm e2e-tests

test: lint test-unit test-integration test-api test-e2e ## Stages 0-4

zap: ## OWASP ZAP baseline scan on a fresh mock stack (brief 15.7); report in tests/security/reports/
	@mkdir -p tests/security/reports && chmod 777 tests/security/reports
	scripts/stack-test.sh --profile test run --rm zap

# The red team runs in its own Compose project, created fresh and removed afterwards: no verdict
# cache from earlier runs (a cached verdict says nothing about the current model) and the
# owner's stack stays untouched.
REDTEAM := COMPOSE_PROJECT_NAME=lfc-redteam LFC_HTTP_PORT=8083 LFC_HTTPS_PORT=8445 \
	CHECKER_RESEARCH_SOURCES=mock CHECKER_MOCK_INJECTED_PAGE=on $(TEST)

redteam: ## LLM red teaming with promptfoo (brief 15.7); needs a real model, see tests/redteam/README.md
	@mkdir -p tests/redteam/reports && chmod 777 tests/redteam/reports
	$(REDTEAM) down -v --remove-orphans
	$(REDTEAM) up -d --build --wait
	$(REDTEAM) --profile redteam run --rm redteam; status=$$?; \
	  $(REDTEAM) down -v --remove-orphans; exit $$status

stt-probe: ## One real STT run with the WAV fixture (plan T2.5): latency and transcript; costs a few cents of provider credit
	$(COMPOSE) -p lfc-probe -f docker-compose.yml -f compose.probe.yaml --profile probe run --rm stt-probe; \
	  status=$$?; $(COMPOSE) -p lfc-probe -f docker-compose.yml -f compose.probe.yaml down --remove-orphans >/dev/null 2>&1; exit $$status

llm-scan: ## Local LLM security scan of the diff (advisory, brief 15.7); needs LM Studio, see scripts/llm-scan/README.md
	$(TB) env SCAN_LLM_PROVIDER=$${SCAN_LLM_PROVIDER:-openai-compatible} \
	  SCAN_LLM_MODEL=$${SCAN_LLM_MODEL:-qwen2.5-coder-7b-instruct} \
	  SCAN_LLM_BASE_URL=$${SCAN_LLM_BASE_URL:-http://host.docker.internal:1234/v1} \
	  SCAN_LLM_TIMEOUT_MS=$${SCAN_LLM_TIMEOUT_MS:-180000} \
	  LLM_SCAN_BASE_REF=$${LLM_SCAN_BASE_REF:-origin/main} \
	  pnpm --filter @lfc/llm-scan run scan

eval: ## Stage 5: eval against the stack (EVAL_LABEL=name, EVAL_SET=claims|detection; evals/README.md)
	$(TEST) up -d --build --wait
	$(TEST) --profile eval run --rm $(if $(filter detection,$(EVAL_SET)),eval-detection,eval)

sast: ## Semgrep exactly like the CI job (pinned image, same rule packs); run before opening a PR
	docker run --rm -v $(CURDIR):/src $(SEMGREP) semgrep scan --error --metrics=off \
	  --config p/typescript --config p/nodejsscan --config p/dockerfile \
	  --config p/github-actions --config p/secrets

scan: ## Trivy scan of all local images (SCAN_TAG=local|test): critical vulnerabilities and embedded secrets fail
	@status=0; for image in $(IMAGES); do \
	  echo "== lfc/$$image:$(SCAN_TAG)"; \
	  docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v lfc-trivy-cache:/root/.cache $(TRIVY) \
	    image --scanners vuln,secret --severity CRITICAL --exit-code 1 --no-progress --quiet --table-mode detailed \
	    lfc/$$image:$(SCAN_TAG) || status=1; \
	done; exit $$status

## ---- tooling
toolbox: ## Build and start the dev toolbox container
	$(COMPOSE) -f compose.toolbox.yaml up -d --build --wait toolbox

toolbox-down: ## Stop the dev toolbox container
	$(COMPOSE) -f compose.toolbox.yaml down

install: ## Install workspace dependencies and the red-team project (frozen lockfiles)
	$(TB) pnpm install --frozen-lockfile
	$(TB) pnpm --dir tests/redteam install --frozen-lockfile

secrets-init: ## Create SECRETS_DIR outside the repo (internal secrets random, API keys empty)
	@scripts/secrets-init.sh "$(SECRETS_DIR)"

hooks-install: ## Install the git pre-commit shim (runs lefthook in the toolbox)
	@install -m 0755 scripts/git-pre-commit.sh "$$(git rev-parse --git-path hooks)/pre-commit"
	@echo "pre-commit hook installed -> scripts/git-pre-commit.sh"
