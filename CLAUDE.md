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
curl -X POST http://localhost:3100/api/test/message \
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

System prompt montado em camadas (`prompt_builder.py`): identidade → persona →
fragmento da vertical → engine rules → regras extras do tenant → hora atual.
RAG, estado do lead e das consultas **não** são camadas do system prompt — entram
concatenados na mensagem do usuário (`agent_core.py`), o que muda o comportamento
de cache. Detalhes em `docs/02-engine-do-agente.md`.

## Divisão de trabalho (3 terminais em paralelo)

Cada terminal é **dono** de suas pastas. Não edite arquivo fora do seu escopo —
abra um pedido para o dono via `maestri ask`.

Os terminais têm nome próprio no canvas: **Pulso** = Agente, **Âmbar** = CRM,
**Bússola** = Prompt. O terminal Maestro coordena e integra.

| Terminal | Dono de | Não toca |
|---|---|---|
| **Agente** | `agent/agent_core.py`, `agent/main.py`, `agent/config.py`, `agent/evolution.py`, `agent/gcal.py`, `verticals/advocacia/tools.py`, `verticals/advocacia/notifications.py`, `verticals/advocacia/receptionist.py`, `tenants/*.yaml` | `dashboard/`, `agent/api.py`, `prompts/`, `knowledge/` |
| **CRM** | `dashboard/`, `agent/api.py`, `agent/sessions.py`, `agent/seed_demo.py` | `agent/agent_core.py`, `verticals/`, `prompts/` |
| **Prompt** | `prompts/base/*.md`, `verticals/advocacia/prompt_fragment.md`, `knowledge/*.md`, `tests/golden/*.yaml` | todo o resto (código) |

**Contrato entre eles:** `agent/sessions.py` é a fronteira. O CRM define e evolui o
schema + as funções de acesso; o Agente só as consome. Mudança de assinatura em
`sessions.py` tem que ser avisada ao terminal do Agente antes de aplicar.

## Comunicação entre terminais — prompts curtos

Todo `maestri ask` / `maestri check` entre terminais é token pago. Delegação aqui é
telegrama, não briefing. Vale nas duas direções: ao delegar e ao responder.

- **Alvo: 1 a 3 linhas.** Passou de 5, corte.
- **Aponte, não transcreva.** Cite `arquivo:linha` e deixe o outro ler. Nunca cole
  trecho de código, log ou conteúdo de arquivo que ele consegue abrir sozinho.
- **Não repita o que já está aqui.** O `CLAUDE.md` e a role já foram lidos pelo
  destinatário — não reexplique arquitetura, stack, ownership ou regras da OAB.
- **Uma tarefa por mensagem**, com o resultado esperado explícito.
- **Sem preâmbulo, sem cortesia, sem recapitulação** do que já foi combinado.
- **Ao responder:** o que mudou, em que arquivo, o que quebrou. Nada de relatório.

```
✓ "Âmbar: sessions.py precisa de lead.status + motivo_perda. Enum em CLAUDE.md. Me avisa a assinatura final."
✗ "Oi Âmbar! Então, conforme conversamos, o projeto é um agente de WhatsApp para
   advocacia e você é responsável pelo CRM. Eu estava analisando o sessions.py e
   percebi que hoje ele só guarda... [30 linhas]"
```

Concisão nunca justifica ambiguidade: se cortar deixa a tarefa dúbia, mantenha a
linha que remove a dúvida — o retrabalho custa mais tokens que ela.

## Contrato de tools (fonte da verdade: `verticals/advocacia/tools.py`)

Prompt e código têm que citar exatamente estes nomes. Mudou aqui, avise o dono do prompt.

`save_lead_field` · `mark_lead_complete` · `marcar_fora_de_escopo` ·
`list_available_slots` · `create_pending_appointment` · `get_patient_appointments` ·
`reschedule_appointment` · `cancel_appointment` · `escalate_to_human`

Categorias de `escalate_to_human` (`ESCALATION_CATEGORIES`):
`urgencia_prazo` · `consulta_juridica` · `processo_em_andamento` · `reclamacao` ·
`pedido_humano` · `confusao_repetida`

Campos do lead (`vertical_config.lead_fields` em `tenants/juris.yaml`):
`nome` · `area_juridica` · `resumo_caso` · `urgencia` · `origem`

