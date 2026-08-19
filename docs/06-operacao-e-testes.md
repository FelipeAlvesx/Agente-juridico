# 06 — Operação e testes

Como sair de uma máquina limpa para um agente atendendo no WhatsApp, o que cada
comando faz de verdade, o que os testes provam e onde olhar quando quebra.

Referências: [arquitetura](01-arquitetura.md) · [replicar para outro nicho](07-replicar-para-outro-nicho.md)

---

## 1. Setup do zero

### 1.1 Pré-requisitos

`setup/check_prerequisites.py` verifica exatamente quatro coisas (linhas 47-59):

| Item | Por quê |
|---|---|
| Docker | Todos os serviços rodam em container |
| Docker Compose (`docker compose`, plugin v2) | `docker-compose.yml:1` usa a sintaxe v2 |
| Python 3 no host | `setup/*.py` e `tests/runner.py` rodam fora do container |
| Docker daemon rodando | Falha dura: sem ele nada sobe |

Duas verificações são apenas avisos e **não** derrubam o script: `.env` ausente
(`setup/check_prerequisites.py:26`) e `credentials/google_credentials.json` ausente
(`setup/check_prerequisites.py:35`).

Dois pontos que o script **não** checa e que mordem:

- **Versão do Python do host.** `agent/sessions.py:344` e `agent/gcal.py:45` usam
  `str | None` em assinatura, sintaxe de Python 3.10+. Num macOS com o Python 3.9 de
  sistema, `python3 tests/test_funnel.py` explode com
  `TypeError: unsupported operand type(s) for |: 'type' and 'NoneType'`. Rode esses
  testes no container (seção 4.1). `tests/runner.py` e `setup/configure_webhook.py`
  rodam em 3.9 sem problema.
- **Bibliotecas do host.** `tests/runner.py` importa `yaml` e `requests`;
  `setup/configure_webhook.py` importa `requests` e `python-dotenv`. Instale:
  `pip3 install requests pyyaml python-dotenv`.

### 1.2 `.env`

`make setup` copia `.env.example` para `.env` se ele não existir (e nunca sobrescreve).
O arquivo é ignorado pelo git (`.gitignore:2`).

| Variável | Obrigatória | Onde obter / o que colocar |
|---|---|---|
| `ANTHROPIC_API_KEY` | **Sim** | console.anthropic.com → API Keys. Sem ela o agente sobe mas toda chamada ao Claude falha e cai no `except` de `agent/agent_core.py:399`. |
| `OPENAI_API_KEY` | Não | Só para transcrever áudio (Whisper, `agent/agent_core.py:207`). Vazio = áudio recebe a resposta padrão de `agent/main.py:168` pedindo texto. |
| `CLAUDE_MODEL` | Não | Sobrepõe o `model:` do tenant. Precedência em `agent/config.py:102`: env > YAML > default `claude-haiku-4-5-20251001`. `tenants/juris.yaml:6` fixa `claude-sonnet-4-6`; descomente a env para forçar Haiku em produção. |
| `EVOLUTION_API_KEY` | **Sim** | Você inventa. É a chave que a Evolution passa a exigir no header `apikey` (`docker-compose.yml:17`) e que `setup/configure_webhook.py:24` e `agent/evolution.py:16` usam. Use algo longo e aleatório. |
| `EVOLUTION_INSTANCE` | Sim (para o setup) | Nome da instância WhatsApp. Cuidado: **quem manda no runtime é `integrations.evolution.instance` do tenant** (`tenants/juris.yaml:31`, lido em `agent/config.py:122`); a env só é usada por `setup/configure_webhook.py:20`. Se os dois divergirem, o webhook é criado numa instância e o agente envia por outra. Mantenha iguais. |
| `EVOLUTION_URL` | Sim (para o setup) | Evolution **vista do host**: `http://localhost:8081`. Dentro da rede Docker o agente usa `http://evolution:8080`, fixado em `docker-compose.yml:44`. |
| `AGENT_WEBHOOK_URL` | Sim | URL do agente que a Evolution vai chamar. Tudo em Docker na mesma máquina: `http://agent:3000`. Evolution fora do compose ou teste com WhatsApp real de fora: use o túnel (`https://xxxx.ngrok-free.app`). |
| `GOOGLE_CREDENTIALS_PATH` | Não | Caminho do JSON da service account. O container recebe `/app/credentials/google_credentials.json` (`docker-compose.yml:48`); o valor do `.env` só vale para execução fora do Docker. |
| `GOOGLE_CALENDAR_ID` | Não | E-mail do calendário (`...@gmail.com` ou `...@group.calendar.google.com`). Precedência em `agent/config.py:126`: `calendar_id` do YAML > esta env. Como `tenants/juris.yaml:34` está vazio, a env vence. |
| `DEMO_CALENDAR` | Não | `true` gera horários simulados sem Google (`agent/gcal.py:135`). **Vence sobre credenciais válidas** — com `true`, mesmo com Google configurado, os slots são fictícios. |
| `DEMO_SEED` | Não | `true` popula 20 leads, 10 consultas e conversas de demonstração no primeiro boot (`agent/main.py:231` → `agent/seed_demo.py:164`). Idempotente: checa se já existe telefone `5511912345%`. **Desligue em produção.** |
| `VITE_API_URL` | Sim | URL do agente **vista pelo browser**: `http://localhost:3100`. Entra no bundle em build time (`docker-compose.yml:74`, `dashboard/Dockerfile:11`). Mudou? `docker compose build dashboard`. |

