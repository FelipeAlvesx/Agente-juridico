# 02 — Engine do agente

Nível de detalhe: suficiente para reimplementar. Tudo que se afirma aqui aponta para
`arquivo.py:linha`. Onde o código diverge do `CLAUDE.md`, o código manda e a divergência
está marcada com **⚠ Divergência**.

---

## 1. Ciclo de vida de uma mensagem

### 1.1 Webhook

Evolution API faz `POST http://agent:3000/webhook` para o evento `MESSAGES_UPSERT`. O
registro é feito pelo próprio agente no boot: `register_webhook()` (`main.py:83`) tenta 10
vezes, com 3s entre elas, um `POST {EVOLUTION_URL}/webhook/set/{instance}` com
`{"url": "http://agent:3000/webhook", "webhook_by_events": false, "webhook_base64": false,
"events": ["MESSAGES_UPSERT"]}` (`main.py:94-99`). Falhou dez vezes, loga
`webhook_registration_failed` e o agente sobe mesmo assim.

Filtros de entrada, em ordem (`main.py:121-187`):

| Ordem | Condição | Ação | Linha |
|---|---|---|---|
| 1 | `event` não é `messages.upsert`/`messages_upsert` | `{"ok": true}` | `:126` |
| 2 | `key.fromMe` | descarta | `:132` |
| 3 | `remoteJid` termina em `@g.us` (grupo) | descarta | `:136` |
| 4 | `key.id` já visto nas últimas 24h | descarta, `webhook_dedup_total++` | `:140` |
| 5 | remetente é `human_phone` e o texto casa um comando | executa o comando e retorna | `:148-155` |
| 6 | mensagem é `audioMessage` | baixa e transcreve | `:159-172` |
| 7 | texto vazio | pede texto e retorna | `:180` |
| 8 | resto | `_enqueue(phone, text)` | `:186` |

`phone` é o **JID inteiro**, não o número (`main.py:145`) — inclui o sufixo
`@s.whatsapp.net` ou `@lid`. É essa string que vira chave primária em todo o SQLite.
Todo log usa `phone_hash` = SHA256 do JID truncado em 12 hex (`main.py:146`), nunca o
número em claro.

Texto é extraído de `message.conversation` ou `message.extendedTextMessage.text`
(`main.py:174-178`). Outros tipos de mídia (imagem, documento, sticker) caem no ramo
"texto vazio" e recebem "Por favor, envie sua mensagem em texto 😊".

### 1.2 Dedup — 24h

`_is_duplicate(key_id)` (`main.py:44-54`): dict `_SEEN_IDS: {key_id: epoch}` protegido por
`threading.Lock`. Cada chamada primeiro varre e remove entradas mais velhas que
`TTL_DEDUP = 24*3600` (`main.py:37`), depois testa presença. Limpeza é O(n) a cada webhook —
aceitável no volume de um escritório, e sem isso o dict cresceria sem teto.

Estado em memória: reinício do processo zera o dedup e uma mensagem reenviada pela Evolution
pode ser processada duas vezes.

### 1.3 Debounce — 4s por telefone

`_enqueue` (`main.py:66-76`): acumula textos em `_DEBOUNCE[phone]["messages"]` e reinicia um
`threading.Timer` de `DEBOUNCE_DELAY = 4.0` (`main.py:41`) a cada nova mensagem. Quando o
timer dispara, `_flush_debounce` (`main.py:57-63`) faz `pop` do buffer, junta as mensagens
com `"\n"` e chama `process_message` numa **thread daemon nova**.

Consequências reais:

- O cliente que manda "oi", "sou o Rafael", "fui demitido" em 3 balões produz **uma** chamada
  ao Claude com o texto `"oi\nsou o Rafael\nfui demitido"`.
- Latência mínima percebida = 4s (debounce) + 5s (`RESPONSE_DELAY`, `agent_core.py:59` e `:366`)
  + latência do Claude. Ou seja, nunca menos de ~9s.
- Não há limite de tamanho do buffer. Alguém mandando 50 mensagens em 4s manda todas de uma vez.
- Threads daemon sem pool: uma por flush.

### 1.4 Guarda de escalação

Antes de qualquer processamento, `process_message` consulta `check_escalation_state(phone)`
(`agent_core.py:356`). Três estados (`agent_core.py:78-87`):

| Estado | Condição | Efeito |
|---|---|---|
| `active` | marcado há menos de `ESCALATION_TTL = 30*60` (`:70`) | **não chama o Claude**; repassa a mensagem crua ao humano via `notify_human` e retorna (`:357-360`) |
| `expired` | marcado há mais de 30min | remove a marca, manda "Voltei! 😊 Em que posso te ajudar?" e segue normalmente (`:363-365`) |
| `none` | nunca marcado | segue normalmente |

