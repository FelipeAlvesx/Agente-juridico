"""
Self-check da triagem jurídica e do horário vindo do tenant.
Roda sem rede, sem Claude e sem banco: python3 tests/test_triagem_horario.py
"""

import os
import sys
import tempfile
from pathlib import Path

import yaml

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "agent"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault(
    "TENANT_CONFIG",
    os.path.join(os.path.dirname(__file__), "..", "tenants", "juris.yaml"),
)

from config import get_config, _parse_workdays          # noqa: E402
from gcal import _period_hours                          # noqa: E402
from verticals.advocacia.tools import (                  # noqa: E402
    _is_served_area, get_tool_definitions, ESCALATION_MESSAGES, ESCALATION_CATEGORIES,
)


def test_workdays():
    assert _parse_workdays(["seg", "ter", "qua", "qui", "sex"]) == (0, 1, 2, 3, 4)
    assert _parse_workdays(["Sáb", "SEG"]) == (0, 5)
    assert _parse_workdays(None) == (0, 1, 2, 3, 4, 5), "sem a chave = comportamento da engine"


def test_hours_from_tenant():
    cfg = get_config()
    assert (cfg.hours_start, cfg.hours_end) == (9, 18), "juris.yaml: 9h-18h"
    assert cfg.workdays == (0, 1, 2, 3, 4), "juris.yaml: seg-sex, sem sábado"
    # Períodos ficam dentro do horário do tenant — nada de 19h herdado da estética.
    assert _period_hours(None, cfg)     == (9, 18)
    assert _period_hours("manha", cfg)  == (9, 12)
    assert _period_hours("tarde", cfg)  == (13, 18)


def test_area_triagem():
    areas = get_config().procedures
    assert _is_served_area("Direito Trabalhista", areas)
    assert _is_served_area("trabalhista", areas)
    assert not _is_served_area("Direito Ambiental", areas), "área não atendida → fora de escopo"
    assert not _is_served_area("Direito Tributário", areas)
    assert _is_served_area("", areas), "vago demais: mantém o lead no funil"


def test_tool_contract():
    tools = {t["name"]: t for t in get_tool_definitions(get_config())}
    assert "marcar_fora_de_escopo" in tools
    cats = tools["escalate_to_human"]["input_schema"]["properties"]["category"]["enum"]
    assert cats == list(ESCALATION_CATEGORIES)
    # Toda categoria tem mensagem de transferência; urgência traz os números de emergência.
    assert set(cats) == set(ESCALATION_MESSAGES), "categoria sem mensagem cai no texto genérico"
    assert "190" in ESCALATION_MESSAGES["urgencia_prazo"]
    assert "---" in ESCALATION_MESSAGES["urgencia_prazo"], "emergência em balão separado"
    # lead_fields do tenant viram o enum de save_lead_field.
    assert tools["save_lead_field"]["input_schema"]["properties"]["field"]["enum"] == [
        "nome", "area_juridica", "resumo_caso", "urgencia", "origem"
    ]


