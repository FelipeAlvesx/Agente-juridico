# 07 — Replicar para outro nicho

Guia executável para clonar este produto para outra vertical. Dois exemplos completos:
**imobiliária** e **clínica/saúde**.

Referências: [arquitetura](01-arquitetura.md) · [operação e testes](06-operacao-e-testes.md)

---

## 1. O coração do produto

Esqueça advocacia por uma página.

**O problema.** Um negócio de serviço recebe o primeiro contato pelo WhatsApp e perde
dinheiro em dois lugares: quem escreve fora do horário não é respondido, e quem é respondido
não vira registro. A recepção anota no caderno, o WhatsApp vira o CRM, e o lead que não
fechou some. O dono descobre no fim do mês que atendeu 80 pessoas e não sabe dizer quantas
eram do serviço que ele quer vender.

**O mecanismo.** Cinco etapas, sempre as mesmas, independentes de nicho:

```
acolher → qualificar → agendar → registrar → follow-up
```

1. **Acolher.** Responder em segundos, no tom do negócio, sem parecer robô e sem
   fazer promessa. Quem escreve tem um problema, não uma curiosidade.
2. **Qualificar.** Extrair, em conversa, um punhado fixo de campos que decidem se esse
   contato vale uma agenda: quem é, do que se trata, quão urgente, de onde veio. São 4 a 6
   campos, nunca um formulário.
3. **Agendar.** Consultar a agenda de verdade, oferecer no máximo 3 horários, criar o
   compromisso como **pendente** e deixar a confirmação para um humano. O agente nunca
   confirma sozinho — é o que impede o desastre de marcar em cima de compromisso real.
4. **Registrar.** Todo contato vira lead no CRM, **inclusive quem não terminou** e quem foi
   recusado. Um lead que sai fora de escopo continua visível, com o motivo.
5. **Follow-up.** O funil separa quem esfriou de quem parou de responder, para alguém
   retomar. É onde o produto se paga: o valor não está no lead que fechou sozinho, está no
   que ia se perder.

**Por que existe uma "vertical".** Só quatro coisas mudam entre nichos:

| O que muda | Onde vive |
|---|---|
| Os campos que qualificam | `lead_fields` no tenant YAML |
| O vocabulário e o tom | `prompts/` + `prompt_fragment.md` da vertical |
| As regras que o agente **não pode** violar | `agent_rules_extra` no tenant + prompt da vertical |
| O que é uma "consulta" | `procedure_durations` no tenant + descrições das tools |

O que **não** muda: o loop do Claude, o debounce, o dedup, a escalação para humano, a agenda,
o SQLite, o funil, o CRM. Isso é a engine, e ela não sabe o que é advocacia.

**Regra dura de cada vertical.** Todo nicho de serviço regulado tem um conselho profissional
que proíbe captação agressiva e promessa de resultado. Na advocacia é a OAB; na imobiliária é
o CRECI/COFECI; na saúde é o CFM/CRM (e mais a LGPD, porque dado de saúde é sensível). O
formato do problema é sempre o mesmo — **o agente acolhe, tria e agenda; qualquer juízo
técnico é do profissional** — e por isso ele cabe numa string de configuração
(`agent_rules_extra`) mais um bloco no prompt da vertical. O conteúdo é que muda.

---

## 2. Anatomia da troca

Todo arquivo que entra na conta ao criar a vertical `<nicho>`.

### Criar

| Arquivo | Papel |
|---|---|
| `verticals/<nicho>/__init__.py` | Vazio. Sem ele o `import_module` falha. |
| `verticals/<nicho>/tools.py` | **O contrato.** `get_tool_definitions(config)` e `execute_tool(fn, args, ctx)`, mais `ESCALATION_MESSAGES` e `ESCALATION_MESSAGE_DEFAULT`. Carregado dinamicamente em `agent/agent_core.py:107`. |
| `verticals/<nicho>/notifications.py` | Mensagens de WhatsApp para a equipe (lead qualificado, agendamento pendente, remarcação, cancelamento). |
| `verticals/<nicho>/receptionist.py` | Comandos `confirmar <id>` / `rejeitar <id> motivo` vindos do WhatsApp da recepção. Carregado em `agent/main.py:197`. |
| `verticals/<nicho>/prompt_fragment.md` | Camada de prompt do nicho: vocabulário, triagem, regras do conselho profissional. Montado em `agent/prompt_builder.py:43`. |
| `tenants/<cliente>.yaml` | Config do negócio. Aponte `TENANT_CONFIG` para ele. |
| `knowledge/*.md` | Base do RAG. **Substitua o conteúdo**, o diretório é fixo. |
| `tests/golden/*.yaml` | Cenários do nicho, incluindo os de recusa regulatória. |

### Editar

