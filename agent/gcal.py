"""
Google Calendar backend para agendamento de procedimentos estéticos.
Usa Service Account — sem OAuth interativo.
"""

import os
from datetime import datetime, date, time, timedelta

import structlog

from config import get_config

log = structlog.get_logger()

# Lumina funciona de segunda a sábado, das 9h às 19h
BUSINESS_START = 9
BUSINESS_END   = 19

_WEEKDAYS_PT = [
    "segunda-feira", "terça-feira", "quarta-feira",
    "quinta-feira", "sexta-feira", "sábado", "domingo",
]


def is_configured() -> bool:
    creds_path = os.getenv("GOOGLE_CREDENTIALS_PATH", "/app/credentials/google_credentials.json")
    return os.path.isfile(creds_path) and bool(get_config().calendar_id)


def _get_service():
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    creds_path = os.getenv("GOOGLE_CREDENTIALS_PATH", "/app/credentials/google_credentials.json")
    creds = service_account.Credentials.from_service_account_file(
        creds_path,
        scopes=["https://www.googleapis.com/auth/calendar"],
    )
    return build("calendar", "v3", credentials=creds, cache_discovery=False)


def _parse_dt(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(get_config().tz)


def _resolve_duration(procedure_type: str | None, cfg) -> int:
    """Retorna duração em minutos para o procedimento, com fallback para slot_duration."""
    if procedure_type and cfg.procedure_durations:
        proc_lower = procedure_type.lower()
        for key, val in cfg.procedure_durations.items():
            if key.lower() in proc_lower or proc_lower in key.lower():
                return int(val)
    return cfg.slot_duration


def _parse_date_range(date_range: str) -> tuple[date, date]:
    if "/" in date_range:
        start_str, end_str = date_range.split("/", 1)
        return date.fromisoformat(start_str), date.fromisoformat(end_str)
    start = date.fromisoformat(date_range)
    return start, start + timedelta(days=6)


def _period_hours(period: str | None) -> tuple[int, int]:
    """Converte preferência de período em (hora_início, hora_fim)."""
    if not period:
        return BUSINESS_START, BUSINESS_END
    p = period.lower()
    if any(x in p for x in ("manha", "manhã", "morning")):
        return 9, 12
    if any(x in p for x in ("tarde", "afternoon")):
        return 13, 19
    return BUSINESS_START, BUSINESS_END


def _mock_slots(start_date: date, end_date: date, duration: int,
                day_start_h: int, day_end_h: int, tz) -> dict:
    """Gera slots simulados plausíveis quando o calendário não está configurado (modo demo)."""
    now = datetime.now(tz)
    tomorrow = (now + timedelta(days=1)).date()
    current = max(start_date, tomorrow)

    # Distribuir horários ao longo do dia para variedade
    candidate_hours = [h for h in [9, 10, 11, 14, 15, 16, 17]
                       if h >= day_start_h and h + duration / 60 <= day_end_h]
    if not candidate_hours:
        candidate_hours = [day_start_h]

    available = []
    hour_idx = 0
    while current <= end_date and len(available) < 3:
        if current.weekday() > 5:  # Pula domingo
            current += timedelta(days=1)
            continue
        h = candidate_hours[hour_idx % len(candidate_hours)]
        hour_idx += 1
        slot = datetime.combine(current, time(h, 0), tzinfo=tz)
        slot_end = slot + timedelta(minutes=duration)
        weekday = _WEEKDAYS_PT[current.weekday()]
        available.append({
            "slot_start": slot.isoformat(),
            "slot_end":   slot_end.isoformat(),
            "label": f"{weekday}, {current.strftime('%d/%m')} às {slot.strftime('%H:%M')}",
        })
        current += timedelta(days=1)

    if not available:
        return {"slots": [], "message": "Nenhum horário disponível no período. Tente outro intervalo."}
    return {"slots": available}


def list_available_slots(
    date_range: str,
    procedure_type: str | None = None,
    period: str | None = None,
) -> dict:
    """
    Retorna até 3 slots livres, um por dia, distribuídos no intervalo pedido.
    date_range: 'YYYY-MM-DD' ou 'YYYY-MM-DD/YYYY-MM-DD'.
    period: 'manha' ou 'tarde' (opcional).
    """
    cfg            = get_config()
    tz             = cfg.tz
    slot_duration  = _resolve_duration(procedure_type, cfg)
    buffer         = cfg.slot_buffer
    day_start_h, day_end_h = _period_hours(period)

    try:
        start_date, end_date = _parse_date_range(date_range)
    except ValueError as e:
        return {"error": f"date_range inválido: {e}"}

    # Fallback de demo: sem credenciais ou DEMO_CALENDAR=true
    demo_mode = os.getenv("DEMO_CALENDAR", "").lower() in ("true", "1", "yes")
    if not is_configured() or demo_mode:
        log.info("gcal_demo_fallback", procedure_type=procedure_type, period=period)
        return _mock_slots(start_date, end_date, slot_duration, day_start_h, day_end_h, tz)

    try:
        calendar_id = cfg.calendar_id
        service     = _get_service()

        time_min = datetime.combine(start_date, time(0, 0), tzinfo=tz).isoformat()
        time_max = datetime.combine(end_date + timedelta(days=1), time(0, 0), tzinfo=tz).isoformat()

        freebusy = service.freebusy().query(body={
            "timeMin": time_min,
            "timeMax": time_max,
            "items": [{"id": calendar_id}],
            "timeZone": cfg.timezone,
        }).execute()

        busy_raw = freebusy.get("calendars", {}).get(calendar_id, {}).get("busy", [])
        busy = [(_parse_dt(b["start"]), _parse_dt(b["end"])) for b in busy_raw]

        now       = datetime.now(tz)
        available = []
        current   = start_date
        buf       = timedelta(minutes=buffer)

        while current <= end_date and len(available) < 3:
            if current.weekday() > 5:  # Pula domingo
                current += timedelta(days=1)
                continue

            slot    = datetime.combine(current, time(day_start_h, 0), tzinfo=tz)
            day_end = datetime.combine(current, time(day_end_h,   0), tzinfo=tz)

            # Curadoria: pegar no máx. 1 slot por dia
            found_today = False
            while slot + timedelta(minutes=slot_duration) <= day_end and not found_today:
                slot_end = slot + timedelta(minutes=slot_duration)
                if slot > now:
                    # Buffer: slot bloqueado se começa antes do fim de um evento + buffer
                    occupied = any(slot < be + buf and slot_end > bs for bs, be in busy)
                    if not occupied:
                        weekday = _WEEKDAYS_PT[current.weekday()]
                        available.append({
                            "slot_start": slot.isoformat(),
                            "slot_end":   slot_end.isoformat(),
                            "label": f"{weekday}, {current.strftime('%d/%m')} às {slot.strftime('%H:%M')}",
                        })
                        found_today = True
                slot += timedelta(minutes=slot_duration)

            current += timedelta(days=1)

        if not available:
            return {"slots": [], "message": "Nenhum horário disponível no período. Tente outro intervalo."}

        return {"slots": available}

    except Exception as e:
        log.error("gcal_list_slots_error", error=str(e))
        return {"error": f"Erro ao consultar calendário: {str(e)}"}


def create_pending_event(appointment_id: int, patient_name: str, procedure_type: str,
                          slot_start: str, slot_end: str, notes: str = "") -> dict:
    if not is_configured():
        return {"ok": True, "external_id": None}

    try:
        cfg         = get_config()
        calendar_id = cfg.calendar_id
        service     = _get_service()

        description = f"Agendamento #{appointment_id}\nPaciente: {patient_name}\nProcedimento: {procedure_type}"
        if notes:
            description += f"\nObs: {notes}"

        event = {
            "summary":     f"[PENDENTE] {procedure_type} — {patient_name}",
            "description": description,
            "start": {"dateTime": slot_start, "timeZone": cfg.timezone},
            "end":   {"dateTime": slot_end,   "timeZone": cfg.timezone},
            "status": "tentative",
        }

        created = service.events().insert(calendarId=calendar_id, body=event).execute()
        return {"ok": True, "external_id": created["id"]}

    except Exception as e:
        log.error("gcal_create_event_error", error=str(e))
        return {"ok": True, "external_id": None}


def confirm_event(external_id: str, patient_name: str, procedure_type: str) -> dict:
    if not external_id or not is_configured():
        return {"ok": True}

    try:
        cfg         = get_config()
        calendar_id = cfg.calendar_id
        service     = _get_service()

        event = service.events().get(calendarId=calendar_id, eventId=external_id).execute()
        event["status"]  = "confirmed"
        event["summary"] = f"{procedure_type} — {patient_name}"
        service.events().update(calendarId=calendar_id, eventId=external_id, body=event).execute()
        return {"ok": True}

    except Exception as e:
        log.error("gcal_confirm_event_error", error=str(e))
        return {"ok": True}


def confirm_event_with_new_slot(external_id: str, patient_name: str, procedure_type: str,
                                 new_slot_start: str, new_slot_end: str) -> dict:
    if not external_id or not is_configured():
        return {"ok": True}

    try:
        cfg         = get_config()
        calendar_id = cfg.calendar_id
        service     = _get_service()

        event = service.events().get(calendarId=calendar_id, eventId=external_id).execute()
        event["status"]  = "confirmed"
        event["summary"] = f"{procedure_type} — {patient_name}"
        event["start"]   = {"dateTime": new_slot_start, "timeZone": cfg.timezone}
        event["end"]     = {"dateTime": new_slot_end,   "timeZone": cfg.timezone}
        service.events().update(calendarId=calendar_id, eventId=external_id, body=event).execute()
        return {"ok": True}

    except Exception as e:
        log.error("gcal_reschedule_confirm_error", error=str(e))
        return {"ok": True}


def delete_event(external_id: str) -> dict:
    if not external_id or not is_configured():
        return {"ok": True}

    try:
        calendar_id = get_config().calendar_id
        service     = _get_service()
        service.events().delete(calendarId=calendar_id, eventId=external_id).execute()
        return {"ok": True}

    except Exception as e:
        log.error("gcal_delete_event_error", error=str(e))
        return {"ok": True}
