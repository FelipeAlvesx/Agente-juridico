"""
Definições de tools e executor para o vertical estética (Lumina).
"""

import structlog
from datetime import datetime

import gcal
from sessions import (
    save_lead_field, is_lead_qualified, get_lead_data,
    get_patient_appointments, get_appointment,
    create_appointment, update_appointment,
    save_offered_slots, clear_offered_slots,
)
from verticals.estetica.notifications import (
    notify_lead_qualified, notify_appointment_pending,
    notify_reschedule_pending, notify_cancel_pending,
)

log = structlog.get_logger()

_WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"]


def slot_label(iso: str, tz) -> str:
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(tz)
        return f"{_WEEKDAYS[dt.weekday()]}, {dt.strftime('%d/%m/%Y às %H:%M')}"
    except Exception:
        return iso


def get_tool_definitions(config) -> list:
    lead_fields    = config.lead_fields
    procedures     = config.procedures
    procedure_desc = ", ".join(procedures) if procedures else "Procedimento estético"

    return [
        {
            "name": "save_lead_field",
            "description": "Salva um campo de qualificação do lead. Chame assim que a cliente confirmar o valor.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "field": {
                        "type": "string",
                        "enum": list(lead_fields),
                        "description": "Campo a salvar: nome, procedimento_interesse ou indicacao",
                    },
                    "value": {
                        "type": "string",
                        "description": (
                            f"Valor confirmado na conversa. "
                            f"Para 'procedimento_interesse', use um dos procedimentos da clínica ({procedure_desc}). "
                            f"Para 'nome', use o nome como a cliente disse. "
                            f"Para 'indicacao', registre como conheceu a clínica (amiga, Instagram, Google, etc)."
                        ),
                    },
                },
                "required": ["field", "value"],
            },
        },
        {
            "name": "mark_lead_complete",
            "description": "Chama quando todos os 3 campos do lead foram coletados (nome, procedimento_interesse, indicacao).",
            "input_schema": {"type": "object", "properties": {}, "required": []},
        },
        {
            "name": "list_available_slots",
            "description": (
                "Consulta horários livres no calendário da clínica. "
                "date_range deve ser ISO: '2026-05-01' (um dia) ou '2026-05-01/2026-05-07' (intervalo). "
                "Retorna até 3 horários disponíveis com labels legíveis, um por dia."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "date_range": {
                        "type": "string",
                        "description": "Data ou intervalo ISO (YYYY-MM-DD ou YYYY-MM-DD/YYYY-MM-DD)",
                    },
                    "procedure_type": {
                        "type": "string",
                        "description": "Tipo de procedimento — define a duração do slot",
                    },
                    "period": {
                        "type": "string",
                        "enum": ["manha", "tarde"],
                        "description": "Preferência de período: 'manha' (9h-12h) ou 'tarde' (13h-19h)",
                    },
                },
                "required": ["date_range"],
            },
        },
        {
            "name": "create_pending_appointment",
            "description": (
                "Cria agendamento pendente e notifica recepcionista. "
                "Só chame após a cliente confirmar explicitamente o horário. "
                "Usar slot_start/slot_end exatamente como retornado por list_available_slots."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "patient_name":   {"type": "string", "description": "Nome da cliente"},
                    "procedure_type": {"type": "string", "description": "Procedimento escolhido"},
                    "slot_start":     {"type": "string", "description": "Datetime ISO do início"},
                    "slot_end":       {"type": "string", "description": "Datetime ISO do fim"},
                    "notes":          {"type": "string", "description": "Observações extras"},
                },
                "required": ["patient_name", "procedure_type", "slot_start", "slot_end"],
            },
        },
        {
            "name": "get_patient_appointments",
            "description": "Busca agendamentos existentes da cliente atual (pendentes e confirmados).",
            "input_schema": {"type": "object", "properties": {}, "required": []},
        },
        {
            "name": "reschedule_appointment",
            "description": (
                "Solicita remarcação de um agendamento existente para um novo horário. "
                "Escala para confirmação da recepcionista — nunca remarca sozinha. "
                "Chame list_available_slots antes para obter o novo slot."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "appointment_id": {"type": "integer", "description": "ID do agendamento existente"},
                    "new_slot_start": {"type": "string",  "description": "Novo datetime ISO início"},
                    "new_slot_end":   {"type": "string",  "description": "Novo datetime ISO fim"},
                    "reason":         {"type": "string",  "description": "Motivo da remarcação"},
                },
                "required": ["appointment_id", "new_slot_start", "new_slot_end"],
            },
        },
        {
            "name": "cancel_appointment",
            "description": (
                "Solicita cancelamento de um agendamento. "
                "Escala para confirmação da recepcionista — nunca cancela sozinha."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "appointment_id": {"type": "integer", "description": "ID do agendamento"},
                    "reason":         {"type": "string",  "description": "Motivo do cancelamento"},
                },
                "required": ["appointment_id"],
            },
        },
        {
            "name": "escalate_to_human",
            "description": "Escala o atendimento para a recepcionista humana. Após chamar, não gere mais texto.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "reason": {
                        "type": "string",
                        "description": "Motivo da escalada (texto livre)",
                    },
                    "category": {
                        "type": "string",
                        "enum": ["medica", "reclamacao", "pedido_humano", "confusao_repetida", "fora_escopo"],
                        "description": (
                            "Categoria da escalada: "
                            "'medica' = dúvida médica/clínica/contraindicação; "
                            "'reclamacao' = insatisfação, reclamação ou crítica; "
                            "'pedido_humano' = cliente pediu explicitamente falar com humano; "
                            "'confusao_repetida' = cliente repetiu a mesma dúvida 2x+ sem progresso ou demonstrou irritação; "
                            "'fora_escopo' = assunto fora do escopo da clínica (jurídico, emergência, etc.)."
                        ),
                    },
                },
                "required": ["reason", "category"],
            },
        },
    ]


