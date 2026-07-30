#!/usr/bin/env python3
"""Verifica se todas as dependências estão instaladas."""

import subprocess
import sys
import shutil


def check(name: str, cmd: list[str], version_flag: str = "--version") -> bool:
    if not shutil.which(cmd[0]):
        print(f"  ✗ {name}: não encontrado")
        return False
    try:
        result = subprocess.run(
            cmd + [version_flag],
            capture_output=True, text=True, timeout=5
        )
        version = (result.stdout or result.stderr).split("\n")[0]
        print(f"  ✓ {name}: {version.strip()}")
        return True
    except Exception:
        print(f"  ✓ {name}: instalado")
        return True


def check_env_file() -> bool:
    import os
    if not os.path.exists(".env"):
        print("  ⚠ .env: não encontrado — será criado pelo make setup")
        return True
    print("  ✓ .env: encontrado")
    return True


def check_credentials() -> bool:
    import os
    cred_path = "./credentials/google_credentials.json"
    if not os.path.exists(cred_path):
        print(f"  ⚠ Credenciais Google: não encontradas em {cred_path}")
        print("    → Coloque o arquivo antes de usar funcionalidades de calendário.")
        return True
    print("  ✓ Credenciais Google: encontradas")
    return True


def main():
    print("\nVerificando dependências...\n")

    results = {
        "Docker":         check("Docker",         ["docker"],         "--version"),
        "Docker Compose": check("Docker Compose",  ["docker", "compose"], "version"),
        "Python 3":       check("Python 3",        ["python3"],        "--version"),
    }

    try:
        subprocess.run(["docker", "info"], capture_output=True, check=True, timeout=5)
        print("  ✓ Docker daemon: rodando")
    except Exception:
        print("  ✗ Docker daemon: não está rodando — inicie o Docker Desktop")
        results["Docker daemon"] = False

    check_env_file()
    check_credentials()

    print()
    if all(results.values()):
        print("Tudo instalado! Pronto para continuar.\n")
        sys.exit(0)
    else:
        failed = [k for k, v in results.items() if not v]
        print(f"Faltando: {', '.join(failed)}")
        print("Instale o que falta e rode este script novamente.\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
