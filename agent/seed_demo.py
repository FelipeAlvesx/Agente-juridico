"""
Popula o banco com dados realistas para demo B2B.
Chamado no boot quando DEMO_SEED=true. Idempotente.
"""

import os
import sqlite3
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import structlog

DB_PATH = os.getenv("DB_PATH", "/app/data/sessions.db")
TZ = ZoneInfo("America/Sao_Paulo")

log = structlog.get_logger()

_LEADS = [
    # (phone, nome, procedimento, indicacao, days_ago)
    ("5511912345001", "Camila Rodrigues",    "Botox",                          "Instagram",        13),
    ("5511912345002", "Fernanda Lima",       "Preenchimento labial",           "Amiga",            12),
    ("5511912345003", "Beatriz Santos",      "Limpeza de pele profunda",       "Google",           11),
    ("5511912345004", "Juliana Oliveira",    "Laser CO2 fracionado",           "Instagram",        10),
    ("5511912345005", "Mariana Costa",       "Skinbooster",                    "Amiga",             9),
    ("5511912345006", "Ana Paula Souza",     "Microagulhamento com vitaminas", "Google",            8),
    ("5511912345007", "Patricia Mendes",     "Bioestimulador de colágeno",     "Indicação médica",  7),
    ("5511912345008", "Renata Ferreira",     "Hidratação profunda com LED",    "TikTok",            6),
    ("5511912345009", "Larissa Alves",       "Peeling químico",                "Instagram",         6),
    ("5511912345010", "Gabriela Moura",      "Fio de sustentação (PDO)",       "Amiga",             5),
    ("5511912345011", "Tatiana Cardoso",     "Drenagem linfática facial",      "Google",            4),
    ("5511912345012", "Vanessa Rocha",       "Luz intensa pulsada (LIP)",      "Instagram",         4),
    ("5511912345013", "Leticia Martins",     "Botox",                          "Amiga",             3),
    ("5511912345014", "Daniela Nunes",       "Preenchimento labial",           "Google",            3),
    ("5511912345015", "Aline Barbosa",       "Skinbooster",                    "TikTok",            2),
    ("5511912345016", "Carolina Farias",     "Laser CO2 fracionado",           None,                2),
    ("5511912345017", "Simone Andrade",      "Botox",                          None,                1),
    ("5511912345018", "Viviane Cruz",        "Preenchimento labial",           None,                1),
    ("5511912345019", "Isabela Borges",      None,                             None,                1),
    ("5511912345020", "Priscila Dias",       None,                             None,                0),
]

_PROC_DURATION = {
    "Botox": 30,
    "Preenchimento labial": 45,
    "Laser CO2 fracionado": 90,
    "Fio de sustentação (PDO)": 90,
    "Skinbooster": 45,
    "Peeling químico": 45,
    "Hidratação profunda com LED": 45,
    "Luz intensa pulsada (LIP)": 60,
}

_APPOINTMENTS = [
    # (lead_idx, days_offset, hour, status, notes)
    (0,   3, 14, "confirmed",             ""),
    (1,   5, 10, "confirmed",             "Primeira vez com preenchimento"),
    (2,  -2, 11, "confirmed",             ""),
    (3,  -6, 15, "confirmed",             ""),
    (4,   6, 16, "pending",               "Prefere tarde"),
    (5,   4, 10, "pending",               ""),
    (6,  -1, 14, "cancelled",             ""),
    (7,  -4,  9, "rejected",              "Horário indisponível"),
    (8,   2, 11, "reschedule_requested",  "Pediu via WhatsApp para outro horário"),
    (9,   7, 15, "cancel_requested",      "Cliente solicitou cancelamento"),
]

_CONVERSATIONS = [
    (0, 13, [
        ("Oi, vi vocês no Instagram 😍", "Olá! Que ótimo, seja bem-vinda à Lumina! Sou a Lara, sua consultora. Posso saber seu nome? 💜"),
        ("Me chamo Camila", "Prazer, Camila! Como posso te ajudar hoje?"),
        ("Quero saber sobre botox", "Ótima escolha! O botox é perfeito para suavizar linhas de expressão e dar aquela renovada no olhar. Você já fez alguma vez?"),
        ("Nunca fiz. Quanto custa?", "Entendo! 😊 Na Lumina, sempre começamos com uma avaliação gratuita com nossa especialista, que vai indicar o tratamento ideal para o seu rosto — sem compromisso.\n\n---\nVocê prefere uma manhã ou tarde para essa avaliação?"),
        ("Prefiro de tarde, semana que vem", "Perfeito! Tenho ótimas opções para você ✨"),
    ]),
    (1, 12, [
        ("oi quero agendar preenchimento labial", "Olá! Que delícia, seja bem-vinda! Sou a Lara 💜 Pode me dizer seu nome?"),
        ("Fernanda", "Prazer, Fernanda! O preenchimento labial é um dos procedimentos mais amados aqui na Lumina — resultado lindo e natural. Como você soube da gente?"),
        ("Uma amiga indicou", "Que fofo! Adoramos indicações 🥰 Você já fez preenchimento antes?"),
        ("Nunca. Tá muito caro?", "Entendo a dúvida! Na Lumina, a avaliação inicial é sempre gratuita — nossa especialista vai analisar seu caso e explicar tudo antes de qualquer decisão. Sem surpresas! Quer agendar?"),
        ("Sim, pode ser!",  "Maravilha! Você prefere de manhã ou de tarde?"),
    ]),
    (4, 9, [
        ("Oi! Quero saber sobre skinbooster", "Olá! Seja bem-vinda à Lumina! Sou a Lara 💜 Pode me dizer seu nome?"),
        ("Mariana", "Prazer, Mariana! O Skinbooster é incrível para aquela hidratação profunda e luminosidade natural na pele. Você tem interesse em fazer uma avaliação?"),
        ("Sim! Como funciona?", "A avaliação é gratuita com nossa esteticista especialista. Ela vai analisar sua pele e te explicar tudo em detalhes. É a melhor forma de conhecer o procedimento de perto! Posso agendar para você?"),
        ("Tá bom! Prefiro de manhã", "Ótimo! Vou checar os horários disponíveis 🌟"),
    ]),
    (8, 2, [
        ("Oi Lara, preciso remarcar meu horário de skinbooster", "Olá, Mariana! Claro, sem problema 😊 Deixa eu verificar seu agendamento atual e os horários disponíveis para você."),
        ("Meu horário atual é segunda às 11h", "Entendi! Vou buscar outras opções para você. Você prefere de manhã ou de tarde para o novo horário?"),
        ("Pode ser qualquer horário", "Perfeito! Solicitei a remarcação para nossa equipe confirmar. Assim que confirmarmos o novo horário, te aviso aqui! 💜"),
    ]),
]