### 1.3 Subir

```bash
make setup     # checa pré-requisitos, cria .env
$EDITOR .env   # preencha ANTHROPIC_API_KEY e EVOLUTION_API_KEY
make up        # docker compose up -d
```

Quatro containers sobem (`docker-compose.yml`):

| Serviço | Container | Porta host → container | Papel |
|---|---|---|---|
| `evolution` | `juris_evolution` | **8081** → 8080 | WhatsApp (Evolution API v1.8.2), imagem própria com o patch `@lid` |
| `agent` | `juris_agent` | **3100** → 3000 | Flask: webhook, `/api/*`, `/health`, `/metrics` |
| `dashboard` | `juris_dashboard` | 5173 → 80 | CRM React buildado, servido por Nginx |
| `backup` | `juris_backup` | — | cron 02:00: `.backup` do SQLite, guarda os 7 mais recentes |

As portas 8081 e 3100 não são estética: **8080 e 3000 no host são de outro projeto**
(comentários em `docker-compose.yml:20` e `docker-compose.yml:32`). Ver o commit
`7730b6c`, onde a ausência da porta publicada fazia o `make webhook` criar a instância
na Evolution errada, em silêncio.

Confira: `make smoke`.

### 1.4 Parear o WhatsApp (QR Code)

```bash
make webhook   # python3 setup/configure_webhook.py
```

O script (`setup/configure_webhook.py`) faz três coisas, nesta ordem:

1. `POST /instance/create` com `integration: WHATSAPP-BAILEYS` (linha 27). HTTP 403 =
   `EVOLUTION_API_KEY` errada, e ele aborta. Instância já existente é apenas informada.
2. Faz polling de `GET /instance/connect/<instância>` até 20 vezes, a cada 3s, e grava o
   base64 do QR em **`qrcode.png`** na raiz do projeto (linha 52). Abra o arquivo e escaneie
   com o celular do escritório: WhatsApp → Aparelhos conectados → Conectar aparelho.
   O script espera você apertar Enter.
3. `POST /webhook/set/<instância>` apontando para `${AGENT_WEBHOOK_URL}/webhook`,
   só o evento `MESSAGES_UPSERT` (linha 76).

`qrcode.png` está no `.gitignore:7` — é uma credencial de sessão, não commite.

**O agente também registra o webhook sozinho no boot** (`agent/main.py:83`): 10 tentativas
a cada 3s apontando para `http://agent:3000/webhook`, valor **fixo no código**, ignorando
`AGENT_WEBHOOK_URL`. Consequência prática: se você configurou um ngrok pelo `make webhook`
e depois reiniciou o agente, o registro automático sobrescreve seu túnel pela URL interna.
Rode `make webhook` de novo depois de cada restart quando estiver usando túnel.

