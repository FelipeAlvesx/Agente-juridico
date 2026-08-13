"""
Check das asserções de tom do runner. Não precisa de Flask, Claude nem do agente:

    python3 tests/test_tom_assertions.py

Existe porque um regex de emoji errado falha do jeito pior: silenciosamente, deixando
o golden test 07 passar com emoji na resposta.
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))

from runner import EMOJI_RE  # noqa: E402

# Emojis que o agente já usou ou usaria — todos têm que ser pegos.
for s in ["Felipe, seja bem-vindo! 😊", "oi 🙂", "pronto ✨", "obrigado 🙏", "💜", "❤️", "🇧🇷"]:
    assert EMOJI_RE.search(s), f"emoji não detectado em: {s!r}"

# Texto legítimo do agente — nada aqui pode ser confundido com emoji.
for s in [
    "Olá, sou a Helena, do atendimento.",
    "Três meses sem receber é muito tempo.",
    "Você prefere presencial ou online?",
    "R$ 1.000,00 — cifrão, acento e pontuação não são emoji",
    "✓ ✗ — os marcadores do próprio prompt",
]:
    assert not EMOJI_RE.search(s), f"falso positivo em: {s!r}"

# As regex do 07_tom.yaml pegam as paráfrases que a substring literal deixava passar.
CELEBRACAO = re.compile(r"que (bom|ótimo|legal|maravilha)", re.IGNORECASE)
assert CELEBRACAO.search("Que bom que nos procurou.")          # falhou em produção
assert CELEBRACAO.search("Que ótimo que você entrou em contato!")
assert not CELEBRACAO.search("Entendo, isso é bem difícil.")

ABERTURA_EUFORICA = re.compile(r"^\s*(ótimo|perfeito|maravilha|show)\b", re.IGNORECASE)
assert ABERTURA_EUFORICA.search("Ótimo, Felipe! Já tenho tudo que preciso aqui.")  # idem
assert not ABERTURA_EUFORICA.search("O próximo passo é uma consulta com o advogado.")

# Parecer jurídico: a forma afirmativa é proibida, a recusa que cita a mesma expressão não.
PARECER = re.compile(r"(^|[.!?]\s*)(sim,?\s*)?você (tem|não tem) direito", re.IGNORECASE)
assert PARECER.search("Sim, você tem direito ao benefício.")
assert PARECER.search("Você não tem direito nesse caso.")
assert not PARECER.search(
    "Quem pode responder se você tem direito é o advogado."   # recusa correta, dava falso positivo
)

print("OK — asserções de tom cobrem os 3 escorregões reais")
