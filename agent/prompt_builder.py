"""
Monta o system prompt a partir de fragmentos reutilizáveis + dados do config do tenant.
"""

import os
import pathlib

from config import BusinessConfig

_APP_ROOT = pathlib.Path(os.getenv("LUMINA_ROOT", "/app"))


def load_fragment(relative_path: str) -> str:
    return (_APP_ROOT / relative_path).read_text(encoding="utf-8")


def _substitute(text: str, config: BusinessConfig) -> str:
    procedures_list = "\n".join(f"- {p}" for p in config.procedures) if config.procedures else "Consulte a recepção"
    payment_methods = ", ".join(config.payment_methods) if config.payment_methods else "Consulte a recepção"
    return (
        text
        .replace("{agent_name}", config.agent_name)
        .replace("{business_name}", config.name)
        .replace("{procedures_list}", procedures_list)
        .replace("{payment_methods}", payment_methods)
    )


def build_system_prompt(config: BusinessConfig) -> str:
    identity = (
        f"Você é {config.agent_name}, {config.agent_role} da {config.name} — {config.segment}.\n\n"
        f"Atende pelo WhatsApp da clínica como uma consultora atenderia: com calma, atenção e jeito humano. "
        f"Você fala como uma pessoa real.\n\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"INFO DA CLÍNICA\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"Endereço: {config.address}\n"
        f"Horário: {config.hours}"
    )

    persona   = _substitute(load_fragment("prompts/base/human_persona.md"), config)
    engine    = load_fragment("prompts/base/engine_rules.md")
    vertical  = _substitute(load_fragment(f"verticals/{config.vertical}/prompt_fragment.md"), config)

    parts = [identity, persona, vertical, engine]
    if config.agent_rules_extra:
        parts.append(config.agent_rules_extra)

    if config.extra_faq:
        faq_lines = []
        for item in config.extra_faq:
            faq_lines.append(f"P: {item['q']}\nR: {item['a']}")
        parts.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nFAQ EXTRA\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" + "\n\n".join(faq_lines))

    return "\n\n".join(parts).strip()
