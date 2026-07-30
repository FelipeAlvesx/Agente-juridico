"""
Definições de tools e executor para o vertical advocacia (Juris).

Nomes de tool herdados da engine (save_lead_field, mark_lead_complete,
list_available_slots, create_pending_appointment, get_patient_appointments,
reschedule_appointment, cancel_appointment, escalate_to_human) — as descrições e
enums é que são jurídicas. Só marcar_fora_de_escopo é nova.

"procedure_type" na engine = área jurídica / tipo de consulta aqui; os nomes de
argumento seguem as colunas de appointments em sessions.py.
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
from verticals.advocacia.notifications import (
    notify_lead_qualified, notify_appointment_pending,
    notify_reschedule_pending, notify_cancel_pending,
)

log = structlog.get_logger()

_WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"]

# Valores aceitos em lead_data: status do lead no funil e níveis de urgência.
# O CRM filtra por estes valores — mudança aqui tem que ser avisada ao Âmbar.
LEAD_STATUS_FORA_ESCOPO = "fora_de_escopo"
URGENCIA_LEVELS = ("alta", "media", "baixa")

# Mensagem enviada à pessoa no momento da transferência, por categoria.
# Vive na vertical (não na engine) porque o texto é jurídico; em urgencia_prazo
# os números de emergência vão em balão separado — split por '---'.
ESCALATION_MESSAGES = {
    "urgencia_prazo": (
        "Entendi a urgência. Já estou chamando a equipe do escritório para falar com você agora."
        "\n\n---\n\n"
        "Se houver risco imediato à sua integridade ou de alguém, ligue 190 (Polícia) "
        "ou 180 (Central de Atendimento à Mulher) — atendem 24 horas."
    ),
    "consulta_juridica": (
        "Essa é uma resposta que só o advogado pode te dar. Vou te transferir para a equipe agora."
    ),
    "processo_em_andamento": (
        "Para falar do andamento do seu processo vou te passar para a equipe agora."
    ),
    "reclamacao": (
        "Sinto muito que tenha acontecido. Vou passar seu contato para a equipe agora."
    ),
    "pedido_humano": "Claro. Já estou te transferindo para a equipe do escritório.",
    "confusao_repetida": (
        "Acho melhor a equipe falar direto com você. Já estou transferindo."
    ),
}
ESCALATION_MESSAGE_DEFAULT = "Um momento! Já estou te transferindo para a equipe do escritório."

ESCALATION_CATEGORIES = (
    "urgencia_prazo",
    "consulta_juridica",
    "processo_em_andamento",
    "reclamacao",
    "pedido_humano",
    "confusao_repetida",
)


def slot_label(iso: str, tz) -> str:
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(tz)
        return f"{_WEEKDAYS[dt.weekday()]}, {dt.strftime('%d/%m/%Y às %H:%M')}"
    except Exception:
        return iso


def _is_served_area(area: str, procedures: list) -> bool:
    """
    True se a área informada casa com alguma área de atuação do escritório.
    Match frouxo de propósito: na dúvida o lead continua no funil (não sai como
    fora de escopo por engano) e quem decide é o advogado.
    """
    a = (area or "").strip().lower()
    if len(a) < 4:
        return True
    return any(a in p.lower() or p.lower() in a for p in procedures)


def get_tool_definitions(config) -> list:
    lead_fields = config.lead_fields
    areas       = config.procedures
    areas_desc  = ", ".join(areas) if areas else "área jurídica"
    manha_ini, manha_fim = config.hours_start, min(12, config.hours_end)
    tarde_ini, tarde_fim = max(13, config.hours_start), config.hours_end

    return [
        {
            "name": "save_lead_field",
            "description": (
                "Salva um campo de qualificação do lead. Chame assim que a pessoa informar o dado — "
                "um campo por chamada, nunca re-salve campo já coletado."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "field": {
                        "type": "string",
                        "enum": list(lead_fields),
                        "description": "Campo a salvar",
                    },
                    "value": {
                        "type": "string",
                        "description": (
                            "Valor confirmado na conversa. "
                            "'nome': como a pessoa se apresentou. "
                            f"'area_juridica': a área do caso — use uma das áreas do escritório ({areas_desc}); "
                            "se o caso for de outra área, chame marcar_fora_de_escopo em vez desta tool. "
                            "'resumo_caso': 1 a 2 frases com o que a pessoa relatou, nas palavras dela, "
                            "sem análise de mérito, sem opinião jurídica e sem juízo sobre chance de êxito. "
                            "'urgencia': exatamente 'alta' (prazo, intimação, audiência marcada, prisão, "
                            "liminar), 'media' (quer resolver logo, sem prazo formal) ou 'baixa' (consulta "
                            "exploratória). "
                            "'origem': como conheceu o escritório (indicação, Google, Instagram, etc)."
                        ),
                    },
                },
                "required": ["field", "value"],
            },
        },
        {
            "name": "mark_lead_complete",
            "description": (
                f"Chame uma única vez, quando os {len(lead_fields)} campos do lead foram coletados "
                f"({', '.join(lead_fields)}). Notifica a equipe do escritório."
            ),
            "input_schema": {"type": "object", "properties": {}, "required": []},
        },
        {
            "name": "marcar_fora_de_escopo",
            "description": (
                "Registra que o caso é de uma área que o escritório NÃO atende. "
                f"Áreas atendidas: {areas_desc}. "
                "O lead sai do funil de agendamento mas continua no CRM com o motivo, para follow-up. "
                "Depois de chamar, seja honesta: o escritório não atua nessa área, sem indicar outro "
                "escritório e sem opinar sobre o caso. Na dúvida sobre a área, NÃO chame — pergunte mais "
                "sobre o caso ou escale."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "area_informada": {
                        "type": "string",
                        "description": "Área jurídica do caso, como você a identificou (ex: Direito Ambiental)",
                    },
                    "motivo": {
                        "type": "string",
                        "description": "Por que sai do funil, em uma frase (ex: caso de Direito Ambiental, área não atendida)",
                    },
                },
                "required": ["area_informada", "motivo"],
            },
        },
        {
            "name": "list_available_slots",
            "description": (
                "Consulta horários livres na agenda de consultas do escritório. "
                "date_range deve ser ISO: '2026-08-03' (um dia) ou '2026-08-03/2026-08-07' (intervalo). "
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
                        "description": "Tipo de consulta ('Consulta inicial' presencial ou 'Consulta online') — define a duração",
                    },
                    "period": {
                        "type": "string",
                        "enum": ["manha", "tarde"],
                        "description": (
                            f"Preferência de período: 'manha' ({manha_ini}h-{manha_fim}h) "
                            f"ou 'tarde' ({tarde_ini}h-{tarde_fim}h)"
                        ),
                    },
                },
                "required": ["date_range"],
            },
        },
        {
            "name": "create_pending_appointment",
            "description": (
                "Cria a consulta como pendente e notifica o escritório. "
                "Só chame após a pessoa confirmar explicitamente o horário. "
                "Usar slot_start/slot_end exatamente como retornado por list_available_slots."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "patient_name":   {"type": "string", "description": "Nome da pessoa"},
                    "procedure_type": {"type": "string", "description": "Tipo de consulta (inicial presencial ou online)"},
                    "slot_start":     {"type": "string", "description": "Datetime ISO do início"},
                    "slot_end":       {"type": "string", "description": "Datetime ISO do fim"},
                    "notes": {
                        "type": "string",
                        "description": "Área jurídica e resumo do caso, para o advogado se preparar",
                    },
                },
                "required": ["patient_name", "procedure_type", "slot_start", "slot_end"],
            },
        },
        {
            "name": "get_patient_appointments",
            "description": "Busca consultas já marcadas para este número (pendentes e confirmadas).",
            "input_schema": {"type": "object", "properties": {}, "required": []},
        },
        {
            "name": "reschedule_appointment",
            "description": (
                "Solicita remarcação de uma consulta para outro horário. "
                "Escala para confirmação do escritório — nunca remarca sozinha. "
                "Chame list_available_slots antes para obter o novo slot."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "appointment_id": {"type": "integer", "description": "ID da consulta existente"},
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
                "Solicita cancelamento de uma consulta. "
                "Escala para confirmação do escritório — nunca cancela sozinha."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "appointment_id": {"type": "integer", "description": "ID da consulta"},
                    "reason":         {"type": "string",  "description": "Motivo do cancelamento"},
                },
                "required": ["appointment_id"],
            },
        },
        {
            "name": "escalate_to_human",
            "description": "Transfere o atendimento para a equipe do escritório. Após chamar, não gere mais texto.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "reason": {
                        "type": "string",
                        "description": "Motivo da escalada (texto livre)",
                    },
                    "category": {
                        "type": "string",
                        "enum": list(ESCALATION_CATEGORIES),
                        "description": (
                            "Categoria da escalada: "
                            "'urgencia_prazo' = prazo iminente, intimação, audiência marcada, prisão, "
                            "liminar, risco à pessoa — escale IMEDIATAMENTE, sem terminar a qualificação; "
                            "'consulta_juridica' = a pessoa insiste em orientação, parecer, chance de êxito, "
                            "valor de indenização, prazo processual ou honorários (ato privativo do advogado); "
                            "'processo_em_andamento' = já é cliente e quer falar do andamento do processo dela; "
                            "'reclamacao' = insatisfação, reclamação ou crítica ao escritório; "
                            "'pedido_humano' = pediu explicitamente falar com advogado ou pessoa; "
                            "'confusao_repetida' = repetiu a mesma dúvida 2x+ sem progresso ou se irritou."
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
            value = value.strip()
            if field == "urgencia":
                value = value.lower()
                if value not in URGENCIA_LEVELS:
                    return {"error": f"urgencia deve ser um de: {', '.join(URGENCIA_LEVELS)}"}
            save_lead_field(phone, field, value)
            log.info("lead_field_saved", phone_hash=phone_hash, field=field)
            return {"ok": True}
        log.warning("save_lead_field_invalid_args", phone_hash=phone_hash)
        return {"error": "field/value inválidos"}

    elif fn == "mark_lead_complete":
        newly = not was_qualified and is_lead_qualified(phone, config.lead_fields)
        if newly:
            context.get("inc_leads_qualified", lambda: None)()
            notify_lead_qualified(phone, get_lead_data(phone), config.lead_fields)
            log.info("lead_qualified", phone_hash=phone_hash)
        return {"ok": True, "qualified": is_lead_qualified(phone, config.lead_fields)}

    elif fn == "marcar_fora_de_escopo":
        area   = (args.get("area_informada") or "").strip()
        motivo = (args.get("motivo") or "").strip()
        if not area or not motivo:
            return {"error": "area_informada e motivo são obrigatórios"}
        if _is_served_area(area, config.procedures):
            log.info("fora_escopo_rejected", phone_hash=phone_hash, area=area)
            return {
                "error": (
                    f"'{area}' está entre as áreas atendidas pelo escritório. "
                    "Não marque fora de escopo — continue a qualificação normalmente."
                )
            }
        # lead_data é chave/valor: status + motivo_perda mantêm o lead no CRM,
        # fora do funil de agendamento, para follow-up posterior.
        save_lead_field(phone, "status", LEAD_STATUS_FORA_ESCOPO)
        save_lead_field(phone, "motivo_perda", motivo)
        save_lead_field(phone, "area_juridica", area)
        log.info("lead_fora_escopo", phone_hash=phone_hash, area=area)
        return {
            "ok": True,
            "status": LEAD_STATUS_FORA_ESCOPO,
            "message": (
                "Lead registrado fora de escopo. Diga com clareza que o escritório não atua "
                "nessa área, sem indicar outro escritório e sem opinar sobre o caso. "
                "Não ofereça agendamento."
            ),
        }

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
            # Persiste os slots (com ISO) para a pessoa poder escolher no próximo turno.
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
        # Sem resumo nas notes, o advogado entra na consulta às cegas: completa do lead.
        if not notes:
            data  = get_lead_data(phone)
            notes = " — ".join(
                v for v in (data.get("area_juridica"), data.get("resumo_caso")) if v
            )
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
            "message": "Consulta registrada e escritório notificado.",
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
            return {"error": "Consulta não encontrada."}
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
            "message": "Remarcação solicitada. O escritório vai confirmar.",
        }

    elif fn == "cancel_appointment":
        apt_id = args.get("appointment_id")
        reason = args.get("reason", "")
        if not isinstance(apt_id, int):
            return {"error": "appointment_id obrigatório"}
        apt = get_appointment(apt_id)
        if not apt or apt["phone"] != phone:
            return {"error": "Consulta não encontrada."}
        update_appointment(apt_id, status="cancel_requested")
        notify_cancel_pending(
            apt_id, phone, apt["patient_name"], apt["procedure_type"],
            slot_label(apt["slot_start"], tz), reason,
        )
        log.info("cancel_requested", phone_hash=phone_hash, appointment_id=apt_id)
        return {
            "ok": True,
            "appointment_id": apt_id,
            "message": "Cancelamento solicitado. O escritório vai confirmar.",
        }

    log.warning("unknown_tool_called", phone_hash=phone_hash, fn=fn)
    return {"error": f"unknown tool: {fn}"}
