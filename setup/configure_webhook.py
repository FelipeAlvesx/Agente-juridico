#!/usr/bin/env python3
"""
1. Cria a instância na Evolution API
2. Gera QR Code para o cliente escanear
3. Configura webhook para apontar para o agente
"""

import os
import sys
import time
import base64
import requests
from dotenv import load_dotenv

load_dotenv()

BASE           = os.getenv("EVOLUTION_URL", "http://localhost:8080")
KEY            = os.getenv("EVOLUTION_API_KEY", "")
INST           = os.getenv("EVOLUTION_INSTANCE", "lumina-demo")
AGENT_WEBHOOK  = os.getenv("AGENT_WEBHOOK_URL", "http://agent:3000")

HEADERS = {"apikey": KEY, "Content-Type": "application/json"}


def create_instance():
    print(f"  → Criando instância '{INST}'...")
    r = requests.post(f"{BASE}/instance/create", headers=HEADERS, json={
        "instanceName": INST,
        "qrcode": True,
        "integration": "WHATSAPP-BAILEYS",
    }, timeout=15)

    if r.status_code in (200, 201):
        print("  ✓ Instância criada!")
    elif r.status_code == 403:
        print("  ✗ API Key inválida — verifique EVOLUTION_API_KEY no .env")
        sys.exit(1)
    else:
        print(f"  ℹ Instância já existia ou: {r.text[:100]}")


def get_qrcode(max_tries: int = 20) -> bool:
    print("\n  → Aguardando QR Code", end="", flush=True)
    for _ in range(max_tries):
        try:
            r = requests.get(
                f"{BASE}/instance/connect/{INST}",
                headers=HEADERS, timeout=10
            )
            b64 = r.json().get("base64", "")
            if b64:
                raw = b64.split(",")[-1]
                with open("qrcode.png", "wb") as f:
                    f.write(base64.b64decode(raw))
                print(" ✓")
                return True
        except Exception:
            pass
        print(".", end="", flush=True)
        time.sleep(3)

    print(" ✗")
    return False


def configure_webhook():
    print(f"\n  → Configurando webhook → {AGENT_WEBHOOK}/webhook")
    r = requests.post(
        f"{BASE}/webhook/set/{INST}",
        headers=HEADERS,
        json={
            "url": f"{AGENT_WEBHOOK}/webhook",
            "webhook_by_events": False,
            "webhook_base64": False,
            "events": ["MESSAGES_UPSERT"],
        },
        timeout=10,
    )
    if r.status_code == 200:
        print("  ✓ Webhook configurado!")
    else:
        print(f"  ✗ Erro ao configurar webhook: {r.text[:100]}")
        sys.exit(1)


def main():
    print("\nConectando WhatsApp...\n")

    create_instance()
    time.sleep(2)

    if get_qrcode():
        print("\n┌─────────────────────────────────────────────┐")
        print("│  QR Code salvo em: qrcode.png               │")
        print("│                                              │")
        print("│  Abra o arquivo e escaneie com o            │")
        print("│  WhatsApp Business do celular da clínica.   │")
        print("│  (igual ao WhatsApp Web)                    │")
        print("└─────────────────────────────────────────────┘\n")
        input("  Pressione Enter após escanear o QR Code...")
    else:
        print("  ✗ Não foi possível gerar o QR Code.")
        print("     Verifique se o docker compose está rodando.")
        sys.exit(1)

    configure_webhook()

    print("\nWhatsApp conectado e webhook configurado!\n")


if __name__ == "__main__":
    main()
