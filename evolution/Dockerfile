FROM atendai/evolution-api:v1.8.2

# Patch @lid: allow sending to contacts that use the multi-device @lid JID format.
# Without this, Evolution throws BadRequestException for @lid remoteJids.
RUN sed -i \
    "s/!isWA\.jid\.includes('@broadcast'))/!isWA.jid.includes('@broadcast') \&\& !isWA.jid.includes('@lid'))/g" \
    /evolution/dist/src/api/services/channels/whatsapp.baileys.service.js \
 && grep -c "includes('@lid')" /evolution/dist/src/api/services/channels/whatsapp.baileys.service.js
