"""
Gerencia histórico de conversas e dados de lead por telefone usando SQLite.
TTL de 30 minutos: conversa inativa por mais que isso começa do zero.
"""

import sqlite3
import time
import os
import threading
from datetime import datetime

DB_PATH = os.getenv("DB_PATH", "/app/data/sessions.db")
TTL_SECONDS = 30 * 60
MAX_TURNS = 10

# Slots oferecidos à cliente no último list_available_slots, por telefone.
# Os ISO slot_start/slot_end não sobrevivem ao histórico (que só guarda texto),
# então a Lara perderia os horários ao escolher num turno seguinte. Guardamos
# aqui em memória (processo único) para reinjetar no contexto e permitir o
# create_pending_appointment direto, sem re-listar.
_OFFERED_SLOTS: dict[str, list] = {}
_OFFERED_LOCK = threading.Lock()


def save_offered_slots(phone: str, slots: list) -> None:
    with _OFFERED_LOCK:
        _OFFERED_SLOTS[phone] = slots


def get_offered_slots(phone: str) -> list:
    with _OFFERED_LOCK:
        return list(_OFFERED_SLOTS.get(phone, []))


def clear_offered_slots(phone: str) -> None:
    with _OFFERED_LOCK:
        _OFFERED_SLOTS.pop(phone, None)

_INITIAL_SERVICES = [
    ("Faciais & Limpeza", "Limpeza de pele profunda",       60,  180.0),
    ("Faciais & Limpeza", "Peeling químico",                45,  220.0),
    ("Faciais & Limpeza", "Drenagem linfática facial",      60,  150.0),
    ("Faciais & Limpeza", "Hidratação profunda com LED",    60,  200.0),
    ("Rejuvenescimento",  "Botox",                          45,  800.0),
    ("Rejuvenescimento",  "Preenchimento labial",           60,  950.0),
    ("Rejuvenescimento",  "Fio de sustentação (PDO)",       90, 2500.0),
    ("Rejuvenescimento",  "Skinbooster",                    45,  650.0),
    ("Rejuvenescimento",  "Bioestimulador de colágeno",     60, 1200.0),
    ("Laser & Luz",       "Laser CO2 fracionado",           60, 1500.0),
    ("Laser & Luz",       "Microagulhamento com vitaminas", 60,  350.0),
    ("Laser & Luz",       "Luz intensa pulsada (LIP)",      45,  450.0),
]

_INITIAL_PROFESSIONALS = [
    ("Dra. Sofia Mendes",  "Dermatologista",           "SM", "#7C3D6E", 4.9, 34, 5),
    ("Dra. Carla Ribeiro", "Esteticista Especialista", "CR", "#2D6E7C", 4.8, 28, 8),
    ("Dr. Lucas Mendonça", "Bioestimuladores",         "LM", "#2D7C3D", 4.7, 21, 4),
]

