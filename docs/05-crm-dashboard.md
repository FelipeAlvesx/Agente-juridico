# 05 — CRM: o dashboard React

O CRM é uma SPA em `dashboard/`, servida como estático. Não tem backend próprio: fala
direto com `/api/*` do agente (contrato completo em `04-api-contrato.md`). Nove telas,
uma sidebar fixa, polling de 30 s, nenhum estado global — cada tela busca o que precisa.

## Stack e build

`dashboard/package.json` é curto de propósito — seis dependências de runtime:

| Pacote | Versão | Para quê |
|---|---|---|
| `react` / `react-dom` | 18.3 | — |
| `react-router-dom` | 6.23 | rotas em `App.tsx` |
| `framer-motion` | 11.18 | todo o motion, incl. `layoutId` no funil e na sidebar |
| `recharts` | 2.12 | os três gráficos (área, barra horizontal, barra vertical) |
| `date-fns` | 3.6 | datas, sempre com `locale: ptBR` |

Dev: Vite 5 + TypeScript 5.4 + Tailwind 3.4 + PostCSS/autoprefixer. Não há biblioteca de
componentes, de estado, de data-fetching nem de formulário — tudo isso é código local, e
a soma é menor do que qualquer uma delas.

**Scripts** (`dashboard/package.json:6-11`):

- `npm run dev` — Vite na 5173, com proxy de `/api` para `http://localhost:3100`
  (`dashboard/vite.config.ts:9-13`). É o que `make dev-dashboard` roda
  (`Makefile:83-87`).
- `npm run build` — `tsc && vite build`. O `tsc` roda antes e falha o build em erro de
  tipo.
- `npm run test` — `node --test 'src/**/*.test.ts'`. Um arquivo só:
  `dashboard/src/lib/api.test.ts`, que cobre a regra de follow-up. Sem framework, sem
  runner.

**Container** (`dashboard/Dockerfile`): build multi-stage — `node:20-alpine` compila,
`nginx:alpine` serve `/usr/share/nginx/html`, com um `try_files $uri $uri/ /index.html`
gerado inline (`dashboard/Dockerfile:22-29`) para o react-router funcionar em rota
profunda. Publica na 5173 do host (`docker-compose.yml:77`).

`VITE_API_URL` é **build arg**, não env de runtime (`dashboard/Dockerfile:11`,
`docker-compose.yml:70-73`): o Vite congela o valor no bundle e quem serve depois é o
nginx, que não lê env. Por isso o valor tem de ser a porta publicada do agente
(`http://localhost:3100`), resolvida no browser do usuário, e nunca o hostname interno da
rede Docker. Trocar de host exige rebuild da imagem do dashboard.

O `index.html` carrega Inter e Fraunces do Google Fonts
(`dashboard/index.html:11-14`) — é a única dependência externa em runtime, e o CRM fica
sem a serifa do display se a rede estiver bloqueada.

## Estrutura

```
src/
  main.tsx          ErrorBoundary > BrowserRouter > App
  App.tsx           rotas + AnimatePresence de troca de tela
  index.css         @layer components: .card, .btn-*, .badge, .input, .cal-*
  lib/api.ts        tipos + cliente REST + regras de negócio compartilhadas
  lib/theme.ts      paleta de dados, rótulos e formatadores da vertical
  lib/motion.ts     vocabulário de movimento
  hooks/useFetch.ts polling + loading/erro/refetch
  components/       Page, StatCard, StatusBadge, Chart, Sidebar, RefreshBar, Icon, ErrorBoundary
  pages/            as nove telas
```

## Rotas

`App.tsx:24-32` define nove rotas em português, e `:35-44` mantém oito redirects
permanentes das rotas herdadas da engine de estética (`/pacientes → /clientes`,
`/pipeline → /funil`, `/servicos → /configuracoes`, …) mais um catch-all para `/`.

O `AnimatePresence mode="wait"` (`App.tsx:22`) com `key={location.pathname}` garante que a
tela que sai termine a animação antes da próxima entrar.

---

## As telas

### Painel — `/` (`pages/Overview.tsx`)

