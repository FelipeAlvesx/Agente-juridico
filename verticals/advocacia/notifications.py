"""
Notificações do vertical advocacia para a equipe do escritório.
"""

import structlog
from evolution import send_message
from config import get_config

log = structlog.get_logger()

_LABELS = {
    "nome":          "👤 Nome",
    "area_juridica": "⚖️ Área",
    "resumo_caso":   "📝 Caso",
    "urgencia":      "⏱️ Urgência",
    "origem":        "🔗 Como conheceu",
}


def notify_lead_qualified(phone: str, data: dict, lead_fields: tuple) -> None:
    human_phone = get_config().human_phone
    if not human_phone:
        return

    lines = [
        f"{_LABELS.get(f, f)}: {data.get(f, '?')}"
        for f in lead_fields
    ]
    text = (
        f"🎯 *Novo lead qualificado!*\n\n"
        f"📱 Número: {phone}\n" + "\n".join(lines) +
        f"\n\nEntre em contato para confirmar a consulta."
    )
    send_message(human_phone, text)


def notify_appointment_pending(
    appointment_id: int,
    patient_phone: str,
    patient_name: str,
    procedure_type: str,
    slot_label: str,
    notes: str = "",
) -> None:
    human_phone = get_config().human_phone
    if not human_phone:
        return

    extra = f"\nObs: {notes}" if notes else ""
    text = (
        f"📅 *Novo agendamento pendente* (ID #{appointment_id})\n\n"
        f"👤 Cliente: {patient_name}\n"
        f"📱 Número: {patient_phone}\n"
        f"⚖️ Consulta: {procedure_type}\n"
        f"🕐 Horário: {slot_label}{extra}\n\n"
        f"Responda:\n"
        f"  *confirmar {appointment_id}*\n"
        f"  *rejeitar {appointment_id} motivo*"
    )
    send_message(human_phone, text)


def notify_reschedule_pending(
    appointment_id: int,
    patient_phone: str,
    patient_name: str,
    procedure_type: str,
    old_slot_label: str,
    new_slot_label: str,
) -> None:
    human_phone = get_config().human_phone
    if not human_phone:
        return

    text = (
        f"🔄 *Pedido de remarcação* (ID #{appointment_id})\n\n"
        f"👤 Cliente: {patient_name}\n"
        f"📱 Número: {patient_phone}\n"
        f"⚖️ Consulta: {procedure_type}\n"
        f"🕐 Horário atual: {old_slot_label}\n"
        f"🕐 Novo horário: {new_slot_label}\n\n"
        f"Responda:\n"
        f"  *confirmar {appointment_id}*\n"
        f"  *rejeitar {appointment_id} motivo*"
    )
    send_message(human_phone, text)


def notify_cancel_pending(
    appointment_id: int,
    patient_phone: str,
    patient_name: str,
    procedure_type: str,
    slot_label: str,
    reason: str = "",
) -> None:
    human_phone = get_config().human_phone
    if not human_phone:
        return

    extra = f"\nMotivo: {reason}" if reason else ""
    text = (
        f"❌ *Pedido de cancelamento* (ID #{appointment_id})\n\n"
        f"👤 Cliente: {patient_name}\n"
        f"📱 Número: {patient_phone}\n"
        f"⚖️ Consulta: {procedure_type}\n"
        f"🕐 Horário: {slot_label}{extra}\n\n"
        f"Responda:\n"
        f"  *confirmar {appointment_id}*  ← confirmar cancelamento\n"
        f"  *rejeitar {appointment_id} motivo*  ← manter agendamento"
    )
    send_message(human_phone, text)