### 1.5 Google Calendar (opcional)

Sem isso o agente funciona em modo demo, gerando horários plausíveis
(`agent/gcal.py:76 _mock_slots`) — bom para demonstração, inútil para operação real.

1. Google Cloud Console → novo projeto → ative a **Google Calendar API**.
2. Crie uma **Service Account** e gere uma chave JSON.
3. Salve como `credentials/google_credentials.json` (a pasta é montada read-only em
   `docker-compose.yml:49`; `credentials/.gitignore` impede commit).
4. No Google Calendar, **compartilhe o calendário** com o e-mail da service account
   (`...iam.gserviceaccount.com`) dando permissão de *Fazer alterações nos eventos*.
   Sem esse passo a API responde 404 e o log mostra `gcal_list_slots_error`.
5. `.env`: `GOOGLE_CALENDAR_ID=<id do calendário>` e **`DEMO_CALENDAR=false`**.
6. `make down && make up`.

`agent/gcal.py:24 is_configured()` exige as duas coisas: arquivo existente **e**
`calendar_id` não vazio. Faltando uma, cai em demo sem avisar.

Fluxo do evento: criado como `tentative` com título `[PENDENTE] ...` (`agent/gcal.py:214`),
vira `confirmed` quando alguém confirma no CRM ou pelo WhatsApp da recepção
(`agent/gcal.py:229`).

---

## 2. Alvos do Makefile

| Alvo | O que executa de verdade |
|---|---|
| `make help` | Lista os comandos. É o alvo default do arquivo. |
| `make setup` | `python3 setup/check_prerequisites.py` + copia `.env.example` → `.env` se não existir. Nunca sobrescreve. |
| `make webhook` | `python3 setup/configure_webhook.py` — cria instância, gera `qrcode.png`, registra o webhook. Roda **depois** do `make up`. |
| `make up` | `docker compose up -d`. Não rebuilda: código Python novo exige `make build` ou `docker compose up -d --build`. |
| `make down` | `docker compose down`. Remove containers, **mantém os volumes** (banco e sessão do WhatsApp sobrevivem). |
| `make build` | `docker compose build --no-cache`. Necessário ao mudar `agent/requirements.txt`, o `dashboard/`, ou `VITE_API_URL`. |
| `make logs` | `docker compose logs -f agent`. Log estruturado JSON via structlog (`agent/main.py:19`). |
| `make logs-all` | Logs de todos os serviços juntos. |
| `make shell` | `docker compose exec agent /bin/bash` — dentro do container o banco está em `/app/data/sessions.db`. |
| `make dev-dashboard` | `cd dashboard && npm install && npm run dev` — Vite com HMR na 5173 do host. Colide com o container `juris_dashboard`, que já publica 5173: derrube-o antes (`docker compose stop dashboard`). Precisa do agente de pé na 3100. |
| `make test` | `test-golden` + `smoke`, nessa ordem. |
| `make test-golden` | `python3 tests/runner.py tests/golden/` — 7 cenários contra o Claude real. Precisa do agente rodando. |
| `make smoke` | `bash tests/smoke.sh` — `curl` em `/health`, `/api/stats` e no dashboard. Não chama o Claude, não custa nada. |
| `make backup` | `docker compose exec backup sqlite3 ... .backup` para `/backups/sessions_manual_<timestamp>.db`, dentro do volume `agent_db_backups`. |
| `make reset-db` | Pede confirmação (`sim`), para o agente e tenta `docker volume rm`. **Está quebrado:** `Makefile:113` remove `lumina-agent_agent_db`, o volume do projeto original; o volume real deste projeto é `agente-advocacia_agent_db` (o Compose prefixa com o nome da pasta). O `2>/dev/null \|\| true` engole o erro, o alvo diz "Banco resetado." e nada foi resetado. Para resetar de verdade: `make down && docker volume rm agente-advocacia_agent_db && make up`. |

---

## 3. Loop de desenvolvimento sem WhatsApp

