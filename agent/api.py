"""
Rotas REST /api/* servidas pelo agente para o dashboard React.
Registre este blueprint no main.py via app.register_blueprint(api_bp).
"""

from flask import Blueprint, jsonify, request

import os
import yaml as _yaml

from sessions import (
    get_stats, get_all_leads, get_all_appointments,
    get_history, get_conversation_for_dashboard, get_recent_conversations,
    get_appointment, update_appointment, create_appointment,
    get_all_services, create_service, update_service, delete_service,
    get_all_professionals, create_professional, update_professional, delete_professional,
    get_recent_escalations,
)
from gcal import confirm_event, confirm_event_with_new_slot, delete_event
from evolution import send_message
from config import get_config
import config as _config_module
from verticals.estetica.tools import slot_label

api_bp = Blueprint("api", __name__, url_prefix="/api")


def _fmt_ts(ts) -> str | None:
    if not ts:
        return None
    try:
        from datetime import datetime, timezone
        return datetime.fromtimestamp(float(ts), tz=timezone.utc).isoformat()
    except Exception:
        return str(ts)


def _map_apt(apt: dict) -> dict:
    """Normaliza campos do DB para o contrato esperado pelo dashboard."""
    return {
        "id":              apt["id"],
        "phone":           apt["phone"],
        "nome":            apt.get("patient_name") or "",
        "procedure":       apt.get("procedure_type") or "",
        "datetime":        apt.get("slot_start") or "",
        "slot_end":        apt.get("slot_end") or "",
        "new_slot_start":  apt.get("new_slot_start") or None,
        "new_slot_end":    apt.get("new_slot_end") or None,
        "status":          apt["status"],
        "notes":           apt.get("notes") or "",
        "created_at":      _fmt_ts(apt.get("created_at")),
    }


def _cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


@api_bp.after_request
def after_request(response):
    return _cors(response)


@api_bp.route("/stats", methods=["GET", "OPTIONS"])
def stats():
    if request.method == "OPTIONS":
        return _cors(jsonify({}))
    return jsonify(get_stats())


@api_bp.route("/leads", methods=["GET", "OPTIONS"])
def leads():
    if request.method == "OPTIONS":
        return _cors(jsonify({}))
    limit  = int(request.args.get("limit", 50))
    offset = int(request.args.get("offset", 0))
    data   = get_all_leads(limit=limit, offset=offset)
    return jsonify({"leads": data, "count": len(data)})


@api_bp.route("/appointments", methods=["GET", "POST", "OPTIONS"])
def appointments():
    if request.method == "OPTIONS":
        return _cors(jsonify({}))

    if request.method == "GET":
        status    = request.args.get("status") or None
        date_from = request.args.get("date_from") or None
        date_to   = request.args.get("date_to") or None
        limit     = int(request.args.get("limit", 50))
        offset    = int(request.args.get("offset", 0))
        data      = get_all_appointments(
            status=status, date_from=date_from, date_to=date_to,
            limit=limit, offset=offset,
        )
        return jsonify({"appointments": [_map_apt(a) for a in data], "count": len(data)})

    # POST — criação manual de agendamento pelo dashboard
    body      = request.get_json(force=True) or {}
    phone     = body.get("phone", "").strip()
    nome      = body.get("nome", "").strip()
    procedure = body.get("procedure", "").strip()
    slot_start = body.get("slot_start", "").strip()
    slot_end   = body.get("slot_end", "").strip()
    notes      = body.get("notes", "")
    status_val = body.get("status", "confirmed")

    if not all([phone, nome, procedure, slot_start]):
        return jsonify({"error": "Campos obrigatórios: phone, nome, procedure, slot_start"}), 400

    if not slot_end:
        from datetime import datetime, timedelta
        try:
            dt = datetime.fromisoformat(slot_start)
            slot_end = (dt + timedelta(hours=1)).isoformat()
        except ValueError:
            slot_end = slot_start

    apt_id = create_appointment(phone, nome, procedure, slot_start, slot_end, notes)

    if status_val == "confirmed":
        update_appointment(apt_id, status="confirmed")

    return jsonify({"id": apt_id, "ok": True}), 201