`_ESCALATED` também é dict de processo (`agent_core.py:68`). Restart devolve o cliente ao bot
no meio do atendimento humano.

### 1.5 Montagem do turno

`process_message` (`agent_core.py:368-378`) constrói **um único bloco de texto de usuário**,
concatenando na ordem:

```
texto_do_cliente
 + [INFORMAÇÕES DO ESCRITÓRIO RELEVANTES]   ← rag.search(text), se houver
 + [DADOS JÁ COLETADOS]                     ← _build_lead_context
 + [CONSULTAS AGENDADAS]                    ← _build_appointments_context
 + [HORÁRIOS JÁ OFERECIDOS]                 ← _build_offered_slots_context
 + [CONTEXTO TEMPORAL]                      ← _temporal_context
```

E monta `messages = get_history(phone) + [{"role":"user","content": bloco}]`.

Os blocos são **injetados na mensagem do usuário**, não no system prompt. Isso é o que
permite o prompt cache: o system é idêntico em todas as chamadas de todos os clientes.

Detalhe de cada bloco:

- `_temporal_context` (`:127-137`) — dia da semana em português, data/hora do tenant, e se
  está `DENTRO` ou `FORA` do horário (`weekday in cfg.workdays and hours_start <= hour < hours_end`).
  É a única fonte de "hoje" que o modelo tem para montar `date_range` ISO.
- `_build_lead_context` (`:140-158`) — lista os campos já em `lead_data` e, se faltar algum,
  lista os que faltam com a instrução de não re-salvar. Se estiver completo, instrui a **não**
  chamar `save_lead_field` nem `mark_lead_complete` de novo. É o que segura o loop de tools.
- `_build_appointments_context` (`:187-196`) — consultas com status fora de
  `cancelled`/`rejected`, formatadas como `- ID #7: Consulta inicial em qui, 21/08/2026 às 16:00 — pending`.
  O prompt manda usar esse ID sem chamar `get_patient_appointments` (`engine_rules.md:106-108`).
- `_build_offered_slots_context` (`:170-184`) — reinjeta os slots ISO da última chamada de
  `list_available_slots`. Ver seção 7.

### 1.6 Loop de tools

`_run_tool_loop(phone, messages, track_calls=None) -> (texto, escalou, categoria)`
(`agent_core.py:216-337`). Detalhado na seção 4.

### 1.7 Pós-loop

Se `escalated` (`agent_core.py:382-389`), na ordem: grava o turno com o literal
`[ESCALADO PARA HUMANO]`, `log_escalation(phone, reason=text[:200], category=...)`, envia a
mensagem de transferência da categoria (que pode conter `---` e virar dois balões), notifica
o humano, marca o telefone como escalado. **O texto que o modelo escreveu junto da tool é
descartado** (`_run_tool_loop` retorna `""` em `:332`).

Senão: se `reply` vazio, usa o fallback `"Deixa eu confirmar uma coisa rápida com a equipe
e já te respondo, tá? 🙏"` (`:393`), grava o turno e envia.

Qualquer exceção não tratada cai em `:399-405`: `errors_total++`, grava
`[ERRO TÉCNICO — ESCALADO PARA HUMANO]` no histórico, avisa o cliente, notifica o humano e
**marca o telefone como escalado** — o cliente fica 30min sem falar com o bot.

### 1.8 Split por `---` e envio

`_split_and_send` (`agent_core.py:340-348`): `re.split(r'\n\s*-{3,}\s*(?:\n|$)', text)`,
descarta pedaços vazios, envia cada um com `send_message` e `time.sleep(BALLOON_DELAY=1)`
entre eles (`:59`, `:345-346`).

O regex exige que o `---` esteja **numa linha própria** (precedido de `\n`), com 3 ou mais
hífens. Um `---` no meio de uma frase não quebra balão. O contador `messages_sent_total`
é incrementado por balão **antes de saber se a Evolution aceitou** (`:348`) — `send_message`
nunca levanta.

---

## 2. System prompt em camadas

`prompt_builder.build_system_prompt(config)` (`prompt_builder.py:29-55`). Roda **uma única
vez**, no import de `agent_core` (`agent_core.py:56`), e o resultado vira
`_SYSTEM_CACHE = [{"type":"text","text":SYSTEM_PROMPT,"cache_control":{"type":"ephemeral"}}]`
(`:57`). Editar um `.md` de prompt **exige restart do container**.

Ordem final (`prompt_builder.py:45-53`), unida por `"\n\n"`:

| # | Camada | Origem | Interpolação | Tamanho aprox. |
|---|---|---|---|---|
| 1 | Identidade | f-string inline em `prompt_builder.py:30-39` | `agent_name`, `agent_role`, `name`, `segment`, `address`, `hours` | ~250 B |
| 2 | Persona | `prompts/base/human_persona.md` | via `_substitute` | 3,4 KB |
| 3 | Fragmento da vertical | `verticals/{config.vertical}/prompt_fragment.md` | via `_substitute` | 5,3 KB |
| 4 | Regras da engine | `prompts/base/engine_rules.md` | **nenhuma** (`:42` chama `load_fragment` sem `_substitute`) | 8,1 KB |
| 5 | Regras extras do tenant | `agent_rules_extra` do YAML (`juris.yaml:70`) | — | ~0,5 KB |
| 6 | FAQ extra | `knowledge.extra_faq` do YAML, formatado como `P:`/`R:` (`:49-53`) | — | ~0,7 KB |

Total ≈ 18 KB ≈ 5 mil tokens, constante em todas as conversas.

`_substitute` (`prompt_builder.py:17-26`) troca exatamente quatro placeholders:
`{agent_name}`, `{business_name}`, `{procedures_list}` (lista `- item` de
`vertical_config.procedures`), `{payment_methods}` (join por vírgula). Placeholder
desconhecido num `.md` fica literal no prompt. `engine_rules.md:86` usa `{agent_name}` e
`{business_name}` dentro de um exemplo — como a camada 4 não passa por `_substitute`, esses
dois chegam **literais** ao modelo. Não quebra nada (o exemplo continua legível), mas é
inconsistente com as camadas 2 e 3.

> ⚠ **Divergência.** O `CLAUDE.md` descreve a ordem como "engine rules → persona → fragmento
> da vertical → regras extras do tenant". A ordem real é **identidade → persona → vertical →
> engine → extras → FAQ**. As regras da engine vêm por **último** entre os `.md`, não primeiro.

> ⚠ **Divergência.** A camada 1 é texto da vertical estética hardcoded em Python:
> `"Atende pelo WhatsApp da clínica como uma consultora atenderia"` e o cabeçalho
> `"INFO DA CLÍNICA"` (`prompt_builder.py:33-36`). Chega no prompt do agente jurídico como
> está, contra a regra de vocabulário do `CLAUDE.md`. É a primeira coisa que o modelo lê.

> ⚠ **Divergência.** `CLAUDE.md` lista "contexto RAG → estado do lead/consulta → hora atual"
> como camadas do system prompt. No código elas **não** estão no system prompt — são
> concatenadas na mensagem de usuário do turno (`agent_core.py:377`). A diferença importa:
> por estarem fora do system, não invalidam o cache e mudam a cada turno.

Camadas por vertical: só a #3 depende de `config.vertical`. Trocar de vertical troca esse
arquivo e nada mais no builder.

---

## 3. Prompt cache e limites de token

- `cache_control: ephemeral` num único bloco de system (`agent_core.py:57`). Cache de 5min
  por padrão do provedor; conversa parada mais que isso paga o system inteiro de novo.
- `max_tokens = 800` em todas as chamadas (`agent_core.py:288`, e `800` também no
  `_force_text`, `:271`). É o teto da resposta do modelo por iteração de loop — não do turno.
  Um turno com 5 iterações pode gerar até 5×800 tokens de saída.
- Não há `temperature`, `top_p`, `stop_sequences`, `timeout` nem retry configurados.
- Não há contagem nem truncamento por token em lugar nenhum. O único controle de tamanho da
  entrada é o corte por número de mensagens em `get_history` (seção 6).

---

## 4. Protocolo de tool use

### 4.1 Declaração

`_get_tools()` (`agent_core.py:118-122`) chama `vertical.get_tool_definitions(get_config())`
**uma vez** e guarda em `_tools_cache`. A vertical é resolvida por import dinâmico:
`import_module(f"verticals.{get_config().vertical}.tools")` (`agent_core.py:107`).

`get_tool_definitions(config)` (`verticals/advocacia/tools.py:93-286`) devolve a lista no
formato da API Anthropic (`name`, `description`, `input_schema` JSON Schema). Vários campos
são **construídos a partir do tenant**, não fixos:

- o `enum` de `save_lead_field.field` é `list(config.lead_fields)` (`:112`);
- a descrição do valor lista as áreas de `config.procedures` (`:120`);
- `mark_lead_complete` diz "os N campos" com `len(lead_fields)` (`:137`);
- a descrição de `period` calcula as faixas de manhã/tarde a partir de `hours_start`/`hours_end`
  (`:97-98`, `:189-190`);
- o `enum` de `escalate_to_human.category` é `list(ESCALATION_CATEGORIES)` (`:269`).

As nove tools:

| Tool | Args obrigatórios | Efeito |
|---|---|---|
| `save_lead_field` | `field`, `value` | grava em `lead_data`; valida `urgencia` contra `("alta","media","baixa")` (`:301`) |
| `mark_lead_complete` | — (schema vazio) | se passou de não-qualificado para qualificado, incrementa métrica e notifica o escritório (`:311-317`) |
| `marcar_fora_de_escopo` | `area_informada`, `motivo` | grava `status=fora_de_escopo` + `motivo_perda` + `area_juridica` em `lead_data` (`:334-336`) |
| `list_available_slots` | `date_range` | consulta `gcal`; persiste os slots retornados em memória (`:362`) |
| `create_pending_appointment` | `patient_name`, `procedure_type`, `slot_start`, `slot_end` | cria `appointments` status `pending`, cria evento tentativo no Calendar, notifica o escritório, limpa slots ofertados (`:381-388`) |
| `get_patient_appointments` | — | lista consultas ativas |
| `reschedule_appointment` | `appointment_id`, `new_slot_start`, `new_slot_end` | status `reschedule_requested`, notifica (`:422-426`) |
| `cancel_appointment` | `appointment_id` | status `cancel_requested`, notifica (`:443-447`) |
| `escalate_to_human` | `reason`, `category` | **executor não faz nada** (`:348-349`) — retorna `{"ok": True}`; o efeito real está no loop |

Os nomes batem exatamente com o contrato do `CLAUDE.md`; as categorias de escalação também.

### 4.2 Execução

Dentro de cada iteração (`agent_core.py:311-329`), para cada bloco `tool_use` da resposta:

```python
result = vertical.execute_tool(tool_block.name, tool_block.input or {}, context)
tool_results.append({
    "type": "tool_result",
    "tool_use_id": tool_block.id,
    "content": json.dumps(result),
})
```

O `context` (`agent_core.py:224-231`) carrega `phone`, `phone_hash`, `was_qualified`
(capturado **antes** do loop, `:220`), `config` e dois callables de métrica
(`inc_leads_qualified`, `inc_appointments_created`). É o único acoplamento entre engine e
vertical além dos dois nomes de função.

O resultado volta como `{"role":"user","content":[...tool_results]}` (`:329`) — todas as
tools de uma iteração viram um único turno de resultados, o que suporta chamadas paralelas.

### 4.3 Tratamento de erro

**Não há `try/except` em volta de `execute_tool`.** Uma exceção não tratada dentro de uma tool
sobe até o `except` de `process_message` (`agent_core.py:399`) e vira erro técnico + escalação.

O contrato de erro é convencional, não estrutural: `execute_tool` devolve
`{"error": "mensagem"}` e o Claude lê isso como texto de resultado — a API não é informada de
que houve erro (`is_error` não é usado). Exemplos que dependem disso funcionar:

- `urgencia` fora do enum → `{"error": "urgencia deve ser um de: alta, media, baixa"}` (`tools.py:304`);
- `marcar_fora_de_escopo` numa área que o escritório **atende** → erro instruindo a continuar
  a qualificação (`tools.py:326-331`), com o match frouxo de `_is_served_area` (`:81-90`);
- consulta de outro telefone em `reschedule`/`cancel` → `{"error": "Consulta não encontrada."}`
  (`:421`, `:442`) — é a checagem de autorização, comparando `apt["phone"] != phone`;
- tool desconhecida → `{"error": "unknown tool: X"}` (`:456`).

### 4.4 Loop estourado

O laço é `for _ in range(5)` (`agent_core.py:283`). Duas saídas:

1. **Saída normal** — a resposta não tem `tool_use` (`:302-306`): monta o texto e retorna.
2. **Saída por escalação** — logo após executar as tools da iteração, se alguma foi
   `escalate_to_human`, retorna `("", True, categoria)` (`:331-332`) sem mais uma volta.

Se as 5 iterações se esgotarem com tool use em todas, o código cai em `:334-337`: monta o texto
coletado e retorna. **As tools da 5ª iteração já executaram** (gravaram no banco, criaram evento,
notificaram o escritório), mas seus `tool_result` **nunca são enviados ao modelo** — a lista
`messages` local é descartada. Efeito prático: uma consulta pode ser criada e o cliente receber
uma resposta que não menciona isso, ou o fallback genérico de `:393`. Não há log específico para
"loop estourado"; só o `empty_reply_after_tool_loop` (`:392`) se o texto sair vazio.

### 4.5 Texto + tools na mesma resposta

O modelo frequentemente emite texto **junto** com o `tool_use`. Cada iteração acumula esse
texto em `collected_text` (`:299-300`), e `_assemble()` (`:240-263`) junta tudo no fim:

1. quebra cada pedaço por `\n---\n` **ou** por linha em branco dupla (`re.split(r'\n\s*-{3,}\s*\n|\n{2,}')`);
2. deduplica por **similaridade de Jaccard sobre o conjunto de palavras**: se dois balões têm
   `|A∩B| / |A∪B| > 0.6`, o segundo é descartado (`:250-261`);
3. rejunta com `"\n\n---\n\n"`, que é o que `_split_and_send` sabe cortar.

A dedup existe porque o modelo re-narra a mesma fala em iterações diferentes do loop. É O(n²)
sobre um punhado de balões — irrelevante nessa escala.

**Rede de segurança** `_force_text()` (`:265-281`): se o modelo usou tools mas não escreveu nada
e não escalou, faz **mais uma chamada ao Claude sem `tools=`** para arrancar uma resposta de
texto. Falhou, devolve `""` e o fallback de `process_message` entra.

---

## 5. RAG

`agent/rag.py`, 58 linhas, sem embeddings, sem índice invertido, sem dependência externa.

**Indexação** (`_load_chunks`, `rag.py:20-30`), executada **uma vez no import**:

- varre `KB_DIR = pathlib.Path("/app/knowledge")` (`:9`) com `sorted(glob("*.md"))`;
- quebra cada arquivo por `"\n\n"` (parágrafo);
- descarta pedaços com 20 caracteres ou menos;
- guarda `{"text": ..., "source": nome_do_arquivo}` — **`source` nunca é usado depois**.

`KB_DIR` é **absoluto e hardcoded**, ao contrário de `prompt_builder`, que respeita
`LUMINA_ROOT` (`prompt_builder.py:10`). Fora do container, `rag.search` sempre devolve `""`.

**Busca** (`search(query, top_k=3)`, `rag.py:36-58`):

1. minúscula a query e separa por espaço;
2. mantém palavras com **mais de 3 caracteres** que não estejam em `STOP_WORDS` (`:11-17`,
   28 palavras). Nenhuma palavra sobrevive → retorna `""`;
3. pontua cada chunk por **quantas keywords distintas aparecem como substring** no texto;
4. ordena por score desc, pega `top_k=3`, junta com `"\n\n"`.

Limites reais, medidos no código e no conteúdo:

| Limite | Valor |
|---|---|
| Base de conhecimento | 4 arquivos, ~8,5 KB total (`knowledge/areas_atuacao.md`, `como_funciona_consulta.md`, `documentos_necessarios.md`, `faq.md`) |
| Chunks | parágrafos > 20 chars, sem overlap |
| Retorno | 3 chunks, tamanho não limitado (um parágrafo grande entra inteiro) |
| Recall | **substring, não stemming**: "prazos" não casa "prazo"; "demissão" não casa "demissao" |
| Precisão | keyword genérica infla score de chunk irrelevante; sem TF-IDF, sem normalização por tamanho |
| Recarga | nenhuma — editar `knowledge/*.md` exige restart |
| Empate | `sort` estável, desempata pela ordem alfabética de arquivo |

O resultado entra como `[INFORMAÇÕES DO ESCRITÓRIO RELEVANTES]` na mensagem do usuário
(`agent_core.py:369`), não no system prompt. O FAQ do tenant
(`knowledge.extra_faq` em `juris.yaml:59-67`) é caminho **separado**: vai para o system prompt
sempre, sem passar pelo RAG (`prompt_builder.py:49-53`).

---

## 6. TTL de sessão e histórico

`sessions.get_history(phone)` (`sessions.py:177-190`):

```sql
SELECT role, content FROM sessions WHERE phone = ? AND ts > ? ORDER BY ts ASC
```

com `cutoff = time.time() - TTL_SECONDS`, `TTL_SECONDS = 30*60` (`sessions.py:13`). Depois
corta em memória para os últimos `MAX_TURNS * 2 = 20` itens (`:14`, `:189-190`).

Semântica exata do TTL: **não é sessão, é janela deslizante por mensagem.** Cada linha tem seu
próprio `ts`; a query filtra linha a linha. Uma conversa que dura 3 horas sem pausa maior que
30min continua carregando as últimas 20 mensagens — não é truncada em 30min de duração.
Silêncio de 31min zera o histórico enviado ao Claude, mas **as linhas continuam no banco**
(o CRM as mostra inteiras via `get_conversation_for_dashboard`, `:193`).

O que **sobrevive** ao TTL e o que **não**:

| Estado | Sobrevive ao TTL de 30min? |
|---|---|
| `lead_data` (nome, área, resumo, urgência, origem) | sim — é reinjetado como `[DADOS JÁ COLETADOS]` |
| `appointments` | sim — reinjetado como `[CONSULTAS AGENDADAS]` |
| Histórico de conversa | não |
| Contagem de repetições para `confusao_repetida` | não — não há contador, o modelo conta pelo histórico (`engine_rules.md:129-131`) |
| Slots oferecidos | não tem TTL próprio, mas morre no restart |

