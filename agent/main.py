import os
import time
import hashlib
import threading
import requests
import structlog
from datetime import datetime, timezone, timedelta
from importlib import import_module
from flask import Flask, request, jsonify, Response
from prometheus_client import Counter, generate_latest, CONTENT_TYPE_LATEST
from apscheduler.schedulers.background import BackgroundScheduler

from agent_core import process_message, transcribe_audio, _slot_label
from evolution import send_message, download_audio
from sessions import get_confirmed_appointments_tomorrow
from config import get_config
from api import api_bp

structlog.configure(
    processors=[
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.BoundLogger,
    context_class=dict,
    logger_factory=structlog.PrintLoggerFactory(),
)
log = structlog.get_logger()

messages_received_total = Counter("messages_received_total", "Mensagens recebidas no webhook")
webhook_dedup_total     = Counter("webhook_dedup_total",     "Webhooks duplicados ignorados")
audio_transcribed_total = Counter("audio_transcribed_total", "Áudios transcritos com sucesso")

_SEEN_IDS: dict[str, float] = {}
_SEEN_LOCK = threading.Lock()
TTL_DEDUP  = 24 * 3600

_DEBOUNCE: dict[str, dict] = {}
_DEBOUNCE_LOCK = threading.Lock()
DEBOUNCE_DELAY = 4.0


def _is_duplicate(key_id: str) -> bool:
    now = time.time()
    with _SEEN_LOCK:
        cutoff = now - TTL_DEDUP
        stale  = [k for k, v in _SEEN_IDS.items() if v < cutoff]
        for k in stale:
            del _SEEN_IDS[k]
        if key_id in _SEEN_IDS:
            return True
        _SEEN_IDS[key_id] = now
        return False


def _flush_debounce(phone: str) -> None:
    with _DEBOUNCE_LOCK:
        if phone not in _DEBOUNCE:
            return
        messages = _DEBOUNCE.pop(phone)["messages"]
    combined = "\n".join(messages)
    threading.Thread(target=process_message, args=(phone, combined), daemon=True).start()


def _enqueue(phone: str, text: str) -> None:
    with _DEBOUNCE_LOCK:
        if phone not in _DEBOUNCE:
            _DEBOUNCE[phone] = {"messages": [], "timer": None}
        buf = _DEBOUNCE[phone]
        buf["messages"].append(text)
        if buf["timer"]:
            buf["timer"].cancel()
        timer = threading.Timer(DEBOUNCE_DELAY, _flush_debounce, args=(phone,))
        buf["timer"] = timer
        timer.start()


app = Flask(__name__)
app.register_blueprint(api_bp)


def register_webhook():
    base = os.getenv("EVOLUTION_URL", "http://evolution:8080")
    key  = os.getenv("EVOLUTION_API_KEY", "")
    inst = get_config().evolution_instance
    headers = {"apikey": key, "Content-Type": "application/json"}

    for attempt in range(10):
        try:
            r = requests.post(
                f"{base}/webhook/set/{inst}",
                headers=headers,
                json={
                    "url": "http://agent:3000/webhook",
                    "webhook_by_events": False,
                    "webhook_base64": False,
                    "events": ["MESSAGES_UPSERT"],
                },
                timeout=5,
            )
            if r.status_code in (200, 201):
                log.info("webhook_registered", instance=inst)
                return
        except Exception:
            pass
        time.sleep(3)
    log.warning("webhook_registration_failed", instance=inst)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "agent": "lumina", "tenant": get_config().tenant_id})


@app.route("/metrics", methods=["GET"])
def metrics():
    return Response(generate_latest(), mimetype=CONTENT_TYPE_LATEST)