def execute_tool(fn: str, args: dict, context: dict) -> dict:
    phone         = context["phone"]
    phone_hash    = context["phone_hash"]
    was_qualified = context["was_qualified"]
    config        = context["config"]
    tz            = config.tz

    if fn == "save_lead_field":
        field = args.get("field")
        value = args.get("value")
        if field in config.lead_fields and isinstance(value, str) and value.strip():
            save_lead_field(phone, field, value.strip())
            log.info("lead_field_saved", phone_hash=phone_hash, field=field)
            return {"ok": True}
        log.warning("save_lead_field_invalid_args", phone_hash=phone_hash)
        return {"error": "field/value inválidos"}

    elif fn == "mark_lead_complete":
        newly = not was_qualified and is_lead_qualified(phone, config.lead_fields)
        if newly:
            context.get("inc_leads_qualified", lambda: None)()
            data = get_lead_data(phone)
            notify_lead_qualified(
                phone,
                data.get("nome", "?"),
                data.get("procedimento_interesse", "?"),
                data.get("indicacao", "?"),
            )
            log.info("lead_qualified", phone_hash=phone_hash)
        return {"ok": True, "qualified": is_lead_qualified(phone, config.lead_fields)}

    elif fn == "escalate_to_human":
        return {"ok": True}

    elif fn == "list_available_slots":
        date_range = args.get("date_range")
        if not isinstance(date_range, str) or not date_range.strip():
            return {"error": "date_range obrigatório (formato YYYY-MM-DD ou YYYY-MM-DD/YYYY-MM-DD)"}
        result = gcal.list_available_slots(
            date_range,
            procedure_type=args.get("procedure_type"),
            period=args.get("period"),
        )
        if isinstance(result, dict) and result.get("slots"):
            # Persiste os slots (com ISO) para a cliente poder escolher no próximo turno.
            save_offered_slots(phone, result["slots"])
        log.info("slots_queried", phone_hash=phone_hash, date_range=date_range)
        return result

    elif fn == "create_pending_appointment":
        patient_name   = args.get("patient_name")
        procedure_type = args.get("procedure_type")
        slot_start     = args.get("slot_start")
        slot_end       = args.get("slot_end")
        notes          = args.get("notes", "") or ""
        if not all(isinstance(v, str) and v.strip() for v in (patient_name, procedure_type, slot_start, slot_end)):
            log.warning("create_appointment_invalid_args", phone_hash=phone_hash)
            return {"error": "patient_name, procedure_type, slot_start e slot_end são obrigatórios"}
        apt_id = create_appointment(phone, patient_name, procedure_type, slot_start, slot_end, notes=notes)
        gcal_result = gcal.create_pending_event(apt_id, patient_name, procedure_type, slot_start, slot_end, notes)
        ext_id = gcal_result.get("external_id")
        if ext_id:
            update_appointment(apt_id, external_id=ext_id)
        notify_appointment_pending(apt_id, phone, patient_name, procedure_type, slot_label(slot_start, tz), notes)
        context.get("inc_appointments_created", lambda: None)()
        clear_offered_slots(phone)
        log.info("appointment_created", phone_hash=phone_hash, appointment_id=apt_id)
        return {
            "ok": True,
            "appointment_id": apt_id,
            "status": "pending",
            "slot": slot_label(slot_start, tz),
            "message": "Agendamento criado e recepcionista notificada.",
        }

    elif fn == "get_patient_appointments":
        apts   = get_patient_appointments(phone)
        active = [a for a in apts if a["status"] not in ("cancelled", "rejected")]
        return {
            "appointments": [
                {
                    "id":             a["id"],
                    "procedure_type": a["procedure_type"],
                    "slot":           slot_label(a["slot_start"], tz),
                    "status":         a["status"],
                }
                for a in active
            ]
        }

    elif fn == "reschedule_appointment":
        apt_id    = args.get("appointment_id")
        new_start = args.get("new_slot_start")
        new_end   = args.get("new_slot_end")
        if not isinstance(apt_id, int) or not isinstance(new_start, str) or not isinstance(new_end, str):
            return {"error": "appointment_id, new_slot_start e new_slot_end são obrigatórios"}
        apt = get_appointment(apt_id)
        if not apt or apt["phone"] != phone:
            return {"error": "Agendamento não encontrado."}
        update_appointment(apt_id, status="reschedule_requested", new_slot_start=new_start, new_slot_end=new_end)
        notify_reschedule_pending(
            apt_id, phone, apt["patient_name"], apt["procedure_type"],
            slot_label(apt["slot_start"], tz), slot_label(new_start, tz),
        )
        log.info("reschedule_requested", phone_hash=phone_hash, appointment_id=apt_id)
        return {
            "ok": True,
            "appointment_id": apt_id,
            "new_slot": slot_label(new_start, tz),
            "message": "Remarcação solicitada. Recepcionista vai confirmar.",
        }

    elif fn == "cancel_appointment":
        apt_id = args.get("appointment_id")
        reason = args.get("reason", "")
        if not isinstance(apt_id, int):
            return {"error": "appointment_id obrigatório"}
        apt = get_appointment(apt_id)
        if not apt or apt["phone"] != phone:
            return {"error": "Agendamento não encontrado."}
        update_appointment(apt_id, status="cancel_requested")
        notify_cancel_pending(
            apt_id, phone, apt["patient_name"], apt["procedure_type"],
            slot_label(apt["slot_start"], tz), reason,
        )
        log.info("cancel_requested", phone_hash=phone_hash, appointment_id=apt_id)
        return {
            "ok": True,
            "appointment_id": apt_id,
            "message": "Cancelamento solicitado. Recepcionista vai confirmar.",
        }

    log.warning("unknown_tool_called", phone_hash=phone_hash, fn=fn)
    return {"error": f"unknown tool: {fn}"}