| Arquivo:linha | Por quê |
|---|---|
| `tenants/schema.yaml:7` | O enum `advocacia \| clinic \| generic` é documentação, mas mantenha honesto. |
| `agent/api.py:28` | `from verticals.advocacia.tools import slot_label` — import **fixo** da vertical dentro do CRM. Troque, ou mova `slot_label` para um módulo comum. |
| `agent/api.py:99` | `MOTIVOS_PERDA` tem `fora_area_atuacao` e `buscou_outro_escritorio`. |
| `agent/api.py:212` e `:238` | Textos "Sua consulta com o advogado está confirmada" e o ⚖️. |
| `agent/sessions.py:41` | `_INITIAL_SERVICES` — as áreas do Direito que o CRM semeia. |
| `agent/sessions.py:54` | `_INITIAL_PROFESSIONALS` — advogados fictícios. |
| `agent/sessions.py:287` | `LEAD_STATUSES` contém `consulta_agendada`. |
| `agent/sessions.py:295` | `_AGENT_STATUS` traduz `fora_de_escopo` → `perdido`/`fora_area_atuacao`. |
| `agent/prompt_builder.py:32` e `:36` | "WhatsApp da clínica" e "INFO DA CLÍNICA" — resíduo da vertical de estética, hardcoded no bloco de identidade de **todas** as verticais. |
| `agent/config.py:130` | `lead_fields` default é `[nome, procedimento_interesse, indicacao]` (estética). Só aparece se o tenant omitir. |
| `prompts/base/engine_rules.md` | Escrito para advocacia: cita `marcar_fora_de_escopo`, `area_juridica`, "prisão, audiência, liminar". |
| `prompts/base/human_persona.md` | Idem: "foi demitido, está endividado, familiar preso". |
| `dashboard/src/lib/api.ts:28,49,139` | Rótulos de motivo de perda, campos do lead, categorias de escalação. |
| `dashboard/src/lib/theme.ts:53` | `AREA_SHORT` — as 8 áreas do Direito. |
| `dashboard/src/pages/Triagem.tsx:29` | Categorias e textos ("ato privativo do advogado"). |
| `dashboard/src/pages/Metrics.tsx:16` | `ESC_LABEL`. |
| `dashboard/src/pages/Pipeline.tsx:18` | "Fechou com o escritório". |
| `dashboard/src/pages/Configuracoes.tsx:60,156` | Filtra `category === 'Áreas de atuação'` e cita `tenants/juris.yaml`. |
| `dashboard/src/components/Sidebar.tsx:116`, `dashboard/index.html:8` | Marca "Juris". |
| `agent/seed_demo.py:24` | Os 20 leads de demonstração. |
| `docker-compose.yml` | `container_name: juris_*`, `TENANT_CONFIG=/app/tenants/juris.yaml`. |
| `Makefile:113` | Já aponta para o volume errado (ver [06](06-operacao-e-testes.md#2-alvos-do-makefile)); corrija junto. |

### Manter intacto

`agent/agent_core.py` · `agent/main.py` · `agent/evolution.py` · `agent/gcal.py` ·
`agent/rag.py` · `agent/config.py` (fora do default de `lead_fields`) ·
`tests/runner.py` · `tests/smoke.sh` · `evolution/Dockerfile` · `setup/` ·
`agent/sessions.py` na parte de schema, funil e appointments.

Se você se pegar editando `agent_core.py` para caber o nicho, parou de replicar e começou a
forkar. O ponto de extensão é `verticals/<nicho>/tools.py`.

---

## 3. Passo a passo

Exemplo com `<nicho> = imobiliaria`.

### Passo 1 — Esqueleto da vertical

```bash
mkdir -p verticals/imobiliaria
touch verticals/imobiliaria/__init__.py
cp verticals/advocacia/tools.py         verticals/imobiliaria/tools.py
cp verticals/advocacia/notifications.py verticals/imobiliaria/notifications.py
cp verticals/advocacia/receptionist.py  verticals/imobiliaria/receptionist.py
sed -i '' 's/verticals\.advocacia/verticals.imobiliaria/g' verticals/imobiliaria/*.py
```

O `sed` é obrigatório: os três arquivos importam uns aos outros pelo caminho absoluto
(`verticals/advocacia/tools.py:23`, `verticals/advocacia/receptionist.py:11`). Foi
exatamente esse esquecimento que gerou o commit `417a46e` ("aponta imports da vertical
copiada para advocacia").

### Passo 2 — Tenant YAML

`tenants/<cliente>.yaml`. Obrigatórios (`agent/config.py:84`): `tenant_id`, `vertical`,
`business.name`, `business.timezone`, `business.hours`, `agent.name`,
`integrations.evolution.instance`, `integrations.human_phone`. O resto tem default
(`tenants/schema.yaml`).

**`vertical` tem que ser o nome da pasta** — é o que `import_module(f"verticals.{vertical}.tools")`
resolve.

Aponte o compose para ele:

```yaml
      - TENANT_CONFIG=/app/tenants/imobiliaria.yaml
```

### Passo 3 — Campos de lead e tools

`lead_fields` vira, sem código nenhum, o `enum` do `save_lead_field`
(`verticals/advocacia/tools.py:112`) e o "ainda faltam coletar" do contexto
(`agent/agent_core.py:147`). Trocar os campos no YAML já muda o comportamento.

O que exige código em `tools.py`:

- as **descrições** de cada campo dentro de `save_lead_field` (linha 117), que é onde o
  modelo aprende o formato de cada valor;
- validação de valor fechado — hoje `URGENCIA_LEVELS` (linha 35, validada na linha 301);
- a tool de recusa: `marcar_fora_de_escopo` + `_is_served_area` (linha 81);
- `ESCALATION_CATEGORIES` e `ESCALATION_MESSAGES` (linhas 40-70).

**Não renomeie** `save_lead_field`, `mark_lead_complete`, `list_available_slots`,
`create_pending_appointment`, `reschedule_appointment`, `cancel_appointment` ou
`escalate_to_human` sem varrer `prompts/base/*.md` e `tests/golden/*.yaml` atrás dos nomes.

### Passo 4 — Prompt

Três camadas, montadas em `agent/prompt_builder.py:45` nesta ordem: identidade (gerada em
código) → `prompts/base/human_persona.md` → `verticals/<nicho>/prompt_fragment.md` →
`prompts/base/engine_rules.md` → `agent_rules_extra` do tenant → FAQ extra.

Placeholders disponíveis (`agent/prompt_builder.py:17`): `{agent_name}`, `{business_name}`,
`{procedures_list}`, `{payment_methods}`.

O `prompt_fragment.md` precisa cobrir, no mínimo:

1. contexto do negócio e o que o agente faz;
2. tabela **linguagem do cliente → categoria** (o cliente não fala a taxonomia interna);
3. o que o agente **nunca** faz, com resposta-modelo para cada pergunta previsível;
4. quando escalar na hora;
5. como conduzir (acolhimento, tamanho de balão, uma pergunta por vez).

### Passo 5 — Knowledge (RAG)

`agent/rag.py:9` lê `/app/knowledge/*.md`, quebra por parágrafo e casa palavra-chave. Duas
consequências: **um parágrafo = um chunk** (escreva parágrafos autossuficientes) e o
diretório é único por deploy — não há knowledge por vertical.

### Passo 6 — Golden tests

Copie a estrutura de `tests/golden/` e reescreva. O conjunto mínimo:

| Cenário | Prova |
|---|---|
| Qualificação completa | Salva o que já foi dito, não re-pergunta, fecha com `mark_lead_complete` |
| Agendamento | Não re-pergunta o que já foi dito; consulta fica **pendente**, nunca "confirmada" |
| Recusas do conselho profissional | A ausência: nenhum valor, nenhuma promessa, nenhum parecer técnico |
| Urgência | Escala antes de qualificar |
| Insistência | Recusa 2x, escala na 3ª chamando a tool |
| Fora de escopo | Sai do funil sem indicar concorrente |
| Tom | `expect_no_emoji` + regex de euforia |

### Passo 7 — Rótulos do CRM

Do mais barato ao mais caro:

1. `dashboard/src/lib/api.ts` (campos do lead, motivos de perda, categorias de escalação);
2. `dashboard/src/lib/theme.ts` (`AREA_SHORT`, `URGENCIA`);
3. páginas com texto fixo: `Triagem.tsx`, `Pipeline.tsx`, `Metrics.tsx`, `Overview.tsx`,
   `FollowUp.tsx`, `Configuracoes.tsx`;
4. marca: `Sidebar.tsx:116`, `index.html:8`, `dashboard/public/icon.png`,
   `dashboard/tailwind.config.ts`;
5. ícones: `IconGavel`/`IconScale` em `Icon.tsx:205`.

Depois: `docker compose build dashboard`.

### Passo 8 — Semente e demo

`agent/sessions.py:41` e `:54` semeiam `services` e `professionals` no primeiro boot.
`agent/seed_demo.py` popula a demo. Ambos jurídicos hoje.

### Passo 9 — Rodar

```bash
docker compose build agent dashboard
make up
make webhook

# Testes offline (Python 3.11 obrigatório)
docker run --rm -v "$PWD":/w -w /w python:3.11-slim \
  sh -c "pip install -q pyyaml structlog requests; python tests/test_triagem_horario.py"

make test-golden
```

Se o tenant estiver incompleto, o agente morre no boot com a lista de campos faltando
(`agent/config.py:96`) — é o comportamento desejado.

---

## 4. Exemplo A — Imobiliária

**O que muda de fato:** "consulta com o advogado" vira **visita ao imóvel**; "áreas de
atuação" viram **tipo de imóvel / região**; a OAB vira **CRECI/COFECI**; e aparece um campo
que a advocacia não tem — **faixa de preço** — que muda a natureza do agendamento, porque
visitar imóvel fora do orçamento é queimar a agenda do corretor.

### Campos de lead

| Campo | Valores | Por quê |
|---|---|---|
| `nome` | livre | igual |
| `finalidade` | `comprar` · `alugar` · `vender` · `avaliar` | decide o funil inteiro; quem quer **vender** não visita nada, vai para captação |
| `tipo_imovel` | apartamento, casa, terreno, sala comercial, galpão | filtra o portfólio |
| `bairro` | livre | região de interesse; é o que define se está na área de atuação |
| `faixa_preco` | livre, como a pessoa falou | não é qualificação financeira, é filtro de portfólio |
| `prazo` | `imediato` · `3_meses` · `sem_pressa` | equivalente do `urgencia`; ordena o follow-up |
| `origem` | livre | igual |

Sete campos é muito para uma conversa. Ou corte `faixa_preco` para depois da primeira visita,
ou aceite qualificação em duas etapas. Advocacia usa cinco, e cinco já é longo.

### Tools equivalentes

| Advocacia | Imobiliária | Mudança |
|---|---|---|
| `save_lead_field` | igual | novo `enum`, novas descrições |
| `mark_lead_complete` | igual | — |
| `marcar_fora_de_escopo` | `marcar_fora_de_atuacao` | recusa por **região** ou tipo de imóvel; `_is_served_area` compara contra os bairros do tenant |
| `list_available_slots` | igual | `procedure_type` = "Visita presencial" \| "Visita virtual"; duração menor (45 min) e **sábado é dia útil** |
| `create_pending_appointment` | igual | `notes` leva imóvel de interesse + faixa; o corretor confirma |
| `get_patient_appointments` | igual (nome legado) | ver seção 6 |
| `reschedule_appointment` / `cancel_appointment` | iguais | — |
| `escalate_to_human` | igual | outras categorias |
| — | **`registrar_imovel_interesse`** (nova) | quando a pessoa manda o link/código de um anúncio; sem isso a informação mais valiosa da conversa vira texto solto |

Categorias de escalação: `proposta_negociacao` (falou em valor de proposta, desconto,
condição de pagamento — é o corretor quem negocia), `documentacao_juridica` (inventário,
usucapião, financiamento negado), `imovel_indisponivel`, `captacao` (quer vender/alugar o
próprio imóvel), `reclamacao`, `pedido_humano`, `confusao_repetida`.

### O que substitui as regras da OAB

A intermediação imobiliária é privativa de corretor inscrito no CRECI (Lei 6.530/1978), e a
publicidade do setor é regulada pelo COFECI (Código de Ética Profissional e as resoluções de
publicidade, que exigem identificação do CRECI no anúncio). Traduzido para o agente:

- **Nunca** dizer que financiamento será aprovado, nem simular parcela, juros ou capacidade
  de crédito — quem faz isso é o banco.
- **Nunca** prometer valorização, renda de aluguel ou retorno de investimento.
- **Nunca** negociar preço, desconto ou condição — é ato do corretor; escale.
- **Nunca** afirmar situação documental do imóvel (matrícula limpa, IPTU quitado, averbação)
  sem consulta; escale.
- **Nunca** filtrar ou sugerir bairro por perfil de morador. Isso é discriminação, e a
  conversa fica gravada no CRM.
- Identificar-se sempre como atendimento da imobiliária, com o CRECI da empresa quando
  divulgar imóvel — nunca como corretor.
- Sem urgência artificial: "última unidade", "esse some hoje", "garanta agora" ficam fora.

> Confirme as resoluções vigentes com o CRECI do estado antes de publicar. O que está aqui
> orienta a redação do prompt; não substitui parecer.

### Tom

Menos grave que na advocacia — quem procura imóvel não está num momento ruim. Mas **sem
euforia comercial**: nada de "temos a casa dos seus sonhos!", nada de exclamação em série.
Objetivo, prestativo, rápido. Emoji: mesma regra (raríssimo, sóbrio). O vocabulário some de
"cliente/paciente" e vira **cliente**; "consulta" vira **visita**; "caso" vira **busca** ou
**imóvel de interesse**.

### O que vira "consulta"

A **visita ao imóvel**. Três diferenças operacionais que quebram o default da engine:

1. **Sábado é dia de maior volume.** `workdays: [seg, ter, qua, qui, sex, sab]` — o default
   da engine (`agent/config.py:59`) já é seg-sáb; foi a advocacia que restringiu.
2. **A visita tem endereço**, e o endereço não é o da empresa. Hoje o evento do Google
   Calendar não tem campo de local (`agent/gcal.py:211`) — o endereço vai em `notes`, que
   aparece na descrição, até alguém adicionar `location` ao evento.
3. **Visita depende de terceiro** (proprietário ou inquilino). Isso reforça, não relaxa, o
   modelo de agendamento pendente: o corretor confirma depois de falar com quem tem a chave.

### YAML do tenant

```yaml
tenant_id: horizonte
vertical: imobiliaria

model: claude-sonnet-4-6

business:
  name: Horizonte Imóveis
  segment: Imobiliária de bairro — compra, venda e locação residencial
  address: "Av. das Palmeiras 880 — Santana, São Paulo/SP"
  phone: ""
  timezone: America/Sao_Paulo
  hours: "segunda a sexta das 9h às 18h, sábado das 9h às 13h."
  hours_start: 9
  hours_end: 18
  workdays: [seg, ter, qua, qui, sex, sab]

agent:
  name: Marina
  role: assistente de atendimento
  persona_notes: >
    Objetiva e prestativa. Entende o que a pessoa procura, registra e agenda a visita
    com o corretor. Nunca negocia preço, nunca fala de financiamento ou aprovação de
    crédito, nunca promete valorização.

integrations:
  evolution:
    instance: "horizonte"
    human_phone: "11988887777"     # corretor de plantão
  google_calendar:
    calendar_id: ""
    slot_duration_minutes: 45
    slot_buffer_minutes: 30        # deslocamento entre imóveis
    procedure_durations:
      Visita presencial: 45
      Visita virtual: 30
      Atendimento na loja: 30

vertical_config:
  # "procedures" na engine = regiões atendidas nesta vertical.
  lead_fields: [nome, finalidade, tipo_imovel, bairro, faixa_preco, prazo, origem]
  procedures:
    - Santana
    - Tucuruvi
    - Casa Verde
    - Vila Guilherme
    - Jaçanã
    - Mandaqui
  payment_methods:
    - Condições e formas de pagamento tratadas com o corretor
    - Financiamento avaliado pelo banco, não pela imobiliária

knowledge:
  extra_faq:
    - q: "Consigo financiar?"
      a: "Quem avalia crédito é o banco, com a sua documentação. O corretor te explica o caminho e os documentos na visita. Quer que eu veja um horário?"
    - q: "Dá pra baixar o valor?"
      a: "Valor e condições são tratados diretamente com o corretor. Posso agendar uma conversa com ele?"
    - q: "Aceita pet?"
      a: "Depende das regras do condomínio e do proprietário de cada imóvel. O corretor confirma isso antes da visita."
    - q: "Quero anunciar meu imóvel com vocês"
      a: "Ótimo momento para falar com o corretor responsável pela captação. Posso pedir para ele te chamar aqui?"

agent_rules_extra: >
  NUNCA simule financiamento, parcela, juros, entrada ou aprovação de crédito — quem avalia
  crédito é o banco. NUNCA prometa valorização, rentabilidade de aluguel ou retorno de
  investimento. NUNCA negocie preço, desconto ou condição de pagamento — isso é ato do
  corretor: escale. NUNCA afirme situação de documentação (matrícula, IPTU, averbação, débito
  de condomínio) sem confirmação: escale. NUNCA sugira ou desaconselhe bairro por perfil de
  morador. NUNCA use urgência artificial ("última unidade", "só hoje", "garanta agora").
  Identifique-se como atendimento da imobiliária, nunca como corretor. O papel é acolher,
  entender a busca e agendar a visita.
```

### Esboço do `prompt_fragment.md`

```markdown
# Fragmento de Prompt — Vertical Imobiliária

## Contexto

{business_name} é uma imobiliária. Você faz o **primeiro contato**: entende o que a pessoa
procura, registra a busca e agenda a visita com o corretor. Toda negociação, avaliação de
crédito e conferência de documento acontece com o corretor — nunca no WhatsApp, nunca por você.

## Regiões atendidas

{procedures_list}

Imóvel fora dessas regiões: chame `marcar_fora_de_atuacao`. Seja honesta — a imobiliária não
atua ali — e não indique concorrente.

## Valores e financiamento

{payment_methods}

Você **nunca** simula parcela, entrada, juros ou aprovação de crédito, e nunca negocia preço
ou desconto. Isso é do corretor e do banco, não seu.

## Triagem (linguagem do cliente → finalidade)

| A pessoa diz | Finalidade |
|---|---|
| "quero comprar", "procuro um apê pra morar", "vi um anúncio" | comprar |
| "procuro pra alugar", "quanto é o aluguel", "preciso mudar até..." | alugar |
| "quero vender meu apartamento", "vocês anunciam?" | vender → escale (captação) |
| "quanto vale meu imóvel?" | avaliar → escale (captação) |

Quem quer **vender ou avaliar** não entra no funil de visita: registre e escale para captação.

## O que você NUNCA faz

1. **"Consigo financiar? Quanto fica a parcela?"**
   > "Quem avalia crédito é o banco, com a sua documentação em mãos. O corretor te explica o
   > caminho e os documentos. Posso agendar essa conversa?"
2. **"Esse imóvel valoriza? Dá pra alugar por quanto?"**
   > "Não consigo estimar isso — depende de muita coisa da região e do momento. O corretor
   > conversa com você sobre o imóvel na visita."
3. **"Dá pra baixar o preço?"**
   > "Valor e condições são tratados direto com o corretor. Quer que eu já veja um horário
   > com ele?"
4. **"A documentação está ok? Tem débito de condomínio?"**
   > "Vou confirmar isso com o corretor antes da visita, para você receber a informação certa."

Também nunca: dizer que um bairro é bom ou ruim, que é seguro ou perigoso; comparar
vizinhança; sugerir região pelo perfil da pessoa; criar urgência ("essa é a última", "some
rápido").

## Escale na hora

Proposta ou negociação de valor · pessoa querendo vender ou avaliar imóvel próprio · dúvida
documental, jurídica ou de financiamento · imóvel indisponível ou já alugado · reclamação.

## Como conduzir

- Uma pergunta por vez. `finalidade` e `bairro` primeiro — eles decidem o resto.
- `faixa_preco`: registre como a pessoa falou ("até uns 400 mil"). Não peça renda, não peça
  comprovante, não faça análise de crédito.
- Antes de oferecer horário, confirme **visita presencial ou virtual** (define a duração).
- Visita fica **pendente**: o corretor precisa combinar com quem tem a chave. Nunca diga que
  está confirmada.
- Se a pessoa mandar link ou código de anúncio, registre com `registrar_imovel_interesse`.
```

### Páginas do CRM afetadas

| Página | Mudança |
|---|---|
| `Pipeline.tsx` | `consulta_agendada` → "Visita agendada"; badge de área vira bairro; :18 "Fechou com o escritório" → "Fechou negócio" |
| `Triagem.tsx` | Categorias novas; some "ato privativo do advogado"; entra "negociação — corretor assume" |
| `FollowUp.tsx` | `URG_WEIGHT` passa a ordenar por `prazo` (`imediato` > `3_meses` > `sem_pressa`) |
| `Overview.tsx` | Gráfico "por área jurídica" (:154) vira "por bairro" ou "por finalidade" |
| `Metrics.tsx` | "Como chegaram até o escritório" → "até a imobiliária"; `ESC_LABEL` novo |
| `Conversations.tsx` | Ficha lateral: Área/Caso → Busca (finalidade + tipo + bairro + faixa) |
| `Configuracoes.tsx` | "Áreas de atuação" → "Regiões atendidas"; some o aviso sobre honorários |
| `Appointments.tsx` | "Consulta" → "Visita"; falta o **endereço do imóvel**, hoje inexistente na tabela `appointments` |
| `Sidebar.tsx`, `Icon.tsx` | Marca; `IconGavel`/`IconScale` → chave/casa |

---

## 5. Exemplo B — Clínica / Saúde

Este é o mais delicado dos três: a conversa contém **dado pessoal sensível** na acepção da
LGPD, e a publicidade médica é a mais restrita das três profissões.

### Campos de lead

| Campo | Valores | Por quê |
|---|---|---|
| `nome` | livre | igual |
| `especialidade` | do `procedures` do tenant | quem atende |
| `motivo_contato` | **frase curta e neutra** | ver o alerta abaixo |
| `convenio` | nome do plano ou `particular` | decide se a consulta é viável |
| `primeira_vez` | `sim` · `nao` | retorno tem duração e regra diferentes |
| `origem` | livre | igual |

**O campo mais perigoso do produto é `motivo_contato`.** Em advocacia, `resumo_caso` guarda o
relato da pessoa. Aqui, o equivalente vira histórico clínico gravado num SQLite e exibido num
CRM. Duas decisões precisam ser tomadas antes de escrever a primeira linha:

1. **Colete o mínimo.** Instrua o modelo a registrar apenas o suficiente para direcionar a
   especialidade ("encaminhamento do clínico para cardiologista", "retorno de exame"), nunca
   sintoma detalhado, diagnóstico, medicação ou resultado. O que o agente não pergunta não
   vaza.
2. **Nunca envie detalhe clínico nas notificações de WhatsApp** de
   `verticals/<nicho>/notifications.py`. A versão jurídica manda o resumo do caso para o
   `human_phone` (`verticals/advocacia/notifications.py:26`). Em saúde, mande nome, telefone
   e especialidade — nada mais.

### Tools equivalentes

| Advocacia | Clínica | Mudança |
|---|---|---|
| `save_lead_field` | igual | `enum` novo; descrição do `motivo_contato` **manda ser breve e não clínica** |
| `marcar_fora_de_escopo` | `marcar_especialidade_nao_atendida` | por especialidade |
| `list_available_slots` | igual | `procedure_type` = "Primeira consulta" \| "Retorno" \| "Teleconsulta" |
| `create_pending_appointment` | igual | recepção confirma |
| `escalate_to_human` | igual | categorias novas |
| — | **`verificar_convenio`** (opcional) | consulta a lista de planos aceitos do tenant; sem ela o modelo inventa |

Categorias de escalação: **`emergencia_medica`** (a mais importante — dor no peito, falta de
ar, sangramento, pensamento suicida, acidente: a mensagem de transferência tem que trazer
**192 SAMU** e **188 CVV**, do mesmo jeito que a versão jurídica traz 190/180 em
`verticals/advocacia/tools.py:44`), `duvida_clinica`, `resultado_exame`, `convenio_negado`,
`reclamacao`, `pedido_humano`, `confusao_repetida`.

### LGPD e dado de saúde

Dado sobre saúde é **dado pessoal sensível** (LGPD, art. 5º, II), com base legal própria
(art. 11) e regime mais rígido que dado comum. O que isso impõe ao sistema, além do prompt:

- **Minimização.** Só o necessário para agendar. É decisão de produto, não de prompt.
- **Retenção.** `agent/sessions.py` guarda conversa indefinidamente; `TTL_SECONDS` (linha 13)
  só limita o que vai ao Claude, não o que fica no banco. Defina e implemente um prazo de
  descarte.
- **Acesso.** Hoje `/api/*` não tem autenticação nenhuma e o CORS é `*` (`agent/api.py:61`).
  Numa clínica isso é inaceitável antes do primeiro atendimento real — ver o
  [checklist pré-deploy](06-operacao-e-testes.md#6-checklist-pré-deploy). O bloqueador do
  `/api/query` (`agent/api.py:505`) vale em dobro aqui.
- **Backup.** O volume `agent_db_backups` passa a conter dado sensível.
- **Transferência a terceiro.** As mensagens vão para a API da Anthropic e para a Evolution.
  Isso precisa estar no aviso de privacidade da clínica.
- **Encarregado (DPO) e direitos do titular.** Não há hoje nenhum endpoint de exclusão a
  pedido do titular; `reset_lead` (`agent/sessions.py:412`) existe, mas está atrás de um
  endpoint de teste sem auth, o que não serve.

### CFM/CRM — publicidade e promessa de resultado

A publicidade médica é regulada pelo CFM (hoje a Resolução CFM 2.336/2023, que substituiu a
1.974/2011) e pelo Código de Ética Médica. Restrições que viram regra de prompt:

- **Nunca** dar diagnóstico, opinião clínica ou conduta — ato do médico, e à distância nem ele
  faz.
- **Nunca** prometer, garantir ou sugerir resultado de tratamento.
- **Nunca** orientar sobre medicação, dose, interrupção ou substituição.
- **Nunca** interpretar exame ou dizer se um resultado é bom ou ruim.
- **Nunca** divulgar preço, desconto, pacote, promoção ou "condição especial" de procedimento.
- **Nunca** usar imagem de antes/depois, depoimento de paciente ou linguagem sensacionalista.
- **Nunca** minimizar sintoma ("não deve ser nada", "isso é normal") — o inverso da promessa
  é igualmente perigoso.
- **Sempre** escalar emergência na hora, com os números de emergência, sem terminar a triagem.

> Confirme a resolução vigente e a redação com o responsável técnico da clínica antes de
> publicar.

### Tom

Próximo do jurídico: acolhedor, sóbrio, sem euforia. Quem escreve para uma clínica está com
dor, com medo ou com um exame na mão. Vocabulário: **paciente** (aqui o termo é o correto),
consulta, especialidade, retorno, convênio. Nunca "procedimento" para consulta clínica, nunca
"tratamento" antes de existir diagnóstico. Emoji: mesma regra restritiva — e, num contexto de
doença, "nenhum" é a resposta certa quase sempre.

### O que vira "consulta"

Continua sendo consulta, mas com três diferenças:

1. **Retorno** tem duração e regra próprias (janela pós-consulta, muitas vezes sem cobrança);
   `primeira_vez` existe justamente para isso.
2. **Convênio decide a viabilidade.** Slot oferecido para um plano não aceito é agenda
   perdida. Confirme o convênio **antes** de chamar `list_available_slots`.
3. **Teleconsulta** é modalidade separada, com duração menor.

### YAML do tenant

```yaml
tenant_id: vitalis
vertical: clinica

model: claude-sonnet-4-6

business:
  name: Clínica Vitalis
  segment: Clínica médica multiespecialidades
  address: "Rua das Acácias 220 — Pinheiros, São Paulo/SP"
  phone: ""
  timezone: America/Sao_Paulo
  hours: "segunda a sexta das 8h às 19h, sábado das 8h às 12h."
  hours_start: 8
  hours_end: 19
  workdays: [seg, ter, qua, qui, sex, sab]

agent:
  name: Bia
  role: assistente de agendamento
  persona_notes: >
    Acolhedora e sóbria. Recebe pessoas com dor, medo ou exame na mão. Nunca dá
    diagnóstico, nunca opina sobre sintoma, nunca fala de medicação, nunca interpreta
    exame, nunca informa preço. Direciona para a especialidade e agenda.

integrations:
  evolution:
    instance: "vitalis"
    human_phone: "11977776666"     # recepção
  google_calendar:
    calendar_id: ""
    slot_duration_minutes: 30
    slot_buffer_minutes: 0
    procedure_durations:
      Primeira consulta: 40
      Retorno: 20
      Teleconsulta: 30

vertical_config:
  lead_fields: [nome, especialidade, motivo_contato, convenio, primeira_vez, origem]
  # "procedures" na engine = especialidades atendidas nesta vertical.
  procedures:
    - Clínica Médica
    - Cardiologia
    - Dermatologia
    - Endocrinologia
    - Ginecologia
    - Ortopedia
    - Pediatria
    - Psiquiatria
  payment_methods:
    - Convênios atendidos informados pela recepção
    - Particular — valores informados pela recepção, nunca pelo agente

knowledge:
  extra_faq:
    - q: "Vocês atendem meu convênio?"
      a: "Me diga qual é o seu plano que eu confirmo com a recepção antes de agendar."
    - q: "Quanto custa a consulta particular?"
      a: "Valores são informados pela recepção. Posso pedir para eles te retornarem aqui?"
    - q: "Recebi meu exame, dá pra você me dizer se está tudo bem?"
      a: "Quem lê o exame é o médico, na consulta. Posso agendar um retorno para você levá-lo?"
    - q: "Preciso de encaminhamento para marcar com especialista?"
      a: "Depende do seu convênio. Me diga qual é o plano que eu confirmo com a recepção."

agent_rules_extra: >
  NUNCA dê diagnóstico, opinião clínica, orientação de conduta ou conselho de saúde — é ato
  privativo do médico. NUNCA interprete exame nem diga se um resultado é bom ou ruim. NUNCA
  fale de medicação, dose, troca ou interrupção. NUNCA prometa, garanta ou sugira resultado de
  tratamento. NUNCA informe preço, desconto, pacote ou promoção de consulta ou procedimento.
  NUNCA minimize sintoma ("não deve ser nada", "isso é normal") nem alarme a pessoa. Registre
  o motivo do contato em uma frase curta e neutra, suficiente para direcionar a especialidade:
  nada de sintoma detalhado, diagnóstico, medicação ou resultado de exame. Diante de sinal de
  emergência (dor no peito, falta de ar, sangramento intenso, desmaio, confusão mental,
  pensamento suicida, acidente), escale IMEDIATAMENTE com emergencia_medica, sem terminar a
  triagem. O papel é acolher, direcionar a especialidade e agendar.
```

### Esboço do `prompt_fragment.md`

```markdown
# Fragmento de Prompt — Vertical Clínica

## Contexto

{business_name} é uma clínica médica. Você faz o **agendamento**: acolhe, entende para qual
especialidade a pessoa precisa ir, confirma o convênio e marca a consulta. Toda avaliação
clínica acontece na consulta — nunca no WhatsApp, nunca por você. Você não é profissional
de saúde e nunca se apresenta como um.

## Especialidades atendidas

{procedures_list}

Especialidade não atendida: chame `marcar_especialidade_nao_atendida`, diga com clareza que a
clínica não atende e não indique outro serviço.

## Valores e convênio

{payment_methods}

Você **nunca** informa preço, desconto ou pacote. Convênio você **confirma antes de oferecer
horário** — slot marcado para plano não aceito é consulta perdida para todo mundo.

## Triagem (linguagem do paciente → especialidade)

| A pessoa diz | Especialidade |
|---|---|
| "check-up", "não sei qual médico", "atestado" | Clínica Médica |
| "pressão alta", "coração acelerado", "encaminhamento do cardiologista" | Cardiologia |
| "mancha na pele", "queda de cabelo", "acne" | Dermatologia |
| "tireoide", "diabetes", "hormônio" | Endocrinologia |
| "preventivo", "gravidez", "anticoncepcional" | Ginecologia |
| "dor no joelho", "torci o pé", "coluna" | Ortopedia |
| "meu filho", "criança", "bebê" | Pediatria |
| "ansiedade", "insônia", "acompanhamento psiquiátrico" | Psiquiatria |

Traduza em silêncio e confirme em linguagem comum: "Isso é com a Endocrinologia — posso ver
um horário?". Em dúvida entre duas, encaminhe para Clínica Médica; **nunca** use a dúvida
como desculpa para perguntar sintoma em detalhe.

## O que você NUNCA faz (CFM + Código de Ética Médica)

1. **"O que eu tenho? É grave?"**
   > "Não consigo avaliar isso — quem examina e responde é o médico. Posso agendar para você?"
2. **"Recebi meu exame, está bom?"**
   > "Quem lê o exame é o médico, com o seu histórico na frente. Quer que eu marque um retorno
   > para você levá-lo?"
3. **"Posso parar o remédio? Posso tomar junto com...?"**
   > "Nada de medicação por aqui, nem para confirmar. Isso é com o médico que prescreveu."
4. **"Esse tratamento resolve? Fica bom mesmo?"**
   > "Nenhum resultado pode ser prometido, e quem avalia o seu caso é o médico na consulta."
5. **"Quanto custa?"**
   > "Valores são informados pela recepção. Quer que eu peça para eles te retornarem?"

Também nunca: minimizar ("não deve ser nada", "isso é normal", "todo mundo tem"); alarmar
("melhor correr no pronto-socorro" fora de sinal de emergência); pedir foto de lesão, exame ou
receita; comentar caso de outro paciente.

## Emergência — escale na hora

Dor no peito, falta de ar, sangramento intenso, desmaio, confusão mental, convulsão,
pensamento de morte ou suicídio, acidente. Chame `escalate_to_human` com `emergencia_medica`
**antes** de qualquer pergunta de triagem. O sistema envia a mensagem com **192 (SAMU)** e
**188 (CVV)** — você não escreve nada.

## Sigilo e registro

Registre o `motivo_contato` em **uma frase curta e neutra**, suficiente para direcionar a
especialidade: "encaminhamento do clínico para cardiologista", "retorno de exame",
"consulta de rotina". Não registre sintoma detalhado, diagnóstico, medicação nem resultado.
Não repita o motivo mais que o necessário na conversa.

## Como conduzir

- Acolha em uma linha, depois pergunte. Uma pergunta por vez.
- Ordem: nome → especialidade (traduzindo o relato) → convênio → primeira vez ou retorno →
  horário. `motivo_contato` sai da própria conversa, não de interrogatório.
- Confirme o convênio **antes** de `list_available_slots`.
- A consulta fica **pendente** até a recepção confirmar. Nunca diga que está confirmada.
```

### Páginas do CRM afetadas

| Página | Mudança |
|---|---|
| Todas | Revisar **o que é exibido**: dado de saúde na tela de um CRM sem login é o maior risco do clone |
| `Conversations.tsx` | Mostra a transcrição completa ao lado da ficha — em saúde, exige controle de acesso |
| `Pipeline.tsx` | "Fechou com o escritório" → "Compareceu"; badge de área → especialidade |
| `Triagem.tsx` | `emergencia_medica` no topo, em vermelho, acima de tudo |
| `FollowUp.tsx` | Ordenação por `primeira_vez` e tempo sem contato, não por urgência clínica |
| `Overview.tsx` | Distribuição por especialidade e por convênio |
| `Metrics.tsx` | Taxa de comparecimento e no-show passam a ser a métrica principal |
| `Configuracoes.tsx` | "Áreas de atuação" → "Especialidades"; nova lista de convênios aceitos |

---

## 6. Armadilhas ao replicar

### 6.1 O que está hardcoded como jurídico

Levantado com busca direta no código. Tudo abaixo precisa ser parametrizado ou reescrito
**antes** de o clone atender alguém.

**Engine (`agent/`) — o pior grupo, porque não deveria saber de vertical nenhuma**

| Local | O que está preso |
|---|---|
| `agent/api.py:28` | `from verticals.advocacia.tools import slot_label` — import fixo da vertical dentro do CRM. Com outra vertical, o agente **não sobe**. |
| `agent/api.py:99-102` | `MOTIVOS_PERDA` com `fora_area_atuacao`, `buscou_outro_escritorio` |
| `agent/api.py:212` | "Sua consulta com o advogado está confirmada." |
| `agent/api.py:213,239` | Emojis ⚖️ nas mensagens de confirmação e remarcação |
| `agent/api.py:238` | "Sua consulta foi remarcada." |
| `agent/sessions.py:41-52` | `_INITIAL_SERVICES`: "Consulta inicial", "Consulta online" e as 8 áreas do Direito, semeadas no primeiro boot |
| `agent/sessions.py:54-58` | `_INITIAL_PROFESSIONALS`: três advogados fictícios com especialidade jurídica |
| `agent/sessions.py:287` | `LEAD_STATUSES` inclui `consulta_agendada` (rótulo de nicho num enum de engine) |
| `agent/sessions.py:295-297` | `_AGENT_STATUS = {"fora_de_escopo": ("perdido", "fora_area_atuacao")}` |
| `agent/agent_core.py:369` e `:416` | Rótulo de contexto `[INFORMAÇÕES DO ESCRITÓRIO RELEVANTES]` |
| `agent/prompt_builder.py:32` | "Atende pelo WhatsApp **da clínica**..." — resíduo de estética em **toda** vertical |
| `agent/prompt_builder.py:36` | Cabeçalho "INFO DA CLÍNICA" |
| `agent/config.py:130` | Default de `lead_fields`: `[nome, procedimento_interesse, indicacao]` (estética) |
| `agent/config.py:71` | Mensagem de erro sugere `tenants/lumina.yaml` |
| `agent/gcal.py:209` | Descrição do evento: "Paciente: ... / Procedimento: ..." |
| `agent/main.py:113` | `/health` responde `"agent": "lumina"` |
| `agent/seed_demo.py:24-77` | 20 leads, 10 consultas e conversas inteiramente jurídicos |
| `agent/rag.py:9` | `KB_DIR = /app/knowledge` fixo — não há knowledge por vertical |

**Emojis fixos no código, que violam a própria regra de tom do `CLAUDE.md`**

| Local | Texto |
|---|---|
| `agent/main.py:168,171` | "Tô com problema pra ouvir o áudio agora, manda em texto? 😊" |
| `agent/main.py:181` | "Por favor, envie sua mensagem em texto 😊" |
| `agent/main.py:218` | Lembrete D-1: "Olá! Aqui é a {agent_name}, da {name} 😊" |
| `agent/agent_core.py:114` | Default de escalação: "Um momento! Vou te transferir para nossa equipe 🙏" |
| `agent/agent_core.py:364` | "Voltei! 😊 Em que posso te ajudar?" |
| `agent/agent_core.py:393,403` | Fallback de erro com 🙏 |
| `verticals/advocacia/receptionist.py:51` | "Boa notícia! Seu agendamento foi confirmado 🎉" — euforia proibida pelo próprio projeto |
| `verticals/advocacia/receptionist.py:93` | 😊 |
| `verticals/advocacia/receptionist.py:117,124` | 😕 |
| `verticals/advocacia/notifications.py:11-16` | Labels 👤 ⚖️ 📝 ⏱️ 🔗 |
| `verticals/advocacia/notifications.py:30` | "🎯 *Novo lead qualificado!*" |
| `agent/evolution.py:64-66` | ⚠️ 📱 💬 na notificação de escalação |

São para a equipe em alguns casos (aceitável) e **para o cliente** em outros (não aceitável).
Ao clonar, decida por texto: o que a pessoa lê passa pela regra de tom do nicho.

**Vertical (`verticals/advocacia/`) — jurídico por definição, mas note o acoplamento**

| Local | O que está preso |
|---|---|
| `verticals/advocacia/tools.py:34` | `LEAD_STATUS_FORA_ESCOPO = "fora_de_escopo"`, contrato tácito com `sessions.py:295` |
| `verticals/advocacia/tools.py:35` | `URGENCIA_LEVELS` |
| `verticals/advocacia/tools.py:40-70` | `ESCALATION_MESSAGES` / `ESCALATION_CATEGORIES` (190/180 na urgência) |
| `verticals/advocacia/tools.py:81` | `_is_served_area` — match frouxo contra `config.procedures` |
| `verticals/advocacia/tools.py:143` | `marcar_fora_de_escopo`: único nome de tool em português no contrato |
| `verticals/advocacia/tools.py:117-127` | Descrições de `save_lead_field` citando `area_juridica`, `resumo_caso` |
| `verticals/advocacia/receptionist.py:2` | Docstring diz "vertical estética (Lumina)" — está errada desde o fork |

**Prompts e knowledge**

| Local | O que está preso |
|---|---|
| `prompts/base/engine_rules.md` | Cita `marcar_fora_de_escopo`, `area_juridica`, "prisão, audiência, liminar" e os 5 campos. É "base", mas é jurídica |
| `prompts/base/human_persona.md` | "foi demitido, está endividado, familiar preso"; "você não é advogada" |
| `knowledge/*.md` | Todos jurídicos |
| `tests/golden/*.yaml` | Todos jurídicos |
| `tenants/schema.yaml:7` | Enum `advocacia \| clinic \| generic` |

**Dashboard**

| Local | O que está preso |
|---|---|
| `dashboard/src/lib/theme.ts:53-62` | `AREA_SHORT` com as 8 áreas do Direito |
| `dashboard/src/lib/theme.ts:65` | `URGENCIA` (alta/media/baixa) |
| `dashboard/src/lib/api.ts:28-34` | `MOTIVO_PERDA_LABELS` ("Foi para outro escritório") |
| `dashboard/src/lib/api.ts:49-52` | Tipo `Lead` com `area_juridica`, `resumo_caso`, `urgencia`, `origem` |
| `dashboard/src/lib/api.ts:139` | Union das categorias de escalação |
| `dashboard/src/pages/Triagem.tsx:29-46` | Rótulos e explicações ("ato privativo do advogado") |
| `dashboard/src/pages/Triagem.tsx:246,291,326` | Textos sobre advogado e opinião jurídica |
| `dashboard/src/pages/Metrics.tsx:16-18` | `ESC_LABEL` |
| `dashboard/src/pages/Metrics.tsx:87,252` | "o número que o escritório...", "Como chegaram até o escritório" |
| `dashboard/src/pages/Pipeline.tsx:18` | "Fechou com o escritório" |
| `dashboard/src/pages/Overview.tsx:104,187,370` | "o que trava o escritório hoje", "aguarda o escritório", "A área jurídica é preenchida na triagem" |
| `dashboard/src/pages/Conversations.tsx:63,67,306` | Ficha do lead ("Área"), "aguardando advogado" |
| `dashboard/src/pages/Configuracoes.tsx:52,60,140,156` | "Dados do escritório", filtro `category === 'Áreas de atuação'`, aviso sobre honorários, `tenants/juris.yaml` citado na tela |
| `dashboard/src/pages/FollowUp.tsx:85` | Badge de área jurídica |
| `dashboard/src/components/Sidebar.tsx:97,116` | Fallback e marca "Juris" |
| `dashboard/src/components/Icon.tsx:205,218` | `IconScale`, `IconGavel` |
| `dashboard/index.html:8` | `<title>Juris — CRM do escritório</title>` |
| `dashboard/tailwind.config.ts:4` | "Identidade Juris — cartório moderno, não clínica" |

**Infra**

| Local | O que está preso |
|---|---|
| `docker-compose.yml` | `container_name: juris_*`, `TENANT_CONFIG=/app/tenants/juris.yaml` |
| `docker-compose.yml:51` | `LUMINA_ROOT=/app` (lido em `agent/prompt_builder.py:10`) |
| `Makefile:113` | `docker volume rm lumina-agent_agent_db` — volume de **outro projeto** |
| `.mcp.json`, `tools/juris_mcp.py` | Servidor MCP com nome e descrições do CRM Juris |

### 6.2 Armadilhas de comportamento

- **A vertical é carregada por nome, em dois lugares diferentes.** `agent_core.py:107` importa
  `verticals.<vertical>.tools` e explode se faltar; `main.py:197` importa
  `verticals.<vertical>.receptionist` e degrada em silêncio se faltar (`ModuleNotFoundError` →
  `False`). Ou seja: sem `receptionist.py`, os comandos `confirmar <id>` param de funcionar e
  **nada** avisa.
- **`agent/api.py:28` derruba o clone.** É o import fixo de `verticals.advocacia.tools`. Com
  outra vertical instalada e a pasta `advocacia` removida, o Flask nem sobe.
- **Copiar a vertical sem trocar os imports.** Já aconteceu neste repositório (commit
  `417a46e`). Rode o `sed` do Passo 1.
- **`procedures` é polissêmico.** Na engine é "o que o negócio oferece"; virou "áreas de
  atuação" na advocacia, "regiões" na imobiliária, "especialidades" na clínica. É usado em
  três lugares distintos: `{procedures_list}` no prompt (`prompt_builder.py:18`),
  `_is_served_area` (`tools.py:90`) e `procedure_durations` do calendário (`gcal.py:45`). Se
  você usar `procedures` para região e `procedure_durations` para tipo de visita, os dois
  conceitos não se falam — e é assim que já está.
- **Mudar `lead_fields` com banco populado.** `lead_data` é chave/valor, então nada quebra —
  mas `is_lead_qualified` (`sessions.py:280`) passa a exigir os campos novos e **todo lead
  antigo volta a "não qualificado"**, mudando as estatísticas retroativamente.
- **`agent/config.py` é singleton.** Mudou o YAML? Reinicie o agente. `PUT /api/config`
  (`api.py:445`) reescreve o YAML e zera o singleton, mas só para seis campos de `business`.
- **O system prompt é montado uma vez no import** (`agent_core.py:56`), com `cache_control`
  ephemeral. Editar prompt sem reiniciar não muda nada.
- **`marcar_fora_de_escopo` recusa a própria chamada** quando a área **está** na lista
  (`tools.py:324`). Ao portar, mantenha essa proteção: sem ela o modelo descarta leads bons.
- **A tabela `services` é semeada uma vez só** (`sessions.py:154`, guardado por
  `COUNT(*) == 0`). Trocar `_INITIAL_SERVICES` não afeta banco já populado.
- **`slot_buffer_minutes` importa mais fora da advocacia.** Zero funciona para consulta na
  mesma sala; para visita a imóvel com deslocamento, 30 minutos é o mínimo.
- **`workdays` sem a chave = seg-sáb** (`config.py:59`). A advocacia é a exceção que
  restringiu; imobiliária e clínica normalmente querem o default.

---

## 7. Nomenclatura legada

O repositório é fork do `lumina-agent`, vertical de estética. Restos visíveis:

| Nome | Onde | O que implica |
|---|---|---|
| `get_patient_appointments` | tool em `verticals/advocacia/tools.py:220`; função em `agent/sessions.py:473`; import em `agent/agent_core.py:27` | O modelo lê "patient" numa vertical sem pacientes. Não quebra nada, mas é uma dica errada em cada chamada. Renomear obriga a mexer no prompt, nos golden tests e no CRM ao mesmo tempo. |
| `patient_name` | coluna em `agent/sessions.py:97`; parâmetro em `:442`; argumento da tool em `tools.py:207` | Renomear a **coluna** exige migration (não há sistema de migrations). A engine mapeia para `nome` na fronteira do CRM (`api.py:48`), o que já esconde metade do problema. |
| `procedure_type` | coluna, tools, `procedure_durations` | Virou "tipo de consulta"; vira "tipo de visita" na imobiliária. Barato de manter, confuso de ler. |
| `services` / `professionals` | tabelas (`sessions.py:124,133`) e endpoints `/api/services`, `/api/professionals` (`api.py:375,408`) | Vêm da clínica de estética, com `price`, `rating`, `initials`, `color` e cor default `#7C3D6E` (o roxo Lumina, `sessions.py:139`). Na advocacia `price` é sempre 0 por vedação da OAB (`sessions.py:39`). O CRM só lê `services` filtrando `category === 'Áreas de atuação'` (`Configuracoes.tsx:60`); `professionals` não aparece em nenhuma página. **Candidato a deleção**, não a renomeação. |
| `lumina` | `/health` (`main.py:113`); `LUMINA_ROOT` (`docker-compose.yml:51`, `prompt_builder.py:10`); exemplo em `config.py:71`; volume em `Makefile:113` | Cosmético, exceto o `Makefile:113`, que aponta para o volume de outro projeto e faz `make reset-db` mentir. |
| "clínica" | `prompt_builder.py:32,36` | **Este importa de verdade:** entra no system prompt de toda vertical, incluindo a jurídica de hoje. |
| "Lara" | comentários em `agent_core.py:267`, `sessions.py:18` | Nome da agente do projeto original. Só comentário. |
| `procedimento_interesse`, `indicacao` | default de `lead_fields` (`config.py:130`) | Campos de estética. Só aparecem se o tenant omitir `lead_fields`. |
| `setup/patch_evolution.sh` | — | Versão antiga do patch `@lid`, aplicada por um serviço `patcher` que não existe mais no `docker-compose.yml`. O patch vigente está em `evolution/Dockerfile:6`. Arquivo órfão. |
| `_ref/lumina-agent/` | — | Repositório de referência, somente leitura. Não é dependência de runtime. |

**Conclusão prática.** Renomear `patient_name`/`get_patient_appointments` custa migration +
prompt + golden tests + CRM, para ganhar clareza. Vale fazer **no momento de criar a segunda
vertical**, quando os dois nomes vão coexistir de qualquer jeito — não antes, e não em cima de
banco de produção. Já `services`/`professionals` deveriam ser removidos: são código morto
carregando forma de outro negócio.

---

## 8. Limitações conhecidas

- **Não existe um comando de scaffold.** Não há `make new-vertical`, gerador ou template.
  Tudo neste guia é `cp` + edição manual.
- **Não existe nenhuma vertical além de `advocacia`.** Os exemplos de imobiliária e clínica
  são projetos, não código presente no repositório; os YAML e prompts das seções 4 e 5 são
  esboços prontos para colar, mas nunca foram executados.
- **A engine não é neutra.** Como mostra a seção 6.1, `agent/api.py`, `agent/prompt_builder.py`
  e `agent/sessions.py` contêm vertical no meio. Uma segunda vertical de verdade exige
  refatorar esses três antes.
- **Knowledge e prompts base são globais**, não por vertical (`agent/rag.py:9`,
  `agent/prompt_builder.py:42`). Duas verticais no mesmo deploy ainda não são possíveis; um
  deploy por cliente é o modelo atual.
- **Nada de multi-tenant.** Um `TENANT_CONFIG`, um SQLite, uma instância Evolution por
  processo.
- **Não há revisão jurídica das regras de CRECI e CFM citadas.** Elas foram redigidas a partir
  do conhecimento geral das normas e servem como ponto de partida para o prompt; valide com o
  conselho e com o responsável técnico do cliente antes de operar.
