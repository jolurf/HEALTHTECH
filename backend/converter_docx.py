#!/usr/bin/env python3
"""
Converte os .docx de ANOTACAO_1o-SEMESTRE2026 para resumo_alta.txt
dentro de outputs/HUMANO_CARLO/ e outputs/HUMANO_CAROLINA/.

Estrutura gerada:
  outputs/HUMANO_CARLO/SEMANA_01_PAT01-<id>/resumo_alta.txt
  outputs/HUMANO_CAROLINA/SEMANA_01_PAT01-<id>/resumo_alta.txt

Uso:
  cd backend/
  python converter_docx.py
"""

from pathlib import Path
from docx import Document  # pip install python-docx

SCRIPT_DIR   = Path(__file__).parent
ANOTACAO_BASE = SCRIPT_DIR.parent / "ANOTACAO_1o-SEMESTRE2026"
OUTPUTS_BASE  = SCRIPT_DIR / "outputs"

# Mapeia autor → nome do modelo na pasta outputs
MODELO_MAP = {
    "CARLO":    "HUMANO_CARLO",
    "CAROLINA": "HUMANO_CAROLINA",
}


def extrair_texto(docx_path: Path) -> str:
    doc = Document(docx_path)
    linhas = []
    for p in doc.paragraphs:
        texto = p.text.strip()
        if texto:
            linhas.append(texto)
    return "\n".join(linhas)


def converter():
    total = convertidos = ignorados = erros = 0

    for autor, modelo in MODELO_MAP.items():
        pasta_autor = ANOTACAO_BASE / autor
        if not pasta_autor.exists():
            print(f"[AVISO] Pasta não encontrada: {pasta_autor}")
            continue

        for docx in sorted(pasta_autor.rglob("*.docx")):
            total += 1
            # Estrutura: ANOTACAO/AUTOR/SEMANA_XX/PAT##-<id>/arquivo.docx
            try:
                semana = docx.parts[-3]   # ex: SEMANA_01
                pat    = docx.parts[-2]   # ex: PAT01-14797211254227193352
            except IndexError:
                print(f"[ERRO] Caminho inesperado: {docx}")
                erros += 1
                continue

            identificador   = f"{semana}_{pat}"   # SEMANA_01_PAT01-...
            pasta_destino   = OUTPUTS_BASE / modelo / identificador
            pasta_destino.mkdir(parents=True, exist_ok=True)
            destino         = pasta_destino / "resumo_alta.txt"

            if destino.exists():
                print(f"[SKIP] {destino.relative_to(OUTPUTS_BASE)}")
                ignorados += 1
                continue

            try:
                texto = extrair_texto(docx)
                destino.write_text(texto, encoding="utf-8")
                print(f"[OK]   {destino.relative_to(OUTPUTS_BASE)}")
                convertidos += 1
            except Exception as e:
                print(f"[ERRO] {docx}: {e}")
                erros += 1

    print(f"\nConcluído: {convertidos} convertidos | {ignorados} ignorados | {erros} erros | {total} total")


if __name__ == "__main__":
    converter()
