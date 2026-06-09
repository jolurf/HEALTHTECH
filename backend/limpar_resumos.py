from pathlib import Path

BASE_OUTPUTS = Path("outputs")
LOG_FILE     = Path("erros_resumo.log")
MARCADOR     = "1) Dados do Paciente"
RODAPE       = "Resultado gerado por inteligência artificial. Pode conter erros."

erros       = []
modificados = 0
intactos    = 0

for arq in sorted(BASE_OUTPUTS.rglob("resumo_alta.txt")):
    texto    = arq.read_text(encoding="utf-8", errors="ignore")
    original = texto

    idx_marcador = texto.find(MARCADOR)

    if idx_marcador == -1:
        erros.append(arq)
        print(f"  SEM MARCADOR : {arq}")
        continue

    # Remove qualquer texto que precede "1) Dados do Paciente"
    if idx_marcador > 0:
        texto = texto[idx_marcador:]

    # Remove o rodapé e tudo após ele
    idx_rodape = texto.find(RODAPE)
    if idx_rodape != -1:
        texto = texto[:idx_rodape].rstrip()

    if texto != original:
        arq.write_text(texto, encoding="utf-8")
        modificados += 1
        print(f"  MODIFICADO   : {arq}")
    else:
        intactos += 1

# Grava log de erros
if erros:
    with open(LOG_FILE, "w", encoding="utf-8") as f:
        for p in erros:
            f.write(f"{p.name}\t{p}\n")
    print(f"\nErros gravados em {LOG_FILE} ({len(erros)} arquivo(s))")
else:
    LOG_FILE.unlink(missing_ok=True)
    print("\nNenhum arquivo sem '1) Dados do Paciente'.")

print(f"Modificados  : {modificados}")
print(f"Sem alteração: {intactos}")
print(f"Com erro     : {len(erros)}")