Quatro `useFetch` (`Overview.tsx:88-91`): leads, appointments, escalations, config.

A ordem da tela é uma decisão de produto: **pendências antes de métrica**. A primeira
faixa são três `ActionCard` (`Overview.tsx:44`) — consultas a confirmar
(`needsAction`), casos para triagem (todas as escalações) e leads sem retorno
(`followUpBucket !== null`). Cada card navega para a tela correspondente e fica opaco
quando zerado. O card de triagem vira vermelho quando há alguma `urgencia_prazo`
(`Overview.tsx:198`).

Depois: filtro de período (7d/30d/90d/12 meses, `Overview.tsx:23-36`), quatro KPIs
(contatos, triagem completa, consultas confirmadas, conversão), série temporal de
contatos, funil do período em `MeterRow`, próximas cinco consultas, ranking de áreas e os
seis últimos que chegaram.

Detalhes que valem saber: a série preenche todo dia do intervalo mesmo zerado e agrupa de
7 em 7 acima de ~60 pontos (`Overview.tsx:138`); o ranking de áreas corta no top 5 e joga
o resto em "Outras", em cinza, para nunca precisar de uma 7ª cor de série
(`Overview.tsx:158-160`).

**Ações do usuário:** navegar. A tela é inteiramente leitura — nenhum clique aqui escreve
no backend.

### Funil — `/funil` (`pages/Pipeline.tsx`)

Kanban de cinco colunas, uma por `LeadStatus` (`Pipeline.tsx:14-20`), alimentado por
`getLeads({limit: 500})`.

Arrastar um card entre colunas chama `api.setLeadStatus`
(`Pipeline.tsx:122` → `PUT /api/leads/<phone>/status`) e faz `refetch()`. Soltar na coluna
**Perdido** não salva direto: abre um modal exigindo um dos seis motivos
(`Pipeline.tsx:135`, modal em `:217-259`), porque é o motivo que decide depois se o lead
entra ou não na fila de follow-up.

O card mostra nome, telefone, área, resumo do caso (2 linhas), badge de urgência, motivo
de perda quando aplicável, e um ícone de alerta em latão quando o lead está aberto e
parado há 3 dias ou mais (`Pipeline.tsx:38`). Clicar abre a conversa
(`/conversas?phone=...`).

O drag-and-drop é HTML5 nativo (`draggable` + `onDragOver`/`onDrop`), sem biblioteca. O
movimento entre colunas usa `layout` + `layoutId` do framer-motion (`Pipeline.tsx:43-44`)
dentro de um `LayoutGroup`, que é o que faz o card deslizar em vez de piscar.

### Triagem — `/triagem` (`pages/Triagem.tsx`)

Os casos que o agente não podia resolver e passou para um humano: `getEscalations(100)`
cruzado com `getLeads` para enriquecer cada card com área, urgência, resumo e origem
(`Triagem.tsx:182-185`).

**A ordenação é por gravidade, não por data** (`Triagem.tsx:194-203`): o `rank` de cada
categoria (`Triagem.tsx:25-59`) manda, e a recência só desempata dentro do mesmo rank.
`urgencia_prazo` tem rank 0 — prazo perdido não volta.

Quando existe qualquer caso de prazo, um alerta vermelho aparece no topo
(`Triagem.tsx:226-252`) dizendo com todas as letras que o agente não avalia prazo, quem
confere é o advogado. O filete lateral do card urgente pulsa (`Triagem.tsx:93-100`).

Chips de filtro por categoria aparecem só para categorias que existem naquele momento
(`Triagem.tsx:211`) — filtro vazio é ruído. No rodapé, uma legenda do que cada categoria
significa e o lembrete de que o agente acolhe, tria e agenda, e nada além disso
(`Triagem.tsx:324-328`).

**Ações:** abrir a conversa no CRM, ou o `wa.me` para assumir no WhatsApp
(`Triagem.tsx:68`). **Nenhuma das duas escreve no backend** — não há como marcar uma
escalação como resolvida, e o contador da Sidebar segue contando.

### Conversas — `/conversas` (`pages/Conversations.tsx`)

