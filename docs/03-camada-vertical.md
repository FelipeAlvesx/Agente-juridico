# 03 — Camada vertical

Documenta o que existe hoje em `verticals/advocacia/`, `tenants/`, `prompts/base/`,
`knowledge/` e `tests/golden/`. Descreve o código como ele está, não como deveria estar;
onde o código diverge do `CLAUDE.md`, a divergência está marcada.

---

## 1. O que é uma "vertical" neste projeto

Não há registry, plugin system nem classe base. Uma vertical é um **nome de string** —
`config.vertical`, lido de `tenants/*.yaml` (`config.py:112`) — usado em três `import_module`
dinâmicos e em um caminho de arquivo:

| Onde | Código | O que carrega |
|---|---|---|
| Tools do Claude | `agent_core.py:107` | `verticals.{vertical}.tools` |
| Comandos da recepcionista | `main.py:197` | `verticals.{vertical}.receptionist` |
| Fragmento de prompt | `prompt_builder.py:43` | `verticals/{vertical}/prompt_fragment.md` |

`verticals/__init__.py` e `verticals/advocacia/__init__.py` são **arquivos vazios** (0 linhas).
Não existe nenhuma declaração formal de qual vertical existe: `tenants/schema.yaml:7` documenta
um enum `advocacia | clinic | generic`, mas nada no código valida contra ele, e só
`verticals/advocacia/` existe no disco. Apontar `vertical: clinic` no tenant sobe o processo e
quebra em `ModuleNotFoundError` no primeiro import.

### Fronteira exata engine × vertical

**Engine (`agent/`) — nunca sabe que é jurídico:**

- `agent_core.py` — loop Claude (máx. 5 iterações, `agent_core.py:283`), montagem de contexto
  (`[DADOS JÁ COLETADOS]`, `[CONSULTAS AGENDADAS]`, `[HORÁRIOS JÁ OFERECIDOS]`,
  `[CONTEXTO TEMPORAL]`), flag de escalação em memória, split de balões por `---`.
- `sessions.py` — SQLite. Fronteira de dados; a vertical só chama funções, nunca escreve SQL.
- `gcal.py` — agenda. Genérico: fala em `procedure_type` e `patient_name`, sem vocabulário
  de nicho.
- `config.py` / `prompt_builder.py` / `rag.py` / `evolution.py` / `main.py` / `api.py`.

**Vertical (o que muda de nicho para nicho):**

| Arquivo | Obrigatório? | Contrato que cumpre |
|---|---|---|
| `verticals/<v>/__init__.py` | sim (pode ser vazio) | torna o pacote importável |
| `verticals/<v>/tools.py` | **sim** | expõe `get_tool_definitions(config) -> list` e `execute_tool(fn, args, context) -> dict`; opcionalmente `ESCALATION_MESSAGES: dict` e `ESCALATION_MESSAGE_DEFAULT: str`, lidos via `getattr` em `agent_core.py:111-115` (se ausentes, cai num texto genérico hardcoded na engine, com emoji 🙏) |
| `verticals/<v>/prompt_fragment.md` | **sim** | lido sem `try` em `prompt_builder.py:43` — ausência derruba o boot |
| `verticals/<v>/receptionist.py` | não | expõe `handle_receptionist_command(text) -> bool`; `main.py:198` engole `ModuleNotFoundError` e segue sem ele |
| `verticals/<v>/notifications.py` | não | não é importado pela engine; só por `tools.py` da própria vertical |
| `tenants/<t>.yaml` | **sim** | apontado por `TENANT_CONFIG`; define `vertical`, `lead_fields`, `procedures`, horários, persona, `agent_rules_extra` |
| `prompts/base/engine_rules.md` | **sim** | caminho fixo, `prompt_builder.py:42` |
| `prompts/base/human_persona.md` | **sim** | caminho fixo, `prompt_builder.py:41` |
| `knowledge/*.md` | não | RAG degrada para string vazia se a pasta não existir (`rag.py:22`) |
| `tests/golden/*.yaml` | não | nada no runtime lê |

Note que `prompts/base/` e `knowledge/` **não são por vertical**: os caminhos são fixos e
globais. Duas verticais no mesmo container compartilhariam a mesma persona e a mesma base RAG.
Hoje isso não incomoda porque só existe uma vertical, mas é a costura mais frágil da separação —
`engine_rules.md` está inteiramente escrito em vocabulário jurídico (ver §6).

---

## 2. Contrato de tools

Fonte da verdade: `verticals/advocacia/tools.py`. As definições são geradas em
`get_tool_definitions(config)` (`tools.py:93`) — as descrições são **interpoladas com o tenant**
(áreas de atuação, horários, quantidade de `lead_fields`), então trocar `tenants/juris.yaml`
muda o texto que o Claude vê.

O executor é `execute_tool(fn, args, context)` (`tools.py:289`). O `context` é montado pela
engine em `agent_core.py:224-231` e contém: `phone`, `phone_hash`, `was_qualified`, `config`,
`inc_leads_qualified`, `inc_appointments_created`. O retorno é serializado com `json.dumps` e
devolvido ao Claude como `tool_result` (`agent_core.py:323-327`) — ou seja, **tudo que a tool
retorna é lido pelo modelo**, inclusive as chaves `message`, que são usadas de propósito como
instrução pós-tool.

Um `fn` desconhecido cai em `tools.py:455` e devolve `{"error": "unknown tool: ..."}`.

### 2.1 `save_lead_field`

- **Assinatura:** `field: str` (enum = `config.lead_fields`), `value: str`. Ambos obrigatórios.
- **Valida** (`tools.py:296-309`): `field` tem que estar em `config.lead_fields`; `value` tem que
  ser `str` não-vazia após `strip()`. Se `field == "urgencia"`, força `lower()` e exige um valor
  de `URGENCIA_LEVELS = ("alta", "media", "baixa")` (`tools.py:35`) — `"média"` com acento é
  rejeitado.
- **Grava:** `sessions.save_lead_field(phone, field, value)` — `INSERT OR REPLACE` na tabela
  chave/valor `lead_data` (`sessions.py:270`). Re-salvar sobrescreve em silêncio.
- **Retorna:** `{"ok": True}` ou `{"error": "..."}`.
- **Efeitos colaterais:** nenhum. Não notifica ninguém.
- **Quando chamar:** assim que a pessoa informar o dado, um campo por chamada
  (`engine_rules.md:16-17`). Nunca re-salvar campo que já aparece em `[DADOS JÁ COLETADOS]`.

```json
{"field": "urgencia", "value": "alta"}
```

