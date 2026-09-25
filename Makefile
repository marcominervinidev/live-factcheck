# All targets run their tools inside containers; the host needs only Docker and Git.
# Exception: secrets-init and hooks-install touch host paths by design.
SHELL := /bin/sh
TB := scripts/tb
SECRETS_DIR ?= $(HOME)/.config/live-factcheck/secrets

.PHONY: help toolbox toolbox-down install lint typecheck secrets-init hooks-install

help: ## List targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-16s %s\n", $$1, $$2}'

toolbox: ## Build and start the dev toolbox container
	docker compose -f compose.toolbox.yaml up -d --build --wait toolbox

toolbox-down: ## Stop the dev toolbox container
	docker compose -f compose.toolbox.yaml down

install: ## Install workspace dependencies (frozen lockfile)
	$(TB) pnpm install --frozen-lockfile

lint: ## Stage 0: typecheck, lint, format check, boundaries
	$(TB) pnpm typecheck
	$(TB) pnpm lint
	$(TB) pnpm format:check
	$(TB) pnpm depcruise

secrets-init: ## Create SECRETS_DIR outside the repo with empty placeholders (0700/0600)
	@scripts/secrets-init.sh "$(SECRETS_DIR)"