`POST /api/test/message` (`agent/api.py:536`) roda o loop completo do Claude — RAG, contexto
do lead, tools, banco — e devolve `{reply, tool_calls}` **sem enviar nada pela Evolution**.
É o mesmo caminho que os golden tests usam.

```bash
# Uma mensagem solta
curl -sX POST http://localhost:3100/api/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "5511999999999", "text": "oi, fui demitido sem justa causa"}' | python3 -m json.tool
```

```json
{
  "reply": "Sinto muito, ...",
  "tool_calls": ["save_lead_field"]
}
```

Conversa com histórico — o endpoint **não** lê o histórico do banco, você o envia:

```bash
curl -sX POST http://localhost:3100/api/test/message \
  -H "Content-Type: application/json" \
  -d '{
        "phone": "5511999999999",
        "text": "achei vocês no google",
        "history": [
          {"role": "user",      "content": "oi, sou o Rafael, fui demitido"},
          {"role": "assistant", "content": "Sinto muito, Rafael. Me conta o que aconteceu?"}
        ]
      }'
```

Zerar o estado do telefone entre execuções (`agent/api.py:557`, apaga
`sessions`, `lead_data`, `lead_status`, `appointments`, `escalations` e os slots oferecidos):

```bash
curl -sX POST http://localhost:3100/api/test/reset \
  -H "Content-Type: application/json" -d '{"phone": "5511999999999"}'
```

Detalhes que economizam confusão:

- O telefone pode ir cru; `agent/api.py:67 _jid()` completa com `@s.whatsapp.net` e deixa
  JIDs `@lid` intactos.
- Os dois endpoints ficam **bloqueados** se `FLASK_ENV=production` (`agent/api.py:542` e
  `:563`). O compose não define essa variável, então em dev eles estão abertos.
- O que você mandar por aqui **aparece no CRM** — lead, conversa e consultas são gravados
  de verdade. Use um número fictício e limpe com `/api/test/reset`.
- Diferente do caminho do WhatsApp, aqui não há debounce, não há `RESPONSE_DELAY` de 5s
  (`agent/agent_core.py:59`) e a resposta não é quebrada em balões.

Alterou prompt, knowledge ou tenant? Reinicie o agente: o system prompt é montado uma vez
no import (`agent/agent_core.py:56`), o RAG lê os `.md` uma vez (`agent/rag.py:33`) e o
tenant é singleton (`agent/config.py:145`).

```bash
docker compose restart agent
```

---

## 4. Testes

Três camadas com custos bem diferentes.

### 4.1 Testes offline (sem rede, sem Claude, sem agente de pé)

Precisam de **Python 3.11**. Rode em container, como as docstrings mandam:

```bash
docker run --rm -v "$PWD":/w -w /w python:3.11-slim \
  sh -c "pip install -q pyyaml structlog requests; \
         python tests/test_funnel.py && \
         python tests/test_triagem_horario.py && \
         python tests/test_tom_assertions.py"
```

| Arquivo | O que prova |
|---|---|
| `tests/test_funnel.py` | Contrato do funil em `agent/sessions.py`: quem só mandou "oi" continua como lead `novo`; lead com os 5 campos vira `qualificado` sozinho; agendar vira `consulta_agendada`; status humano do CRM vence o derivado; `motivo_perda` só sobrevive em `perdido`; lead perdido que volta e agenda sai de perdido; ninguém some da contagem. |
| `tests/test_triagem_horario.py` | Horário e dias úteis vindos do tenant (9h-18h, seg-sex, sem o 19h herdado da estética); `_is_served_area` recusa área não atendida e mantém o lead no funil quando a área é vaga; o contrato de tools bate com `ESCALATION_CATEGORIES` e com `lead_fields`; `marcar_fora_de_escopo` continua visível no CRM como `perdido`/`fora_area_atuacao` com o texto livre preservado; telefones dos cenários golden são estáveis e sem colisão. |
| `tests/test_tom_assertions.py` | As asserções de tom do próprio runner: o regex de emoji pega 😊🙂✨🙏💜❤️🇧🇷 e não dá falso positivo em "R$ 1.000,00" nem nos marcadores ✓/✗ do prompt; os regex de euforia pegam as três frases que o agente escreveu de verdade em produção; o regex de parecer jurídico distingue "você tem direito" (proibido) de "quem pode dizer se você tem direito é o advogado" (a recusa correta). Existe porque um regex errado falha em silêncio, deixando o cenário 07 passar com emoji. |