```json
{"field": "resumo_caso", "value": "Foi demitido sem justa causa dia 10, trabalhou 3 anos e não recebeu as verbas rescisórias."}
```

### 2.2 `mark_lead_complete`

- **Assinatura:** sem parâmetros (`input_schema` com `properties: {}`).
- **Valida** (`tools.py:311-317`): recalcula `is_lead_qualified(phone, config.lead_fields)` —
  todos os campos presentes em `lead_data`. Chamar cedo demais não grava nada, só devolve
  `qualified: false`.
- **Grava:** nada de novo. É um gatilho, não uma escrita.
- **Retorna:** `{"ok": True, "qualified": <bool>}`.
- **Efeitos colaterais:** só se `newly = not was_qualified and is_lead_qualified(...)` — incrementa
  a métrica `leads_qualified_total` e dispara `notify_lead_qualified` (WhatsApp para
  `integrations.human_phone`). `was_qualified` é fotografado **antes** do turno
  (`agent_core.py:220`), então chamar duas vezes no mesmo turno notifica duas vezes.
- **Quando chamar:** uma única vez, com os 5 campos salvos.

```json
{}
```

### 2.3 `marcar_fora_de_escopo`

Única tool que não existe na engine original.

- **Assinatura:** `area_informada: str`, `motivo: str`. Ambos obrigatórios.
- **Valida** (`tools.py:319-331`): campos não-vazios; depois `_is_served_area(area, config.procedures)`
  (`tools.py:81-90`) — match frouxo por substring nos dois sentidos, e **string com menos de 4
  caracteres é tratada como área atendida** (mantém o lead no funil). Se a área É atendida, a tool
  **recusa** e devolve um `error` que instrui o Claude a continuar a qualificação.
- **Grava** três chaves em `lead_data` via `save_lead_field`: `status = "fora_de_escopo"`,
  `motivo_perda = <motivo>`, `area_juridica = <area_informada>`.
- **Retorna:** `{"ok": true, "status": "fora_de_escopo", "message": "..."}` — a `message` instrui o
  modelo a ser honesto, não indicar outro escritório e não oferecer agendamento.
- **Efeitos colaterais:** nenhuma notificação. O acoplamento é com o CRM:
  `sessions.py:295-297` traduz `_AGENT_STATUS = {"fora_de_escopo": ("perdido", "fora_area_atuacao")}`,
  e `get_all_leads` preserva o texto livre em `motivo_perda_detalhe` (`sessions.py:398`).
  `test_triagem_horario.py:68-114` existe exatamente para travar esse contrato de chaves.
- **Quando chamar:** só com certeza da área. Na dúvida, perguntar mais ou escalar
  (`engine_rules.md:28-30`).

```json
{"area_informada": "Direito Ambiental", "motivo": "caso de Direito Ambiental, área não atendida"}
```

### 2.4 `list_available_slots`

- **Assinatura:** `date_range: str` (obrigatório), `procedure_type: str` (opcional),
  `period: "manha" | "tarde"` (opcional).
- **Valida** (`tools.py:351-354`): só que `date_range` é string não-vazia. O parse real é em
  `gcal._parse_date_range` (`gcal.py:55`); `YYYY-MM-DD` sozinho vira um intervalo de 7 dias
  (`gcal.py:59-60`), não um dia só — divergente da descrição da tool, que diz "um dia".
  `date_range` malformado volta como `{"error": "date_range inválido: ..."}`.
- **Grava:** se vierem slots, `save_offered_slots(phone, result["slots"])` — é isso que alimenta o
  bloco `[HORÁRIOS JÁ OFERECIDOS]` no turno seguinte (`agent_core.py:170-184`).
- **Retorna:** `{"slots": [{slot_start, slot_end, label}, ...]}`, no máximo 3, um por dia.
- **Efeitos colaterais:** consulta o Google Calendar. Sem credenciais ou com `DEMO_CALENDAR=true`,
  cai em `_mock_slots` (`gcal.py:134-138`) e inventa horários plausíveis — em demo o agente oferece
  horários que não existem em agenda nenhuma.
- **Duração do slot:** `_resolve_duration` (`gcal.py:45`) casa `procedure_type` contra
  `integrations.google_calendar.procedure_durations` do tenant (Consulta inicial 60min,
  Consulta online 45min), com fallback em `slot_duration_minutes`.
- **Período:** `_period_hours` (`gcal.py:63-73`) clampa contra o horário do tenant —
  manhã = `hours_start` a `min(12, hours_end)`, tarde = `max(13, hours_start)` a `hours_end`.
- **Quando chamar:** antes de citar qualquer horário, e na mesma vez em que a pessoa sinalizar dia
  ou período (`engine_rules.md:21-24`).

```json
{"date_range": "2026-08-24/2026-08-28", "procedure_type": "Consulta online", "period": "tarde"}
```

### 2.5 `create_pending_appointment`

- **Assinatura:** `patient_name`, `procedure_type`, `slot_start`, `slot_end` (todos obrigatórios,
  `str`), `notes` (opcional).
- **Valida** (`tools.py:372-374`): os quatro obrigatórios têm que ser strings não-vazias. Não valida
  formato ISO, não confere se o slot foi de fato oferecido, não checa conflito de agenda.
- **Grava:** `sessions.create_appointment(...)` com `status = 'pending'` (`sessions.py:440`).
  Se `notes` vier vazio, a tool preenche sozinha com `area_juridica — resumo_caso` do lead
  (`tools.py:375-380`) — sem isso o advogado entra na consulta às cegas. `create_appointment`
  também apaga um `lead_status = 'perdido'` do telefone (`sessions.py:457`): quem voltou e agendou
  deixa de ser perdido.
- **Retorna:** `{"ok": true, "appointment_id": N, "status": "pending", "slot": "<label pt-BR>",
  "message": "Consulta registrada e escritório notificado."}`.
- **Efeitos colaterais:** cria evento no Google Calendar (`gcal.create_pending_event`) e grava o
  `external_id`; dispara `notify_appointment_pending` para o `human_phone`; incrementa
  `appointments_created_total`; limpa os slots oferecidos (`clear_offered_slots`).
- **Quando chamar:** assim que a pessoa confirmar o horário, sem perguntar "posso confirmar?"
  (`engine_rules.md:25`). A consulta fica **pendente** — o agente nunca diz que está confirmada
  (`engine_rules.md:65-66`, provado por `02_agendamento.yaml:34-40`).

```json
{
  "patient_name": "Cláudia",
  "procedure_type": "Consulta online",
  "slot_start": "2026-08-25T14:00:00-03:00",
  "slot_end": "2026-08-25T14:45:00-03:00",
  "notes": "Direito do Consumidor — plano de saúde negou cirurgia pedida pelo médico"
}
```