Duas colunas. À esquerda, a lista de `getConversations()` com busca por nome ou telefone e
um toggle "N na triagem" que filtra por `escalated` (`Conversations.tsx:194-208`). À
direita, o histórico completo em balões, agrupado por dia com divisores
(`Conversations.tsx:152-165`).

Entre o cabeçalho e os balões, o `CaseCard` (`Conversations.tsx:64`) resume a triagem:
resumo do caso, área, origem, urgência, e um badge "incompleta" quando `!lead.qualified`.
É o que o advogado precisa antes de ler a conversa.

Aceita `?phone=` na URL, e é para cá que todas as outras telas navegam ao clicar num
contato (`Conversations.tsx:110`, `:144-147`).

O carregamento das mensagens **não** usa `useFetch`: é um `useEffect` sobre
`selectedPhone` (`Conversations.tsx:130-138`), então o chat aberto não tem polling. A
lista lateral tem, e o rodapé avisa "atualiza a cada 30s" (`Conversations.tsx:277`).

**Ações:** selecionar conversa, buscar, filtrar, e o link "Assumir" para o `wa.me`. Nada
escreve.

### Agenda — `/agenda` (`pages/Appointments.tsx`)

Calendário mensal (semana começando na segunda, `Appointments.tsx:256`) com até três
eventos por dia e "+N mais" acima disso. Cor do evento por status
(`Appointments.tsx:209-216`, classes `.cal-event-*` em `index.css:134-137`).

Acima do calendário, a faixa de pendências: tudo que passa em `needsAction`
(`lib/api.ts:99`), com o rótulo do que a pessoa pediu — "quer confirmação", "pediu para
remarcar", "pediu para cancelar" (`Appointments.tsx:31-35`) — e um botão Confirmar direto.

Clicar num evento abre o painel lateral, cujos botões dependem do status:

| Status | Botões | Endpoint | Efeito no backend |
|---|---|---|---|
| `pending` | Confirmar consulta / Recusar este horário | `/confirm`, `/reject` | evento no Google Calendar + WhatsApp ao cliente; status vira `confirmed` ou `rejected` |
| `reschedule_requested` | Aceitar novo horário / Recusar remarcação | idem | aceitar move `new_slot_*` para `slot_*`; recusar volta o registro a `confirmed` |
| `cancel_requested` | Confirmar cancelamento / Manter a consulta | idem | confirmar apaga o evento e marca `cancelled`; manter volta a `confirmed` |

Tudo isso passa por `act()` (`Appointments.tsx:280-290`), que chama a API, faz `refetch()`
e ainda aplica um ajuste otimista no painel aberto — porque o painel não é remontado pelo
refetch.

O botão "Marcar consulta" abre o modal de criação manual (`Appointments.tsx:37`), que
monta `slot_end` a partir da duração e chama `POST /api/appointments`
(`Appointments.tsx:243`). O campo de tipo é um `<input list>` alimentado por
`getServices()` — nativo, sem componente de combobox.

### Clientes — `/clientes` (`pages/Contacts.tsx`)

Tabela de todos os leads, com o subtítulo dizendo o que o produto promete: "inclusive quem
não concluiu o atendimento" (`Contacts.tsx:176`). Colunas: contato, área, urgência, origem,
último contato, estágio.

Busca cobre nome, telefone, área e resumo do caso (`Contacts.tsx:154-159`); filtros por
estágio (`Contacts.tsx:15-22`); ordenação por contato recente, antigo ou nome.

Clicar na linha expande um detalhe com o resumo do caso completo, a data do primeiro
contato, o link de WhatsApp e o botão "Ver conversa" (`Contacts.tsx:86-137`). Quando o
lead foi perdido, o `motivo_perda_detalhe` — texto livre gravado pelo agente ao encerrar —
aparece como "Encerramento" (`Contacts.tsx:104-107`).

**Ações:** filtrar, buscar, ordenar, expandir, navegar. Só leitura.

### Follow-up — `/follow-up` (`pages/FollowUp.tsx`)

A tela que cumpre a promessa de que ninguém some. Nenhum dado é dela: tudo sai de
`getLeads` passado por `followUpBucket` (`lib/api.ts:65`), a regra que também alimenta o
contador da Sidebar.