## Tom e vocabulário — nicho jurídico

Este agente não é de estética. O tom herdado da engine original (caloroso, emojis de
flor e coração, "que ótimo que você entrou em contato!") está **errado** aqui: quem
procura advogado está passando por demissão, dívida, separação, acidente ou processo.

- **Vocabulário jurídico correto:** cliente (não "paciente"), consulta com o advogado
  (não "procedimento"), área de atuação (não "serviço"), caso (não "tratamento").
- **Emojis: raríssimos e sóbrios.** No máximo um por conversa, e só onde acolhe sem
  banalizar o problema. Nunca 💜🌿✨💆 nem carinhas festivas. Na dúvida, nenhum.
- **Acolhe sem dramatizar e sem euforia.** "Entendo, vamos te ajudar com isso" — não
  "Que ótimo que você nos procurou!". Ninguém está feliz por precisar de advogado.
- **Sem urgência artificial nem tom comercial.** Isso é regra da OAB, não estilo.

Vale para o prompt do agente, as mensagens do WhatsApp, os textos do CRM e o seed.

## Arquivos-chave

| Arquivo | Papel |
|---|---|
| `agent/agent_core.py` | Loop Claude + montagem de contexto (RAG, estado do lead, consultas) |
| `agent/sessions.py` | Modelos SQLite: leads, conversas, consultas, escalações |
| `agent/api.py` | REST para o CRM — 19 rotas, incluindo `/api/query` (SQL read-only p/ MCP). Ver `docs/04-api-contrato.md` |
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

## Estado atual

Feito e verificado (`tests/test_funnel.py` e `tests/test_triagem_horario.py` passam
num container `python:3.11-slim` com `pyyaml structlog requests`):

- Engine forkada do `lumina-agent`, vertical `estetica` → `advocacia`
- `tools.py` jurídico, horário de atendimento vindo do tenant
- Funil de leads em `sessions.py` (`status`, `motivo_perda`, `last_contact`) + `api.py`
- `prompts/base/*` e `prompt_fragment.md` reescritos para o jurídico
- 7 cenários em `tests/golden/` (qualificação, agendamento, recusas OAB, urgência,
  insistência, fora de escopo, tom)
- CRM reescrito com identidade jurídica: nove telas (inclui Triagem e Follow-up,
  que não existiam na engine original) — não está mais "herdado da estética"
- `.env` existe com `ANTHROPIC_API_KEY` válida — `make test-golden` roda e passa
  7/7 contra o Claude real

Documentação completa do projeto, incluindo guia de replicação para outros
nichos, em [`docs/`](docs/README.md) — comece por `docs/README.md`.

Pendente:

- **Antes do deploy: nenhuma rota `/api/*` tem auth, e o CORS é `*`.** Não é só o
  `/api/query` (SQL read-only, alimenta o MCP em `tools/juris_mcp.py`) — até
  `GET /api/conversations/<phone>` já devolve o histórico integral de qualquer
  telefone sem precisar de SQL. Local em `localhost:3100` tudo bem; exposto na
  rede vira leitura irrestrita das conversas — sigilo profissional de cliente de
  advogado. Resolver com token no header ou bind em 127.0.0.1 antes de publicar.
  Ver `docs/04-api-contrato.md §5`.
- **`verticals/` não é isolável hoje.** `agent/api.py` importa direto de
  `verticals.advocacia`; `prompts/base/` e `knowledge/` são caminhos globais;
  `sessions.py` semeia áreas do Direito e advogados fictícios; e sobra resíduo da
  vertical de estética original no core (`prompt_builder.py` chama a variável de
  contexto "INFO DA CLÍNICA", `/health` responde `"agent": "lumina"`,
  `get_patient_appointments`, coluna `patient_name`). Levantar antes de tentar
  plugar uma segunda vertical. Lista completa com `arquivo:linha` em
  `docs/07-replicar-para-outro-nicho.md`.
- **Estado crítico é in-memory de processo único**: dedup, debounce, flag de
  escalação e slots ofertados não sobrevivem a restart nem funcionam com duas
  réplicas.
- `make reset-db` (`Makefile:113`) remove o volume `lumina-agent_agent_db`, que
  não existe neste projeto (o real é `agente-advocacia_agent_db`) — imprime
  "Banco resetado" sem resetar nada.
