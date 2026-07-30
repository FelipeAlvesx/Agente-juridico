#!/usr/bin/env python3
"""
Golden test runner — executa cenários YAML e valida respostas do agente.
Uso: python3 tests/runner.py tests/golden/
"""

import os
import sys
import json
import yaml
import requests
import argparse
from pathlib import Path

AGENT_URL = os.getenv("AGENT_URL", "http://localhost:3000")


def run_scenario(path: Path) -> tuple[bool, str]:
    with open(path) as f:
        scenario = yaml.safe_load(f)

    name = scenario.get("name", path.stem)
    messages = scenario.get("messages", [])

    print(f"\n  [{path.name}] {name}")

    # Usa um telefone fictício único por cenário para não poluir sessões
    phone = f"5511999{abs(hash(path.stem)) % 100000:05d}"
    history = []
    passed = True

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

            for tool in expect_tools:
                if tool not in tool_calls:
                    print(f"    FAIL expected tool '{tool}' not called (got: {tool_calls})")
                    passed = False

            for fragment in expect_text:
                if fragment.lower() not in reply.lower():
                    print(f"    FAIL reply missing '{fragment}'")
                    print(f"         reply was: {reply[:120]}")
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