def test_fora_de_escopo_fica_no_funil():
    """
    Contrato com o CRM: o lead fora de escopo sai do funil de agendamento mas
    NÃO desaparece — o Âmbar traduz status/motivo_perda de lead_data em
    'perdido' (sessions.py:_AGENT_STATUS). Se um dos lados renomear a chave,
    o lead vira invisível para follow-up e ninguém percebe.
    """
    import sqlite3
    from verticals.advocacia.tools import execute_tool

    with tempfile.TemporaryDirectory() as tmp:
        import sessions
        sessions.DB_PATH = os.path.join(tmp, "t.db")
        sqlite3.connect(sessions.DB_PATH).close()

        phone = "5511999000001@s.whatsapp.net"
        ctx = {"phone": phone, "phone_hash": "test", "was_qualified": False,
               "config": get_config()}

        # Área atendida: a tool recusa e o lead continua no funil.
        r = execute_tool("marcar_fora_de_escopo",
                         {"area_informada": "Direito Trabalhista", "motivo": "x"}, ctx)
        assert "error" in r, "área atendida não pode sair do funil"

        r = execute_tool("marcar_fora_de_escopo",
                         {"area_informada": "Direito Ambiental",
                          "motivo": "caso de Direito Ambiental, área não atendida"}, ctx)
        assert r.get("ok"), r

        data = sessions.get_lead_data(phone)
        assert data["status"] == "fora_de_escopo"
        assert data["motivo_perda"]
        assert data["area_juridica"] == "Direito Ambiental"

        lead = sessions.get_lead_status(phone)
        assert lead["status"] == "perdido", f"CRM não traduziu o status: {lead}"
        assert lead["motivo_perda"] == "fora_area_atuacao", lead
        # O texto livre da tool tem que sobreviver como detalhe, senão o
        # follow-up perde o porquê e sobra só o código canônico.
        assert "Ambiental" in lead["motivo_perda_detalhe"], lead

        leads = {l["phone"]: l for l in sessions.get_all_leads()}
        assert phone in leads, "lead sumiu do CRM"
        assert leads[phone]["status"] == "perdido"
        # Filtro do funil tem que achar o lead perdido (é onde o follow-up vive).
        assert phone in [l["phone"] for l in sessions.get_all_leads(status="perdido")]
        assert sessions.get_funnel_counts().get("perdido", 0) >= 1


def test_scenario_phone():
    """Telefone estável entre processos e sem colisão entre cenários."""
    from runner import scenario_phone

    # Literal fixo: md5 não muda entre versões de Python, hash() muda a cada processo.
    assert scenario_phone("01_qualificacao") == "551199903890"
    assert scenario_phone("a") != scenario_phone("b")

    golden = sorted(Path(__file__).parent.joinpath("golden").glob("*.yaml"))
    phones = {scenario_phone(p.stem) for p in golden}
    assert len(phones) == len(golden), "colisão de telefone: 2 cenários compartilhariam o mesmo lead"


def _run_golden(tmpdir, scenario: dict, reply: str) -> bool:
    """Roda um cenário golden contra uma reply fixa, sem subir o agente."""
    import runner

    class _Resp:
        status_code = 200

        def json(self):
            return {"reply": reply, "tool_calls": []}

    original = runner.requests.post
    runner.requests.post = lambda *a, **k: _Resp()
    try:
        path = os.path.join(tmpdir, "cenario.yaml")
        with open(path, "w") as f:
            yaml.safe_dump(scenario, f, allow_unicode=True)
        passed, _ = runner.run_scenario(Path(path))
        return passed
    finally:
        runner.requests.post = original


def test_expect_text_absent():
    """A chave de recusa OAB tem que reprovar a reply proibida — e só ela."""
    scenario = {
        "name": "recusa de prognóstico",
        "messages": [
            {"role": "user", "text": "tenho chance de ganhar? quanto recebo?"},
            {"role": "agent", "expect_text_absent": ["R$", "%", "chance", "boas chances"]},
        ],
    }
    with tempfile.TemporaryDirectory() as tmp:
        assert not _run_golden(tmp, scenario, "Você tem boas chances, dá uns R$ 20 mil.")
        assert not _run_golden(tmp, scenario, "Uns 80% de êxito."), "'%' tem que reprovar"
        assert _run_golden(tmp, scenario, "Essa análise é do advogado. Posso agendar?")
        # Fragmento único como string, não lista.
        scenario2 = dict(scenario, messages=[
            scenario["messages"][0],
            {"role": "agent", "expect_text_absent": "R$"},
        ])
        assert not _run_golden(tmp, scenario2, "custa R$ 500")
        assert _run_golden(tmp, scenario2, "o advogado explica na consulta")


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"ok  {name}")
    print("todos ok")
