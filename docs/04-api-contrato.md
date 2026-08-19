# 04 — Contrato da API: a fronteira agente ↔ CRM

Tudo que o CRM sabe sobre o atendimento passa por `agent/api.py`. É um blueprint Flask
(`api_bp`, `agent/api.py:30`) montado em `/api`, registrado no processo do agente em
`agent/main.py:80` — não existe backend separado do CRM. O mesmo container que fala com
o WhatsApp serve o REST; o banco é um SQLite único (`agent/sessions.py:12`,
`DB_PATH=/app/data/sessions.db`, volume `agent_db` em `docker-compose.yml:58`).

Consequências diretas dessa escolha, antes de qualquer tabela:

- **CORS aberto para tudo.** `_cors` (`agent/api.py:60`) devolve
  `Access-Control-Allow-Origin: *` em toda resposta, via `after_request`
  (`agent/api.py:73`). Não há auth em rota nenhuma de `/api/*`.
- **O agente publica na 3100** (`docker-compose.yml:39`, mapeia `3100:3000`). O
  dashboard resolve isso no browser, por `VITE_API_URL` congelado no bundle
  (`docker-compose.yml:73`, `dashboard/Dockerfile:11`).
- **Telefone é JID, não número.** `_jid` (`agent/api.py:67`) acrescenta
  `@s.whatsapp.net` a quem chega sem `@`, e deixa passar intacto o que já tem — inclusive
  `@lid`, o formato novo do WhatsApp. Rotas com telefone usam `<path:phone>` justamente
  porque o JID tem caracteres que quebrariam um `<string:>`.

---

## 1. Endpoints

Todos aceitam `OPTIONS` (preflight) devolvendo `{}` com os headers de CORS. Erros seguem
sempre a forma `{"error": "<texto em português>"}` com o status HTTP indicado.

### `GET /api/stats`

`agent/api.py:78` → `sessions.get_stats()` (`agent/sessions.py:681`).

Sem parâmetros. Resposta:

```json
{
  "funnel": {"novo": 7, "qualificado": 4, "consulta_agendada": 5, "cliente": 2, "perdido": 4},
  "leads_total": 22,
  "leads_qualified": 11,
  "appointments_total": 9,
  "appointments_pending": 2,
  "appointments_confirmed": 5,
  "escalations_total": 6
}
```

`leads_total` conta a união de `lead_data ∪ sessions ∪ lead_status`
(`agent/sessions.py:685-691`) — quem mandou uma mensagem e sumiu conta igual. `funnel` vem
de `get_funnel_counts()` (`agent/sessions.py:426`), que reprocessa `get_all_leads` inteiro
em memória.

Consumo: **só** `dashboard/src/pages/Metrics.tsx:53`. As outras telas contam em cima da
lista de leads, não daqui. `conversion_rate` **não existe no JSON** — é derivado no
cliente em `dashboard/src/lib/api.ts:163-166`, ainda que a interface `Stats`
(`dashboard/src/lib/api.ts:13`) o declare como campo.

Erros: nenhum tratado. Exceção de SQL vira 500 do Flask.

### `GET /api/leads`

`agent/api.py:85` → `sessions.get_all_leads()` (`agent/sessions.py:344`).

| Param | Tipo | Padrão |
|---|---|---|
| `limit` | int | 50 |
| `offset` | int | 0 |
| `status` | um de `LEAD_STATUSES` | — |

```json
{
  "leads": [
    {
      "phone": "5511912345001@s.whatsapp.net",
      "nome": "Camila Rodrigues",
      "area_juridica": "Direito Trabalhista",
      "resumo_caso": "Demitida sem justa causa, verbas não pagas",
      "urgencia": "alta",
      "origem": "Google",
      "qualified": true,
      "status": "cliente",
      "motivo_perda": "",
      "motivo_perda_detalhe": "",
      "created_at": "2026-08-06T13:00:00+00:00",
      "last_contact": "2026-08-06T13:20:00+00:00"
    }
  ],
  "count": 1
}
```

O objeto é `**data` espalhado (`agent/sessions.py:392`): **qualquer** chave gravada em
`lead_data` aparece no topo do lead, não só os `lead_fields` do tenant. É por isso que o
`status` interno do agente (`fora_de_escopo`) pode aparecer sobrescrito logo abaixo pelo
status do funil — a chave calculada vence porque vem depois no dicionário.

Erros: `400` se `status` não estiver em `LEAD_STATUSES` (`agent/api.py:92`). `limit`/`offset`
não numéricos estouram `ValueError` → 500.

Consumo (é o endpoint mais carregado do CRM, sempre com `limit: 500`):
`Sidebar.tsx:88`, `Overview.tsx:88`, `Pipeline.tsx:103`, `Triagem.tsx:179`,
`Conversations.tsx:118`, `Contacts.tsx:143`, `FollowUp.tsx:157`, `Metrics.tsx:54`.