### 2.6 `get_patient_appointments`

- **Assinatura:** sem parâmetros. O telefone vem do `context`, não do modelo.
- **Valida:** nada.
- **Grava:** nada.
- **Retorna:** `{"appointments": [{id, procedure_type, slot, status}]}`, filtrando fora
  `cancelled` e `rejected` (`tools.py:400`). `slot` já vem formatado em pt-BR por `slot_label`.
- **Efeitos colaterais:** nenhum.
- **Quando chamar:** raramente — a engine já injeta `[CONSULTAS AGENDADAS]` no contexto quando há
  consulta ativa (`agent_core.py:187-196`), e `engine_rules.md:106-113` manda usar esse bloco e só
  chamar a tool se ele não aparecer.

```json
{}
```

### 2.7 `reschedule_appointment`

- **Assinatura:** `appointment_id: integer`, `new_slot_start: str`, `new_slot_end: str`
  (obrigatórios), `reason: str` (opcional — declarado no schema mas **não usado** no executor).
- **Valida** (`tools.py:417-421`): tipos (`appointment_id` tem que ser `int`, não string), e
  **ownership**: `apt["phone"] != phone` devolve "Consulta não encontrada." — um número não remarca
  a consulta de outro.
- **Grava:** `update_appointment(status="reschedule_requested", new_slot_start=..., new_slot_end=...)`.
  O slot original fica intacto até a recepcionista confirmar.
- **Retorna:** `{"ok": true, "appointment_id": N, "new_slot": "<label>", "message": "Remarcação
  solicitada. O escritório vai confirmar."}`.
- **Efeitos colaterais:** `notify_reschedule_pending` para o `human_phone`, com horário antigo e
  novo. **Não mexe no Google Calendar** — o evento só muda quando a recepcionista confirma
  (`receptionist.py:65-76`).
- **Quando chamar:** só com pedido explícito, depois de `list_available_slots` para o novo slot.

```json
{"appointment_id": 12, "new_slot_start": "2026-08-27T10:00:00-03:00", "new_slot_end": "2026-08-27T11:00:00-03:00", "reason": "conflito de trabalho"}
```

### 2.8 `cancel_appointment`

- **Assinatura:** `appointment_id: integer` (obrigatório), `reason: str` (opcional, este é usado —
  vai na notificação).
- **Valida** (`tools.py:437-442`): tipo e ownership, igual à remarcação.
- **Grava:** `update_appointment(status="cancel_requested")`.
- **Retorna:** `{"ok": true, "appointment_id": N, "message": "Cancelamento solicitado. O escritório
  vai confirmar."}`.
- **Efeitos colaterais:** `notify_cancel_pending`. O evento no Calendar só é apagado quando a
  recepcionista confirma (`receptionist.py:88`).
- **Quando chamar:** só com pedido explícito; perguntar o motivo uma vez, sem insistir
  (`engine_rules.md:111-113`).

```json
{"appointment_id": 12, "reason": "resolveu diretamente com a empresa"}
```

### 2.9 `escalate_to_human`

- **Assinatura:** `reason: str` (texto livre) e `category: str` (enum = `ESCALATION_CATEGORIES`).
  Ambos obrigatórios.
- **Valida:** **nada**. `execute_tool` devolve `{"ok": True}` e pronto (`tools.py:348-349`). Todo o
  efeito está na engine.
- **Grava:** na engine — `save_turn(phone, text, "[ESCALADO PARA HUMANO]")` e
  `log_escalation(phone, reason=text[:200], category=...)` (`agent_core.py:383-384`). Note que a
  `reason` gravada é o **texto do cliente truncado em 200 chars**, não o `reason` que o modelo
  escreveu — o argumento `reason` da tool é descartado.
- **Retorna ao Claude:** `{"ok": true}`, mas o loop nem chega a usar: `agent_core.py:331-332`
  retorna imediatamente com `reply = ""`. **Todo texto que o modelo escreveu no mesmo turno é
  descartado.**
- **Efeitos colaterais:** incrementa `escalations_total`; envia a mensagem de
  `ESCALATION_MESSAGES[category]` (com split por `---`); `notify_human`; `mark_escalated(phone)` —
  a partir daí, por 30 min (`ESCALATION_TTL`, `agent_core.py:70`), toda mensagem do número é
  encaminhada crua ao humano sem passar pelo Claude (`agent_core.py:356-360`).
- **Quando chamar:** ver §4.

```json
{"reason": "filho preso, audiência de custódia amanhã de manhã", "category": "urgencia_prazo"}
```

---

## 3. Qualificação do lead

Os campos vêm de `vertical_config.lead_fields` em `tenants/juris.yaml:43` —
`[nome, area_juridica, resumo_caso, urgencia, origem]`. A ordem no YAML é a ordem natural da
conversa. Eles viram literalmente o `enum` de `save_lead_field` (`tools.py:112`) e o critério de
completude em `is_lead_qualified` (`sessions.py:280`). Trocar a lista no YAML muda tool, prompt e
CRM de uma vez — não há lista duplicada em código. (O default da engine, se o tenant omitir, é
`[nome, procedimento_interesse, indicacao]`, `config.py:130` — herança da estética.)

| Campo | Como é coletado | Valores |
|---|---|---|
| `nome` | pedido se não vier na 1ª mensagem (`engine_rules.md:45`) | texto livre |
| `area_juridica` | **inferido do relato**, nunca perguntado como "qual área do direito?" — a tabela de tradução está em `prompt_fragment.md:29-38` | idealmente uma das 8 de `procedures` |
| `resumo_caso` | 1-2 frases nas palavras da pessoa, sem análise de mérito (`tools.py:122-124`) | texto livre |
| `urgencia` | **inferido**, não perguntado (`engine_rules.md:50-52`) | `alta` / `media` / `baixa` — validado no executor |
| `origem` | "como você chegou até a gente?" | texto livre |

### Como o prompt guia a coleta

Três camadas empurram na mesma direção:

1. A descrição do parâmetro `value` de `save_lead_field` (`tools.py:117-127`) carrega a semântica
   de cada campo — inclusive os três valores exatos de `urgencia`.
2. `engine_rules.md:41-55` dá a ordem e a regra de "não pergunte o que ela acabou de dizer".
3. O contexto injetado a cada turno: `[DADOS JÁ COLETADOS]` lista o que já tem e o que falta
   (`agent_core.py:140-158`); quando não falta nada, o bloco vira a instrução
   *"Lead completo. NÃO chame save_lead_field nem mark_lead_complete de novo"*.

