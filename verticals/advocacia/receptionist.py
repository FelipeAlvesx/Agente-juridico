"""
Processamento de comandos da recepcionista para o vertical estética (Lumina).
"""

import re
import structlog
import gcal
from sessions import get_appointment, update_appointment
from evolution import send_message
from config import get_config
from verticals.estetica.tools import slot_label

log = structlog.get_logger()

_CONFIRM_RE = re.compile(r"^confirmar\s+(\d+)\s*$", re.IGNORECASE)
_REJECT_RE  = re.compile(r"^rejeitar\s+(\d+)(?:\s+(.+))?\s*$", re.IGNORECASE)


def handle_receptionist_command(text: str) -> bool:
    """Retorna True se o texto era um comando reconhecido da recepcionista."""
    m = _CONFIRM_RE.match(text.strip())
    if m:
        _confirm_appointment(int(m.group(1)))
        return True

    m = _REJECT_RE.match(text.strip())
    if m:
        _reject_appointment(int(m.group(1)), m.group(2) or "")
        return True

    return False


def _confirm_appointment(appointment_id: int) -> None:
    config      = get_config()
    human_phone = config.human_phone
    tz          = config.tz
    apt         = get_appointment(appointment_id)
    if not apt:
        send_message(human_phone, f"Agendamento #{appointment_id} não encontrado.")
        return

    status = apt["status"]

    if status == "pending":
        gcal.confirm_event(apt.get("external_id") or "", apt["patient_name"], apt["procedure_type"])
        update_appointment(appointment_id, status="confirmed")
        sl = slot_label(apt["slot_start"], tz)
        send_message(
            apt["phone"],
            f"Boa notícia! Seu agendamento foi confirmado 🎉\n\n"
            f"💆 {apt['procedure_type']}\n"
            f"🕐 {sl}\n\n"
            f"Qualquer dúvida ou se precisar remarcar, é só me chamar!",
        )
        send_message(human_phone, f"✅ Agendamento #{appointment_id} confirmado.")
        log.info("appointment_confirmed", appointment_id=appointment_id)

    elif status == "reschedule_requested":
        new_start = apt.get("new_slot_start")
        new_end   = apt.get("new_slot_end")
        if not new_start:
            send_message(human_phone, f"Dados de remarcação não encontrados para #{appointment_id}.")
            return
        gcal.confirm_event_with_new_slot(
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
        send_message(human_phone, f"✅ Remarcação #{appointment_id} confirmada.")
        log.info("reschedule_confirmed", appointment_id=appointment_id)

    elif status == "cancel_requested":
        gcal.delete_event(apt.get("external_id") or "")
        update_appointment(appointment_id, status="cancelled")
        send_message(
            apt["phone"],
            f"Seu agendamento foi cancelado conforme solicitado.\n"
            f"Se quiser agendar em outro momento, é só me chamar 😊",
        )
        send_message(human_phone, f"✅ Cancelamento #{appointment_id} confirmado.")
        log.info("appointment_cancelled", appointment_id=appointment_id)

    else:
        send_message(human_phone, f"Agendamento #{appointment_id} está com status '{status}', nada a confirmar.")


def _reject_appointment(appointment_id: int, reason: str) -> None:
    config      = get_config()
    human_phone = config.human_phone
    apt         = get_appointment(appointment_id)
    if not apt:
        send_message(human_phone, f"Agendamento #{appointment_id} não encontrado.")
        return

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
            gcal.delete_event(apt.get("external_id") or "")
            update_appointment(appointment_id, status="rejected")
            patient_msg = (
                f"Infelizmente não conseguimos confirmar esse horário 😕\n"
                + (f"Motivo: {reason}\n\n" if reason else "\n")
                + "Quer tentar outro dia ou horário? É só me dizer!"
            )
        send_message(apt["phone"], patient_msg)
        send_message(human_phone, f"✅ Agendamento #{appointment_id} rejeitado.")
        log.info("appointment_rejected", appointment_id=appointment_id, reason=reason)

    elif status == "cancel_requested":
        update_appointment(appointment_id, status="confirmed")
        send_message(
            apt["phone"],
            "Não conseguimos processar o cancelamento agora.\n"
            + (f"Motivo: {reason}\n\n" if reason else "\n")
            + "Seu agendamento continua confirmado. Precisa de outra ajuda?",
        )
        send_message(human_phone, f"✅ Cancelamento #{appointment_id} negado, agendamento mantido.")

    else:
        send_message(human_phone, f"Agendamento #{appointment_id} está com status '{status}', nada a rejeitar.")