@api_bp.route("/conversations", methods=["GET", "OPTIONS"])
def conversations_list():
    if request.method == "OPTIONS":
        return _cors(jsonify({}))
    limit = int(request.args.get("limit", 50))
    return jsonify({"conversations": get_recent_conversations(limit=limit)})


@api_bp.route("/conversations/<path:phone>", methods=["GET", "OPTIONS"])
def conversations(phone: str):
    if request.method == "OPTIONS":
        return _cors(jsonify({}))
    if not phone.endswith("@s.whatsapp.net"):
        phone = phone + "@s.whatsapp.net"
    messages = get_conversation_for_dashboard(phone)
    return jsonify({"phone": phone, "messages": messages})


@api_bp.route("/appointments/<int:appointment_id>/confirm", methods=["POST", "OPTIONS"])
def confirm_appointment(appointment_id: int):
    if request.method == "OPTIONS":
        return _cors(jsonify({}))

    apt = get_appointment(appointment_id)
    if not apt:
        return jsonify({"error": "Agendamento não encontrado"}), 404

    config = get_config()
    tz     = config.tz
    status = apt["status"]

    if status == "pending":
        confirm_event(apt.get("external_id") or "", apt["patient_name"], apt["procedure_type"])
        update_appointment(appointment_id, status="confirmed")
        sl = slot_label(apt["slot_start"], tz)
        send_message(
            apt["phone"],
            f"Boa notícia! Seu agendamento foi confirmado 🎉\n\n"
            f"💆 {apt['procedure_type']}\n"
            f"🕐 {sl}\n\n"
            f"Qualquer dúvida, é só me chamar!",
        )
        return jsonify({"ok": True, "status": "confirmed"})

    elif status == "reschedule_requested":
        new_start = apt.get("new_slot_start")
        new_end   = apt.get("new_slot_end")
        if not new_start:
            return jsonify({"error": "Dados de remarcação não encontrados"}), 400
        confirm_event_with_new_slot(
            apt.get("external_id") or "", apt["patient_name"], apt["procedure_type"],
            new_start, new_end,
        )
        update_appointment(
            appointment_id,
            status="confirmed",
            slot_start=new_start,
            slot_end=new_end,
            new_slot_start=None,
            new_slot_end=None,
        )
        send_message(
            apt["phone"],
            f"Seu agendamento foi remarcado com sucesso!\n\n"
            f"💆 {apt['procedure_type']}\n"
            f"🕐 {slot_label(new_start, tz)}\n\n"
            f"Qualquer dúvida, é só me chamar!",
        )
        return jsonify({"ok": True, "status": "confirmed"})

    elif status == "cancel_requested":
        delete_event(apt.get("external_id") or "")
        update_appointment(appointment_id, status="cancelled")
        send_message(
            apt["phone"],
            f"Seu agendamento foi cancelado conforme solicitado.\n"
            f"Se quiser agendar em outro momento, é só me chamar 😊",
        )
        return jsonify({"ok": True, "status": "cancelled"})

    return jsonify({"error": f"Status '{status}' não permite confirmação"}), 400


@api_bp.route("/appointments/<int:appointment_id>/reject", methods=["POST", "OPTIONS"])
def reject_appointment(appointment_id: int):
    if request.method == "OPTIONS":
        return _cors(jsonify({}))

    apt    = get_appointment(appointment_id)
    if not apt:
        return jsonify({"error": "Agendamento não encontrado"}), 404

    reason = (request.json or {}).get("reason", "") if request.is_json else ""
    status = apt["status"]

    if status in ("pending", "reschedule_requested"):
        if status == "reschedule_requested":
            update_appointment(appointment_id, status="confirmed", new_slot_start=None, new_slot_end=None)
            patient_msg = (
                f"Infelizmente não conseguimos remarcar para esse horário 😕\n"
                + (f"Motivo: {reason}\n\n" if reason else "\n")
                + "Quer tentar outro horário? É só me dizer!"
            )
        else:
            delete_event(apt.get("external_id") or "")
            update_appointment(appointment_id, status="rejected")
            patient_msg = (
                f"Infelizmente não conseguimos confirmar esse horário 😕\n"
                + (f"Motivo: {reason}\n\n" if reason else "\n")
                + "Quer tentar outro dia ou horário? É só me dizer!"
            )
        send_message(apt["phone"], patient_msg)
        return jsonify({"ok": True, "status": "rejected"})

    elif status == "cancel_requested":
        update_appointment(appointment_id, status="confirmed")
        send_message(
            apt["phone"],
            "Não conseguimos processar o cancelamento agora.\n"
            + (f"Motivo: {reason}\n\n" if reason else "\n")
            + "Seu agendamento continua confirmado. Precisa de outra ajuda?",
        )
        return jsonify({"ok": True, "status": "confirmed"})

    return jsonify({"error": f"Status '{status}' não permite rejeição"}), 400


