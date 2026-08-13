#!/usr/bin/env python3
"""
Golden test runner — executa cenários YAML e valida respostas do agente.
Uso: python3 tests/runner.py tests/golden/
"""

import os
import re
import sys
import json
import yaml
import hashlib
import requests
import argparse
from pathlib import Path

# Emoji de verdade numa mensagem de WhatsApp: pictogramas, emoticons, bandeiras e
# símbolos diversos. O bloco Dingbats (U+2700-27BF) fica DE FORA de propósito — ✓ e ✗
# vivem lá e são os marcadores usados nos próprios prompts; os poucos dingbats que
# aparecem como emoji entram na lista explícita.
EMOJI_RE = re.compile(
    "[\U0001F300-\U0001FAFF"      # pictogramas, emoticons, símbolos suplementares
    "\U0001F1E6-\U0001F1FF"       # bandeiras (regional indicators)
    "\U00002600-\U000026FF"       # símbolos diversos (☀ ☂ ⚠ ⚖)
    "✅✨❌❎❤⭐]"                   # dingbats/símbolos isolados de uso corrente
)

AGENT_URL = os.getenv("AGENT_URL", "http://localhost:3100")


def scenario_phone(stem: str) -> str:
    """
    Telefone fictício estável por cenário. hash() de str é randomizado por
    processo (PYTHONHASHSEED), então usar hash() dava um número novo a cada
    rodada — lead órfão no CRM e falha impossível de reproduzir.
    """
    digits = int(hashlib.md5(stem.encode()).hexdigest(), 16) % 100000
    return f"5511999{digits:05d}"


def reset_scenario_state(phone: str) -> None:
    """
    Zera lead + conversa + consultas do telefone antes do cenário: sem isso a 2ª
    rodada roda em cima do estado da 1ª (lead já qualificado → o agente não chama
    save_lead_field de novo e a asserção quebra).
    """
    try:
        r = requests.post(f"{AGENT_URL}/api/test/reset", json={"phone": phone}, timeout=10)
        if r.status_code == 404:
            print(f"    WARN /api/test/reset ausente — cenário roda sobre o estado anterior ({phone})")
        elif r.status_code != 200:
            print(f"    WARN reset falhou: HTTP {r.status_code}")
    except requests.RequestException as e:
        print(f"    WARN reset falhou: {e}")


def run_scenario(path: Path) -> tuple[bool, str]:
    with open(path) as f:
        scenario = yaml.safe_load(f)

    name = scenario.get("name", path.stem)
    messages = scenario.get("messages", [])

    print(f"\n  [{path.name}] {name}")

    # Telefone fictício estável por cenário, com estado zerado antes de começar.
    phone = scenario_phone(path.stem)
    reset_scenario_state(phone)
    history = []
    passed = True
    # Cenário que começa por um step 'agent' não deve estourar NameError.
    reply = ""
    tool_calls = []

    for step in messages:
        role = step["role"]

        if role == "user":
            history.append({"role": "user", "content": step["text"]})

            r = requests.post(f"{AGENT_URL}/api/test/message", json={
                "phone": phone,
                "text": step["text"],
                "history": history,
            }, timeout=30)

            if r.status_code != 200:
                print(f"    FAIL HTTP {r.status_code}")
                passed = False
                break

            data = r.json()
            reply = data.get("reply", "")
            tool_calls = data.get("tool_calls", [])
            history.append({"role": "assistant", "content": reply})

        elif role == "agent":
            expect_tools = step.get("expect_tool_calls", [])
            expect_text = step.get("expect_text_contains", [])
            if isinstance(expect_text, str):
                expect_text = [expect_text]

            # Prova de recusa (OAB): a reply NÃO pode conter estes fragmentos.
            forbidden = step.get("expect_text_absent", [])
            if isinstance(forbidden, str):
                forbidden = [forbidden]

            for tool in expect_tools:
                if tool not in tool_calls:
                    print(f"    FAIL expected tool '{tool}' not called (got: {tool_calls})")
                    passed = False

            for fragment in expect_text:
                if fragment.lower() not in reply.lower():
                    print(f"    FAIL reply missing '{fragment}'")
                    print(f"         reply was: {reply[:120]}")
                    passed = False

            for fragment in forbidden:
                if fragment.lower() in reply.lower():
                    print(f"    FAIL reply contains forbidden '{fragment}'")
                    print(f"         reply was: {reply[:200]}")
                    passed = False

            # Substring literal não pega paráfrase: "que ótimo que você entrou em contato"
            # está na lista, mas o agente escreveu "que bom que nos procurou" e passou.
            for pattern in step.get("expect_text_absent_regex", []):
                if re.search(pattern, reply, re.IGNORECASE):
                    print(f"    FAIL reply matches forbidden /{pattern}/")
                    print(f"         reply was: {reply[:200]}")
                    passed = False

            if step.get("expect_no_emoji"):
                found = EMOJI_RE.findall(reply)
                if found:
                    print(f"    FAIL reply contains emoji {found}")
                    print(f"         reply was: {reply[:200]}")
                    passed = False

    status = "PASS" if passed else "FAIL"
    print(f"    {status}")
    return passed, name


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("dir", help="Diretório com arquivos .yaml de golden tests")
    args = parser.parse_args()

    golden_dir = Path(args.dir)
    files = sorted(golden_dir.glob("*.yaml"))

    if not files:
        print(f"Nenhum arquivo .yaml encontrado em {golden_dir}")
        sys.exit(1)

    print(f"\nGolden tests — {len(files)} cenário(s)\n")

    results = []
    for f in files:
        passed, name = run_scenario(f)
        results.append((passed, name))

    print("\n" + "─" * 50)
    total = len(results)
    ok = sum(1 for p, _ in results if p)
    print(f"Resultado: {ok}/{total} passaram")

    if ok < total:
        sys.exit(1)


if __name__ == "__main__":
    main()
