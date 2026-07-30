.PHONY: setup up down logs logs-all test test-golden smoke webhook shell backup reset-db dev-dashboard build help

# ──────────────────────────────────────────────────────────────────────────────
# Lumina Agent — Makefile
# ──────────────────────────────────────────────────────────────────────────────

help:
	@echo ""
	@echo "  Lumina Agent — comandos disponíveis"
	@echo ""
	@echo "  Onboarding:"
	@echo "    make setup          Verifica pré-requisitos e copia .env.example"
	@echo "    make webhook        Registra webhook na Evolution API (após make up)"
	@echo ""
	@echo "  Docker:"
	@echo "    make up             Sobe todos os containers"
	@echo "    make down           Para e remove os containers"
	@echo "    make build          Rebuilda as imagens sem cache"
	@echo "    make logs           Logs em tempo real do agente"
	@echo "    make logs-all       Logs de todos os containers"
	@echo "    make shell          Terminal dentro do container do agente"
	@echo ""
	@echo "  Desenvolvimento:"
	@echo "    make dev-dashboard  Vite HMR local (porta 5173)"
	@echo ""
	@echo "  Testes:"
	@echo "    make test           Golden tests + smoke tests"
	@echo "    make test-golden    Só golden tests"
	@echo "    make smoke          Só smoke tests (health checks)"
	@echo ""
	@echo "  Manutenção:"
	@echo "    make backup         Backup manual do SQLite"
	@echo "    make reset-db       Apaga o banco (dev only — pede confirmação)"
	@echo ""

# ─── Onboarding ──────────────────────────────────────────────────────────────

setup:
	@echo ""
	@echo "==> Verificando pré-requisitos..."
	@python3 setup/check_prerequisites.py
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "==> .env criado a partir de .env.example"; \
		echo "    Edite o arquivo .env com suas credenciais antes de continuar."; \
	else \
		echo "==> .env já existe — não sobrescrevendo."; \
	fi
	@echo ""
	@echo "==> Próximos passos:"
	@echo "    1. Edite o .env com suas chaves"
	@echo "    2. Coloque google_credentials.json em credentials/"
	@echo "    3. make up"
	@echo "    4. make webhook"
	@echo ""

webhook:
	@echo "==> Registrando webhook na Evolution API..."
	@python3 setup/configure_webhook.py

# ─── Docker ──────────────────────────────────────────────────────────────────

up:
	docker compose up -d

down:
	docker compose down

build:
	docker compose build --no-cache

logs:
	docker compose logs -f agent

logs-all:
	docker compose logs -f

shell:
	docker compose exec agent /bin/bash

# ─── Desenvolvimento ─────────────────────────────────────────────────────────

dev-dashboard:
	@echo "==> Iniciando dashboard em modo desenvolvimento (Vite HMR)..."
	@echo "    Acesse: http://localhost:5173"
	@echo "    O agente deve estar rodando em http://localhost:3000"
	@cd dashboard && npm install && npm run dev

# ─── Testes ──────────────────────────────────────────────────────────────────

test: test-golden smoke

test-golden:
	@echo "==> Rodando golden tests..."
	@python3 tests/runner.py tests/golden/

smoke:
	@echo "==> Rodando smoke tests..."
	@bash tests/smoke.sh

# ─── Manutenção ──────────────────────────────────────────────────────────────

backup:
	@echo "==> Criando backup do SQLite..."
	@docker compose exec backup sqlite3 /data/sessions.db ".backup /backups/sessions_manual_$$(date +%Y%m%d_%H%M%S).db"
	@echo "==> Backup concluído."

reset-db:
	@echo "ATENÇÃO: Isso apagará todos os dados do banco (leads, agendamentos, conversas)."
	@read -p "Digite 'sim' para confirmar: " confirm; \
	if [ "$$confirm" = "sim" ]; then \
		docker compose stop agent; \
		docker volume rm lumina-agent_agent_db 2>/dev/null || true; \
		docker compose up -d agent; \
		echo "Banco resetado."; \
	else \
		echo "Cancelado."; \
	fi