### `PUT /api/leads/<phone>/status`

`agent/api.py:105` → `set_lead_status` / `clear_lead_status`
(`agent/sessions.py:302` e `:322`).

Body: `{"status": "...", "motivo_perda": "..."}`. `status` aceita os cinco de
`LEAD_STATUSES` mais o valor especial `"auto"`, que **apaga** a linha de `lead_status` e
devolve o lead ao status derivado da conversa. `motivo_perda` é obrigatório — e só
aceito — quando `status == "perdido"`; nos demais casos é zerado (`agent/api.py:124`).

```json
{"ok": true, "status": "perdido", "motivo_perda": "sem_resposta"}
```

Erros: `400` com a lista de valores aceitos, para status inválido (`agent/api.py:119`) ou
motivo inválido (`agent/api.py:122`).

O enum `MOTIVOS_PERDA` vive em `agent/api.py:99` — **não** em `sessions.py`. O espelho no
front é `MOTIVO_PERDA_LABELS` (`dashboard/src/lib/api.ts:29`). São duas listas que
precisam ser mudadas juntas, sem nada as amarrando.

Consumo: `Pipeline.tsx:122` (drag entre colunas) e `FollowUp.tsx:187` (botões de "virou
cliente" / "encerrar como perdido").

### `GET /api/appointments`

`agent/api.py:130` → `get_all_appointments()` (`agent/sessions.py:497`), normalizado por
`_map_apt` (`agent/api.py:43`).

Params: `status`, `date_from`, `date_to` (comparados como string contra `slot_start`),
`limit` (50), `offset` (0).

```json
{
  "appointments": [
    {
      "id": 3,
      "phone": "5511912345004@s.whatsapp.net",
      "nome": "Juliana Oliveira",
      "procedure": "Consulta inicial",
      "datetime": "2026-08-21T14:00:00-03:00",
      "slot_end": "2026-08-21T15:00:00-03:00",
      "new_slot_start": null,
      "new_slot_end": null,
      "status": "pending",
      "notes": "",
      "created_at": "2026-08-18T11:02:31.000000+00:00"
    }
  ],
  "count": 1
}
```

`_map_apt` é a camada que esconde os nomes de coluna herdados da engine de estética:
`patient_name → nome`, `procedure_type → procedure`, `slot_start → datetime`. As colunas
no SQLite continuam com os nomes antigos (`agent/sessions.py:94-108`) — quem consultar o
banco direto (MCP, seção 5) vê `patient_name`, não `nome`.

Consumo: `Sidebar.tsx:89`, `Overview.tsx:89`, `Appointments.tsx:238`, `Metrics.tsx:55`.

### `POST /api/appointments`

`agent/api.py:147` → `create_appointment` (`agent/sessions.py:440`), seguido de
`update_appointment(status="confirmed")` quando o body pede.

Body: `phone`, `nome`, `procedure`, `slot_start` obrigatórios; `slot_end` (default:
`slot_start + 1h`, `agent/api.py:160-166`), `notes`, `status` (`"confirmed"` por padrão).

`201 {"id": 12, "ok": true}` · `400` com "Campos obrigatórios: phone, nome, procedure,
slot_start".

Este é o **único** endpoint que cria consulta a partir do CRM. Repare no que ele **não**
faz: não cria evento no Google Calendar (`gcal.confirm_event` só é chamado no `/confirm`,
`agent/api.py:207`) e não avisa a pessoa no WhatsApp. É registro manual de algo combinado
fora do canal — o modal diz isso explicitamente
(`dashboard/src/pages/Appointments.tsx:97`).

Consumo: `Appointments.tsx:243`, pelo modal "Marcar consulta".

### `POST /api/appointments/<id>/confirm`

`agent/api.py:193`. É o endpoint com mais efeito colateral de todo o contrato, e o único
que muda de comportamento conforme o status atual:

| Status de entrada | Efeito | Resposta |
|---|---|---|
| `pending` | `gcal.confirm_event` + status → `confirmed` + WhatsApp de confirmação | `{"ok": true, "status": "confirmed"}` |
| `reschedule_requested` | `gcal.confirm_event_with_new_slot`, `slot_start/end` recebem o novo horário, `new_slot_*` zerados, WhatsApp de remarcação | `{"ok": true, "status": "confirmed"}` |
| `cancel_requested` | `gcal.delete_event` + status → `cancelled` + WhatsApp de cancelamento | `{"ok": true, "status": "cancelled"}` |
| qualquer outro | nada | `400 "Status 'X' não permite confirmação"` |

Erros: `404` se o id não existir; `400` se `reschedule_requested` estiver sem
`new_slot_start` (`agent/api.py:223`).

O texto enviado ao cliente está embutido em `agent/api.py:211-216`, `:238-242` e
`:250-252`. **Divergência com o CLAUDE.md:** as duas primeiras mensagens levam dois emojis
cada (`⚖️` e `🕐`), contra a regra de "no máximo um por conversa, e na dúvida nenhum".

Consumo: `Appointments.tsx:283`, tanto na faixa de pendências quanto no painel lateral.

### `POST /api/appointments/<id>/reject`

`agent/api.py:258`. Body opcional `{"reason": "..."}` — o motivo entra no texto enviado
ao cliente, então é visível para ele.

| Status de entrada | Efeito | Resposta |
|---|---|---|
| `pending` | `gcal.delete_event` + status → `rejected` + WhatsApp "não conseguimos confirmar" | `{"ok": true, "status": "rejected"}` |
| `reschedule_requested` | status volta a `confirmed`, `new_slot_*` zerados, WhatsApp "não conseguimos remarcar" | `{"ok": true, "status": "rejected"}` — o campo mente, o registro ficou `confirmed` |
| `cancel_requested` | status volta a `confirmed`, WhatsApp "seu agendamento continua confirmado" | `{"ok": true, "status": "confirmed"}` |
| outro | nada | `400` |

O `"status": "rejected"` devolvido no caso de remarcação recusada (`agent/api.py:287`) é
incorreto. Não causa dano visível porque `Appointments.tsx:286` só usa o retorno para um
ajuste otimista e chama `refetch()` na linha anterior, mas quem consumir a API fora do
dashboard vai ler errado.

Consumo: `Appointments.tsx:284`.

### `POST /api/appointments/<id>/reschedule`

`agent/api.py:302`. Body `{"new_slot_start": "...", "new_slot_end": "..."}` — o `end` é
inferido como `+1h` quando ausente. Marca `status = reschedule_requested` e grava os
campos `new_slot_*`. Não chama o Google Calendar nem o WhatsApp: é só um pedido pendente,
que o `/confirm` depois materializa.

`{"ok": true, "status": "reschedule_requested"}` · `404` id inexistente · `400`
`new_slot_start` ausente.

**Sem consumidor.** `api.rescheduleAppointment` existe em
`dashboard/src/lib/api.ts:206` e nenhuma tela chama. O caminho real de remarcação hoje é
o cliente pedindo no WhatsApp (seção 3).

### `POST /api/appointments/<id>/cancel`

`agent/api.py:335`. Body opcional `{"reason": "..."}`, que é **anexado ao campo `notes`**
(`agent/api.py:347-349`) e por isso fica visível no painel de detalhe da Agenda. Marca
`cancel_requested`; quem efetiva é o `/confirm`.

`{"ok": true, "status": "cancel_requested"}` · `404`.

**Sem consumidor** — mesma situação do `/reschedule` (`dashboard/src/lib/api.ts:212`).

### `GET /api/conversations`

`agent/api.py:176` → `get_recent_conversations()` (`agent/sessions.py:209`). Param `limit`
(50).

```json
{
  "conversations": [
    {
      "phone": "5511912345014@s.whatsapp.net",
      "nome": "Daniel Nunes",
      "last_message": "Entendo. Vou registrar seu caso para um advogado assumir.",
      "last_role": "assistant",
      "last_ts": "2026-08-16T18:41:02+00:00",
      "escalated": true
    }
  ]
}
```

Não devolve `count`, ao contrário de `/leads` e `/appointments`. `escalated` é um
`EXISTS` sobre `escalations` (`agent/sessions.py:217`) — uma vez escalado, para sempre
escalado; não há "resolvido".

Consumo: `Conversations.tsx:117`.

### `GET /api/conversations/<phone>`

`agent/api.py:184` → `get_conversation_for_dashboard()` (`agent/sessions.py:193`).

```json
{
  "phone": "5511912345001@s.whatsapp.net",
  "messages": [
    {"role": "user", "content": "oi, fui demitida sem justa causa", "timestamp": "2026-08-06T13:00:00+00:00"},
    {"role": "assistant", "content": "Entendo. Vamos te ajudar com isso.", "timestamp": "2026-08-06T13:00:00.001000+00:00"}
  ]
}
```

Diferente de `get_history` (`agent/sessions.py:177`), que o loop do Claude usa: aqui não
há corte por TTL de 30 min nem limite de 10 turnos. O CRM vê a conversa inteira desde
sempre; o agente vê só a janela viva.

Consumo: `Conversations.tsx:134` — fora do `useFetch`, num `useEffect` disparado pela
seleção de contato, portanto **sem polling**: o chat aberto não se atualiza sozinho.

### `GET /api/escalations`

`agent/api.py:355` → `get_recent_escalations()` (`agent/sessions.py:548`). Param `limit` (50).

```json
{
  "escalations": [
    {
      "id": 4,
      "phone": "5511912345014@s.whatsapp.net",
      "nome": "Daniel Nunes",
      "reason": "familiar preso em flagrante, pergunta sobre audiência de custódia",
      "category": "urgencia_prazo",
      "created_at": "2026-08-16T18:41:02+00:00"
    }
  ],
  "count": 1
}
```

`category` espelha `ESCALATION_CATEGORIES` de `verticals/advocacia/tools.py`; o front
redeclara o mesmo enum em `dashboard/src/lib/api.ts:138` e em
`dashboard/src/pages/Triagem.tsx:25`, com um `FALLBACK` (`Triagem.tsx:61`) para categoria
desconhecida — que é a única proteção contra as três listas divergirem.

`get_recent_escalations` tenta um `ALTER TABLE ... ADD COLUMN category` a cada chamada e
engole a exceção (`agent/sessions.py:550-554`). É migração por tentativa e erro, repetida
em `log_escalation` (`agent/sessions.py:574`).

Consumo: `Sidebar.tsx:87`, `Overview.tsx:90`, `Triagem.tsx:178`, `Metrics.tsx:56` — todos
com `limit=100`.

### `GET|POST /api/services` · `PUT|DELETE /api/services/<id>`

`agent/api.py:375` e `:392` → CRUD em `sessions.get_all_services` e afins
(`agent/sessions.py:591-628`). O objeto tem `category`, `name`, `duration`, `price`,
`active`.

"Service" aqui é a nomenclatura da engine de estética. Na vertical jurídica a tabela
guarda duas categorias (`agent/sessions.py:41-52`): `"Consultas"` e `"Áreas de atuação"`.
`price` é sempre `0.0` por decisão de produto — honorários não entram no CRM
(Provimento 205/2021, comentado em `agent/sessions.py:39`). A coluna existe e o POST a
aceita, então **nada impede** alguém gravar valor ali pela API.

Consumo: só o `GET`. `Appointments.tsx:61` (preenche o `datalist` do modal) e
`Configuracoes.tsx:22` (chips de áreas de atuação, filtrando
`category === 'Áreas de atuação'`, `Configuracoes.tsx:60`). Os três verbos de escrita
existem em `dashboard/src/lib/api.ts:236-249` e **nenhuma tela os chama** — a tela de
Configurações diz por escrito que as áreas se editam em `tenants/juris.yaml`
(`Configuracoes.tsx:156`).

### `GET|POST /api/professionals` · `PUT|DELETE /api/professionals/<id>`

`agent/api.py:408` e `:428` → `agent/sessions.py:633-676`. Campos: `name`, `specialty`,
`initials`, `color`, `rating`, `appointments_count`, `services_count`, `active`.

Herança direta da engine de estética, inclusive o `rating` de 5 estrelas e o `color`
default `#7C3D6E` (roxo da clínica, `agent/api.py:420`), que não pertence à paleta do
CRM jurídico. A tabela é semeada com três advogados fictícios
(`agent/sessions.py:54-58`).

**Nenhum consumidor.** Os quatro métodos existem em `dashboard/src/lib/api.ts:252-268` e
nenhuma página os importa. É superfície de API viva, sem tela e sem uso.

### `GET|PUT /api/config`

`agent/api.py:445`. O `GET` projeta sete campos do tenant carregado
(`agent/api.py:451-459`): `name`, `segment`, `address`, `phone`, `hours`, `timezone`,
`agent_name`.

O `PUT` é o único endpoint que **escreve fora do banco**: reabre o YAML apontado por
`TENANT_CONFIG`, mescla os campos recebidos em `business.*` (e `agent.name`), reescreve o
arquivo e zera o singleton `_config` para forçar reload (`agent/api.py:461-476`).

`{"ok": true}` · `500 "TENANT_CONFIG não configurado"` se a env estiver ausente.

Duas coisas a saber antes de usar isso em produção: o arquivo é regravado por
`yaml.dump`, o que **descarta todos os comentários** do `tenants/juris.yaml`; e o compose
monta `./tenants` como `:ro` (`docker-compose.yml:53`), então dentro do container o `PUT`
falha com erro de escrita. Ou seja: a tela de Configurações salva no dev e quebra no
compose.

Consumo do `GET`: `Sidebar.tsx:86`, `Overview.tsx:91`, `Conversations.tsx:119`,
`Configuracoes.tsx:21`. Nas três primeiras o intervalo de polling é elevado para 300 s.
`PUT`: `Configuracoes.tsx:31`.

### `POST /api/query`

`agent/api.py:505`. Detalhado na seção 5.

### `POST /api/test/message` · `POST /api/test/reset`

`agent/api.py:536` e `:557`. Existem para os golden tests. Ambos devolvem
`403` quando `FLASK_ENV == "production"` — é a **única** verificação de ambiente em todo o
`api.py`, e ela não protege nenhum dos outros endpoints.

`/test/message` recebe `{phone, text, history}` e chama `agent_core.run_test_message`,
que roda o loop do Claude sem enviar nada pelo WhatsApp. `/test/reset` recebe `{phone}` e
chama `sessions.reset_lead` (`agent/sessions.py:412`), que apaga as linhas daquele
telefone em `sessions`, `lead_data`, `lead_status`, `appointments` e `escalations`:

```json
{"ok": true, "phone": "5511999999999@s.whatsapp.net",
 "deleted": {"sessions": 6, "lead_data": 4, "lead_status": 0, "appointments": 1, "escalations": 0}}
```

Nenhum dos dois é chamado pelo dashboard.

---

## 2. O que o agente escreve e o CRM lê

Este é o sentido bem coberto. Tudo passa por funções de `sessions.py` chamadas pelo
`agent_core.py` ou pelo `verticals/advocacia/tools.py`.

**Lead (`lead_data`).** A tool `save_lead_field` grava um par chave/valor por campo
(`verticals/advocacia/tools.py:305` → `sessions.save_lead_field`, `agent/sessions.py:270`).
Os campos válidos vêm de `vertical_config.lead_fields` no tenant: `nome`, `area_juridica`,
`resumo_caso`, `urgencia`, `origem`. `mark_lead_complete`
(`verticals/advocacia/tools.py:311`) não grava nada — só confere `is_lead_qualified` e
dispara a notificação interna. O CRM lê isso por `GET /api/leads`, e o campo `qualified`
(`agent/sessions.py:381`) é recalculado a cada request comparando as chaves gravadas com
os `lead_fields` do tenant. **Mudar `lead_fields` no YAML reclassifica leads antigos
retroativamente.**

**Encerramento por fora de escopo.** `marcar_fora_de_escopo`
(`verticals/advocacia/tools.py:334-336`) grava três chaves em `lead_data`: `status =
fora_de_escopo`, `motivo_perda` (texto livre) e `area_juridica`. Como `lead_data` é KV,
isso não exigiu migração. O funil traduz esse par via `_AGENT_STATUS`
(`agent/sessions.py:295`) para `("perdido", "fora_area_atuacao")`, e o texto livre sai no
campo separado `motivo_perda_detalhe` (`agent/sessions.py:399`), renderizado no card do
funil (`Pipeline.tsx:87`) e na linha expandida de Clientes (`Contacts.tsx:105`).

**Conversa (`sessions`).** `save_turn` (`agent/sessions.py:238`) grava par
user/assistant a cada turno, com o assistente recebendo `ts + 0.001` para garantir a
ordem. O CRM lê por `/api/conversations` e `/api/conversations/<phone>`. Note que o
`created_at` do lead é o `MIN(ts)` dessa tabela e o `last_contact` é o `MAX(ts)`
(`agent/sessions.py:357-362`) — um lead que nunca conversou (criado só por
`lead_status`) tem ambos `null`, e some da fila de follow-up por causa do guard em
`dashboard/src/lib/api.ts:69`.

**Consulta (`appointments`).** `create_pending_appointment`
(`verticals/advocacia/tools.py:381`) insere com status `pending` e depois grava o
`external_id` do evento de calendário (`:385`). Um efeito colateral escondido em
`sessions.create_appointment` (`agent/sessions.py:457`): a linha de `lead_status` é
apagada se estiver marcada `perdido` — quem foi dado como perdido e volta a agendar não
continua perdido no funil. É a única escrita em `lead_status` que não vem de um clique
humano.

**Escalação (`escalations`).** `log_escalation` (`agent/sessions.py:572`) é chamado do
`agent_core.py:384` e `:431`, gravando `reason` (os primeiros 200 caracteres da mensagem
do cliente) e `category`. Alimenta `/api/escalations` → tela de Triagem. Não há campo de
"atendida": a lista só cresce, e o contador da Sidebar (`Sidebar.tsx:92`) conta tudo que
existe.

**Follow-up.** Não é escrito por ninguém. É inteiramente derivado no front por
`followUpBucket` (`dashboard/src/lib/api.ts:65`) a partir de `status`, `motivo_perda` e
`last_contact`. Não existe tabela, endpoint nem coluna de follow-up no backend.

---

## 3. O que o CRM escreve e o agente lê

Este sentido é mais estreito do que parece, e vale traçar cada caminho.

**Existe: status do funil.** `PUT /api/leads/<phone>/status` → `lead_status`. Mas
**nenhum código do agente lê essa tabela.** `get_lead_status` (`agent/sessions.py:330`)
existe e não é importado por `agent_core.py` nem por `tools.py` — só `api.py` a alcança
indiretamente. Marcar um lead como `cliente` ou `perdido` no CRM não muda uma vírgula do
que o agente responde no próximo "oi" daquela pessoa. É registro comercial, não estado de
conversa.

**Existe: decisão sobre consulta.** É o único fluxo de mão dupla completo, e ele fecha o
ciclo por **duas** vias distintas:

1. Pelo WhatsApp, imediatamente: `confirm`/`reject` chamam `evolution.send_message`
   diretamente (`agent/api.py:209`, `:236`, `:248`, `:286`, `:291`). O texto sai do
   `api.py`, não passa pelo Claude, e não é gravado em `sessions` — ou seja, **a mensagem
   que o cliente recebe não aparece no histórico do CRM nem no contexto do agente**. Na
   próxima mensagem dele, o Claude não sabe que essa confirmação foi enviada.
2. Pelo contexto do agente, na conversa seguinte: `_build_appointments_context`
   (`agent/agent_core.py:187`) chama `get_patient_appointments` e injeta no system prompt
   o bloco `[CONSULTAS AGENDADAS]` com id, tipo, horário e **status atual**
   (`agent/agent_core.py:193`). É por aqui que a decisão do escritório efetivamente chega
   ao agente: ele passa a ver `confirmed` onde antes via `pending`.

O caminho inverso (cliente pede remarcação/cancelamento no WhatsApp) usa as tools
`reschedule_appointment` (`verticals/advocacia/tools.py:413`) e `cancel_appointment`
(`:434`), que gravam `reschedule_requested` / `cancel_requested` e disparam
`notify_reschedule_pending` / `notify_cancel_pending`. O CRM vê isso na faixa de
pendências da Agenda e resolve com `/confirm` ou `/reject`.

**Existe: configuração do tenant.** `PUT /api/config` reescreve o YAML e zera
`_config._config`. O agente lê `get_config()` na montagem de todo system prompt, então
mudar `agent_name` ou `hours` no CRM altera o comportamento do agente na mensagem
seguinte — dentro das ressalvas de `:ro` já descritas.

**Existe: agendamento manual.** `POST /api/appointments` insere na mesma tabela que a
tool do agente usa, então a consulta criada à mão aparece no bloco
`[CONSULTAS AGENDADAS]` do prompt igual às outras.

**Não existe: responder pelo CRM.** Não há endpoint de envio de mensagem. Onde o
dashboard oferece "Assumir" ou "WhatsApp", o link é um `wa.me` externo
(`Triagem.tsx:68`, `Conversations.tsx:313`, `FollowUp.tsx:43`, `Contacts.tsx:117`,
`Appointments.tsx:528`) — abre o WhatsApp Web do advogado, fora do sistema. O comentário
em `FollowUp.tsx:39-42` explica por que o link vai sem texto pré-montado: mensagem
sugerida seria captação, vedada pelo Provimento 205/2021.

**Não existe: pausar o agente numa conversa.** Escalar marca a conversa como `escalated`
e a Triagem a lista, mas o agente continua respondendo normalmente aquele telefone. Não
há flag de "humano assumiu" em lugar nenhum do schema.

**Não existe: resolver ou arquivar uma escalação.** Sem `UPDATE`, sem `DELETE`, sem
coluna de estado.

**Não existe: apagar lead ou conversa.** `reset_lead` só é alcançável por
`/api/test/reset`, bloqueado em produção, e o próprio docstring
(`agent/sessions.py:413-414`) diz para não usar fora de teste.

---

## 4. Ownership: como evoluir `sessions.py` sem quebrar o agente

O `CLAUDE.md` define `agent/sessions.py` como a fronteira: o terminal do CRM é dono do
schema e das funções de acesso; o terminal do Agente apenas consome. Na prática o
acoplamento é o seguinte, e é ele que dita o que é seguro mudar:

O agente importa de `sessions.py` em dois pontos, e só estes:

- `agent/agent_core.py:24-30` — `get_history`, `save_turn`, `get_lead_data`,
  `get_patient_appointments`, `log_escalation`, mais o cache de slots oferecidos.
- `verticals/advocacia/tools.py:17-20` — `save_lead_field`, `is_lead_qualified`,
  `get_lead_data`, `create_appointment`, `update_appointment`, `get_appointment`,
  `get_patient_appointments`.

Regras que caem disso:

1. **Coluna nova com `DEFAULT` é seguro.** O `CREATE TABLE IF NOT EXISTS` em `_get_conn`
   (`agent/sessions.py:63`) não altera tabela existente, então coluna nova em banco já
   criado exige `ALTER TABLE`. O padrão da casa para isso é o `try/except` de
   `get_recent_escalations` (`agent/sessions.py:550`) — feio, mas é o que existe; não
   invente um sistema de migração para uma coluna.
2. **Tabela nova é sempre seguro**, desde que criada no mesmo `_get_conn` — todo caminho
   de acesso passa por ele.
3. **Mudar assinatura das sete funções acima quebra o agente em runtime**, sem erro de
   tipo que o pegue antes. É exatamente o caso que o `CLAUDE.md` manda avisar ao terminal
   do Agente **antes** de aplicar. `update_appointment(**fields)` é o mais frágil: aceita
   qualquer kwarg e o injeta cru no `SET` (`agent/sessions.py:488`), então renomear uma
   coluna de `appointments` falha silenciosamente até o `sqlite3.OperationalError` na
   chamada.
4. **Renomear coluna de `appointments` custa três lugares**, não um: a coluna,
   `_map_apt` (`agent/api.py:43`) e a interface `Appointment`
   (`dashboard/src/lib/api.ts:77`). Preferir manter os nomes legados no banco e traduzir
   no `_map_apt` — que é o que já se faz com `patient_name`/`procedure_type`.
5. **Campo novo de lead não passa por schema.** `lead_data` é KV: basta acrescentar a
   chave em `vertical_config.lead_fields` no tenant e a tool `save_lead_field` já a aceita
   (`verticals/advocacia/tools.py:296`). O custo escondido é o item já citado —
   `qualified` recalcula sobre a base inteira, e leads antigos passam a contar como
   incompletos.
6. **Enums vivem em três arquivos e nada os sincroniza.** `LEAD_STATUSES`
   (`agent/sessions.py:287`), `MOTIVOS_PERDA` (`agent/api.py:99`) e
   `ESCALATION_CATEGORIES` (`verticals/advocacia/tools.py`) têm cópias em TypeScript em
   `dashboard/src/lib/api.ts:23`, `:29`, `:138` e em `dashboard/src/pages/Triagem.tsx:25`.
   Mudar um enum é uma tarefa de dois terminais.

---

## 5. `/api/query` e o MCP — e o bloqueador de deploy

### O que faz

`POST /api/query` (`agent/api.py:505`) recebe `{"sql": "...", "limit": 200}` e devolve
resultado tabular:

```json
{
  "columns": ["status", "n"],
  "rows": [["novo", 7], ["qualificado", 4]],
  "truncated": false
}
```

Três defesas, todas em `agent/api.py`:

- `_guard_select` (`:491`) remove comentários, recusa `;` embutido e exige que a
  instrução comece com `SELECT` ou `WITH`.
- A conexão abre em `file:{DB_PATH}?mode=ro` (`:517`) — quem recusa escrita é o SQLite,
  não a regex. Essa é a defesa que importa.
- `set_progress_handler` com deadline de 5 s (`:518-519`) e teto de 1000 linhas (`:485`).

Erro de SQL vira `400 {"error": "sqlite: ..."}`; SQL recusado pelo guard vira `400` com o
motivo em português.

### Como é usado

`tools/juris_mcp.py` é um servidor MCP stdio de 126 linhas, sem SDK: fala JSON-RPC
direto no stdin/stdout e implementa `initialize`, `tools/list` e `tools/call`
(`tools/juris_mcp.py:74-103`). Expõe duas tools ao Claude:

- `juris_schema` — roda um `SELECT name, sql FROM sqlite_master` fixo
  (`tools/juris_mcp.py:20`) para o modelo descobrir as tabelas antes da primeira consulta.
- `juris_query` — repassa o SQL do modelo para `POST /api/query`
  (`tools/juris_mcp.py:53`), com timeout de 30 s.

O registro está em `.mcp.json`, na raiz: `python3 tools/juris_mcp.py`, sem env. O
endereço do agente vem de `JURIS_API_URL`, default `http://localhost:3100`
(`tools/juris_mcp.py:18`) — a porta publicada, não a interna. Erro de conexão volta como
texto legível sugerindo `make up` (`tools/juris_mcp.py:71`), e toda exceção vira resposta
JSON-RPC em vez de derrubar o loop (`tools/juris_mcp.py:119`).

Quem consultar por aqui vê o schema cru: `patient_name`, `procedure_type`, `slot_start` —
não os nomes traduzidos pelo `_map_apt`.

### Nota de segurança — bloqueador de deploy

`/api/query` executa SQL arbitrário de leitura, **sem autenticação nenhuma**, com CORS
`*`, sobre um banco onde a tabela `sessions` guarda o texto integral de todas as conversas
entre clientes e o escritório. Isso não é "dado de CRM": é relato de demissão, de
separação, de prisão em flagrante. Sigilo profissional do advogado.

O agravante é que o problema não é só do `/api/query` — **nenhuma** rota de `/api/*` tem
auth. `/api/conversations/<phone>` já devolve o histórico completo de qualquer telefone
para quem souber o número. O `/query` apenas dispensa saber o número.

Em `localhost:3100` numa máquina de dev, tudo bem. No momento em que o compose subir num
host com a 3100 alcançável pela rede, é leitura irrestrita do banco inteiro.

Duas correções possíveis, ambas suficientes sozinhas:

- **Token no header.** Um `before_request` no `api_bp` comparando um header
  (`X-API-Token`) com uma env, com `OPTIONS` liberado para não quebrar o preflight.
  Exige propagar o token para `dashboard/src/lib/api.ts:6` e para
  `tools/juris_mcp.py:60`. Mais trabalho, mas é o que permite expor o CRM.
- **Bind em `127.0.0.1`.** Trocar a publicação da porta no compose
  (`docker-compose.yml:39`) para `127.0.0.1:3100:3000`. Uma linha, resolve o vazamento
  pela rede — mas mata o acesso ao CRM de fora da máquina, então só serve se o dashboard
  também for local.

Resolver **antes** de qualquer publicação. Está registrado como pendência no
`CLAUDE.md`.

---

## 6. Não há WebSocket: polling de 30 s

Todo dado do CRM chega por `useFetch` (`dashboard/src/hooks/useFetch.ts:9`), que dispara o
fetcher no mount e depois a cada `intervalMs`, default `30_000`
(`dashboard/src/hooks/useFetch.ts:11`, `:32`). Não existe socket, SSE ou long-poll em
lugar nenhum do projeto.

O que isso implica, na ordem em que morde:

- **Latência de até 30 s em tudo que o agente escreve.** Consulta agendada às 14:00:03
  aparece na Agenda em algum momento até 14:00:33. Aceitável para triagem; ruim para
  "menção a prazo", que é o alarme que a Triagem trata como crítico
  (`Triagem.tsx:226-252`).
- **Mutações compensam com `refetch()` manual.** Toda ação de escrita chama o `refetch`
  devolvido pelo hook logo depois do `await`: `Pipeline.tsx:123`, `FollowUp.tsx:188`,
  `Appointments.tsx:252` e `:285`. Sem isso, o usuário veria seu próprio clique só no
  ciclo seguinte. `Appointments.tsx:286` ainda aplica um ajuste otimista no painel
  lateral, porque o painel não é remontado pelo refetch.
- **Cada tela multiplica requests.** `Overview` mantém quatro `useFetch`
  (`Overview.tsx:88-91`) e a `Sidebar` outros quatro (`Sidebar.tsx:86-89`), sempre
  montada. Numa aba aberta em `/`, são ~7 requests a cada 30 s (o `getConfig` das duas
  usa 300 s), várias delas o mesmo `GET /api/leads?limit=500`. Não há cache
  compartilhado entre hooks — cada `useFetch` busca por conta própria.
- **O chat aberto não atualiza.** `Conversations.tsx:130-138` carrega as mensagens num
  `useEffect` sobre `selectedPhone`, fora do `useFetch`. Mensagem nova chegando naquela
  conversa não aparece até trocar de contato e voltar. A lista lateral, essa sim, tem os
  30 s — e o rodapé anuncia isso ao usuário (`Conversations.tsx:277`).
- **Sem revalidação por foco.** Aba deixada aberta a noite toda mostra dados de até 30 s
  atrás ao voltar, o que está certo, mas nada acelera o primeiro fetch pós-retorno.

O contador de "atualizado há Xs" que aparece nas telas é o `RefreshBar`
(`dashboard/src/components/RefreshBar.tsx:10`), alimentado pelo `lastUpdated` do hook e
com um `setInterval` próprio de 5 s só para o texto.

---

## Limitações conhecidas

- Nenhuma rota de `/api/*` tem autenticação, autorização ou rate limit. Ver seção 5.
- Não há como responder ao cliente pelo CRM, nem pausar o agente numa conversa que um
  advogado assumiu, nem marcar uma escalação como resolvida.
- `lead_status` é escrito pelo CRM e lido por ninguém do lado do agente.
- `/api/appointments/<id>/reschedule` e `/cancel` não têm consumidor no dashboard; o CRUD
  de `services` (escrita) e todo o de `professionals` também não.
- `/api/appointments/<id>/reject` devolve `"status": "rejected"` quando o registro ficou
  `confirmed` (`agent/api.py:287`).
- As mensagens disparadas por `/confirm` e `/reject` não são gravadas em `sessions`: nem
  o CRM nem o agente sabem depois que foram enviadas.
- `PUT /api/config` reescreve `tenants/juris.yaml` por `yaml.dump`, perdendo os
  comentários, e falha dentro do container porque o volume é `:ro`
  (`docker-compose.yml:53`).
- `get_all_leads` e `get_funnel_counts` carregam a base inteira em memória e ordenam em
  Python (`agent/sessions.py:404-406`, marcado com `ponytail:` no próprio código).
  `get_lead_status` (`:330`) chega a varrer `get_all_leads(limit=1_000_000)` para achar um
  telefone.
- Migração de schema é `ALTER TABLE` dentro de `try/except` repetido a cada chamada
  (`agent/sessions.py:550`, `:574`).
- Os enums do funil, de motivos de perda e de categorias de escalação estão duplicados
  entre Python e TypeScript sem geração nem teste que os compare.