Quatro faixas (`FollowUp.tsx:25-30`): 3–7 dias, 8–20 dias, mais de 20 dias, e os marcados
como perdidos por silêncio — estes últimos entram porque `sem_resposta` merece uma última
tentativa, enquanto perdido com motivo real não entra
(`lib/api.ts:68`). Cliente fechado nunca entra.

Dentro de cada faixa a ordem é urgência declarada primeiro, dias parados como desempate
(`FollowUp.tsx:169-176`).

**Ações por linha:** abrir o WhatsApp, abrir a conversa no CRM, marcar como cliente
(`setLeadStatus(phone, 'cliente')`, `FollowUp.tsx:187`) ou encerrar como perdido — que
abre o mesmo modal de motivo do funil. As duas últimas escrevem em `lead_status` via
`PUT /api/leads/<phone>/status`.

O link do WhatsApp vai **sem texto pré-montado**, e o comentário no código explica por quê
(`FollowUp.tsx:39-42`): mensagem sugerida de retomada seria captação, vedada pelo
Provimento 205/2021.

### Relatórios — `/relatorios` (`pages/Metrics.tsx`)

Única tela que consome `GET /api/stats` (`Metrics.tsx:53`), somado a leads, appointments e
escalations. Sem filtro de período — é sempre a base inteira, e o subtítulo diz isso.

Quatro KPIs (contatos, triagem completa, conversão, tempo médio até agendar), funil
completo em cinco etapas, e o painel "Onde as pessoas param", que mostra a retenção de
cada etapa para a próxima e pinta de vermelho abaixo de 50% (`Metrics.tsx:198`).

Depois, quatro rankings pelo mesmo componente local `Ranking` (`Metrics.tsx:27`): áreas
procuradas, por que perdemos, como chegaram até o escritório, e o que foi para triagem
humana. Fecha com um histograma de horário do primeiro contato, das 9h às 18h
(`Metrics.tsx:24`), explicitamente para dimensionar o plantão humano.

O "tempo até agendar" (`Metrics.tsx:90-103`) cruza o `created_at` do lead com o
`created_at` da consulta, descartando spans negativos ou acima de 90 dias.

**Ações:** só o refresh manual.

### Configurações — `/configuracoes` (`pages/Configuracoes.tsx`)

Formulário sobre `GET|PUT /api/config`: nome, segmento, endereço e telefone do escritório;
nome do agente, horário de atendimento e fuso. Salvar chama `api.updateConfig`
(`Configuracoes.tsx:31`), que reescreve `tenants/juris.yaml` no disco do agente e força
reload do singleton de config — ou seja, **muda o comportamento do agente na mensagem
seguinte**. A barra de salvar é sticky, com feedback "Salvo" que some em 3 s.

Abaixo, as áreas de atuação em chips, só leitura, vindas de `getServices()` filtradas por
`category === 'Áreas de atuação'` (`Configuracoes.tsx:60`). O rodapé diz onde editá-las e
lembra que honorários não entram no CRM nem no contexto do agente
(`Configuracoes.tsx:155-158`).

Duas ressalvas do backend valem para esta tela (detalhe em `04-api-contrato.md`): o `PUT`
descarta os comentários do YAML, e falha dentro do container porque `./tenants` é montado
`:ro` (`docker-compose.yml:53`).

---

## Componentes compartilhados

### `Page.tsx` — a casca de toda tela

`Page` (`components/Page.tsx:6`) é a raiz animada: aplica `pageVariants` e faz stagger dos
filhos diretos. Toda tela abre com ela, exceto Conversas, que precisa de altura fixa e
monta o `motion.div` à mão (`Conversations.tsx:168-172`).

- `Reveal` (`:21`) — qualquer bloco que deva entrar em cascata dentro do `Page`.
- `PageHeader` (`:33`) — título em Fraunces, subtítulo, slot de ações (onde vai o
  `RefreshBar`) e a régua de latão `.rule-brass`.