Ou seja, após 30min de silêncio o cliente reabre a conversa e o agente **não lembra do que foi
dito**, mas **lembra dos dados estruturados** — o comportamento pretendido, já que o prompt
manda retomar de onde parou usando `[DADOS JÁ COLETADOS]` (`engine_rules.md:92-93`).

Um turno grava exatamente duas linhas, `user` e `assistant`, com o assistant em `now + 0.001`
para garantir a ordem (`save_turn`, `sessions.py:238-249`). O texto do usuário gravado é a
**mensagem original**, sem os blocos de contexto — eles não poluem o histórico das próximas voltas.

---

## 7. Agenda

### 7.1 Configuração

Google Calendar via **Service Account**, sem OAuth interativo (`gcal.py:29-38`, escopo
`https://www.googleapis.com/auth/calendar`). `is_configured()` (`:24-26`) exige as duas coisas:
arquivo em `GOOGLE_CREDENTIALS_PATH` **e** `calendar_id` não vazio.

Parâmetros vindos do tenant (`juris.yaml:33-39`): `slot_duration_minutes: 60`,
`slot_buffer_minutes: 15`, e o mapa `procedure_durations` (`Consulta inicial: 60`,
`Consulta online: 45`). `_resolve_duration` (`gcal.py:45-52`) casa o `procedure_type` recebido
contra as chaves do mapa por **substring nos dois sentidos**, com fallback em `slot_duration`.

### 7.2 Busca de slots

`list_available_slots(date_range, procedure_type=None, period=None)` (`gcal.py:113-196`):

1. `_parse_date_range` (`:55-61`): `"2026-08-03"` vira o intervalo desse dia até +6 dias;
   `"2026-08-03/2026-08-07"` vira o intervalo literal. Formato inválido → `{"error": ...}`.
2. `_period_hours` (`:63-73`): `manha` → `(hours_start, min(12, hours_end))`;
   `tarde` → `(max(13, hours_start), hours_end)`; nada → o dia inteiro do tenant.
3. Se `not is_configured()` **ou** `DEMO_CALENDAR=true` → `_mock_slots` (`:76-110`).
4. Senão, uma chamada `freebusy().query()` para o intervalo inteiro (`:147-152`) e varredura
   local.

Regras da varredura (`:162-187`):

- pula dias que não estão em `cfg.workdays`;
- caminha do `day_start_h` em passos de `slot_duration`;
- descarta slot que já passou (`slot > now`);
- **buffer assimétrico**: `occupied = any(slot < busy_end + buffer and slot_end > busy_start)`
  (`:176`). O buffer só é aplicado **depois** do evento ocupado, nunca antes. Um compromisso
  às 11h não bloqueia um slot que termina às 11h — bloqueia o que começa até 15min depois dele
  terminar;
- **no máximo 1 slot por dia** (`found_today`, `:171`) e **no máximo 3 no total** (`:162`).
  Isso é curadoria deliberada: o cliente recebe 3 opções em dias diferentes, não 20 no mesmo dia;
- nenhum slot → `{"slots": [], "message": "Nenhum horário disponível no período. Tente outro intervalo."}`.

Cada slot é `{"slot_start": ISO, "slot_end": ISO, "label": "quinta-feira, 21/08 às 16:00"}`.

`_mock_slots` (`:76-110`) segue as mesmas regras de `workdays` e período, começa em
`max(start_date, amanhã)` e cicla os horários candidatos `[9,10,11,14,15,16,17]` filtrados pelo
horário do tenant, um por dia, até 3.

### 7.3 Slots oferecidos — memória entre turnos

O problema: `label` é legível mas `slot_start`/`slot_end` ISO não sobrevivem no histórico, que
só guarda texto. O cliente diz "a segunda opção" no turno seguinte e o modelo não teria o ISO.

Solução (`sessions.py:16-37`): `save_offered_slots(phone, slots)` guarda a lista num dict de
processo `_OFFERED_SLOTS`. Ciclo de vida:

| Momento | Ação | Onde |
|---|---|---|
| `list_available_slots` retorna slots | `save_offered_slots` | `tools.py:360-362` |
| Turno seguinte | `_build_offered_slots_context` reinjeta como `[HORÁRIOS JÁ OFERECIDOS]` com `slot_start=` e `slot_end=` explícitos, mandando chamar `create_pending_appointment` imediatamente e **não** re-listar | `agent_core.py:170-184` |
| Consulta criada | `clear_offered_slots` | `tools.py:388` |
| Restart | perdido | — |

