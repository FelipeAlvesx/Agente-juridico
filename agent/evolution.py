"""
Integração com a Evolution API para envio de mensagens e download de mídia.
"""

import os
import requests
import structlog

from config import get_config

log = structlog.get_logger()

EVOLUTION_URL = os.getenv("EVOLUTION_URL", "http://evolution:8080")
EVOLUTION_KEY = os.getenv("EVOLUTION_API_KEY", "")

HEADERS = {
    "apikey": EVOLUTION_KEY,
    "Content-Type": "application/json",
}


def send_message(phone: str, text: str) -> None:
    inst = get_config().evolution_instance
    try:
        requests.post(
            f"{EVOLUTION_URL}/message/sendText/{inst}",
            headers=HEADERS,
            json={"number": phone, "textMessage": {"text": text}},
            timeout=10,
        )
    except Exception as e:
        log.error("send_message_failed", phone_suffix=phone[-4:], error=str(e))


def download_audio(message_data: dict) -> tuple[str, str] | None:
    inst = get_config().evolution_instance
    try:
        r = requests.post(
            f"{EVOLUTION_URL}/chat/getBase64FromMediaMessage/{inst}",
            headers=HEADERS,
            json={"message": message_data},
            timeout=30,
        )
        if r.status_code == 200:
            body = r.json()
            b64 = body.get("base64")
            media_type = body.get("mediaType", "audio/ogg")
            if b64:
                return b64, media_type
        log.warning("download_audio_bad_status", status=r.status_code)
        return None
    except Exception as e:
        log.error("download_audio_failed", error=str(e))
        return None


def notify_human(patient_phone: str, last_message: str) -> None:
    human_phone = get_config().human_phone
    if not human_phone:
        log.warning("notify_human_skipped", reason="human_phone not set in tenant config")
        return

    text = (
        f"⚠️ *Atendimento para escalar*\n\n"
        f"📱 Cliente: {patient_phone}\n"
        f"💬 Última mensagem: _{last_message}_\n\n"
        f"Por favor, assuma o atendimento no WhatsApp."
    )
    send_message(human_phone, text)