_ESCALATIONS = [
    (3, 9,  "medica: cliente perguntou sobre laser com histórico de herpes labial"),
    (1, 11, "medica: dúvida sobre preenchimento na gravidez"),
    (6, 1,  "pedido_humano: cliente pediu falar com a especialista diretamente"),
]


def _ts(days_ago: float, hour: int = 10, minute: int = 0) -> float:
    now = datetime.now(TZ)
    target = now - timedelta(days=days_ago)
    dt = target.replace(hour=hour, minute=minute, second=0, microsecond=0)
    return dt.timestamp()


def run_seed() -> None:
    # Garante que as tabelas existem antes de inserir dados
    from sessions import _get_conn as _init_db
    _init_db().close()

    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")

    count = conn.execute(
        "SELECT COUNT(*) FROM lead_data WHERE phone LIKE '5511912345%@s.whatsapp.net'"
    ).fetchone()[0]
    if count > 0:
        conn.close()
        return

    log.info("demo_seed_start")

    now = time.time()

    for phone, nome, proc, indicacao, days_ago in _LEADS:
        jid = phone + "@s.whatsapp.net"
        hour = 9 + (int(phone[-3:]) % 9)
        ts = _ts(days_ago, hour=hour)

        conn.execute("INSERT OR REPLACE INTO lead_data (phone, field, value) VALUES (?, 'nome', ?)", (jid, nome))
        if proc:
            conn.execute("INSERT OR REPLACE INTO lead_data (phone, field, value) VALUES (?, 'procedimento_interesse', ?)", (jid, proc))
        if indicacao:
            conn.execute("INSERT OR REPLACE INTO lead_data (phone, field, value) VALUES (?, 'indicacao', ?)", (jid, indicacao))

        conn.execute(
            "INSERT INTO sessions (phone, role, content, ts) VALUES (?, 'user', ?, ?)",
            (jid, f"Oi, quero saber sobre {proc or 'procedimentos'}", ts),
        )
        conn.execute(
            "INSERT INTO sessions (phone, role, content, ts) VALUES (?, 'assistant', ?, ?)",
            (jid, "Olá! Seja bem-vinda à Lumina! Sou a Lara, sua consultora 💜", ts + 2),
        )

    for lead_idx, days_offset, hour, status, notes in _APPOINTMENTS:
        phone, nome, proc, _, _ = _LEADS[lead_idx]
        jid = phone + "@s.whatsapp.net"
        proc = proc or "Consulta"
        duration = _PROC_DURATION.get(proc, 60)

        now_dt = datetime.now(TZ)
        apt_dt = (now_dt + timedelta(days=days_offset)).replace(hour=hour, minute=0, second=0, microsecond=0)
        slot_start = apt_dt.isoformat()
        slot_end = (apt_dt + timedelta(minutes=duration)).isoformat()
        created_ts = now - max(0, -days_offset) * 86400 - 3600 * 2

        cur = conn.execute(
            """INSERT INTO appointments
               (phone, patient_name, procedure_type, slot_start, slot_end, notes, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (jid, nome, proc, slot_start, slot_end, notes, status, created_ts, now),
        )

        if status == "reschedule_requested":
            apt_id = cur.lastrowid
            new_dt = apt_dt + timedelta(days=2)
            new_end = (new_dt + timedelta(minutes=duration)).isoformat()
            conn.execute(
                "UPDATE appointments SET new_slot_start=?, new_slot_end=? WHERE id=?",
                (new_dt.isoformat(), new_end, apt_id),
            )

    for lead_idx, days_ago, turns in _CONVERSATIONS:
        phone, *_ = _LEADS[lead_idx]
        jid = phone + "@s.whatsapp.net"
        for j, (user_msg, assistant_msg) in enumerate(turns):
            ts = _ts(days_ago, hour=10 + j, minute=j * 8)
            conn.execute("INSERT INTO sessions (phone, role, content, ts) VALUES (?, 'user', ?, ?)", (jid, user_msg, ts))
            conn.execute("INSERT INTO sessions (phone, role, content, ts) VALUES (?, 'assistant', ?, ?)", (jid, assistant_msg, ts + 30))

    for lead_idx, days_ago, reason in _ESCALATIONS:
        phone, *_ = _LEADS[lead_idx]
        jid = phone + "@s.whatsapp.net"
        conn.execute("INSERT INTO escalations (phone, reason, created_at) VALUES (?, ?, ?)", (jid, reason, _ts(days_ago)))

    conn.commit()
    conn.close()
    log.info("demo_seed_done", leads=len(_LEADS), appointments=len(_APPOINTMENTS))