- `Section` (`:56`) — card com título e subtítulo. É a unidade de layout dos painéis.
- `EmptyState` (`:83`) — ícone, título e dica. Os textos aqui são de produto, não de
  sistema: explicam o que faria aquele vazio se preencher.
- `Skeleton` / `SkeletonRows` / `SkeletonCards` (`:108-133`) — placeholders do primeiro
  fetch.

Padrão de uso: `!data` → skeleton; `data.length === 0` → `EmptyState`; erro → um card
vermelho inline, como em `Pipeline.tsx:151`, `Triagem.tsx:278`, `FollowUp.tsx:228`.

### `StatCard.tsx`

`StatCard` (`components/StatCard.tsx:36`) é o KPI: rótulo em caixa alta, subtítulo, valor
grande em Fraunces tabular, ícone opcional, filete superior que cresce na entrada. Aceita
`accent: 'brass' | 'critical'` para realçar número que exige ação
(`components/StatCard.tsx:30-34`) e `onClick` para virar clicável.

Valor numérico passa por `AnimatedNumber` (`:18`), que sobe até o alvo com spring e
respeita `useReducedMotion` — com movimento reduzido, renderiza o número direto.

### `StatusBadge.tsx`

Pastilha de status com ponto de cor opcional. Cobre em um só `Record` os seis status de
consulta e os cinco do funil de leads (`components/StatusBadge.tsx:1-39`), com fallback
cinza para desconhecido. Os rótulos são jurídicos: `pending` é "Aguardando confirmação",
`consulta_agendada` é "Consulta agendada".

A regra visual é dita no comentário (`:41`): ponto de cor **mais** rótulo — identidade
nunca fica só na cor. Vale para toda a interface, não só aqui.

Hoje só a Agenda e a tabela de Clientes o usam (`Appointments.tsx:494`,
`Contacts.tsx:77`); Triagem, Funil e Follow-up montam badges próprios com cor da
categoria.

### `Chart.tsx`

Peças de gráfico, não gráficos: `axisProps` (eixos sem linha, tick cinza),
`ChartTooltip` (ficha branca com bolinha de cor e valor em `pt-BR`), `ChartLegend`, e
`MeterRow` (`components/Chart.tsx:50`) — a barra de progresso horizontal com rótulo,
valor, percentual e animação de largura, usada no funil do Painel, no funil dos
Relatórios e nos quatro rankings.

Para um ranking novo, o caminho é `MeterRow` (ou o `Ranking` local de `Metrics.tsx:27`),
não um `BarChart` novo. Só há três Recharts em todo o CRM.

### `ErrorBoundary.tsx`

Class component clássico, aplicado **uma vez só**, em volta de tudo
(`main.tsx:10-14`). Mostra "Algo deu errado", a mensagem do erro em mono e um botão que
zera o estado. Não há boundary por rota — erro de render em qualquer tela derruba a
aplicação inteira até o clique em "Tentar novamente".

### Outros

- `Sidebar.tsx` — navegação fixa, nome do escritório e do agente vindos de `getConfig`,
  e três contadores de pendência (`Sidebar.tsx:91-95`) calculados com as **mesmas**
  funções que as telas usam: `needsAction`, `followUpBucket`, contagem de escalações. A
  pílula ativa desliza entre itens por `layoutId="nav-active"` (`Sidebar.tsx:51`).
- `RefreshBar.tsx` — botão de refresh manual com "Atualizado há Xs", atualizado por um
  `setInterval` de 5 s só do texto. Vai no slot `actions` do `PageHeader`.
- `Icon.tsx` — 25 ícones SVG inline, `stroke="currentColor"`, sem pacote de ícones. Os
  quatro do fim (`IconScale`, `IconGavel`, `IconInbox`, `IconBellRing`) são a adição da
  vertical jurídica; `IconSparkles` sobrou da estética e não é mais usado.

---

## Sistema visual

### Cores — dois lugares, propósitos diferentes

