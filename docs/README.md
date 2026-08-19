# Documentação — Juris Agent

Agente de WhatsApp que acolhe o primeiro contato, qualifica o caso, agenda a consulta
e alimenta um CRM — inclusive com os leads que **não** concluíram o atendimento.

Leia na ordem se está chegando agora. Se veio replicar o produto para outro nicho,
vá direto ao 07 e volte aos outros conforme precisar.

| # | Documento | Para quê |
|---|---|---|
| 01 | [Arquitetura](01-arquitetura.md) | Problema resolvido, fluxo request→resposta, mapa de módulos, modelo de dados, modos de falha |
| 02 | [Engine do agente](02-engine-do-agente.md) | Ciclo da mensagem, prompt em camadas, tool loop, RAG, cache, pontos de extensão |
| 03 | [Camada vertical](03-camada-vertical.md) | Contrato de cada tool, qualificação, escalação, prompts, knowledge, regras da OAB |
| 04 | [Contrato da API](04-api-contrato.md) | As 19 rotas, integração de mão dupla agente↔CRM, como evoluir o schema |
| 05 | [CRM / dashboard](05-crm-dashboard.md) | Stack do front, tela por tela, componentes e sistema visual |
| 06 | [Operação e testes](06-operacao-e-testes.md) | Setup do zero, Makefile, dev sem WhatsApp, testes, troubleshooting |
| 07 | [Replicar para outro nicho](07-replicar-para-outro-nicho.md) | O coração do produto e o passo a passo — com exemplos completos de imobiliária e clínica |

## O que a documentação corrigiu no CLAUDE.md

Levantado ao ler o código; o `CLAUDE.md` ainda não foi atualizado.

- **`.env` existe e tem chave válida.** `make test-golden` passa 7/7 contra o Claude real
  (o `CLAUDE.md` diz que o arquivo não existe e que o teste não roda). São 7 cenários golden, não 6.
- **Ordem das camadas do prompt é outra:** identidade → persona → vertical → engine → extras → FAQ.
  `engine_rules.md` entra por último, e RAG / estado do lead / hora **não** são camadas do system
  prompt — vão concatenados na mensagem do usuário, o que muda o comportamento de cache.
- **A API tem 19 rotas**, não três. Contrato completo em [04](04-api-contrato.md).
- **CRM não está "em reconstrução":** as nove telas já estão reescritas com identidade jurídica.
- **`verticals/` não é isolável:** `prompts/base/` e `knowledge/` são globais, `engine_rules.md`
  tem conteúdo jurídico dentro e `api.py:28` importa de `verticals.advocacia` — com outra vertical
  o agente não sobe. Lista completa do que está hardcoded em [07](07-replicar-para-outro-nicho.md).
- **Regra de tom só vale para o que o Claude gera.** As mensagens hardcoded ainda têm euforia e
  emoji festivo (`receptionist.py:51`, `notifications.py`, `main.py`, `api.py:211-216`).
- **Estado crítico é in-memory de processo único** — dedup, debounce, flag de escalação e slots
  ofertados morrem no restart e quebram com duas réplicas.
- **`make reset-db` não reseta nada:** aponta para o volume `lumina-agent_agent_db`, de outro
  projeto, e imprime "Banco resetado" mesmo assim (`Makefile:113`).

## Bloqueador de deploy

**Nenhuma** rota `/api/*` tem autenticação e o CORS é `*`. Não é só o `/api/query`:
`/api/conversations/<phone>` entrega o histórico integral de qualquer telefone — conversa de
cliente de advogado, sigilo profissional. Em `localhost:3100` tudo bem; exposto na rede, não.
Corrigir com token no header ou bind em `127.0.0.1` antes de publicar. Detalhes em
[04 §5](04-api-contrato.md).
