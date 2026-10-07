"""
Projeto Resumo de Emergência — dados do visualizador (só admin; os endpoints ficam em main.py).

Trazido de Resumo_emergencia_dgx/visualizador/app.py, reduzido ao que o site precisa:
  - só a rodada R10 da MapReduce_v2, que já vem com o `.fontes.json` (rastreabilidade pronta,
    sem recalcular nada — dispensa o código do pipeline, pypdf e os logs);
  - gabaritos já convertidos de .docx para .txt (dispensa o libreoffice no container);
  - sem PDFs: o painel "Documento" mostra o texto (anonimizado) que o pipeline leu, que já vem
    em documentos[...].texto do .fontes.json.

Estrutura em EMERGENCIA_DIR (mesma de data_validation/ no DGX):
  MapReduce_v2/SEMANA_xx/Paciente{N}_{id}/*_R10.md  (+ .fontes.json)
  DrMarcio|DraEdnara/SEMANA_xx/Paciente{N}_{id}/*.txt
"""

import json
import os
import re
from difflib import SequenceMatcher
from pathlib import Path

from fastapi import HTTPException

EMERGENCIA_DIR = Path(os.environ.get("EMERGENCIA_PATH", "emergencia"))

PIPELINES = {"MapReduce_v2": "v2 · R10"}
MEDICOS   = {"DrMarcio": "Dr. Marcio", "DraEdnara": "Dra. Ednara"}

_RE_PACIENTE_PASTA = re.compile(r"^Paciente(\d+)_(.+)$")
_RE_LEGENDA_LINHA  = re.compile(r"^\[Doc (\d+)\]\s+(.+?)\s*$", re.MULTILINE)


def _resolve_dentro_de(base: Path, relativo: str) -> Path:
    """Resolve `relativo` dentro de `base`, recusando sair da árvore (path traversal)."""
    candidato = (base / relativo).resolve()
    base_resolvida = base.resolve()
    if candidato != base_resolvida and base_resolvida not in candidato.parents:
        raise HTTPException(status_code=403, detail="Acesso negado")
    if not candidato.is_file():
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")
    return candidato


def _pastas_de_paciente(base: Path):
    for semana_dir in sorted(base.glob("SEMANA_*")):
        for paciente_dir in sorted(semana_dir.glob("Paciente*_*")):
            m = _RE_PACIENTE_PASTA.match(paciente_dir.name)
            if m:
                yield semana_dir, paciente_dir, int(m.group(1))


def listar_casos() -> list[dict]:
    casos = []
    for pasta, rotulo in PIPELINES.items():
        for semana_dir, paciente_dir, num in _pastas_de_paciente(EMERGENCIA_DIR / pasta):
            for md in sorted(paciente_dir.glob("*_R10.md")):
                casos.append({
                    "pipeline":       rotulo,
                    "pipeline_pasta": pasta,
                    "paciente_num":   num,
                    "paciente_pasta": paciente_dir.name,
                    "semana":         semana_dir.name,
                    "arquivo":        md.relative_to(EMERGENCIA_DIR).as_posix(),
                    "nome_arquivo":   md.name,
                    "tem_fontes":     md.with_suffix(".fontes.json").exists(),
                })
    casos.sort(key=lambda c: (c["paciente_num"], c["pipeline"]))
    return casos


def listar_gabaritos() -> list[dict]:
    itens = []
    for pasta, rotulo in MEDICOS.items():
        for semana_dir, paciente_dir, num in _pastas_de_paciente(EMERGENCIA_DIR / pasta):
            for txt in sorted(paciente_dir.glob("*.txt")):
                itens.append({
                    "medico":         rotulo,
                    "paciente_num":   num,
                    "paciente_pasta": paciente_dir.name,
                    "semana":         semana_dir.name,
                    "arquivo":        txt.relative_to(EMERGENCIA_DIR).as_posix(),
                })
    itens.sort(key=lambda c: (c["paciente_num"], c["medico"]))
    return itens


def _parse_legenda(texto: str) -> dict[str, str]:
    """[Doc N] -> caminho do documento de origem (seção 'Legenda dos Documentos Analisados')."""
    idx = texto.find("Legenda dos Documentos Analisados")
    bloco = texto[idx:] if idx != -1 else ""
    return {f"Doc {m.group(1)}": m.group(2).strip() for m in _RE_LEGENDA_LINHA.finditer(bloco)}


