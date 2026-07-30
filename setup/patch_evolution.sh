#!/bin/sh
# Aplica o patch @lid na Evolution API.
# Executado como serviço one-shot pelo patcher no docker-compose.
# O patch modifica o arquivo JS diretamente no volume compartilhado antes
# de o processo Evolution iniciar — sem necessidade de reiniciar o container.

set -e

TARGET=/evolution/dist/src/api/services/channels/whatsapp.baileys.service.js

i=0
while [ $i -lt 30 ]; do
  if [ -f "$TARGET" ]; then
    break
  fi
  echo "[patcher] Aguardando arquivo alvo... tentativa $((i+1))/30"
  i=$((i + 1))
  sleep 2
done

if [ ! -f "$TARGET" ]; then
  echo "[patcher] ERRO: arquivo alvo não encontrado: $TARGET"
  exit 1
fi

# Verifica se o patch já foi aplicado
if grep -q "isWA.jid.includes('@lid')" "$TARGET"; then
  echo "[patcher] Patch @lid já aplicado — nenhuma ação necessária."
  exit 0
fi

echo "[patcher] Aplicando patch @lid..."

sed -i \
  's/!isWA.exists \&\& !(0, baileys_1.isJidGroup)(isWA.jid) \&\& !isWA.jid.includes(.@broadcast.)/!isWA.exists \&\& !(0, baileys_1.isJidGroup)(isWA.jid) \&\& !isWA.jid.includes('\''@broadcast'\'') \&\& !isWA.jid.includes('\''@lid'\'')/g' \
  "$TARGET"

echo "[patcher] Patch @lid aplicado com sucesso!"