`tests/test_tom_assertions.py` roda em Python 3.9 também — só importa `runner.EMOJI_RE`.

### 4.2 Smoke (`make smoke`)

`tests/smoke.sh` faz `curl -sf` em `/health`, `/api/stats` e no dashboard. Não chama Claude.
É o teste de "os containers subiram". Falha aqui é infra, nunca é o agente.

### 4.3 Golden tests (`make test-golden`)

`tests/runner.py` roda cada `tests/golden/*.yaml` contra `POST /api/test/message` do agente
**rodando**, que por sua vez chama o **Claude real**. Daí a exigência de `ANTHROPIC_API_KEY`:
não existe mock — o que está sob teste é o comportamento do modelo com este system prompt,
não o código Python em volta dele. Cada rodada gasta tokens de verdade.

Cada cenário usa um telefone fictício estável derivado do MD5 do nome do arquivo
(`tests/runner.py:39`; `hash()` de string é randomizado por processo e gerava lead órfão a
cada rodada) e chama `/api/test/reset` antes de começar (`tests/runner.py:48`), senão a 2ª
rodada roda em cima do estado da 1ª e o agente deixa de chamar `save_lead_field`.

Asserções disponíveis num step `agent`:

| Chave | Efeito |
|---|---|
| `expect_tool_calls` | Estas tools têm que ter sido chamadas no turno |
| `expect_text_contains` | Fragmentos que precisam aparecer na resposta |
| `expect_text_absent` | Fragmentos proibidos (é a prova das recusas OAB) |
| `expect_text_absent_regex` | Regex proibido — pega a paráfrase que a substring literal deixava passar |
| `expect_no_emoji` | Reprova qualquer emoji na resposta |

Os sete cenários:

| Arquivo | O que prova |
|---|---|
| `01_qualificacao.yaml` | Nome e área na primeira mensagem são salvos e **não** re-perguntados; nada de mérito, valor ou artigo de lei; fecha com `mark_lead_complete`. |
| `02_agendamento.yaml` | Período e formato informados → consulta a agenda sem re-perguntar; escolha explícita → `create_pending_appointment` na hora; a consulta nunca é anunciada como confirmada. |
| `03_recusas_oab.yaml` | As quatro perguntas que sempre aparecem (custo, chance, valor/prazo, "o que eu faço?"). A prova é a ausência: nenhum valor, estimativa ou juízo de mérito — e **sem escalar na primeira vez**, senão todo lead iria para o humano. |
| `04_urgencia_escalada.yaml` | Prisão com audiência marcada escala antes da triagem. Prova a categoria pelo texto: "190" só existe em `ESCALATION_MESSAGES["urgencia_prazo"]` (`verticals/advocacia/tools.py:44`), já que o runner só enxerga nomes de tool. |
| `05_insistencia_juridica.yaml` | Recusa duas vezes e escala na terceira — e escala **chamando a tool**, não perguntando "quer que eu te transfira?". |
| `06_fora_de_escopo.yaml` | Área não atendida sai do funil sem indicar outro escritório e sem opinar. |
| `07_tom.yaml` | Regressão de três frases que o agente escreveu num WhatsApp real ("Felipe, seja bem-vindo! 😊", "Que bom que nos procurou.", "Ótimo, Felipe! Já tenho tudo que preciso aqui.") com um prompt que já proibia as três. Ver commit `6222186`. |

### 4.4 Estado real hoje

Verificado nesta máquina, com os containers de pé:

- `tests/test_funnel.py`, `tests/test_triagem_horario.py` e `tests/test_tom_assertions.py`:
  **passam** no container `python:3.11-slim`.
- `make smoke`: **passa** — `/health` responde `{"agent":"lumina","status":"ok","tenant":"juris"}`
  e o dashboard responde 200.
