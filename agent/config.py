"""
Carrega e valida o arquivo YAML do tenant apontado por TENANT_CONFIG.
Expõe get_config() como singleton — lê o arquivo apenas uma vez no boot.
"""

import os
from dataclasses import dataclass, field
from typing import Optional
from zoneinfo import ZoneInfo

import yaml
import structlog

log = structlog.get_logger()


@dataclass
class BusinessConfig:
    tenant_id: str
    vertical: str
    name: str
    segment: str
    address: str
    phone: str
    timezone: str
    hours: str
    agent_name: str
    agent_role: str
    evolution_instance: str
    human_phone: str
    calendar_id: str
    slot_duration: int
    slot_buffer: int
    procedure_durations: dict
    lead_fields: tuple
    procedures: list
    payment_methods: list
    extra_faq: list
    agent_rules_extra: str
    model: str = "claude-haiku-4-5-20251001"
    tz: ZoneInfo = field(init=False)

    def __post_init__(self):
        self.tz = ZoneInfo(self.timezone)


def _load_config() -> BusinessConfig:
    path = os.getenv("TENANT_CONFIG")
    if not path:
        raise RuntimeError(
            "TENANT_CONFIG não definida. "
            "Aponte para o YAML do tenant, ex: TENANT_CONFIG=/app/tenants/lumina.yaml"
        )

    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f)

    biz   = data.get("business") or {}
    agent = data.get("agent") or {}
    integ = data.get("integrations") or {}
    gcal  = integ.get("google_calendar") or {}
    vc    = data.get("vertical_config") or {}
    know  = data.get("knowledge") or {}

    required = [
        ("tenant_id",                        data.get("tenant_id")),
        ("vertical",                          data.get("vertical")),
        ("business.name",                     biz.get("name")),
        ("business.timezone",                 biz.get("timezone")),
        ("business.hours",                    biz.get("hours")),
        ("agent.name",                        agent.get("name")),
        ("integrations.evolution.instance",   (integ.get("evolution") or {}).get("instance")),
        ("integrations.human_phone",          integ.get("human_phone")),
    ]
    missing = [k for k, v in required if v is None]
    if missing:
        raise RuntimeError(
            f"Campos obrigatórios ausentes em {path}: {', '.join(missing)}"
        )

    # Precedência: env var CLAUDE_MODEL > campo "model" no YAML > default
    _default_model = "claude-haiku-4-5-20251001"
    model = (
        os.getenv("CLAUDE_MODEL")
        or str(data.get("model") or "")
        or _default_model
    )

    cfg = BusinessConfig(
        tenant_id=data["tenant_id"],
        vertical=data["vertical"],
        name=biz["name"],
        segment=biz.get("segment", ""),
        address=str(biz.get("address", "") or ""),
        phone=str(biz.get("phone", "") or ""),
        timezone=biz["timezone"],
        hours=biz["hours"],
        agent_name=agent["name"],
        agent_role=agent.get("role", "consultora de agendamentos"),
        evolution_instance=integ["evolution"]["instance"],
        human_phone=str(integ.get("human_phone", "")),
        # Precedência: calendar_id no YAML > env GOOGLE_CALENDAR_ID. Mantém o
        # .env como fonte (a recomendação do próprio comentário no YAML).
        calendar_id=str(gcal.get("calendar_id") or os.getenv("GOOGLE_CALENDAR_ID", "") or ""),
        slot_duration=int(gcal.get("slot_duration_minutes", 60)),
        slot_buffer=int(gcal.get("slot_buffer_minutes", 0)),
        procedure_durations=dict(gcal.get("procedure_durations") or {}),
        lead_fields=tuple(vc.get("lead_fields", ["nome", "procedimento_interesse", "indicacao"])),
        procedures=list(vc.get("procedures", [])),
        payment_methods=list(vc.get("payment_methods", [])),
        extra_faq=list(know.get("extra_faq", [])),
        agent_rules_extra=str(data.get("agent_rules_extra", "") or ""),
        model=model,
    )

    log.info("tenant_loaded", tenant_id=cfg.tenant_id, vertical=cfg.vertical)
    return cfg


_config: Optional[BusinessConfig] = None


def get_config() -> BusinessConfig:
    global _config
    if _config is None:
        _config = _load_config()
    return _config