def _relatorio(arquivo: str) -> Path:
    caminho = _resolve_dentro_de(EMERGENCIA_DIR, arquivo)
    if caminho.suffix != ".md":
        raise HTTPException(status_code=403, detail="Acesso negado")
    return caminho


def obter_relatorio(arquivo: str) -> dict:
    texto = _relatorio(arquivo).read_text(encoding="utf-8", errors="ignore")
    return {"markdown": texto, "legenda": _parse_legenda(texto)}


def _carregar_fontes(caminho_md: Path) -> dict | None:
    gravado = caminho_md.with_suffix(".fontes.json")
    if not gravado.exists():
        return None
    with open(gravado, encoding="utf-8") as f:
        return json.load(f)


def obter_fontes(arquivo: str) -> dict:
    dados = _carregar_fontes(_relatorio(arquivo))
    if dados is None:
        return {"disponivel": False, "motivo": "relatório sem .fontes.json"}
    return {"disponivel": True, "gerado": "pipeline", "com_extracao": True, **dados}


def obter_gabarito(arquivo: str) -> dict:
    caminho = _resolve_dentro_de(EMERGENCIA_DIR, arquivo)
    if caminho.suffix != ".txt":
        raise HTTPException(status_code=403, detail="Acesso negado")
    return {"texto": caminho.read_text(encoding="utf-8", errors="ignore")}


# ─────────────────────────────────────────────────────────────────────────────
# Trecho de origem de um [Doc N] que não está ligado a nenhuma linha do .fontes.json.
# No DGX isso usava o PDF (pdftotext) ou os logs da execução; aqui busca no texto que o próprio
# pipeline leu (já gravado em documentos[...].texto do .fontes.json) — mesma busca híbrida
# leve (overlap de palavras + fuzzy match) do visualizador original.
# ─────────────────────────────────────────────────────────────────────────────

_PARADAS = {
    "de", "da", "do", "das", "dos", "e", "a", "o", "em", "no", "na", "nos", "nas",
    "com", "por", "um", "uma", "para", "ao", "aos", "as", "os", "que", "se",
}


def _tokeniza(s: str) -> list[str]:
    s = re.sub(r"[^\w\s]", " ", s.lower())
    return [t for t in s.split() if t not in _PARADAS and len(t) > 1]


def _busca_hibrida(texto_doc: str, claim: str, janela: int = 500, passo: int = 200, top_k: int = 3) -> list[dict]:
    tokens_claim = set(_tokeniza(claim))
    n = len(texto_doc)
    posicoes = list(range(0, max(n - janela, 1), passo)) if n > janela else [0]
    candidatos = []
    for inicio in posicoes:
        trecho = texto_doc[inicio: inicio + janela]
        tokens_trecho = set(_tokeniza(trecho))
        uniao = tokens_claim | tokens_trecho
        jaccard = (len(tokens_claim & tokens_trecho) / len(uniao)) if uniao else 0.0
        fuzzy = SequenceMatcher(None, claim.lower(), trecho.lower()).ratio()
        candidatos.append({
            "inicio": inicio, "trecho": trecho.strip(),
            "score": round(0.6 * jaccard + 0.4 * fuzzy, 3),
            "jaccard": round(jaccard, 3), "fuzzy": round(fuzzy, 3),
        })
    candidatos.sort(key=lambda c: c["score"], reverse=True)

    escolhidos: list[dict] = []
    for c in candidatos:
        if all(abs(c["inicio"] - e["inicio"]) > janela // 2 for e in escolhidos):
            escolhidos.append(c)
        if len(escolhidos) >= top_k:
            break
    return escolhidos


def buscar_trecho(arquivo: str, doc_id: str, claim: str) -> dict:
    dados = _carregar_fontes(_relatorio(arquivo)) or {}
    meta_id = doc_id if doc_id.startswith("[") else f"[{doc_id}]"
    texto = (dados.get("documentos", {}).get(meta_id) or {}).get("texto", "")
    if len(texto.strip()) < 20:
        return {"trechos": [], "origem": "nenhuma",
                "aviso": "O texto deste documento não está registrado no .fontes.json."}
    return {"trechos": _busca_hibrida(texto, claim), "origem": "busca_heuristica", "tamanho_documento": len(texto)}
