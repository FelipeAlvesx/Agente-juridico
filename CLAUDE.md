# Juris Agent

Agente de WhatsApp para escritórios de advocacia. Recebe o primeiro contato, acolhe,
qualifica (área jurídica, resumo do caso, urgência, origem), agenda a consulta com o
advogado e alimenta um CRM com todo lead — inclusive os que **não** concluíram o
atendimento, para follow-up posterior.

Fork da engine do `lumina-agent` (vertical estética), aqui adaptada para a vertical
`advocacia`. O repositório de referência está em `_ref/lumina-agent/` — **somente
leitura**, nunca editar nem commitar mudanças lá.

## Stack

- **Backend:** Python 3.11 + Flask, Anthropic Claude, SQLite
- **Frontend (CRM):** React 18 + Vite + TypeScript + Tailwind + Recharts
- **WhatsApp:** Evolution API v1.8.2
- **Infra:** Docker Compose

## Comandos

```bash
make up             # Sobe todos os serviços
make down           # Para tudo
make logs           # Logs do agente
make dev-dashboard  # Vite HMR na :5173
make test-golden    # Cenários de conversa completos (precisa do agente rodando)
make smoke          # Health checks, sem chamar Claude
```

Loop de dev mais rápido, sem WhatsApp nenhum:

```bash
curl -X POST http://localhost:3000/api/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "5511999999999", "text": "oi, fui demitido sem justa causa"}'
```

## Arquitetura

```
WhatsApp → Evolution API (:8080)
  → POST /webhook (agent/main.py)
    → dedup (24h) + debounce (4s)
      → agent_core.py (loop Claude, máx. 5 iterações de tool)
        → verticals/advocacia/tools.py (execução das tools)
          → sessions.py (SQLite), gcal.py (agenda)
      → evolution.py (envia resposta)
```

System prompt montado em camadas (`prompt_builder.py`):
engine rules → persona → fragmento da vertical → regras extras do tenant →
contexto RAG → estado do lead/consulta → hora atual.

## Divisão de trabalho (3 terminais em paralelo)

Cada terminal é **dono** de suas pastas. Não edite arquivo fora do seu escopo —
abra um pedido para o dono via `maestri ask`.

| Terminal | Dono de | Não toca |
|---|---|---|
| **Agente** | `agent/agent_core.py`, `agent/main.py`, `agent/config.py`, `agent/evolution.py`, `agent/gcal.py`, `verticals/advocacia/tools.py`, `verticals/advocacia/notifications.py`, `verticals/advocacia/receptionist.py`, `tenants/*.yaml` | `dashboard/`, `agent/api.py`, `prompts/`, `knowledge/` |
| **CRM** | `dashboard/`, `agent/api.py`, `agent/sessions.py`, `agent/seed_demo.py` | `agent/agent_core.py`, `verticals/`, `prompts/` |
| **Prompt** | `prompts/base/*.md`, `verticals/advocacia/prompt_fragment.md`, `knowledge/*.md`, `tests/golden/*.yaml` | todo o resto (código) |

**Contrato entre eles:** `agent/sessions.py` é a fronteira. O CRM define e evolui o
schema + as funções de acesso; o Agente só as consome. Mudança de assinatura em
`sessions.py` tem que ser avisada ao terminal do Agente antes de aplicar.

## Arquivos-chave

| Arquivo | Papel |
|---|---|
| `agent/agent_core.py` | Loop Claude + montagem de contexto (RAG, estado do lead, consultas) |
| `agent/sessions.py` | Modelos SQLite: leads, conversas, consultas, escalações |
| `agent/api.py` | REST para o CRM (`/api/stats`, `/api/leads`, `/api/appointments/*`) |
| `verticals/advocacia/tools.py` | Tools do Claude (qualificação, agenda, escalação) |
| `tenants/juris.yaml` | Config do escritório: áreas, horários, persona, regras OAB |
| `knowledge/*.md` | Fonte do RAG (áreas de atuação, FAQ, documentos necessários) |
| `prompts/base/` | `engine_rules.md` + `human_persona.md` |

## Regras duras da vertical (OAB)

O Provimento 205/2021 do CFOAB e o Código de Ética restringem publicidade e captação.
Isto é requisito de produto, não sugestão — vale para prompts, textos do CRM e mensagens:

- **Nunca** dar orientação, opinião ou parecer jurídico — ato privativo do advogado.
- **Nunca** estimar chance de êxito, valor de indenização ou prazo processual.
- **Nunca** informar honorários — só que são tratados na consulta.
- **Nunca** usar linguagem de captação ("garanta seu direito", "receba até R$ X",
  "promoção", "vagas limitadas", urgência artificial).
- O papel do agente é **acolher, triar e agendar**. Nada além disso.

## Comportamentos não óbvios (herdados da engine)

- **Debounce:** mensagens seguidas do mesmo número viram uma só (janela de 4s).
- **Split de mensagem:** resposta com `---` vira balões separados no WhatsApp.
- **Tool loop:** máximo de 5 chamadas de tool por mensagem.
- **Polling do dashboard:** `useFetch` a cada 30s — não há WebSocket.
- **TTL de sessão:** 30 min de inatividade zera o histórico enviado ao Claude.