- `make test-golden`: **7/7 passam** contra o Claude real.
- Os três testes offline **não rodam** no Python 3.9 do sistema macOS (erro de sintaxe de
  tipos, seção 4.1). Não é falha do teste.
- `CLAUDE.md` afirma que o `.env` não existe; ele existe e tem `ANTHROPIC_API_KEY` preenchida.
  Essa linha do CLAUDE.md está desatualizada.
- Não existe suíte de teste do dashboard além de `dashboard/src/lib/api.test.ts`
  (`npm test` no `dashboard/package.json:10`, não coberto por nenhum alvo do Makefile).

---

## 5. Troubleshooting

### O WhatsApp recebe, mas o agente não responde

Ordem de checagem:

1. `make logs` mostra `message_received`? Se não, o webhook não chegou.
2. A Evolution está falando com o agente certo? `curl -H "apikey: $EVOLUTION_API_KEY"
   http://localhost:8081/webhook/find/<instância>` deve mostrar `.../webhook` e o evento
   `MESSAGES_UPSERT`. Se apontar para outro lugar, `make webhook`.
3. Você está na Evolution certa? **A deste projeto é a 8081**, a 8080 é de outro projeto
   nesta máquina (`docker-compose.yml:20`). `EVOLUTION_URL=http://localhost:8081` no `.env`.
   Foi exatamente esse o bug do commit `7730b6c`: a instância era criada na Evolution errada,
   silenciosamente.
4. Reiniciou o agente depois de configurar ngrok? `agent/main.py:95` re-registra o webhook
   com `http://agent:3000/webhook` fixo, sobrescrevendo o túnel. Rode `make webhook` de novo.
5. O webhook descarta de propósito: mensagens `fromMe` (`agent/main.py:132`) e grupos
   `@g.us` (`agent/main.py:136`). Testar mandando mensagem para si mesmo não funciona.

### A mensagem chegou e sumiu (dedup)

`agent/main.py:44 _is_duplicate()` guarda o `key.id` por 24h em memória e devolve 200 sem
processar na segunda vez. O log registra `webhook_dedup_hit` e o contador
`webhook_dedup_total` sobe. Se a Evolution reenviar a mesma mensagem (retry), ela é engolida
— correto. Se você está reprocessando um evento à mão para depurar, mude o `key.id` ou
reinicie o agente (o dicionário é em memória e some no restart).

### Resposta demora ~9 segundos

Somatório de projeto, não bug: 4s de debounce (`agent/main.py:41`) + 5s de `RESPONSE_DELAY`
(`agent/agent_core.py:59`) + latência do Claude. O debounce junta mensagens seguidas do mesmo
número numa só (`agent/main.py:57`), que é o que faz a conversa parecer natural quando a
pessoa escreve em três balões.

### Conversa aparece no CRM e abre vazia (JID `@lid`)

O WhatsApp entrega o remetente como `<id>@lid` no lugar do número. A normalização antiga
concatenava `@s.whatsapp.net` por cima, produzindo `1937...@lid@s.whatsapp.net`. Corrigido
no commit `7730b6c` com `agent/api.py:67 _jid()`, que só completa quando não há `@`. Se você
adicionar um endpoint novo que receba telefone, **use `_jid()`** em vez de concatenar.

O outro lado do `@lid` é o envio: a Evolution v1.8.2 lança `BadRequestException` para JIDs
`@lid`. O patch está *baked* na imagem (`evolution/Dockerfile:6`) e o `RUN` termina com um
`grep -c` que falha o build se o `sed` não pegar — se a imagem buildou, o patch está lá.
`setup/patch_evolution.sh` é a versão antiga do mesmo patch, aplicada por um serviço
`patcher` que **não existe mais** no `docker-compose.yml`; está órfão, não o chame.

### O agente parou de responder para uma pessoa específica

Provável escalação ativa. Depois de `escalate_to_human`, `agent/agent_core.py:73
mark_escalated()` silencia o bot por 30 minutos (`ESCALATION_TTL`, linha 70): toda mensagem
seguinte é só encaminhada ao humano (`agent/agent_core.py:357`), com o log
`message_forwarded_during_escalation`. É o comportamento desejado. O estado é em memória —
reiniciar o agente libera a conversa. Passados os 30 min, o agente volta com "Voltei! 😊"
(`agent/agent_core.py:364`).