@api_bp.route("/appointments/<int:appointment_id>/reschedule", methods=["POST", "OPTIONS"])
def reschedule_appointment_endpoint(appointment_id: int):
    if request.method == "OPTIONS":
        return _cors(jsonify({}))

    apt = get_appointment(appointment_id)
    if not apt:
        return jsonify({"error": "Agendamento não encontrado"}), 404

    body = request.get_json(force=True) or {}
    new_slot_start = body.get("new_slot_start", "").strip()
    new_slot_end   = body.get("new_slot_end", "").strip()

    if not new_slot_start:
        return jsonify({"error": "new_slot_start obrigatório"}), 400

    if not new_slot_end:
        from datetime import datetime, timedelta
        try:
            dt = datetime.fromisoformat(new_slot_start)
            new_slot_end = (dt + timedelta(hours=1)).isoformat()
        except ValueError:
            new_slot_end = new_slot_start

    update_appointment(
        appointment_id,
        status="reschedule_requested",
        new_slot_start=new_slot_start,
        new_slot_end=new_slot_end,
    )
    return jsonify({"ok": True, "status": "reschedule_requested"})


@api_bp.route("/appointments/<int:appointment_id>/cancel", methods=["POST", "OPTIONS"])
def cancel_appointment_endpoint(appointment_id: int):
    if request.method == "OPTIONS":
        return _cors(jsonify({}))

    apt = get_appointment(appointment_id)
    if not apt:
        return jsonify({"error": "Agendamento não encontrado"}), 404

    body = request.get_json(force=True) or {}
    reason = body.get("reason", "")

    notes = apt.get("notes", "")
    if reason:
        notes = f"{notes}\nMotivo cancelamento: {reason}".strip()

    update_appointment(appointment_id, status="cancel_requested", notes=notes)
    return jsonify({"ok": True, "status": "cancel_requested"})


@api_bp.route("/escalations", methods=["GET", "OPTIONS"])
def escalations():
    if request.method == "OPTIONS":
        return _cors(jsonify({}))
    limit = int(request.args.get("limit", 50))
    data = get_recent_escalations(limit=limit)
    result = [
        {
            "id":         row["id"],
            "phone":      row["phone"],
            "nome":       row.get("nome") or None,
            "reason":     row["reason"],
            "category":   row["category"],
            "created_at": _fmt_ts(row["created_at"]),
        }
        for row in data
    ]
    return jsonify({"escalations": result, "count": len(result)})


@api_bp.route("/services", methods=["GET", "POST", "OPTIONS"])
def services_list():
    if request.method == "OPTIONS":
        return _cors(jsonify({}))
    if request.method == "GET":
        return jsonify({"services": get_all_services()})
    data = request.get_json(force=True) or {}
    sid = create_service(
        category=data.get("category", ""),
        name=data.get("name", ""),
        duration=int(data.get("duration", 60)),
        price=float(data.get("price", 0)),
        active=bool(data.get("active", True)),
    )
    return jsonify({"id": sid, "ok": True}), 201


@api_bp.route("/services/<int:service_id>", methods=["PUT", "DELETE", "OPTIONS"])
def service_detail(service_id: int):
    if request.method == "OPTIONS":
        return _cors(jsonify({}))
    if request.method == "DELETE":
        ok = delete_service(service_id)
        return (jsonify({"ok": True}), 200) if ok else (jsonify({"error": "Não encontrado"}), 404)
    data = request.get_json(force=True) or {}
    allowed = {"category", "name", "duration", "price", "active"}
    fields = {k: v for k, v in data.items() if k in allowed}
    if "active" in fields:
        fields["active"] = int(bool(fields["active"]))
    ok = update_service(service_id, **fields)
    return (jsonify({"ok": True}), 200) if ok else (jsonify({"error": "Não encontrado"}), 404)