### Quando o lead vira completo / perdido

- **Completo:** todos os campos presentes em `lead_data`. `mark_lead_complete` notifica o
  escritório e o CRM deriva `status = "qualificado"` (`sessions.py:388`).
- **Consulta agendada:** derivado, não gravado — basta existir um `appointment` em status ativo
  (`sessions.py:291`, `sessions.py:388`).
- **Perdido:** dois caminhos. (a) o agente chama `marcar_fora_de_escopo`, que grava
  `status=fora_de_escopo` em `lead_data` e o CRM traduz para `perdido` /
  `motivo_perda=fora_area_atuacao`; (b) um humano marca no CRM via `set_lead_status`
  (`sessions.py:302`), que tem precedência sobre tudo (`sessions.py:384-385`).
- **Nunca some:** todo telefone que trocou mensagem aparece em `get_all_leads`, mesmo sem nenhum
  campo coletado (`sessions.py:378`) — é o requisito de follow-up do `CLAUDE.md`, e está cumprido.

Não existe expiração automática de lead nem transição para `cliente` pelo agente: `cliente` e
`perdido` só chegam por decisão humana ou pelo caso (a) acima (`sessions.py:289-290`).

---

## 4. Escalação

Seis categorias, em `ESCALATION_CATEGORIES` (`tools.py:63-70`). Cada uma tem um texto de
transferência em `ESCALATION_MESSAGES` (`tools.py:40-61`) — `test_triagem_horario.py:59` trava que
nenhuma categoria fique sem mensagem (a que ficasse cairia no genérico
`ESCALATION_MESSAGE_DEFAULT`).

| Categoria | Gatilho (`engine_rules.md:120-127`, `tools.py:270-279`) | Mensagem enviada |
|---|---|---|
| `urgencia_prazo` | Prisão, audiência ou prazo <48h, intimação, liminar, despejo, busca e apreensão, violência doméstica, risco à pessoa. **Imediato, antes da triagem.** | dois balões (split por `---`): transferência + números 190 / 180 |
| `consulta_juridica` | Insistiu em parecer, êxito, valor, prazo processual ou honorários **depois de duas recusas** | "Essa é uma resposta que só o advogado pode te dar..." |
| `processo_em_andamento` | Já é cliente e quer falar do andamento do processo | "Para falar do andamento do seu processo..." |
| `reclamacao` | Insatisfação ou crítica ao escritório / advogado / atendimento | "Sinto muito que tenha acontecido..." |
| `pedido_humano` | Pediu explicitamente falar com advogado ou pessoa | "Claro. Já estou te transferindo..." |
| `confusao_repetida` | Repetiu a mesma necessidade 2x+ sem progresso, ou se irritou | "Acho melhor a equipe falar direto com você..." |

A contagem de repetição **não é persistida**: o modelo conta pelo histórico da própria conversa, que
zera com o TTL de sessão de 30 min (`engine_rules.md:129-132`).

### O que acontece com o lead

Nada no funil. Escalação não muda `status` e não grava em `lead_data`. Ela só insere uma linha em
`escalations` (`sessions.py:572`) com `phone`, `reason` (texto do cliente, 200 chars), `category` e
timestamp, e grava o turno como `[ESCALADO PARA HUMANO]`. Um lead escalado por urgência continua
"novo" ou "qualificado" no CRM conforme os campos que já tinha.

### Quem é notificado

Tudo vai para um único destino: `integrations.human_phone` do tenant
(`juris.yaml:32`, hoje o placeholder `11999999999`). Dois canais no mesmo número:

- `evolution.notify_human(phone, text)`, chamado direto pela engine (`agent_core.py:386`);
- `verticals/advocacia/notifications.py` — quatro funções, todas com o mesmo padrão: leem
  `get_config().human_phone`, **desistem em silêncio se estiver vazio** (`notifications.py:22-23`),
  e mandam WhatsApp formatado:
  - `notify_lead_qualified` — os 5 campos, com rótulos e emojis de `_LABELS` (`notifications.py:11-17`);
  - `notify_appointment_pending` / `notify_reschedule_pending` / `notify_cancel_pending` — incluem
    o par de comandos `confirmar <id>` / `rejeitar <id> motivo`, que é o protocolo consumido pelo
    `receptionist.py`.

Não há e-mail, webhook, Slack nem retry: se o `send_message` falhar, a notificação se perde.

---

## 5. Recepcionista e horário de atendimento

São duas coisas diferentes que o `CLAUDE.md` não separa: `receptionist.py` **não tem nada a ver com
horário de atendimento**.

### 5.1 `receptionist.py` — o canal de volta

É o loop de confirmação humana. `main.py:203-205` (`_is_from_receptionist`) compara o JID de quem
mandou a mensagem com `human_phone` do tenant — se casar, o texto passa antes por
`handle_receptionist_command` (`main.py:154`) e, se for um comando reconhecido, **nunca chega ao
Claude**.

Dois comandos, por regex (`receptionist.py:15-16`):

- `confirmar <id>` → `_confirm_appointment`
- `rejeitar <id> [motivo]` → `_reject_appointment`

O efeito depende do status atual da consulta (`receptionist.py:43-99`):

| Status | `confirmar` | `rejeitar` |
|---|---|---|
| `pending` | evento vira confirmado no Calendar, status `confirmed`, cliente avisado | evento apagado, status `rejected`, cliente convidado a tentar outro horário |
| `reschedule_requested` | slot antigo substituído pelo novo, campos `new_slot_*` limpos, status `confirmed` | volta a `confirmed` no slot original |
| `cancel_requested` | evento apagado, status `cancelled` | volta a `confirmed`, cliente avisado que o horário se mantém |
| qualquer outro | mensagem "nada a confirmar" para o próprio humano | "nada a rejeitar" |

Um ID inexistente responde ao humano e não faz nada (`receptionist.py:39-41`).

O módulo é opcional por design (`main.py:196-199` engole `ModuleNotFoundError`), mas sem ele
nenhuma consulta sai de `pending` — o CRM teria que fazer a transição.

### 5.2 Horário de atendimento — vem do tenant, não da vertical

`tenants/juris.yaml:14-18` define quatro coisas:

```yaml
hours: "segunda a sexta, das 9h às 18h."   # texto livre, vai pro prompt
hours_start: 9
hours_end: 18
workdays: [seg, ter, qua, qui, sex]
```

`hours` é só string exibida; `hours_start` / `hours_end` / `workdays` são a fonte real
(`config.py:117-119`; nomes de dia viram inteiros em `_parse_workdays`, `config.py:56-63`, default
seg-sáb quando ausente — herança da estética).