### Resposta vazia / "Deixa eu confirmar uma coisa rápida com a equipe"

O tool loop tem teto de 5 iterações (`agent/agent_core.py:283`). Se o modelo usou tools sem
escrever texto, há uma rede de segurança que pede uma resposta sem tools
(`agent/agent_core.py:265 _force_text`). Se mesmo assim vier vazio, o log grava
`empty_reply_after_tool_loop` e a pessoa recebe a frase genérica de
`agent/agent_core.py:393`. Sintoma típico: prompt mandando chamar tool que não existe mais
no contrato — confira os nomes contra `verticals/advocacia/tools.py:100`.

### Balões repetidos ou faltando

O acumulador de texto junta o que o modelo escreveu junto das tool calls e remove balões com
mais de 60% de sobreposição de palavras (`agent/agent_core.py:240 _assemble`). O envio quebra
por `---` (`agent/agent_core.py:341`). Um balão que "sumiu" costuma ter sido classificado
como duplicata; um balão repetido costuma ser paráfrase abaixo do limiar.

### SQLite travado (`database is locked`)

O banco está em `/app/data/sessions.db` dentro do volume `agente-advocacia_agent_db`, em modo
WAL (`agent/sessions.py:65`), com uma conexão aberta e fechada por chamada. Fontes de
contenção:

- `/api/query` roda SQL arbitrário; a conexão abre em `mode=ro` e tem um *deadline* de 5s
  via `set_progress_handler` (`agent/api.py:517`). Query pesada não trava escrita, mas
  segura o processo.
- `get_all_leads()` carrega tudo em memória e filtra em Python (`agent/sessions.py:404`) —
  aceitável para um escritório, vira problema com milhares de leads.
- Nunca abra o `.db` com um cliente externo enquanto o agente escreve; use
  `POST /api/query` ou o backup (`make backup`).

Backup e restauração: os `.db` ficam no volume `agent_db_backups`, gerados às 02:00 com
retenção de 7 arquivos (`docker-compose.yml:99`).

### Dashboard abre mas os números não vêm

`VITE_API_URL` entra no bundle em **build time** (`dashboard/Dockerfile:11`). Se você mudou o
`.env` e só fez `make up`, o bundle antigo continua chamando o endereço velho. Solução:
`docker compose build dashboard && docker compose up -d dashboard`. O dashboard não tem
WebSocket: `useFetch` refaz o polling a cada 30s.

### Horários oferecidos são sempre plausíveis demais

`DEMO_CALENDAR=true` vence sobre credenciais válidas (`agent/gcal.py:135`). Nesse modo os
slots vêm de `_mock_slots` e **não existem** no calendário de ninguém.

### Leads estranhos no CRM (Camila, Fernando, Beatriz...)

`DEMO_SEED=true`. São os 20 leads de `agent/seed_demo.py:24`, com telefones `5511912345xxx`.
Desligue no `.env` e resete o banco (ver a ressalva do `make reset-db` na seção 2).

---

## 6. Checklist pré-deploy

**Bloqueadores de segurança**

- [ ] **`/api/query` sem autenticação** (`agent/api.py:505`). Executa SQL read-only arbitrário
      contra o banco e alimenta o MCP de `tools/juris_mcp.py`. Em `localhost:3100` é aceitável;
      exposto na rede, é a tabela `sessions` inteira legível — conversa de cliente com
      escritório de advocacia, sigilo profissional. Resolva com token no header ou bind em
      `127.0.0.1` antes de publicar. É o bloqueador registrado no `CLAUDE.md`.
- [ ] **`/api/test/message` e `/api/test/reset` abertos.** Só são bloqueados com
      `FLASK_ENV=production` (`agent/api.py:542` e `:563`), variável que o
      `docker-compose.yml` não define. `/api/test/reset` apaga leads, conversas e consultas de
      qualquer telefone. Defina `FLASK_ENV=production` no serviço `agent`.