@app.route("/webhook", methods=["POST"])
def webhook():
    data  = request.json or {}
    event = data.get("event", "").lower()

    if event not in ("messages.upsert", "messages_upsert"):
        return jsonify({"ok": True})

    msg = data.get("data", {})
    key = msg.get("key", {})

    if key.get("fromMe"):
        return jsonify({"ok": True})

    jid = key.get("remoteJid", "")
    if jid.endswith("@g.us"):
        return jsonify({"ok": True})

    key_id = key.get("id", "")
    if key_id and _is_duplicate(key_id):
        webhook_dedup_total.inc()
        log.info("webhook_dedup_hit", key_id=key_id)
        return jsonify({"ok": True})

    phone      = jid
    phone_hash = hashlib.sha256(phone.encode()).hexdigest()[:12]

    if _is_from_receptionist(jid):
        raw_text = (
            (msg.get("message", {}).get("conversation") or "")
            or (msg.get("message", {}).get("extendedTextMessage", {}).get("text") or "")
        ).strip()
        handler = _get_vertical_handler()
        if raw_text and handler and handler.handle_receptionist_command(raw_text):
            return jsonify({"ok": True})

    message_obj = msg.get("message", {})

    if message_obj.get("audioMessage"):
        b64_result = download_audio(msg)
        if b64_result:
            b64, _ = b64_result
            text    = transcribe_audio(b64)
            if text:
                audio_transcribed_total.inc()
                log.info("audio_transcribed", phone_hash=phone_hash)
            else:
                send_message(phone, "Tô com problema pra ouvir o áudio agora, manda em texto? 😊")
                return jsonify({"ok": True})
        else:
            send_message(phone, "Tô com problema pra ouvir o áudio agora, manda em texto? 😊")
            return jsonify({"ok": True})
    else:
        text = (
            message_obj.get("conversation")
            or message_obj.get("extendedTextMessage", {}).get("text")
            or ""
        ).strip()

        if not text:
            send_message(phone, "Por favor, envie sua mensagem em texto 😊")
            return jsonify({"ok": True})

    messages_received_total.inc()
    log.info("message_received", phone_hash=phone_hash, text_len=len(text))
    _enqueue(phone, text)
    return jsonify({"ok": True})


_vertical_handler = None


def _get_vertical_handler():
    global _vertical_handler
    if _vertical_handler is None:
        try:
            _vertical_handler = import_module(f"verticals.{get_config().vertical}.receptionist")
        except ModuleNotFoundError:
            _vertical_handler = False
    return _vertical_handler or None


def _is_from_receptionist(jid: str) -> bool:
    clean = get_config().human_phone.lstrip("+")
    return bool(clean) and jid.startswith(clean + "@")


def _send_daily_reminders() -> None:
    """Dispara lembretes D-1 para clientes com agendamentos confirmados amanhã."""
    appointments = get_confirmed_appointments_tomorrow()
    config       = get_config()
    log.info("sending_reminders", count=len(appointments))
    for apt in appointments:
        try:
            sl = _slot_label(apt["slot_start"])
            send_message(
                apt["phone"],
                f"Olá! Aqui é a {config.agent_name}, da {config.name} 😊\n\n"
                f"Passando pra lembrar que você tem *{apt['procedure_type']}* amanhã às "
                f"{sl.split(' às ')[-1]}.\n\n"
                f"Qualquer dúvida ou se precisar remarcar, me chama por aqui!",
            )
            log.info("reminder_sent", appointment_id=apt["id"])
        except Exception as e:
            log.error("reminder_failed", appointment_id=apt["id"], error=str(e))


if __name__ == "__main__":
    log.info("agent_starting", port=3000)

    if os.getenv("DEMO_SEED", "").lower() in ("true", "1", "yes"):
        try:
            from seed_demo import run_seed
            run_seed()
        except Exception as e:
            log.warning("demo_seed_failed", error=str(e))

    threading.Thread(target=register_webhook, daemon=True).start()

    scheduler = BackgroundScheduler(timezone="America/Sao_Paulo")
    scheduler.add_job(_send_daily_reminders, "cron", hour=8, minute=0)
    scheduler.start()
    log.info("scheduler_started")

    app.run(host="0.0.0.0", port=3000, debug=False)