Dois consumidores:

1. **Agenda** (`gcal.py`): `_period_hours` clampa manhã/tarde (`gcal.py:63-73`) e os geradores de
   slot pulam dias fora de `workdays` (`gcal.py:93`, `gcal.py:163`). É por isso que o agente jurídico
   não oferece sábado. `test_triagem_horario.py:34-41` trava esses valores.
2. **Contexto do prompt** (`agent_core.py:127-137`): a cada turno é injetado

   ```
   [CONTEXTO TEMPORAL]
   Agora é terça-feira, 19/08/2026 às 20:14.
   Estamos FORA do horário de atendimento (segunda a sexta, das 9h às 18h.).
   ```

**O que muda fora do horário: só isso.** Não há branch de código, mensagem automática de fora de
expediente, fila ou bloqueio. O agente responde normalmente às 3h da manhã; o único freio é que a
agenda não devolve slot fora da faixa, e que o modelo *sabe* que está fora do horário — sem nenhuma
instrução no prompt sobre o que fazer com essa informação. `engine_rules.md` cita
`[CONTEXTO TEMPORAL]` apenas para montar `date_range` (`engine_rules.md:22-23`).

---

## 6. Camada de prompt

`build_system_prompt` (`prompt_builder.py:29-55`) concatena, **nesta ordem** (`prompt_builder.py:45`):

1. `identity` — bloco gerado em código a partir do tenant (`prompt_builder.py:30-39`)
2. `prompts/base/human_persona.md`
3. `verticals/<vertical>/prompt_fragment.md`
4. `prompts/base/engine_rules.md`
5. `agent_rules_extra` do tenant, se houver (`juris.yaml:70-77`)
6. FAQ extra do tenant, se houver (`juris.yaml:59-67`)

> Divergência: o `CLAUDE.md` documenta a ordem "engine rules → persona → fragmento da vertical".
> O código põe engine rules **por último** e não menciona o bloco `identity`.

Só persona e fragmento passam por `_substitute` (`prompt_builder.py:17-26`), que troca
`{agent_name}`, `{business_name}`, `{procedures_list}` e `{payment_methods}`. `engine_rules.md` usa
`{agent_name}` e `{business_name}` nas linhas 86-89 — **e essas chaves não são substituídas**,
chegando literais ao modelo. O resultado é montado uma vez no import (`agent_core.py:56`) e enviado
com `cache_control: ephemeral` (`agent_core.py:57`); mudar prompt exige restart do processo.

### Quem é dono de quê

| Camada | Deveria conter | O que contém hoje |
|---|---|---|
| `engine_rules.md` | mecânica invariante: como usar tool, regra de turno, split por `---`, ordem de fluxo | a mecânica **e** o conteúdo jurídico: os nomes das 6 categorias de escalação, o glossário de urgência jurídica ("prisão, liminar, despejo"), a ordem dos 5 campos jurídicos, os limites da OAB (linhas 134-142) |
| `human_persona.md` | tom, registro, comprimento de balão, política de emoji | tom **e** premissas do nicho: "foi demitido, está endividado, se separando" (linha 5), "você não é advogada" (linha 44), exemplos de parecer proibido (linhas 28-29) |
| `prompt_fragment.md` | tudo específico da vertical | corretamente: áreas, tabela de tradução linguagem→área, as 4 recusas OAB com respostas-modelo, regra de insistência, gatilho de urgência |

Ou seja: a separação nominal existe, a separação real não. `engine_rules.md` e `human_persona.md`
**não são reaproveitáveis** em outro nicho sem reescrita — ver §9.

### Restrições da OAB, onde estão escritas

O Provimento 205/2021 do CFOAB e o Código de Ética aparecem em **quatro lugares** do prompt, com
redundância deliberada:

| Restrição | Onde está no prompt | Golden test que verifica |
|---|---|---|
| Sem parecer / orientação jurídica | `prompt_fragment.md:47-49` (resposta-modelo), `engine_rules.md:8-10` (prioridade), `engine_rules.md:136-137`, `human_persona.md:28`, `juris.yaml:71` | `03_recusas_oab.yaml:51-59` (ausência de "recomendo", "no geral", "artigo", "súmula", "jurisprudência"); `05_insistencia_juridica.yaml:9-11` via regex que só barra a forma **afirmativa** de "você tem direito" |
| Sem estimar êxito | `prompt_fragment.md:50-53`, `engine_rules.md:138-139`, `faq.md:5` | `03_recusas_oab.yaml:26-34` ("boas chances", "caso forte", "casos assim costumam", "%") |
| Sem valor de indenização nem prazo processual | `prompt_fragment.md:54-57`, `engine_rules.md:138` | `03_recusas_oab.yaml:39-45` ("R$", "%", "meses", "anos", "em média", "costuma demorar") |
| Sem honorários | `prompt_fragment.md:18-22` e `:58-60`, `juris.yaml:73`, `faq.md:3` | `03_recusas_oab.yaml:12-20` ("R$", "reais", "gratuita", "sem custo", "a partir de", "desconto", "parcela") |
| Sem captação / urgência artificial | `human_persona.md:29`, `prompt_fragment.md:86-89`, `engine_rules.md:142`, `juris.yaml:74-75` | `07_tom.yaml:62` ("não perca", "garanta", "aproveite", "vagas limitadas") |
| Sem indicar outro escritório | `prompt_fragment.md` via `marcar_fora_de_escopo`, `tools.py:148-149` e `tools.py:341-345` | `06_fora_de_escopo.yaml:11-14` ("indico", "procure um", "procure outro") |
| Escalar urgência antes de triar | `prompt_fragment.md:72-77`, `engine_rules.md:11-12`, `juris.yaml:76-77` | `04_urgencia_escalada.yaml:10-21` |

O método de prova é sempre **ausência de substring ou de regex na resposta** — nunca um juízo
semântico. Isso pega o literal e as paráfrases catalogadas, não pega uma paráfrase nova.

### Tom do nicho

`human_persona.md:9-14` define acolhedora, sóbria, clara, firme, discreta.
`human_persona.md:33-38` proíbe abrir balão celebrando o contato.
`human_persona.md:40-43` restringe emoji a **no máximo um, só na primeira mensagem, e só sóbrio**.