### 7.4 Pendente vs confirmada

`create_pending_appointment` (`tools.py:366-396`) faz, nesta ordem:

1. `create_appointment(...)` no SQLite com status `pending` (`sessions.py:440`);
2. `gcal.create_pending_event(...)` — evento com `"status": "tentative"` e summary
   `[PENDENTE] {procedure_type} — {patient_name}` (`gcal.py:214-218`);
3. se veio `external_id`, grava na linha (`tools.py:384-385`);
4. `notify_appointment_pending(...)` → WhatsApp para `human_phone`;
5. `clear_offered_slots`.

O prompt proíbe dizer que está confirmada: *"A consulta fica pendente — nunca diga que está
confirmada"* (`engine_rules.md:65-66`).

Confirmação é **sempre humana**, por dois caminhos independentes:

- WhatsApp: a recepcionista responde `confirmar <id>` / `rejeitar <id> [motivo]`
  (`receptionist.py:15-31`), roteado no webhook por `_is_from_receptionist` (`main.py:148`);
- CRM: `POST /api/appointments/<id>/confirm` e `/reject` (`api.py:193`, `:258`).

Nos dois, o evento do Calendar passa de `tentative` para `confirmed` e o summary perde o
prefixo `[PENDENTE]` (`gcal.confirm_event`, `:229-246`).

Remarcação e cancelamento **também não são executados pelo agente**: as tools só mudam o status
para `reschedule_requested`/`cancel_requested` e notificam (`tools.py:422`, `:443`). Quem
resolve é a recepcionista — e `confirmar <id>` significa coisas diferentes conforme o status
atual da consulta (`receptionist.py:43-99`, tabela em `docs/01-arquitetura.md`).

Lembrete D-1: `_send_daily_reminders` (`main.py:208-225`), APScheduler cron 08:00
America/Sao_Paulo (`:240-242`), só para status `confirmed` com `slot_start` no dia seguinte
(`sessions.get_confirmed_appointments_tomorrow`, `:526`).

> ⚠ **Divergência.** O texto do lembrete (`main.py:218-221`) diz *"você tem
> **{procedure_type}** amanhã às ..."* e termina com 😊 — vocabulário e tom de clínica, contra
> as regras de tom do `CLAUDE.md`.

---

## 8. Pontos de extensão — genérico vs. específico da vertical

Esta é a seção que importa para replicar a engine em outra vertical (imobiliária, clínica).

### 8.1 O que é genérico (engine — não toque ao trocar de vertical)

| Arquivo | Por que é genérico |
|---|---|
| `agent/main.py` | webhook, dedup, debounce, áudio, scheduler. A única amarração é o import dinâmico `verticals.{vertical}.receptionist` (`:197`) — e o texto das mensagens de erro, que hoje tem emoji |
| `agent/agent_core.py` | loop de tools, contexto, split, escalação. Resolve a vertical por `import_module(f"verticals.{vertical}.tools")` (`:107`) |
| `agent/prompt_builder.py` | camadas. A #3 é `verticals/{vertical}/prompt_fragment.md` (`:43`). ⚠ mas a camada #1 tem texto de clínica hardcoded — **isso precisa virar campo do tenant para a engine ser realmente genérica** |
| `agent/config.py` | loader do YAML. ⚠ o default de `lead_fields` (`:130`) é da vertical estética |
| `agent/sessions.py` | schema. Os nomes `patient_name`, `procedure_type`, `services`, `professionals` são da clínica, mas a semântica é neutra |
| `agent/gcal.py` | agenda. Neutro; a única noção de domínio é `procedure_durations`, que vem do tenant |
| `agent/rag.py` | busca. Neutro; o conteúdo é `knowledge/*.md` |
| `agent/evolution.py` | transporte. Neutro exceto o texto de `notify_human` (`:63-68`) |

### 8.2 O que é específico da vertical

Uma vertical é um pacote Python `verticals/<nome>/` com **três arquivos obrigatórios** e um opcional:

| Arquivo | Contrato exato |
|---|---|
| `tools.py` | **obrigatório.** Deve expor `get_tool_definitions(config) -> list` e `execute_tool(fn, args, context) -> dict`. Opcionalmente `ESCALATION_MESSAGES: dict` e `ESCALATION_MESSAGE_DEFAULT: str`, lidos com `getattr` e com fallback (`agent_core.py:111-115`) |
| `prompt_fragment.md` | **obrigatório.** Camada 3 do prompt. Recebe `{agent_name}`, `{business_name}`, `{procedures_list}`, `{payment_methods}` |
| `__init__.py` | obrigatório para o import funcionar |
| `receptionist.py` | opcional. Se ausente, `_get_vertical_handler` engole o `ModuleNotFoundError` e desliga a feature (`main.py:196-200`). Deve expor `handle_receptionist_command(text) -> bool` |
| `notifications.py` | livre — é detalhe interno da vertical, importado só pelo `tools.py` dela |

