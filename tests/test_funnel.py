"""
Check do funil de leads. Não precisa de Flask, Claude nem do agente rodando —
só de Python 3.11 (o local pode ser 3.9, daí o container):

    docker run --rm -v "$PWD":/w -w /w python:3.11-slim \
      sh -c "pip install -q pyyaml structlog; python tests/test_funnel.py"
"""

import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "agent"))
os.environ.setdefault("DB_PATH", os.path.join(tempfile.mkdtemp(), "funnel.db"))
os.environ.setdefault("TENANT_CONFIG", os.path.join(os.path.dirname(__file__), "..", "tenants", "juris.yaml"))

import sessions as s  # noqa: E402

FIELDS = ("nome", "area_juridica", "resumo_caso", "urgencia", "origem")


def status_of(phone):
    return next(l for l in s.get_all_leads(limit=1000) if l["phone"] == phone)


def main():
    # 1. Quem só mandou "oi" e sumiu continua existindo, como novo.
    s.save_turn("5511900000001@s.whatsapp.net", "oi", "Olá! Sou a Helena.")
    lead = status_of("5511900000001@s.whatsapp.net")
    assert lead["status"] == "novo", lead
    assert lead["last_contact"], lead

    # 2. Lead com todos os campos vira qualificado sozinho.
    p2 = "5511900000002@s.whatsapp.net"
    s.save_turn(p2, "fui demitido", "Sinto muito.")
    for f in FIELDS:
        s.save_lead_field(p2, f, "x")
    assert status_of(p2)["status"] == "qualificado", status_of(p2)

    # 3. Agendou → consulta_agendada, sem ninguém marcar nada.
    s.create_appointment(p2, "Fulano", "Consulta inicial", "2026-08-01T10:00:00", "2026-08-01T11:00:00")
    assert status_of(p2)["status"] == "consulta_agendada"

    # 4. Status explícito ganha do derivado, e motivo só vale em perdido.
    s.set_lead_status(p2, "cliente")
    assert status_of(p2)["status"] == "cliente"
    s.set_lead_status(p2, "perdido", "sem_resposta")
    assert status_of(p2)["motivo_perda"] == "sem_resposta"
    s.set_lead_status(p2, "qualificado", "sem_resposta")
    assert status_of(p2)["motivo_perda"] == ""

    # 5. Perdido que volta e agenda sai de perdido.
    s.set_lead_status(p2, "perdido", "sem_interesse")
    s.create_appointment(p2, "Fulano", "Consulta inicial", "2026-09-01T10:00:00", "2026-09-01T11:00:00")
    assert status_of(p2)["status"] == "consulta_agendada", status_of(p2)

    # 6. Agente encerra por fora de escopo gravando em lead_data → cai em perdido.
    p3 = "5511900000003@s.whatsapp.net"
    s.save_turn(p3, "é caso de direito marítimo", "Não atuamos nessa área.")
    s.save_lead_field(p3, "status", "fora_de_escopo")
    s.save_lead_field(p3, "motivo_perda", "direito marítimo não é área do escritório")
    lead3 = status_of(p3)
    assert lead3["status"] == "perdido", lead3
    assert lead3["motivo_perda"] == "fora_area_atuacao", lead3
    assert "marítimo" in lead3["motivo_perda_detalhe"], lead3

    # ...e a decisão humana no CRM ganha do que o agente gravou.
    s.set_lead_status(p3, "qualificado")
    assert status_of(p3)["status"] == "qualificado"
    s.clear_lead_status(p3)
    assert status_of(p3)["status"] == "perdido"

    # 7. Nenhum lead se perde na contagem.
    assert s.get_stats()["leads_total"] == 3
    assert sum(s.get_funnel_counts().values()) == 3
    assert [l["phone"] for l in s.get_all_leads(status="novo")] == ["5511900000001@s.whatsapp.net"]

    print("ok — funil consistente")


if __name__ == "__main__":
    main()
