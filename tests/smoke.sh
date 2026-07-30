#!/bin/bash
# Smoke tests — verifica se os serviços estão respondendo

set -e

AGENT_URL=${AGENT_URL:-http://localhost:3000}
DASHBOARD_URL=${DASHBOARD_URL:-http://localhost:5173}

fail=0

check() {
    local name="$1"
    local url="$2"
    if curl -sf "$url" -o /dev/null; then
        echo "  OK  $name ($url)"
    else
        echo "  FAIL $name ($url)"
        fail=1
    fi
}

echo ""
echo "Smoke tests..."
echo ""

check "Agent /health"    "$AGENT_URL/health"
check "Agent /api/stats" "$AGENT_URL/api/stats"
check "Dashboard"        "$DASHBOARD_URL"

echo ""
if [ $fail -eq 0 ]; then
    echo "Todos os smoke tests passaram."
else
    echo "Falhas detectadas — verifique os containers com: make logs-all"
    exit 1
fi