O acoplamento engine↔vertical é **exatamente duas funções e um dict de contexto**. O `context`
que o executor recebe (`agent_core.py:224-231`) tem: `phone`, `phone_hash`, `was_qualified`,
`config`, `inc_leads_qualified`, `inc_appointments_created`.

### 8.3 O que é específico do tenant (YAML, sem tocar em código)

Tudo em `tenants/<slug>.yaml`, validado informalmente por `tenants/schema.yaml`:
nome/endereço/horário do negócio, timezone, `workdays`, nome e papel do agente, instância
Evolution, telefone humano, calendário e durações, `lead_fields`, `procedures`,
`payment_methods`, `extra_faq`, `agent_rules_extra`, `model`.

`vertical_config.lead_fields` é o ponto mais poderoso: mudar essa lista muda ao mesmo tempo o
`enum` da tool `save_lead_field` (`tools.py:112`), a definição de "lead qualificado"
(`is_lead_qualified`, `sessions.py:280`), o bloco `[DADOS JÁ COLETADOS]` (`agent_core.py:145`)
e a contagem do funil (`sessions.py:693-702`) — sem uma linha de código.

### 8.4 Checklist para criar `verticals/imobiliaria/`

1. `mkdir verticals/imobiliaria` com `__init__.py`, `tools.py`, `prompt_fragment.md`.
2. `tools.py`: copiar a estrutura de `advocacia/tools.py`, manter os nomes de tool que a engine
   e o prompt já conhecem (`save_lead_field`, `mark_lead_complete`, `list_available_slots`,
   `create_pending_appointment`, `get_patient_appointments`, `reschedule_appointment`,
   `cancel_appointment`, `escalate_to_human`), trocar descrições/enums e as tools próprias da
   vertical (o análogo de `marcar_fora_de_escopo`).
3. `tenants/imob.yaml` com `vertical: imobiliaria` e `lead_fields` do domínio.
4. `knowledge/*.md` novo — o RAG é global e lê **tudo** que estiver em `/app/knowledge`.
   Não há separação por tenant nem por vertical; misturar bases de dois negócios contamina as
   respostas dos dois.
5. `TENANT_CONFIG=/app/tenants/imob.yaml` no compose.
6. **Trabalho de engine que ainda falta para isso ficar limpo:** tirar o texto de clínica de
   `prompt_builder.py:33-36`, o default de `lead_fields` de `config.py:130`, e os textos
   com emoji de `main.py:168/181/218`, `agent_core.py:364/393` e
   `verticals/advocacia/notifications.py`. Hoje, uma vertical nova herda tudo isso.

---

## 9. Limitações conhecidas

- **Prompt e tools congelam no import.** `SYSTEM_PROMPT` (`agent_core.py:56`) e `_tools_cache`
  (`:101`) são construídos uma vez. `PUT /api/config` recarrega o singleton de config
  (`api.py:473`) mas **não** reconstrói o prompt nem as tools — depois de editar o tenant pelo
  CRM, o agente continua falando com o nome antigo até o restart.
- **Um só processo.** Debounce, dedup, flag de escalação e slots oferecidos são dicts de
  memória. Qualquer escala horizontal quebra os quatro sem erro visível.
- **Loop estourado é silencioso.** As tools da 5ª iteração executam e seus resultados são
  jogados fora (seção 4.4). Não há log nem métrica para esse caso.
- **Sem timeout nem retry no Claude.** `messages.create` (`agent_core.py:285`) usa o default do
  SDK. Uma chamada lenta segura a thread do debounce inteira.
- **`_force_text` gasta uma chamada extra** de LLM sempre que o modelo usa tool sem escrever
  texto (`:265`), sem cache diferente e sem limite de frequência.
- **Nada aqui foi executado.** Este documento foi escrito por leitura de código. `make test-golden`
  precisa do agente rodando e de `ANTHROPIC_API_KEY` válida, e `make smoke` precisa dos
  containers de pé; nenhum dos dois foi rodado para produzir este texto, então **não há
  confirmação empírica** dos comportamentos descritos — só a leitura das linhas citadas.
  (O `CLAUDE.md` afirma que `.env` não existe; existe um `.env` na raiz, não versionado —
  essa parte do `CLAUDE.md` está desatualizada.)
- **Sem observabilidade do funil de prompt.** Não há log do prompt montado, do contexto
  injetado, nem de uso de tokens/cache hit. `llm_latency_seconds` (`agent_core.py:50`) é a
  única métrica sobre o Claude.