_seeded = False


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            phone    TEXT    NOT NULL,
            role     TEXT    NOT NULL,
            content  TEXT    NOT NULL,
            ts       REAL    NOT NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_phone_ts ON sessions(phone, ts)")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS lead_data (
            phone TEXT NOT NULL,
            field TEXT NOT NULL,
            value TEXT NOT NULL,
            PRIMARY KEY (phone, field)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS appointments (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            phone           TEXT    NOT NULL,
            patient_name    TEXT    NOT NULL DEFAULT '',
            procedure_type  TEXT    NOT NULL DEFAULT '',
            slot_start      TEXT    NOT NULL,
            slot_end        TEXT    NOT NULL,
            new_slot_start  TEXT,
            new_slot_end    TEXT,
            notes           TEXT    NOT NULL DEFAULT '',
            status          TEXT    NOT NULL DEFAULT 'pending',
            external_id     TEXT,
            created_at      REAL    NOT NULL,
            updated_at      REAL    NOT NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_apt_phone ON appointments(phone)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_apt_status ON appointments(status)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_apt_slot ON appointments(slot_start)")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS escalations (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            phone      TEXT NOT NULL,
            reason     TEXT NOT NULL DEFAULT '',
            category   TEXT NOT NULL DEFAULT 'pedido_humano',
            created_at REAL NOT NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_esc_phone ON escalations(phone)")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS services (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT    NOT NULL,
            name     TEXT    NOT NULL,
            duration INTEGER NOT NULL DEFAULT 60,
            price    REAL    NOT NULL DEFAULT 0,
            active   INTEGER NOT NULL DEFAULT 1
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS professionals (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            name               TEXT    NOT NULL,
            specialty          TEXT    NOT NULL DEFAULT '',
            initials           TEXT    NOT NULL DEFAULT '',
            color              TEXT    NOT NULL DEFAULT '#7C3D6E',
            rating             REAL    NOT NULL DEFAULT 5.0,
            appointments_count INTEGER NOT NULL DEFAULT 0,
            services_count     INTEGER NOT NULL DEFAULT 0,
            active             INTEGER NOT NULL DEFAULT 1
        )
    """)
    conn.commit()
    global _seeded
    if not _seeded:
        _seed_default_data(conn)
        _seeded = True
    return conn


def _seed_default_data(conn: sqlite3.Connection) -> None:
    if conn.execute("SELECT COUNT(*) FROM services").fetchone()[0] == 0:
        conn.executemany(
            "INSERT INTO services (category, name, duration, price, active) VALUES (?, ?, ?, ?, 1)",
            _INITIAL_SERVICES,
        )
    if conn.execute("SELECT COUNT(*) FROM professionals").fetchone()[0] == 0:
        conn.executemany(
            """INSERT INTO professionals
               (name, specialty, initials, color, rating, appointments_count, services_count, active)
               VALUES (?, ?, ?, ?, ?, ?, ?, 1)""",
            _INITIAL_PROFESSIONALS,
        )
    conn.commit()


# ── Session history ───────────────────────────────────────────────────────────

def _ts_to_iso(ts: float) -> str:
    from datetime import timezone
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def get_history(phone: str) -> list[dict]:
    """Retorna histórico para o loop do Claude (sem timestamp)."""
    cutoff = time.time() - TTL_SECONDS
    conn = _get_conn()
    rows = conn.execute(
        """SELECT role, content FROM sessions
           WHERE phone = ? AND ts > ?
           ORDER BY ts ASC""",
        (phone, cutoff)
    ).fetchall()
    conn.close()
    history = [{"role": row[0], "content": row[1]} for row in rows]
    max_msgs = MAX_TURNS * 2
    return history[-max_msgs:] if len(history) > max_msgs else history


def get_conversation_for_dashboard(phone: str) -> list[dict]:
    """Retorna todo o histórico da conversa com timestamps ISO para o dashboard."""
    conn = _get_conn()
    rows = conn.execute(
        """SELECT role, content, ts FROM sessions
           WHERE phone = ?
           ORDER BY ts ASC""",
        (phone,)
    ).fetchall()
    conn.close()
    return [
        {"role": row[0], "content": row[1], "timestamp": _ts_to_iso(row[2])}
        for row in rows
    ]


def get_recent_conversations(limit: int = 50) -> list[dict]:
    """Retorna lista de conversas recentes (última mensagem por telefone)."""
    conn = _get_conn()
    rows = conn.execute(
        """SELECT s.phone, MAX(s.ts) as last_ts,
                  (SELECT content FROM sessions s2 WHERE s2.phone = s.phone ORDER BY s2.ts DESC LIMIT 1) as last_msg,
                  (SELECT role    FROM sessions s2 WHERE s2.phone = s.phone ORDER BY s2.ts DESC LIMIT 1) as last_role,
                  (SELECT value   FROM lead_data l  WHERE l.phone  = s.phone AND l.field = 'nome' LIMIT 1) as nome,
                  EXISTS(SELECT 1 FROM escalations e WHERE e.phone = s.phone) as escalated
           FROM sessions s
           GROUP BY s.phone
           ORDER BY last_ts DESC
           LIMIT ?""",
        (limit,)
    ).fetchall()
    conn.close()
    return [
        {
            "phone":        row[0],
            "nome":         row[4] or "",
            "last_message": row[2] or "",
            "last_role":    row[3] or "",
            "last_ts":      _ts_to_iso(row[1]) if row[1] else None,
            "escalated":    bool(row[5]),
        }
        for row in rows
    ]


def save_turn(phone: str, user_text: str, assistant_text: str) -> None:
    now = time.time()
    conn = _get_conn()
    conn.executemany(
        "INSERT INTO sessions (phone, role, content, ts) VALUES (?, ?, ?, ?)",
        [
            (phone, "user",      user_text,      now),
            (phone, "assistant", assistant_text, now + 0.001),
        ]
    )
    conn.commit()
    conn.close()


def clear_history(phone: str) -> None:
    conn = _get_conn()
    conn.execute("DELETE FROM sessions WHERE phone = ?", (phone,))
    conn.commit()
    conn.close()


# ── Lead qualification ────────────────────────────────────────────────────────

def get_lead_data(phone: str) -> dict:
    conn = _get_conn()
    rows = conn.execute(
        "SELECT field, value FROM lead_data WHERE phone = ?", (phone,)
    ).fetchall()
    conn.close()
    return {row[0]: row[1] for row in rows}


def save_lead_field(phone: str, field: str, value: str) -> None:
    conn = _get_conn()
    conn.execute(
        "INSERT OR REPLACE INTO lead_data (phone, field, value) VALUES (?, ?, ?)",
        (phone, field, value)
    )
    conn.commit()
    conn.close()


def is_lead_qualified(phone: str, lead_fields: tuple) -> bool:
    data = get_lead_data(phone)
    return all(f in data for f in lead_fields)


def get_all_leads(limit: int = 100, offset: int = 0) -> list[dict]:
    """Retorna todos os leads com seus dados de qualificação agregados."""
    conn = _get_conn()
    phones = conn.execute(
        """SELECT DISTINCT phone FROM lead_data
           ORDER BY rowid DESC LIMIT ? OFFSET ?""",
        (limit, offset),
    ).fetchall()

    leads = []
    for (phone,) in phones:
        rows = conn.execute(
            "SELECT field, value FROM lead_data WHERE phone = ?", (phone,)
        ).fetchall()
        data = {r[0]: r[1] for r in rows}
        # Last contact timestamp from sessions
        last_ts = conn.execute(
            "SELECT MAX(ts) FROM sessions WHERE phone = ?", (phone,)
        ).fetchone()[0]
        leads.append({
            "phone": phone,
            "nome": data.get("nome", ""),
            "procedimento_interesse": data.get("procedimento_interesse", ""),
            "indicacao": data.get("indicacao", ""),
            "qualified": all(f in data for f in ("nome", "procedimento_interesse", "indicacao")),
            "created_at": _ts_to_iso(last_ts) if last_ts else None,
        })
    conn.close()
    return leads


# ── Appointments ──────────────────────────────────────────────────────────────

def _rows_to_dicts(cursor, rows: list) -> list[dict]:
    cols = [d[0] for d in cursor.description]
    return [dict(zip(cols, r)) for r in rows]


def create_appointment(
    phone: str,
    patient_name: str,
    procedure_type: str,
    slot_start: str,
    slot_end: str,
    notes: str = "",
) -> int:
    now = time.time()
    conn = _get_conn()
    cursor = conn.execute(
        """INSERT INTO appointments
           (phone, patient_name, procedure_type, slot_start, slot_end, notes, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)""",
        (phone, patient_name, procedure_type, slot_start, slot_end, notes, now, now),
    )
    conn.commit()
    apt_id = cursor.lastrowid
    conn.close()
    return apt_id


def get_appointment(appointment_id: int) -> dict | None:
    conn = _get_conn()
    cur = conn.execute("SELECT * FROM appointments WHERE id = ?", (appointment_id,))
    row = cur.fetchone()
    result = _rows_to_dicts(cur, [row])[0] if row else None
    conn.close()
    return result


def get_patient_appointments(phone: str) -> list[dict]:
    conn = _get_conn()
    cur = conn.execute(
        "SELECT * FROM appointments WHERE phone = ? ORDER BY created_at DESC LIMIT 10",
        (phone,),
    )
    result = _rows_to_dicts(cur, cur.fetchall())
    conn.close()
    return result


def update_appointment(appointment_id: int, **fields) -> bool:
    if not fields:
        return False
    fields["updated_at"] = time.time()
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [appointment_id]
    conn = _get_conn()
    cursor = conn.execute(f"UPDATE appointments SET {set_clause} WHERE id = ?", values)
    conn.commit()
    conn.close()
    return cursor.rowcount > 0


def get_all_appointments(status: str | None = None, date_from: str | None = None,
                          date_to: str | None = None, limit: int = 100, offset: int = 0) -> list[dict]:
    """Retorna agendamentos com filtros opcionais."""
    conditions = []
    params: list = []

    if status:
        conditions.append("status = ?")
        params.append(status)
    if date_from:
        conditions.append("slot_start >= ?")
        params.append(date_from)
    if date_to:
        conditions.append("slot_start <= ?")
        params.append(date_to)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    params += [limit, offset]

    conn = _get_conn()
    cur = conn.execute(
        f"SELECT * FROM appointments {where} ORDER BY slot_start DESC LIMIT ? OFFSET ?",
        params,
    )
    result = _rows_to_dicts(cur, cur.fetchall())
    conn.close()
    return result


def get_confirmed_appointments_tomorrow() -> list[dict]:
    from datetime import timedelta
    from zoneinfo import ZoneInfo
    tz = ZoneInfo("America/Sao_Paulo")
    now = datetime.now(tz)
    tomorrow = (now.date() + timedelta(days=1)).isoformat()
    day_end  = (now.date() + timedelta(days=2)).isoformat()
    conn = _get_conn()
    cur = conn.execute(
        """SELECT * FROM appointments
           WHERE status = 'confirmed'
             AND slot_start >= ? AND slot_start < ?
           ORDER BY slot_start""",
        (tomorrow, day_end),
    )
    result = _rows_to_dicts(cur, cur.fetchall())
    conn.close()
    return result


# ── Escalations ───────────────────────────────────────────────────────────────

def get_recent_escalations(limit: int = 50) -> list[dict]:
    conn = _get_conn()
    try:
        conn.execute("ALTER TABLE escalations ADD COLUMN category TEXT NOT NULL DEFAULT 'pedido_humano'")
        conn.commit()
    except Exception:
        pass
    cur = conn.execute(
        """
        SELECT e.id, e.phone, e.reason, e.category, e.created_at,
               ld.value AS nome
        FROM escalations e
        LEFT JOIN lead_data ld ON ld.phone = e.phone AND ld.field = 'nome'
        ORDER BY e.created_at DESC
        LIMIT ?
        """,
        (limit,),
    )
    rows = cur.fetchall()
    cols = [d[0] for d in cur.description]
    conn.close()
    return [dict(zip(cols, r)) for r in rows]


def log_escalation(phone: str, reason: str = "", category: str = "pedido_humano") -> None:
    conn = _get_conn()
    try:
        conn.execute("ALTER TABLE escalations ADD COLUMN category TEXT NOT NULL DEFAULT 'pedido_humano'")
        conn.commit()
    except Exception:
        pass
    conn.execute(
        "INSERT INTO escalations (phone, reason, category, created_at) VALUES (?, ?, ?, ?)",
        (phone, reason, category, time.time()),
    )
    conn.commit()
    conn.close()


# ── Stats for dashboard ───────────────────────────────────────────────────────

# ── Services ─────────────────────────────────────────────────────────────────

def get_all_services() -> list[dict]:
    conn = _get_conn()
    cur = conn.execute("SELECT * FROM services ORDER BY category, name")
    result = _rows_to_dicts(cur, cur.fetchall())
    conn.close()
    return result


def create_service(category: str, name: str, duration: int, price: float, active: bool = True) -> int:
    conn = _get_conn()
    cur = conn.execute(
        "INSERT INTO services (category, name, duration, price, active) VALUES (?, ?, ?, ?, ?)",
        (category, name, duration, price, int(active)),
    )
    conn.commit()
    sid = cur.lastrowid
    conn.close()
    return sid


def update_service(service_id: int, **fields) -> bool:
    if not fields:
        return False
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [service_id]
    conn = _get_conn()
    cursor = conn.execute(f"UPDATE services SET {set_clause} WHERE id = ?", values)
    conn.commit()
    conn.close()
    return cursor.rowcount > 0


def delete_service(service_id: int) -> bool:
    conn = _get_conn()
    cursor = conn.execute("DELETE FROM services WHERE id = ?", (service_id,))
    conn.commit()
    conn.close()
    return cursor.rowcount > 0


# ── Professionals ─────────────────────────────────────────────────────────────

def get_all_professionals() -> list[dict]:
    conn = _get_conn()
    cur = conn.execute("SELECT * FROM professionals ORDER BY name")
    result = _rows_to_dicts(cur, cur.fetchall())
    conn.close()
    return result


def create_professional(
    name: str, specialty: str, initials: str, color: str,
    rating: float, appointments_count: int = 0, services_count: int = 0,
    active: bool = True,
) -> int:
    conn = _get_conn()
    cur = conn.execute(
        """INSERT INTO professionals
           (name, specialty, initials, color, rating, appointments_count, services_count, active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (name, specialty, initials, color, rating, appointments_count, services_count, int(active)),
    )
    conn.commit()
    pid = cur.lastrowid
    conn.close()
    return pid


def update_professional(professional_id: int, **fields) -> bool:
    if not fields:
        return False
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [professional_id]
    conn = _get_conn()
    cursor = conn.execute(f"UPDATE professionals SET {set_clause} WHERE id = ?", values)
    conn.commit()
    conn.close()
    return cursor.rowcount > 0


def delete_professional(professional_id: int) -> bool:
    conn = _get_conn()
    cursor = conn.execute("DELETE FROM professionals WHERE id = ?", (professional_id,))
    conn.commit()
    conn.close()
    return cursor.rowcount > 0


# ── Stats for dashboard ───────────────────────────────────────────────────────

def get_stats() -> dict:
    conn = _get_conn()

    total_leads = conn.execute(
        "SELECT COUNT(DISTINCT phone) FROM lead_data"
    ).fetchone()[0]

    total_qualified = conn.execute(
        """SELECT COUNT(*) FROM (
             SELECT phone FROM lead_data
             GROUP BY phone
             HAVING COUNT(DISTINCT field) >= 3
           )"""
    ).fetchone()[0]

    total_appointments = conn.execute(
        "SELECT COUNT(*) FROM appointments"
    ).fetchone()[0]

    pending_appointments = conn.execute(
        "SELECT COUNT(*) FROM appointments WHERE status = 'pending'"
    ).fetchone()[0]

    confirmed_appointments = conn.execute(
        "SELECT COUNT(*) FROM appointments WHERE status = 'confirmed'"
    ).fetchone()[0]

    total_escalations = conn.execute(
        "SELECT COUNT(*) FROM escalations"
    ).fetchone()[0]

    conn.close()
    return {
        "leads_total": total_leads,
        "leads_qualified": total_qualified,
        "appointments_total": total_appointments,
        "appointments_pending": pending_appointments,
        "appointments_confirmed": confirmed_appointments,
        "escalations_total": total_escalations,
    }