**`tailwind.config.ts`** é a cromática de interface: `ink` (#141E33, o navy de tinta da
sidebar), `primary`, `brass` (#B07C1E, o acento de "precisa de atenção"), `surface`,
`surface-2`, `bg` (#F3F1EC, papel — nunca branco puro na moldura) e `line`. Duas famílias
tipográficas: Inter para texto, Fraunces para display (`tailwind.config.ts:35-38`). O
comentário do arquivo resume a intenção: cartório moderno, não clínica.

Há degraus de opacidade custom de 8% a 85% (`tailwind.config.ts:40-43`) porque a paleta é
sóbria e vive nesses véus — `bg-brass/12`, `bg-primary/8` aparecem por toda parte.

**`lib/theme.ts`** é a paleta de **dados**, separada de propósito:

- `SERIES` (`theme.ts:9`) — seis cores categóricas, validadas para faixa de luminosidade,
  piso de croma, separação para deuteranopia/tritanopia e contraste ≥ 3:1. As regras estão
  no docblock e são levadas a sério no código: ordem fixa (cor segue a entidade, não a
  posição no ranking), nunca reciclar, nunca gerar uma sétima — o excedente vira "Outras"
  em cinza (`Overview.tsx:158`).
- `FUNNEL_RAMP` (`:19`) — escala sequencial de um hue só, claro → escuro, para as etapas
  do funil.
- `STATUS` (`:26`) — cinco cores de status reservadas, nunca reaproveitadas como série.
- `hueFor(key)` (`:35`) — cor estável por entidade, por hash do telefone. É o que dá ao
  avatar da mesma pessoa a mesma cor em toda tela, sem depender da posição na lista.

Regra prática ao construir um gráfico: uma medida só = um hue só (a cor é magnitude);
várias entidades = `SERIES` na ordem, teto de seis.

### Motion — `lib/motion.ts`

Uma curva (`EASE`, `motion.ts:7`) e três durações: `quick` (0,18 s), `smooth` (0,34 s),
`springy`. Ease de saída sem overshoot, porque a interface é séria, não saltitante.

Vocabulário pronto: `pageVariants` (sobe entrando, desce saindo), `itemVariants` +
`stagger()` para listas, `liftable` para cartão clicável, `modalBackdrop`/`modalPanel`
para os dois modais do CRM.

A armadilha está documentada em `motion.ts:32-38`: `AnimatePresence` no meio da árvore
corta a propagação de variants e o filho fica preso em `opacity: 0` — a lista inteira
some. Por isso todo item dentro de um `AnimatePresence` usa `revealItem(i)`
(`motion.ts:39`), que carrega o próprio delay, e não `variants={itemVariants}`. Vale para
Triagem, Follow-up, Overview e a lista de Conversas.

### Classes utilitárias — `index.css`

`@layer components` define o vocabulário repetido: `.card`, `.card-flush`, `.btn-primary`,
`.btn-secondary`, `.btn-ghost`, `.btn-brass`, `.badge`, `.input`, `.label`, `.th`,
`.tab-btn-active` / `.tab-btn-inactive`, `.panel-title`, `.rule-brass`, `.skeleton` e as
`.cal-*` do calendário. Antes de escrever uma sequência longa de utilitários Tailwind,
procurar aqui.

---

## Camada de dados

### `lib/api.ts`

Um `request<T>` de oito linhas (`api.ts:4-11`) sobre `fetch`: injeta
`Content-Type: application/json`, converte não-2xx em `Error("HTTP 404: ...")` e devolve
`res.json()`. O `BASE` sai de `import.meta.env?.VITE_API_URL ?? ''` — o `?.` existe para o
módulo continuar importável fora do Vite, que é o que permite o teste rodar em
`node --test`.

Abaixo, todas as interfaces do contrato (`Stats`, `Lead`, `Appointment`, `Message`,
`ConversationSummary`, `Service`, `Professional`, `Escalation`, `FirmConfig`) e o objeto
`api` com um método por endpoint, cada um já desembrulhando o envelope
(`.then(r => r.leads)`).

Mas o arquivo não é só transporte — ele guarda as **regras que precisam ser únicas**:

- `followUpBucket(lead)` (`api.ts:65`) e `STALE_DAYS` (`:56`). O docblock diz por que
  estão aqui: a Sidebar (contador) e a tela de Follow-up (fila) têm de concordar, e duas
  cópias divergem.
- `APPOINTMENT_NEEDS_ACTION` / `needsAction` (`:95-99`), pela mesma razão, entre a
  Sidebar e a Agenda.
- `MOTIVO_PERDA_LABELS` (`:29`) — o enum e sua tradução para o português da tela.
- `conversion_rate` calculado no `getStats` (`:163-166`), já que o backend não o manda.

`dashboard/src/lib/api.test.ts` testa exatamente `followUpBucket`: as faixas de dias, o
cliente fechado que nunca entra, o perdido por silêncio que entra. É o único teste do
front, e cobre a regra que mais dói se quebrar.

### `hooks/useFetch.ts`

Trinta e sete linhas. Recebe um fetcher e um intervalo (default 30 s), devolve
`{ data, loading, error, refetch, lastUpdated }`.

Pontos de comportamento que importam:

- `data` começa `null` e **permanece o último valor bom** em caso de erro
  (`useFetch.ts:26` só mexe em `loading` e `error`). Erro intermitente de rede não apaga a
  tela.
- O fetcher fica num `ref` reatribuído a cada render (`useFetch.ts:15-16`), e `load` tem
  deps vazias. É isso que permite passar uma arrow function inline
  (`useFetch(() => api.getLeads({limit: 500}))`) sem recriar o intervalo a cada render.
- `refetch` é a mesma `load`: chamada manual pelo `RefreshBar` e depois de toda mutação.
- `lastUpdated` só avança em sucesso.
- Não há cache, deduplicação nem revalidação por foco. Duas telas pedindo `getLeads` são
  dois requests.

Convenção nas telas: intervalo default para dado operacional; `300_000` para
`getConfig()`, que quase nunca muda (`Sidebar.tsx:86`, `Overview.tsx:91`,
`Conversations.tsx:119`).

---

## O que é jurídico e o que é genérico

Trocar de nicho é viável, e a fronteira está razoavelmente clara. Onde ela vaza, é dito.

**Genérico — serve a qualquer vertical sem tocar:**
`hooks/useFetch.ts`, `lib/api.ts` no que é transporte, `lib/motion.ts` inteiro,
`components/Page.tsx`, `StatCard.tsx`, `Chart.tsx`, `RefreshBar.tsx`, `ErrorBoundary.tsx`,
`vite.config.ts`, `Dockerfile`, e a estrutura das nove telas (funil, fila de retomada,
triagem de escalação, agenda, tabela de contatos, relatórios são padrões de CRM, não de
advocacia).

**Jurídico — trocar em bloco:**

- `lib/theme.ts:53-64` — `AREA_SHORT`, o mapa de "Direito de Família e Sucessões" →
  "Família". Puramente da vertical.
- `lib/theme.ts:66-70` — `URGENCIA`, os três níveis com rótulo e cor.
- `pages/Triagem.tsx:25-59` — as seis categorias de escalação, com rótulo, explicação,
  cor e rank. É o arquivo mais específico do CRM: "prazo, audiência ou intimação", "ato
  privativo do advogado".
- `lib/api.ts:29-36` — os seis motivos de perda, incluindo
  `buscou_outro_escritorio`.
- `pages/Metrics.tsx:15-22` — `ESC_LABEL`, terceira cópia dos rótulos de escalação.
- `components/StatusBadge.tsx:24-39` — rótulos como "Consulta agendada".
- `components/Icon.tsx:207-243` — `IconScale`, `IconGavel`.
- `tailwind.config.ts` — navy + latão + Fraunces é a identidade "cartório moderno".
- Os textos: cada `EmptyState`, subtítulo e legenda foi escrito para esta vertical
  ("Ninguém esperando retorno", "aguardando um advogado", "o agente acolhe, tria e
  agenda"). São dezenas de strings espalhadas pelas telas, sem i18n.

**Jurídico por regra da OAB — não é estilo, é requisito**, e trocar de nicho não pode
apagar por engano o motivo:

- `FollowUp.tsx:39-42` — link de WhatsApp sem mensagem pré-montada.
- `Configuracoes.tsx:155-158` — honorários fora do CRM.
- `Triagem.tsx:324-328` — o agente não opina, não estima êxito, valor ou prazo.
- O `price: 0.0` em `services` (`agent/sessions.py:39-40`), que é backend mas se reflete
  em não haver coluna de preço em tela nenhuma.

**Vazamentos da vertical anterior (estética), ainda presentes:**

- `App.tsx:35-43` — oito redirects de `/pacientes`, `/servicos`, `/profissionais`…
- `lib/api.ts:125-135` e `:252-268` — a interface `Professional` e seus quatro métodos,
  com `rating` e `specialty`, sem tela nenhuma que os use.
- `lib/api.ts:116-123` — `Service` com `price`, que existe e é sempre 0.
- `components/StatusBadge.tsx:3` — os status `qualified`/`new`/`returning`, da engine
  antiga, ainda no `Record`.
- `components/Icon.tsx:26` — `IconSparkles`, órfão.
- O termo "procedure" no tipo `Appointment` (`lib/api.ts:81`), traduzido para "Tipo de
  consulta ou área" só na tela (`Appointments.tsx:130`).

---

## Divergências com o `CLAUDE.md`

- O `CLAUDE.md`, em "Estado atual", diz que o **CRM está em reconstrução** e que "o
  dashboard herdado é da clínica de estética". Não é mais o caso: as nove telas estão
  reescritas com identidade jurídica (navy + latão, Fraunces, `IconScale`/`IconGavel`),
  com Triagem e Follow-up — telas que não existiam na engine original — e com motion
  design próprio. O que restou da estética é o inventário de vazamentos acima.
- O `CLAUDE.md` descreve `agent/api.py` como "REST para o CRM (`/api/stats`, `/api/leads`,
  `/api/appointments/*`)". A superfície real é bem maior: conversas, escalações, services,
  professionals, config, `/api/query` e as duas rotas de teste.

---

## Limitações conhecidas

- **Sem WebSocket.** Polling de 30 s em tudo; o chat aberto não tem nem isso
  (`Conversations.tsx:130`). Consequências detalhadas em `04-api-contrato.md`, seção 6.
- **Sem cache entre hooks.** `GET /api/leads?limit=500` é buscado em paralelo pela
  Sidebar e pela tela ativa, sempre.
- **`limit: 500` é um teto rígido**, repetido literal em oito lugares. Escritório com mais
  de 500 leads passa a mostrar dados truncados sem aviso — não há paginação em tela
  nenhuma, embora a API suporte `offset`.
- **Sem autenticação.** Não há login, sessão nem noção de usuário. Quem abre a 5173 vê
  tudo, e a API por trás também não pede nada (ver `04-api-contrato.md`, seção 5).
- **Um único `ErrorBoundary`**, na raiz: erro de render em qualquer tela derruba a
  aplicação inteira.
- **Um único teste** (`lib/api.test.ts`). Nenhuma tela, nenhum componente, nenhum hook
  tem cobertura.
- **Sem estados de erro para mutação.** `Pipeline.move` e `FollowUp.setStatus` têm
  `try/finally` sem `catch`: falha de rede ao mudar status é silenciosa, o card volta ao
  lugar no refetch seguinte sem explicação. O modal de nova consulta é a exceção — ele
  mostra o erro (`Appointments.tsx:77`).
- **Acessibilidade parcial.** Há `useReducedMotion` no `StatCard`, ponto de cor junto de
  todo rótulo de status e foco visível nas ações do Follow-up; mas o kanban é
  drag-and-drop HTML5 sem alternativa por teclado, e os modais não prendem foco nem
  fecham no `Esc`.
- **Sem responsividade real abaixo de tablet.** A sidebar é fixa em 15 rem
  (`Sidebar.tsx:100`), o kanban usa cinco colunas de no mínimo 190 px
  (`Pipeline.tsx:161`) e a lista de conversas tem 19 rem fixos. Os grids têm breakpoints
  `sm:`/`lg:`, o esqueleto da página não.
- **Fontes externas.** Inter e Fraunces vêm do Google Fonts em runtime
  (`index.html:11-14`); sem rede, o display cai para Georgia.