@api_bp.route("/professionals", methods=["GET", "POST", "OPTIONS"])
def professionals_list():
    if request.method == "OPTIONS":
        return _cors(jsonify({}))
    if request.method == "GET":
        return jsonify({"professionals": get_all_professionals()})
    data = request.get_json(force=True) or {}
    pid = create_professional(
        name=data.get("name", ""),
        specialty=data.get("specialty", ""),
        initials=data.get("initials", ""),
        color=data.get("color", "#7C3D6E"),
        rating=float(data.get("rating", 5.0)),
        appointments_count=int(data.get("appointments_count", 0)),
        services_count=int(data.get("services_count", 0)),
        active=bool(data.get("active", True)),
    )
    return jsonify({"id": pid, "ok": True}), 201


@api_bp.route("/professionals/<int:professional_id>", methods=["PUT", "DELETE", "OPTIONS"])
def professional_detail(professional_id: int):
    if request.method == "OPTIONS":
        return _cors(jsonify({}))
    if request.method == "DELETE":
        ok = delete_professional(professional_id)
        return (jsonify({"ok": True}), 200) if ok else (jsonify({"error": "Não encontrado"}), 404)
    data = request.get_json(force=True) or {}
    allowed = {"name", "specialty", "initials", "color", "rating",
               "appointments_count", "services_count", "active"}
    fields = {k: v for k, v in data.items() if k in allowed}
    if "active" in fields:
        fields["active"] = int(bool(fields["active"]))
    ok = update_professional(professional_id, **fields)
    return (jsonify({"ok": True}), 200) if ok else (jsonify({"error": "Não encontrado"}), 404)


@api_bp.route("/config", methods=["GET", "PUT", "OPTIONS"])
def tenant_config():
    if request.method == "OPTIONS":
        return _cors(jsonify({}))
    if request.method == "GET":
        cfg = get_config()
        return jsonify({
            "name":       cfg.name,
            "segment":    cfg.segment,
            "address":    cfg.address,
            "phone":      cfg.phone,
            "hours":      cfg.hours,
            "timezone":   cfg.timezone,
            "agent_name": cfg.agent_name,
        })
    # PUT — update tenant YAML and reload in-memory singleton
    data = request.get_json(force=True) or {}
    tenant_path = os.getenv("TENANT_CONFIG")
    if not tenant_path:
        return jsonify({"error": "TENANT_CONFIG não configurado"}), 500
    with open(tenant_path, encoding="utf-8") as f:
        raw = _yaml.safe_load(f)
    biz = raw.setdefault("business", {})
    for k in ("name", "segment", "address", "phone", "hours", "timezone"):
        if k in data:
            biz[k] = data[k]
    if "agent_name" in data:
        raw.setdefault("agent", {})["name"] = data["agent_name"]
    with open(tenant_path, "w", encoding="utf-8") as f:
        _yaml.dump(raw, f, allow_unicode=True, default_flow_style=False)
    _config_module._config = None  # force reload on next get_config()
    return jsonify({"ok": True})


@api_bp.route("/test/message", methods=["POST", "OPTIONS"])
def test_message():
    """Endpoint exclusivo para golden tests — não envia mensagens via WhatsApp."""
    if request.method == "OPTIONS":
        return _cors(jsonify({}))

    if os.getenv("FLASK_ENV") == "production":
        return jsonify({"error": "Endpoint disponível apenas em modo de teste"}), 403

    data    = request.get_json(force=True) or {}
    phone   = data.get("phone", "test@s.whatsapp.net")
    text    = data.get("text", "")
    history = data.get("history", [])

    if not phone.endswith("@s.whatsapp.net"):
        phone = phone + "@s.whatsapp.net"

    from agent_core import run_test_message
    result = run_test_message(phone, text, history)
    return jsonify(result)
