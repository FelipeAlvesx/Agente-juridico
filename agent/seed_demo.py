"""
Popula o banco com dados realistas para demo B2B (escritório de advocacia).
Chamado no boot quando DEMO_SEED=true. Idempotente.

Nenhuma mensagem daqui pode violar as regras da OAB: sem opinião jurídica,
sem estimativa de êxito/valor/prazo, sem honorários, sem linguagem de captação.
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

# (phone, nome, area_juridica, resumo_caso, urgencia, origem, days_ago)
# Campos None = lead que não terminou a triagem. Ele fica no CRM do mesmo jeito.
_LEADS = [
    ("5511912345001", "Camila Rodrigues",  "Direito Trabalhista",            "Demitida sem justa causa, verbas não pagas",          "alta",  "Google",           13),
    ("5511912345002", "Fernando Lima",     "Direito de Família e Sucessões", "Divórcio consensual, casal sem filhos",               "media", "Indicação",        12),
    ("5511912345003", "Beatriz Santos",    "Direito do Consumidor",          "Cobrança indevida de plano de saúde há 6 meses",       "media", "Instagram",        11),
    ("5511912345004", "Juliana Oliveira",  "Direito Previdenciário",         "Auxílio-doença negado pelo INSS",                     "alta",  "Google",           10),
    ("5511912345005", "Marcos Costa",      "Direito Trabalhista",            "Horas extras não pagas, ainda trabalha na empresa",    "baixa", "Indicação",         9),
    ("5511912345006", "Ana Paula Souza",   "Direito Civil e Contratos",      "Contrato de prestação de serviços descumprido",        "media", "Site",              8),
    ("5511912345007", "Patrícia Mendes",   "Direito Imobiliário",            "Atraso na entrega de imóvel na planta",               "media", "Indicação",         7),
    ("5511912345008", "Renata Ferreira",   "Direito de Família e Sucessões", "Inventário do pai, três herdeiros",                   "baixa", "Google",            6),
    ("5511912345009", "Lucas Alves",       "Direito Empresarial",            "Sócio saiu da empresa sem distrato",                  "media", "LinkedIn",          6),
    ("5511912345010", "Gabriela Moura",    "Direito Trabalhista",            "Assédio moral da chefia, quer orientação",            "alta",  "Instagram",         5),
    ("5511912345011", "Tatiana Cardoso",   "Direito do Consumidor",          "Compra online não entregue, loja não responde",       "baixa", "Google",            4),
    ("5511912345012", "Vanessa Rocha",     "Direito Previdenciário",         "Quer revisar aposentadoria concedida em 2019",        "baixa", "Indicação",         4),
    ("5511912345013", "Letícia Martins",   "Direito de Família e Sucessões", "Pensão alimentícia atrasada há 4 meses",              "alta",  "Google",            3),
    ("5511912345014", "Daniel Nunes",      "Direito Criminal",               "Familiar preso em flagrante ontem à noite",           "alta",  "Indicação",         3),
    ("5511912345015", "Aline Barbosa",     "Direito Civil e Contratos",      "Acidente de trânsito, seguradora nega cobertura",     "media", "Site",              2),
    ("5511912345016", "Carolina Farias",   "Direito Trabalhista",            "Pediu demissão e não recebeu as verbas",              None,    "Google",            2),
    ("5511912345017", "Simone Andrade",    "Direito Imobiliário",            None,                                                  None,    None,                1),
    ("5511912345018", "Rodrigo Cruz",      "Direito do Consumidor",          None,                                                  None,    None,                1),
    ("5511912345019", "Isabela Borges",    None,                             None,                                                  None,    None,                1),
    # Sem nenhum campo salvo: mandou uma mensagem e parou de responder.
    ("5511912345020", None,                None,                             None,                                                  None,    None,                0),
]

# Status explícito do funil (o resto é derivado da conversa em sessions.py).
# (lead_idx, status, motivo_perda)
_LEAD_STATUS = [
    (1,  "cliente", ""),
    (3,  "cliente", ""),
    (4,  "perdido", "buscou_outro_escritorio"),
    (11, "perdido", "so_queria_informacao"),
    (16, "perdido", "sem_resposta"),
    (19, "perdido", "sem_resposta"),
]

# Encerramento gravado pelo próprio agente em lead_data (área não atendida).
# (lead_idx, motivo em texto livre)
_FORA_DE_ESCOPO = [
    (8, "Direito Empresarial societário complexo — escritório não atua nesse porte"),
]

_APPOINTMENTS = [
    # (lead_idx, days_offset, hour, tipo, status, notes)
    (0,   3, 14, "Consulta inicial", "confirmed",            "Levar carteira de trabalho e rescisão"),
    (1,   5, 10, "Consulta inicial", "confirmed",            "Divórcio consensual"),
    (2,  -2, 11, "Consulta online",  "confirmed",            ""),
    (3,  -6, 15, "Consulta inicial", "confirmed",            "Levar indeferimento do INSS"),
    (5,   6, 16, "Consulta online",  "pending",              "Só pode fora do horário comercial"),
    (6,   4, 10, "Consulta inicial", "pending",              "Levar contrato e comprovantes de pagamento"),
    (9,  -1, 14, "Consulta inicial", "cancelled",            ""),
    (12, -4,  9, "Consulta inicial", "rejected",             "Advogado sem agenda no horário pedido"),
    (7,   2, 11, "Consulta inicial", "reschedule_requested", "Pediu outro horário pelo WhatsApp"),
    (14,  7, 15, "Consulta online",  "cancel_requested",     "Cliente solicitou cancelamento"),
]

_CONVERSATIONS = [
    (0, 13, [
        ("Oi, boa tarde. Fui demitida e acho que não pagaram tudo certo",
         "Boa tarde! Sou a Helena, do atendimento do escritório. Sinto muito pelo que aconteceu — vou te ajudar a falar com um advogado.\n\n---\nPara começar, como é o seu nome?"),
        ("Camila Rodrigues",
         "Obrigada, Camila. Você foi demitida sem justa causa ou pediu demissão?"),
        ("Sem justa causa, mês passado",
         "Entendi. E o escritório já pagou alguma verba, ou nada até agora?"),
        ("Não recebi nada ainda",
         "Anotado. Essa análise é do advogado — ele vai olhar sua rescisão e sua carteira e explicar os próximos passos na consulta.\n\n---\nVocê prefere manhã ou tarde para conversar com ele?"),
        ("De tarde é melhor",
         "Perfeito. Vou ver os horários de tarde disponíveis e já te mostro."),
    ]),
    (3, 10, [
        ("bom dia, meu auxílio doença foi negado",
         "Bom dia! Sou a Helena, do atendimento do escritório. Vamos organizar isso para o advogado te orientar. Como é o seu nome?"),
        ("Juliana Oliveira",
         "Obrigada, Juliana. Você recebeu o documento do INSS com o motivo do indeferimento?"),
        ("Recebi sim, tá escrito que não constatou incapacidade",
         "Certo. Guarde esse documento, ele é importante para a consulta. Isso é recente ou já faz um tempo?"),
        ("Foi semana passada",
         "Entendi, obrigada. O advogado é quem avalia o caso e explica o que pode ser feito.\n\n---\nConsigo agendar sua consulta ainda esta semana. Manhã ou tarde?"),
    ]),
    (13, 3, [
        ("SOCORRO meu irmão foi preso ontem de noite",
         "Entendo a urgência. Sou a Helena, do atendimento do escritório. Já estou acionando o advogado responsável agora.\n\n---\nMe diga seu nome e em qual delegacia ele está."),
        ("Daniel Nunes, ele tá no 14º DP",
         "Obrigada, Daniel. Passei seus dados para o advogado — ele vai te ligar em instantes neste número."),
    ]),
    (4, 9, [
        ("Oi, trabalho numa empresa que não paga hora extra. Posso processar mesmo estando lá dentro?",
         "Olá! Sou a Helena, do atendimento do escritório. Essa é exatamente uma pergunta para o advogado — eu não posso te orientar sobre isso, mas ele explica tudo na consulta. Como é o seu nome?"),
        ("Marcos Costa",
         "Obrigada, Marcos. Você ainda está trabalhando na empresa hoje?"),
        ("Sim, ainda estou",
         "Anotado. Quer que eu agende uma consulta para você conversar com o advogado?"),
        ("Vou pensar e te aviso",
         "Sem problema, Marcos. Fico à disposição — quando quiser, é só me chamar por aqui."),
    ]),
    (8, 6, [
        ("Boa tarde, meu sócio saiu da empresa e ficou tudo em aberto",
         "Boa tarde! Sou a Helena, do atendimento do escritório. Como é o seu nome?"),
        ("Lucas Alves",
         "Obrigada, Lucas. Me conta em uma frase o que aconteceu, para eu direcionar ao advogado certo."),
        ("Ele saiu sem distrato e a empresa tem uns 200 funcionários",
         "Obrigada por explicar. Sendo bem sincera com você: um caso societário desse porte está fora do que o escritório atende hoje, e prefiro não te fazer perder tempo.\n\n---\nDeixo seu contato registrado aqui e, se puder indicar um colega da área, te aviso por aqui."),
    ]),
    (7, 2, [
        ("Helena, preciso remarcar minha consulta de quinta",
         "Claro, sem problema. Deixa eu ver os horários disponíveis do advogado."),
        ("Qualquer dia da semana que vem serve",
         "Perfeito. Já pedi a remarcação para a equipe confirmar — assim que o novo horário estiver fechado, te aviso por aqui."),
    ]),
]

# (lead_idx, days_ago, category, reason)
# category tem que ser uma de ESCALATION_CATEGORIES em verticals/advocacia/tools.py —
# é ela que ordena a fila da Triagem no CRM (prazo primeiro).
_ESCALATIONS = [
    (13, 3, "urgencia_prazo",
     "Familiar preso em flagrante ontem à noite, perguntou sobre audiência de custódia"),
    (12, 2, "urgencia_prazo",
     "Recebeu intimação com prazo correndo e quer saber o que fazer"),
    (4,  9, "consulta_juridica",
     "Pediu opinião sobre processar o empregador enquanto ainda está na empresa"),
    (7,  6, "processo_em_andamento",
     "Já tem ação em curso com outro advogado e quer falar sobre o andamento"),
    (9,  5, "consulta_juridica",
     "Relato de assédio moral com afastamento, pediu orientação sobre o que configura o caso"),
    (2,  4, "reclamacao",
     "Achou que demorou para ter retorno do escritório depois do primeiro contato"),
    (19, 0, "pedido_humano",
     "Pediu para falar com uma pessoa e não respondeu mais"),
    (17, 1, "confusao_repetida",
     "Não conseguiu descrever o caso depois de três tentativas do agente"),
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
        "SELECT COUNT(*) FROM sessions WHERE phone LIKE '5511912345%@s.whatsapp.net'"
    ).fetchone()[0]
    if count > 0:
        conn.close()
        return

    log.info("demo_seed_start")

    now = time.time()

    for phone, nome, area, resumo, urgencia, origem, days_ago in _LEADS:
        jid = phone + "@s.whatsapp.net"
        hour = 9 + (int(phone[-3:]) % 9)
        ts = _ts(days_ago, hour=hour)

        for field, value in (
            ("nome", nome), ("area_juridica", area), ("resumo_caso", resumo),
            ("urgencia", urgencia), ("origem", origem),
        ):
            if value:
                conn.execute(
                    "INSERT OR REPLACE INTO lead_data (phone, field, value) VALUES (?, ?, ?)",
                    (jid, field, value),
                )

        primeira = f"Oi, preciso de ajuda com {area.lower()}" if area else "Oi, boa tarde"
        conn.execute(
            "INSERT INTO sessions (phone, role, content, ts) VALUES (?, 'user', ?, ?)",
            (jid, primeira, ts),
        )
        conn.execute(
            "INSERT INTO sessions (phone, role, content, ts) VALUES (?, 'assistant', ?, ?)",
            (jid, "Olá! Sou a Helena, do atendimento do escritório. Como posso te ajudar?", ts + 2),
        )

    for lead_idx, motivo in _FORA_DE_ESCOPO:
        jid = _LEADS[lead_idx][0] + "@s.whatsapp.net"
        conn.execute("INSERT OR REPLACE INTO lead_data (phone, field, value) VALUES (?, 'status', 'fora_de_escopo')", (jid,))
        conn.execute("INSERT OR REPLACE INTO lead_data (phone, field, value) VALUES (?, 'motivo_perda', ?)", (jid, motivo))

    for lead_idx, status, motivo in _LEAD_STATUS:
        jid = _LEADS[lead_idx][0] + "@s.whatsapp.net"
        conn.execute(
            """INSERT OR REPLACE INTO lead_status (phone, status, motivo_perda, updated_at)
               VALUES (?, ?, ?, ?)""",
            (jid, status, motivo, now),
        )

    for lead_idx, days_offset, hour, tipo, status, notes in _APPOINTMENTS:
        phone, nome = _LEADS[lead_idx][0], _LEADS[lead_idx][1]
        jid = phone + "@s.whatsapp.net"
        duration = 45 if tipo == "Consulta online" else 60

        now_dt = datetime.now(TZ)
        apt_dt = (now_dt + timedelta(days=days_offset)).replace(hour=hour, minute=0, second=0, microsecond=0)
        slot_start = apt_dt.isoformat()
        slot_end = (apt_dt + timedelta(minutes=duration)).isoformat()
        created_ts = now - max(0, -days_offset) * 86400 - 3600 * 2

        cur = conn.execute(
            """INSERT INTO appointments
               (phone, patient_name, procedure_type, slot_start, slot_end, notes, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (jid, nome or "", tipo, slot_start, slot_end, notes, status, created_ts, now),
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
        jid = _LEADS[lead_idx][0] + "@s.whatsapp.net"
        for j, (user_msg, assistant_msg) in enumerate(turns):
            ts = _ts(days_ago, hour=10 + j, minute=j * 8)
            conn.execute("INSERT INTO sessions (phone, role, content, ts) VALUES (?, 'user', ?, ?)", (jid, user_msg, ts))
            conn.execute("INSERT INTO sessions (phone, role, content, ts) VALUES (?, 'assistant', ?, ?)", (jid, assistant_msg, ts + 30))

    for lead_idx, days_ago, category, reason in _ESCALATIONS:
        jid = _LEADS[lead_idx][0] + "@s.whatsapp.net"
        conn.execute(
            "INSERT INTO escalations (phone, category, reason, created_at) VALUES (?, ?, ?, ?)",
            (jid, category, reason, _ts(days_ago)),
        )

    conn.commit()
    conn.close()
    log.info("demo_seed_done", leads=len(_LEADS), appointments=len(_APPOINTMENTS))