`07_tom.yaml` é um teste de regressão de três escorregões reais de 05/08/2026 anotados no cabeçalho
do arquivo ("Felipe, seja bem-vindo! 😊", "Que bom que nos procurou.", "Ótimo, Felipe! Já tenho tudo
que preciso aqui.") — todos ocorreram com o prompt que já os proibia. Daí a existência de
`expect_text_absent_regex` e `expect_no_emoji`, e de `tests/test_tom_assertions.py`, que valida as
próprias regex sem precisar de Claude.

> Divergência importante: a regra de tom vale **só para o texto gerado pelo Claude**. Os textos
> escritos em Python continuam eufóricos e cheios de emoji: `receptionist.py:51` ("Boa notícia! …
> 🎉"), `receptionist.py:93` ("😊"), `agent_core.py:364` ("Voltei! 😊"), `agent_core.py:393` e
> `:403` ("🙏"), `main.py:168`, `:181`, `:218` ("😊"), e todo o `notifications.py`. O `CLAUDE.md`
> afirma que a regra "vale para o prompt do agente, as mensagens do WhatsApp, os textos do CRM e o
> seed" — para as mensagens de WhatsApp hardcoded, não vale.

---

## 7. RAG e `knowledge/`

`agent/rag.py` é busca por sobreposição de palavras-chave, não embedding:

- Carrega todo `*.md` de `/app/knowledge` **uma vez, no import** (`rag.py:33`) — arquivo novo só
  entra depois de restart, e o caminho é absoluto do container: rodando fora do Docker o RAG devolve
  string vazia em silêncio.
- Quebra cada arquivo em **parágrafos separados por linha em branco**, descartando os menores que
  20 caracteres (`rag.py:26-29`). O parágrafo é a unidade de recuperação — títulos `#` viram chunks
  inúteis.
- Da pergunta, extrai palavras com mais de 3 letras que não estejam na `STOP_WORDS`
  (`rag.py:11-17`), pontua cada chunk por quantas aparecem como substring, devolve os `top_k=3`
  concatenados (`rag.py:36-57`). Sem match, string vazia.
- O resultado entra no turno como `[INFORMAÇÕES DO ESCRITÓRIO RELEVANTES]` (`agent_core.py:369`).

### Papel de cada arquivo

| Arquivo | Cobre |
|---|---|
| `areas_atuacao.md` | as 8 áreas, com os termos que a pessoa usaria em cada uma; último parágrafo instrui o comportamento de fora de escopo |
| `como_funciona_consulta.md` | presencial × online, o que acontece na consulta, por que fica pendente, quem confirma remarcação/cancelamento, honorários só na consulta |
| `documentos_necessarios.md` | um parágrafo por área com documentos úteis, sempre fechando com "não precisa reunir tudo antes de agendar" |
| `faq.md` | 16 perguntas-resposta, uma por parágrafo, cada uma abrindo com a pergunta entre aspas |

`knowledge/` **não** é a única fonte de FAQ: `juris.yaml:59-67` traz `extra_faq`, que entra no prompt
de forma fixa (`prompt_builder.py:49-53`) e por isso está sempre presente, ao contrário do RAG.
As respostas ali se sobrepõem parcialmente às de `faq.md`.

### Como escrever um arquivo novo

1. `.md` em `knowledge/`, texto corrido em português.
2. **Um parágrafo = um chunk = uma resposta completa.** Nada de listas com marcador, nada de
   parágrafo que só faz sentido com o anterior: cada um vai chegar ao modelo sozinho.
3. Repita as palavras que a pessoa usaria ("nome sujo", "INSS negou", "hora extra") dentro do
   parágrafo — a busca é literal, não semântica.
4. Mais de 20 caracteres, senão é descartado.
5. Escreva na terceira pessoa descrevendo o escritório e o comportamento esperado do agente — é o
   registro dos arquivos atuais e evita que o modelo copie a frase como se fosse fala dele.
6. Nunca coloque valor, prazo, chance de êxito ou orientação jurídica: o RAG entra no contexto sem
   filtro, e o que estiver lá o modelo pode repetir.
7. Reinicie o agente.

---

## 8. Golden tests

### Formato

Cada arquivo em `tests/golden/` é um YAML com `name` e `messages`, alternando `role: user` e
`role: agent`. O step `user` traz `text`; o step `agent` só traz asserções sobre a **última**
resposta (`runner.py:97-138`):

| Chave | Semântica |
|---|---|
| `expect_tool_calls` | lista de nomes de tool que **têm** que ter sido chamados no turno (só nomes — o runner não vê argumentos) |
| `expect_text_contains` | substrings que a resposta deve conter (case-insensitive); aceita string única |
| `expect_text_absent` | substrings proibidas (case-insensitive); aceita string única |
| `expect_text_absent_regex` | regex proibidas, `re.IGNORECASE` — pega paráfrase onde a substring falha |
| `expect_no_emoji` | `true` reprova qualquer emoji, pelo `EMOJI_RE` de `runner.py:21-26` |

Asserções extras não existem: uma chave desconhecida é ignorada em silêncio.

### O que cada cenário prova

| Arquivo | Prova |
|---|---|
| `01_qualificacao.yaml` | nome e área vindos na 1ª mensagem são salvos e **não** re-perguntados; qualificação fecha com `mark_lead_complete` |
| `02_agendamento.yaml` | período + formato informados juntos disparam `list_available_slots` sem re-perguntar; escolha explícita vira `create_pending_appointment` sem re-listar; a resposta fala em "confirma" e nunca em "está confirmada" |
| `03_recusas_oab.yaml` | as 4 perguntas OAB (honorários, êxito, valor/prazo, orientação) — prova por ausência; nenhuma escala na 1ª vez |
| `04_urgencia_escalada.yaml` | prisão + audiência escalam antes da triagem; a presença de "190" prova a **categoria** `urgencia_prazo`, já que o runner não enxerga argumentos de tool |
| `05_insistencia_juridica.yaml` | recusa 1x, recusa 2x diferente, escala na 3ª; a frase "só o advogado" prova a categoria `consulta_juridica`; a ausência de "190" prova que **não** foi `urgencia_prazo`; a regex barra "posso te transferir, o que prefere?" — perguntar não é escalar |
| `06_fora_de_escopo.yaml` | área não atendida chama `marcar_fora_de_escopo` e a resposta não agenda nem indica terceiros |
| `07_tom.yaml` | regressão dos 3 escorregões reais de tom, com regex e `expect_no_emoji` |

> Divergência: o `CLAUDE.md` diz "6 cenários em `tests/golden/`". São **sete** — `07_tom.yaml` foi
> adicionado depois.

### Como rodar

```bash
make test-golden      # python3 tests/runner.py tests/golden/  — precisa do agente rodando
make test             # golden + smoke
```

O runner fala HTTP com `AGENT_URL` (default `http://localhost:3100`), `POST /api/test/message`
(`runner.py:81`), que chama `run_test_message` (`agent_core.py:410`) — mesmo loop, mesmas tools,
mesmo banco, mas sem enviar nada via Evolution. Exige `ANTHROPIC_API_KEY`: é o único teste que
exercita o Claude de verdade, e hoje não roda porque `.env` não está no repositório.

Antes de cada cenário o runner faz `POST /api/test/reset` (`runner.py:41-54`) com um telefone
fictício estável derivado de md5 do nome do arquivo (`runner.py:31-38`) — sem isso a segunda rodada
correria sobre o lead da primeira e o agente não chamaria `save_lead_field` de novo.
`test_triagem_horario.py:117-127` garante que dois cenários nunca colidam no mesmo telefone.

Dois testes rodam **sem** Claude, rede ou banco, e devem passar sempre:

```bash
python3 tests/test_tom_assertions.py      # as regex de tom pegam os 3 escorregões reais
python3 tests/test_triagem_horario.py     # horário do tenant, triagem de área, contrato de tools, fora de escopo → CRM
```

### Como escrever um cenário novo

1. Arquivo `NN_nome.yaml` em `tests/golden/` — a numeração só define a ordem de execução
   (`runner.py:151`, `sorted`).
2. Alterne `user` / `agent`. Cada step `agent` avalia **apenas a última** resposta.
3. Prefira provar por **ausência**: é o que o formato faz bem. Para provar categoria de escalação,
   ancore numa frase exclusiva de `ESCALATION_MESSAGES` (como "190" ou "só o advogado").
4. Use `expect_text_absent_regex` quando a proibição for uma família de frases; substring literal
   deixa passar paráfrase — foi exatamente a falha que originou o `07_tom.yaml`.
5. Não escreva um step `user` que ignore a pergunta que o agente acabou de fazer: o cenário trava o
   funil e falha por culpa do teste (comentário em `07_tom.yaml:42-43`).
6. Escalação encerra o cenário: `mark_escalated` bloqueia as mensagens seguintes do mesmo número
   por 30 min (`04_urgencia_escalada.yaml:3-4`).
7. Se adicionar regex nova de tom, adicione o caso positivo **e** o negativo em
   `tests/test_tom_assertions.py` — regex errada falha em silêncio, deixando o golden test passar.

---

## 9. Checklist: o que trocar ao mudar de nicho

Para uma vertical `imobiliaria` ou `clinica`, item a item. "Reaproveitável" = copiar sem tocar.

### 9.1 Reaproveitável tal qual

| Arquivo / bloco | Por quê |
|---|---|
| `agent/agent_core.py` | loop, contexto, escalação e split são agnósticos; só usam `config.vertical` para importar |
| `agent/sessions.py` | `lead_data` é chave/valor: campos novos não pedem migration. Único ponto de nicho: `_AGENT_STATUS` (`sessions.py:295`) mapeia `fora_de_escopo` |
| `agent/gcal.py` | fala `procedure_type`/`patient_name`; genérico |
| `agent/config.py` | só o default de `lead_fields` (`config.py:130`) é da estética, e todo tenant o sobrescreve |
| `agent/prompt_builder.py` | mecânica de montagem — **exceto** o bloco `identity` (ver abaixo) |
| `agent/rag.py`, `agent/evolution.py`, `agent/main.py`, `agent/api.py` | agnósticos |
| `tests/runner.py` | asserções e `EMOJI_RE` servem qualquer nicho |
| `tests/test_tom_assertions.py` | as regex de euforia servem qualquer nicho onde euforia seja errada; a regex `PARECER` é jurídica |
| **Estrutura** dos 9 nomes de tool | `save_lead_field`, `mark_lead_complete`, `list_available_slots`, `create_pending_appointment`, `get_patient_appointments`, `reschedule_appointment`, `cancel_appointment`, `escalate_to_human` já vieram herdados da estética e sobreviveram ao jurídico. Só `marcar_fora_de_escopo` é nomeada em português/jurídico |
| **Estrutura** de `notifications.py` e `receptionist.py` | o protocolo `confirmar <id>` / `rejeitar <id>` e a máquina de estados de agendamento não têm nada de jurídico |

### 9.2 Reescrever — linha a linha

| Onde | O que é jurídico | O que fazer |
|---|---|---|
| `tenants/juris.yaml:41-56` | `lead_fields`, as 8 áreas em `procedures`, `payment_methods` | novo tenant YAML; `lead_fields` propaga sozinho para tool, prompt e CRM |
| `tenants/juris.yaml:20-27` | `agent.name`, `role`, `persona_notes` ("demissão, dívida, separação") | reescrever |
| `tenants/juris.yaml:59-67` | `extra_faq` — 4 perguntas jurídicas | reescrever |
| `tenants/juris.yaml:69-77` | `agent_rules_extra` — as vedações da OAB | **trocar pelo regulador do nicho** (CFM/CRM para clínica, CRECI para imobiliária). Se o nicho não tiver vedação, o campo é opcional |
| `tools.py:9-10, 30-31` | docstring e `_WEEKDAYS` | docstring sim, `_WEEKDAYS` não |
| `tools.py:34-35` | `LEAD_STATUS_FORA_ESCOPO`, `URGENCIA_LEVELS` | `URGENCIA_LEVELS` pode virar outra coisa (ou sumir); `fora_de_escopo` só faz sentido onde haja escopo de atuação |
| `tools.py:40-61` | os 6 textos de `ESCALATION_MESSAGES`, incluindo 190/180 | reescrever inteiro; os números de emergência são específicos de urgência jurídica/violência |
| `tools.py:63-70` | as 6 categorias | `pedido_humano`, `reclamacao` e `confusao_repetida` são universais; `urgencia_prazo`, `consulta_juridica` e `processo_em_andamento` são jurídicas |
| `tools.py:81-90` | `_is_served_area` | a **lógica** serve (match frouxo contra `config.procedures`); só o nome e a docstring falam "área" |
| `tools.py:117-127` | descrições dos 5 campos, os níveis de urgência | reescrever |
| `tools.py:142-166` | `marcar_fora_de_escopo` inteira | manter se o nicho recusa casos (clínica: procedimento não oferecido); descartar se atende tudo |
| `tools.py:181-183, 208, 213` | "Consulta inicial"/"Consulta online", "área jurídica e resumo do caso" nas notes | reescrever |
| `tools.py:258-284` | descrição de `escalate_to_human` e o glossário de cada categoria | reescrever |
| `notifications.py:11-17` | `_LABELS` — rótulos e emojis dos 5 campos | reescrever junto com `lead_fields` |
| `notifications.py:29-32, 51-59, 76-85, 103-111` | "Novo lead qualificado", "⚖️ Consulta", "Cliente" | reescrever os textos; manter a estrutura |
| `receptionist.py:1-3` | docstring diz "vertical estética (Lumina)" — **já errada hoje** | corrigir |
| `receptionist.py:51-54, 79-82, 92-94, 115-127, 136-138` | textos ao cliente, com "⚖️", "🎉", "😊" | reescrever; no jurídico o tom deles **já contraria** `CLAUDE.md` |
| `prompt_fragment.md` inteiro (95 linhas) | tudo | reescrever do zero — é o arquivo cuja razão de existir é ser específico |
| `prompts/base/human_persona.md:5-7` | "foi demitido, está endividado, se separando... familiar preso" | reescrever |
| `prompts/base/human_persona.md:18-29` | exemplos ✓/✗, incluindo parecer e captação | reescrever os ✗ de nicho; os de euforia servem |
| `prompts/base/human_persona.md:44-45` | "você não é advogada" | trocar a profissão |
| `prompts/base/human_persona.md:9-14, 31-43, 51` | tom sóbrio, política de emoji, 3-4 linhas, uma pergunta por vez | **reaproveitável** em qualquer nicho de acolhimento; num nicho comercial (imobiliária) a proibição de euforia é opcional |
| `prompts/base/engine_rules.md:5-12` | exemplos ("fui demitido"), regra de "pedido de conteúdo jurídico vem primeiro", gatilhos de urgência | reescrever |
| `prompts/base/engine_rules.md:14-39, 68-78` | uso de tool, regra de turno, split por `---` | **reaproveitável** — é a mecânica da engine |
| `prompts/base/engine_rules.md:41-55` | fluxo dos 5 campos jurídicos | reescrever com os campos novos |
| `prompts/base/engine_rules.md:57-66` | fluxo de agendamento, "presencial ou online" | quase todo reaproveitável; ajustar os formatos de consulta |
| `prompts/base/engine_rules.md:80-95` | abertura da conversa | estrutura reaproveitável, exemplos jurídicos |
| `prompts/base/engine_rules.md:97-132` | fora de escopo, cliente antigo, tabela das 6 categorias | reescrever com as categorias do nicho |
| `prompts/base/engine_rules.md:134-142` | limites — os 6 primeiros são OAB pura | trocar pelo regulador do nicho |
| `knowledge/*.md` (4 arquivos) | 100% jurídico | reescrever do zero, seguindo o formato de §7 |
| `tests/golden/*.yaml` (7 cenários) | conteúdo jurídico | reescrever; as **formas** (`01` qualificação, `02` agendamento pendente, `04` urgência, `06` fora de escopo, `07` tom) transpõem direto. `03` e `05` só existem por causa da OAB |
| `tests/test_triagem_horario.py:44-65` | áreas jurídicas, os 5 campos, "190" | reescrever as asserções; a forma serve |

### 9.3 Bugs de vertical a corrigir antes de forkar de novo

O fork da estética deixou resíduos que ainda estão no código e vão viajar para o próximo fork:

| Local | Resíduo |
|---|---|
| `prompt_builder.py:33, 35-36` | o bloco `identity` diz "Atende pelo WhatsApp **da clínica**… como uma **consultora** atenderia" e imprime o cabeçalho `INFO DA CLÍNICA` — vai no topo do system prompt de todo tenant jurídico |
| `receptionist.py:2` | docstring "vertical estética (Lumina)" |
| `agent_core.py:114` | fallback de escalação com emoji 🙏 |
| `agent_core.py:271` | comentário "para a **Lara** nunca ficar muda" |
| `main.py:113` | `/health` devolve `"agent": "lumina"` fixo |
| `engine_rules.md:86-89` | `{agent_name}` e `{business_name}` não são substituídos nesta camada (`prompt_builder.py:42`) e chegam literais ao modelo |
| `config.py:130` | default de `lead_fields` é `[nome, procedimento_interesse, indicacao]` |
| `sessions.py:591-680` | tabelas `services` e `professionals` — vocabulário de clínica, sem uso na vertical advocacia |

---

## 10. Limitações conhecidas

- **Não existe registry nem validação de vertical.** `tenants/schema.yaml:7` promete o enum
  `advocacia | clinic | generic`, mas nada valida e só `verticals/advocacia/` existe.
  `schema.yaml` é documentação: `config.py` implementa a própria lista de obrigatórios
  (`config.py:84-93`), que não bate campo a campo com o YAML.
- **`prompts/base/` e `knowledge/` não são por vertical.** Caminhos fixos; duas verticais no mesmo
  deploy compartilhariam persona e base RAG.
- **`engine_rules.md` não é engine.** Metade do arquivo é conteúdo jurídico. A camada existe no
  nome, não na prática.
- **RAG só funciona dentro do container** — `KB_DIR = /app/knowledge` hardcoded (`rag.py:9`) — e
  carrega os arquivos no import: mudança em `knowledge/` exige restart.
- **A regra de tom não alcança o código Python.** Os textos hardcoded em `receptionist.py`,
  `notifications.py`, `agent_core.py` e `main.py` continuam com emoji festivo e euforia.
- **`escalate_to_human` descarta o `reason` do modelo**; o que é gravado é o texto do cliente
  truncado (`agent_core.py:384`).
- **`reason` de `reschedule_appointment` é declarado e ignorado** (`tools.py:237` × `tools.py:413-433`).
- **`list_available_slots` com uma data só devolve 7 dias**, contrariando a própria descrição
  (`tools.py:170` × `gcal.py:59-60`).
- **Escalação não altera o funil.** Um lead escalado por urgência continua "novo" no CRM; não há
  status "em atendimento humano".
- **Notificação é fire-and-forget e num só número.** Sem retry, sem fila, sem segundo destinatário;
  `human_phone` vazio faz as notificações sumirem em silêncio (`notifications.py:22-23`).
- **Fora do horário de atendimento nada muda no comportamento** — só o texto do
  `[CONTEXTO TEMPORAL]`.
- **`make test-golden` não roda hoje**: falta `.env` com `ANTHROPIC_API_KEY`. Só
  `test_tom_assertions.py`, `test_triagem_horario.py` e `test_funnel.py` são executáveis agora.
- **Nada verifica os argumentos das tools nos golden tests** — o runner só recebe nomes
  (`agent_core.py:316`). Categoria de escalação e valores de campo só são provados indiretamente,
  por frases da mensagem de transferência.
