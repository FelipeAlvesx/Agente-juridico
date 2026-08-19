#!/usr/bin/env python3
"""Servidor MCP stdio: dá ao Claude leitura SQL do CRM Juris, para relatórios.

Fala JSON-RPC direto no stdin/stdout, sem SDK — o host tem python3 e nada mais,
e o protocolo aqui é `initialize` + `tools/list` + `tools/call`. Toda consulta
vai para POST /api/query no agente, que abre o SQLite em mode=ro. Este processo
nunca escreve no banco.

Uso: registrado em .mcp.json (Claude Code) e no config do Claude Desktop.
"""

import json
import os
import sys
import urllib.error
import urllib.request

API = os.getenv("JURIS_API_URL", "http://localhost:3100")

SCHEMA_SQL = (
    "SELECT name, sql FROM sqlite_master "
    "WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
)

TOOLS = [
    {
        "name": "juris_schema",
        "description": (
            "Tabelas e colunas do CRM Juris — leads, status do funil, consultas, "
            "conversas e escalações. Chame antes do primeiro juris_query da sessão."
        ),
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "juris_query",
        "description": (
            "Roda um SELECT read-only no banco do CRM Juris. Uma instrução, só "
            "SELECT ou WITH. Agregue no SQL (COUNT, AVG, GROUP BY) em vez de "
            "puxar linha crua — o retorno é limitado e linha crua gasta contexto."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "sql":   {"type": "string",  "description": "SELECT ou WITH, instrução única."},
                "limit": {"type": "integer", "description": "Máx. de linhas (padrão 200, teto 1000)."},
            },
            "required": ["sql"],
        },
    },
]


def _query(sql: str, limit=None) -> dict:
    payload = {"sql": sql}
    if limit:
        payload["limit"] = limit
    req = urllib.request.Request(
        f"{API}/api/query",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        try:
            return {"error": json.loads(e.read()).get("error", str(e))}
        except (ValueError, OSError):
            return {"error": str(e)}
    except OSError as e:
        return {"error": f"agente inacessível em {API} ({e}) — rodou `make up`?"}


def _handle(msg: dict):
    method = msg.get("method")

    if method == "initialize":
        return {
            "protocolVersion": msg.get("params", {}).get("protocolVersion", "2024-11-05"),
            "capabilities":    {"tools": {}},
            "serverInfo":      {"name": "juris-crm", "version": "1.0.0"},
        }

    if method == "tools/list":
        return {"tools": TOOLS}

    if method == "tools/call":
        params = msg.get("params", {})
        args   = params.get("arguments") or {}
        name   = params.get("name")
        if name == "juris_schema":
            out = _query(SCHEMA_SQL)
        elif name == "juris_query":
            out = _query(args.get("sql", ""), args.get("limit"))
        else:
            raise KeyError(f"tool desconhecida: {name}")
        return {
            "content": [{"type": "text",
                         "text": json.dumps(out, ensure_ascii=False, default=str)}],
            "isError": "error" in out,
        }

    raise KeyError(f"método desconhecido: {method}")


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        if "id" not in msg:          # notificação: por contrato, não se responde
            continue
        try:
            reply = {"jsonrpc": "2.0", "id": msg["id"], "result": _handle(msg)}
        except Exception as e:       # erro vira resposta JSON-RPC, nunca derruba o loop
            reply = {"jsonrpc": "2.0", "id": msg["id"],
                     "error": {"code": -32603, "message": str(e)}}
        print(json.dumps(reply, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
