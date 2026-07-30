"""
RAG simples por similaridade de palavras-chave.
Lê os arquivos .md da pasta /app/knowledge e retorna
os trechos mais relevantes para a pergunta do usuário.
"""

import pathlib

KB_DIR = pathlib.Path("/app/knowledge")

STOP_WORDS = {
    "de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas",
    "para", "por", "com", "que", "uma", "um", "são", "tem", "ter",
    "como", "qual", "quais", "quando", "onde", "quem", "meu", "minha",
    "você", "vocês", "eu", "ele", "ela", "eles", "elas", "isso", "isto",
    "esse", "essa", "este", "esta", "esses", "essas", "estes", "estas",
}


def _load_chunks() -> list[dict]:
    chunks = []
    if not KB_DIR.exists():
        return chunks
    for f in sorted(KB_DIR.glob("*.md")):
        text = f.read_text(encoding="utf-8")
        for para in text.split("\n\n"):
            para = para.strip()
            if len(para) > 20:
                chunks.append({"text": para, "source": f.name})
    return chunks


_CHUNKS = _load_chunks()


def search(query: str, top_k: int = 3) -> str:
    if not _CHUNKS:
        return ""

    q_lower = query.lower()
    keywords = [w for w in q_lower.split() if len(w) > 3 and w not in STOP_WORDS]

    if not keywords:
        return ""

    scored = []
    for chunk in _CHUNKS:
        chunk_lower = chunk["text"].lower()
        score = sum(1 for kw in keywords if kw in chunk_lower)
        if score > 0:
            scored.append((score, chunk["text"]))

    if not scored:
        return ""

    scored.sort(key=lambda x: x[0], reverse=True)
    results = [text for _, text in scored[:top_k]]
    return "\n\n".join(results)