- [ ] **CORS `Access-Control-Allow-Origin: *` em todo `/api/*`** (`agent/api.py:61`). Combinado
      com a ausência de auth, qualquer página web consegue ler o CRM do usuário. Restrinja à
      origem do dashboard.
- [ ] Nenhum `/api/*` pede credencial. Se o CRM for para a internet, ponha um proxy com auth
      na frente ou publique só o dashboard, mantendo o agente na rede interna.
- [ ] `credentials/google_credentials.json` e `.env` fora do git (já cobertos pelo
      `.gitignore`, confira mesmo assim). `qrcode.png` idem.
- [ ] `EVOLUTION_API_KEY` longa e aleatória; a Evolution na 8081 não deve ficar exposta.

**Configuração do tenant**

- [ ] `tenants/juris.yaml:9` e `:11` ainda dizem `PLACEHOLDER` — nome e endereço reais.
- [ ] `tenants/juris.yaml:32` `human_phone: "11999999999"` é fictício. Sem o número certo,
      toda escalação e toda notificação de agendamento morre em silêncio
      (`agent/evolution.py:59` só loga `notify_human_skipped`).
- [ ] Áreas de atuação (`tenants/juris.yaml:45`) batem com o que o escritório realmente atende
      — é o que decide o `marcar_fora_de_escopo`.
- [ ] Horário (`hours`, `hours_start`, `hours_end`, `workdays`) igual ao real.
- [ ] `EVOLUTION_INSTANCE` do `.env` igual a `integrations.evolution.instance` do YAML.
- [ ] Modelo escolhido de forma consciente: Sonnet no YAML custa mais que o Haiku default
      (`agent/config.py:101`); `CLAUDE_MODEL` no `.env` sobrepõe sem mexer no YAML.

**Dados e modo demo**

- [ ] `DEMO_SEED=false` e banco sem os leads `5511912345xxx`.
- [ ] `DEMO_CALENDAR=false` e Google Calendar realmente conectado (crie um agendamento de
      teste e confira o evento `[PENDENTE]` no calendário).
- [ ] Backup verificado: `make backup` e confirme que o arquivo apareceu no volume. Retenção
      é de 7 dias — se precisar de mais, mude `docker-compose.yml:99`.
- [ ] `make reset-db` corrigido ou proibido em produção: hoje ele mira o volume de outro
      projeto (`Makefile:113`).

**Comportamento**

- [ ] `make test-golden` verde com o tenant de produção — os cenários OAB são o que impede o
      agente de dar parecer jurídico.
- [ ] Conversa de ponta a ponta pelo WhatsApp real: primeiro contato → qualificação →
      agendamento → confirmação pela recepção (`confirmar <id>` no WhatsApp do
      `human_phone`, `verticals/advocacia/receptionist.py:19`).
- [ ] Uma escalação real testada: a equipe recebe a notificação e assume a conversa.
- [ ] `/health` e `/metrics` (`agent/main.py:116`, Prometheus) coletados por algum
      monitoramento — ou pelo menos alguém olhando `make logs`.

---

## 7. Limitações conhecidas

- **Não há deploy documentado.** Nenhum Compose de produção, nenhum reverse proxy, nenhum TLS,
  nenhum CI. Tudo neste documento assume uma máquina só, rodando `docker compose`.
- **Estado em memória morre no restart:** dedup de webhook, buffer de debounce, flag de
  escalação e os slots oferecidos (`agent/sessions.py:21`). Um único processo Flask; o
  projeto não roda em mais de uma réplica sem perder essas quatro coisas.
- **`/health` responde `"agent": "lumina"`** (`agent/main.py:113`), nome do projeto de origem.
  Cosmético, mas confunde monitoramento.
- **Sem migrations.** O schema é criado com `CREATE TABLE IF NOT EXISTS` a cada conexão
  (`agent/sessions.py:63`). Coluna nova exige `ALTER TABLE` manual em banco existente.
- **Sem teste automatizado do CRM** além de `dashboard/src/lib/api.test.ts`, que nenhum alvo
  do Makefile executa.
