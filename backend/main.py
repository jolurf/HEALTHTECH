from fastapi import FastAPI, Query, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, field_validator, model_validator
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional

from pathlib import Path
from datetime import datetime

import sqlite3
import random
import json
import hashlib
import secrets
import smtplib
import shutil
import threading
import os
import time
import re
import urllib.request
import urllib.error
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

app = FastAPI()

# =========================================================
# CORS
# =========================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================================================
# CONFIG
# =========================================================

BASE_OUTPUTS   = Path("outputs")
BASE_PDFS      = Path(os.environ.get("PDFS_PATH", "PDFs"))
USUARIOS_FILE  = Path(os.environ.get("USUARIOS_FILE", "usuarios.json"))
BACKUPS_DIR    = Path("backups")
DB_PATH        = os.environ.get("DB_PATH", "avaliacoes.db")

def _inicializar_usuarios():
    """Na primeira execução de um volume vazio, copia o usuarios.json embutido na imagem."""
    if not USUARIOS_FILE.exists():
        USUARIOS_FILE.parent.mkdir(parents=True, exist_ok=True)
        bundled = Path(__file__).parent / "usuarios.json"
        if bundled.exists() and bundled.resolve() != USUARIOS_FILE.resolve():
            shutil.copy(bundled, USUARIOS_FILE)

_inicializar_usuarios()

# =========================================================
# BOOTSTRAP LFS — baixa PDFs reais do GitHub LFS no 1º boot
# =========================================================

def _bootstrap_pdfs():
    token = os.environ.get("GITHUB_TOKEN")
    repo  = os.environ.get("GITHUB_REPO")
    if not token or not repo:
        print("[LFS] GITHUB_TOKEN/GITHUB_REPO não configurados — PDFs não serão baixados.")
        return

    manifest_path = Path(__file__).parent / "pdfs_manifest.json"
    if not manifest_path.exists():
        print("[LFS] pdfs_manifest.json não encontrado.")
        return

    manifest = json.loads(manifest_path.read_text())
    to_download = [
        item for item in manifest
        if not (BASE_PDFS / item["path"].split("/", 1)[1]).exists()
        or (BASE_PDFS / item["path"].split("/", 1)[1]).stat().st_size < 500
    ]

    if not to_download:
        print(f"[LFS] {len(manifest)} PDFs já presentes no volume.")
        return

    print(f"[LFS] Baixando {len(to_download)} PDFs para o volume...")

    BATCH = 50
    downloaded = 0
    for i in range(0, len(to_download), BATCH):
        batch = to_download[i:i + BATCH]
        payload = json.dumps({
            "operation": "download",
            "transfers": ["basic"],
            "objects":   [{"oid": item["oid"], "size": item["size"]} for item in batch],
        }).encode()
        try:
            req = urllib.request.Request(
                f"https://github.com/{repo}.git/info/lfs/objects/batch",
                data=payload,
                headers={
                    "Accept":        "application/vnd.git-lfs+json",
                    "Content-Type":  "application/vnd.git-lfs+json",
                    "Authorization": f"Bearer {token}",
                },
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read())
        except Exception as e:
            print(f"[LFS] Erro no batch {i}: {e}")
            continue

        oid_map = {item["oid"]: item for item in batch}
        for obj in data.get("objects", []):
            if "error" in obj or "actions" not in obj:
                continue
            item = oid_map.get(obj["oid"])
            if not item:
                continue
            dest = BASE_PDFS / item["path"].split("/", 1)[1]
            dest.parent.mkdir(parents=True, exist_ok=True)
            try:
                url     = obj["actions"]["download"]["href"]
                headers = obj["actions"]["download"].get("header", {})
                dl_req  = urllib.request.Request(url, headers=headers)
                with urllib.request.urlopen(dl_req, timeout=60) as r:
                    dest.write_bytes(r.read())
                downloaded += 1
            except Exception as e:
                print(f"[LFS] Erro baixando {dest.name}: {e}")

    print(f"[LFS] {downloaded}/{len(to_download)} PDFs baixados.")

threading.Thread(target=_bootstrap_pdfs, daemon=True).start()

SESSION_TTL     = 86_400   # 24 horas
MAX_FALHAS      = 5
JANELA_BLOQUEIO = 900      # 15 minutos
MAX_REGISTROS   = 3        # cadastros por IP por hora
JANELA_REGISTRO = 3_600

NOTIFY_EMAIL = os.environ.get("NOTIFY_EMAIL", "joaoreisfreitas@gmail.com")

# =========================================================
# ESTADO EM MEMÓRIA
# =========================================================

_sessions:             dict[str, dict]        = {}
_login_falhas:         dict[str, list[float]] = {}
_registro_tentativas:  dict[str, list[float]] = {}

# =========================================================
# E-MAIL  (disparo assíncrono para não travar a resposta)
# =========================================================

def _enviar_email(destinatario: str, assunto: str, corpo: str):
    def _send():
        resend_key = os.environ.get("RESEND_API_KEY", "")
        if resend_key:
            payload = json.dumps({
                "from":    "onboarding@resend.dev",
                "to":      [destinatario],
                "subject": assunto,
                "text":    corpo,
            }).encode()
            req = urllib.request.Request(
                "https://api.resend.com/emails",
                data=payload,
                headers={
                    "Authorization": f"Bearer {resend_key}",
                    "Content-Type":  "application/json",
                },
            )
            try:
                with urllib.request.urlopen(req, timeout=15) as r:
                    print(f"[EMAIL] Enviado via Resend para {destinatario} (status {r.status})")
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", errors="replace")
                print(f"[EMAIL] Erro Resend {e.code} ao enviar para {destinatario}: {body}")
            except Exception as e:
                print(f"[EMAIL] Erro Resend ao enviar para {destinatario}: {e}")
            return

        # fallback SMTP (para uso local)
        host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
        port = int(os.environ.get("SMTP_PORT", "587"))
        user = os.environ.get("SMTP_USER", "")
        pwd  = os.environ.get("SMTP_PASS", "")
        if not user or not pwd:
            print(f"[EMAIL] Nenhum método de envio configurado — ignorado. Assunto: {assunto}")
            return
        try:
            msg = MIMEMultipart()
            msg["From"]    = user
            msg["To"]      = destinatario
            msg["Subject"] = assunto
            msg.attach(MIMEText(corpo, "plain", "utf-8"))
            with smtplib.SMTP(host, port) as s:
                s.starttls()
                s.login(user, pwd)
                s.send_message(msg)
        except Exception as e:
            print(f"[EMAIL] Erro SMTP ao enviar para {destinatario}: {e}")
    threading.Thread(target=_send, daemon=True).start()


def _email_avaliacao(av: "Avaliacao"):
    try:
        cobertura = json.loads(av.secoes_cobertura)
        cobertura_txt = "\n".join(
            f"  [{i}] {v}" for i, v in cobertura.items()
        ) if isinstance(cobertura, dict) else av.secoes_cobertura
    except Exception:
        cobertura_txt = av.secoes_cobertura

    corpo = f"""Nova avaliação registrada — {datetime.now().strftime('%d/%m/%Y %H:%M')}

Avaliador : {av.avaliador}
Modelo    : {av.modelo}
ID Resumo : {av.id_resumo}

─── FIDELIDADE ──────────────────────────
Grau de incerteza     : {av.grau_incerteza}
Sem contradições      : {av.sem_contradicoes}
Dados respaldados     : {av.dados_respaldados}

─── ERROS FACTUAIS ──────────────────────
Erro factual          : {av.erro_factual}
Natureza do erro      : {av.natureza_erro or 'N/A'}
Gravidade clínica     : {av.gravidade_clinica or 'N/A'}

─── CONCISÃO ────────────────────────────
Evita redundâncias    : {av.evita_redundancias}
Tamanho apropriado    : {av.tamanho_apropriado}

─── COBERTURA ───────────────────────────
{cobertura_txt}

─── COMPLETUDE ──────────────────────────
Eventos clínicos      : {av.eventos_clinicos}
Info essencial        : {av.info_essencial}

─── GLOBAL ──────────────────────────────
Uso clínico           : {av.uso_clinico}
Tempo de avaliação    : {av.tempo_avaliacao} min

Comentários:
{av.comentarios or '(nenhum)'}
"""
    _enviar_email(
        NOTIFY_EMAIL,
        f"[Resumos Alta] {av.avaliador} • {av.id_resumo} • {av.modelo}",
        corpo,
    )

# =========================================================
# HASH DE SENHA  (PBKDF2-HMAC-SHA256, 200 000 iterações)
# =========================================================

def _hash_senha(senha: str, salt: str | None = None) -> tuple[str, str]:
    if salt is None:
        salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", senha.encode("utf-8"), salt.encode("utf-8"), 200_000)
    return dk.hex(), salt

def _verificar_senha(senha_digitada: str, hash_armazenado: str, salt: str) -> bool:
    dk, _ = _hash_senha(senha_digitada, salt)
    return secrets.compare_digest(dk, hash_armazenado)

# =========================================================
# USUÁRIOS
# =========================================================

def _carregar_usuarios() -> list:
    if not USUARIOS_FILE.exists():
        return []
    return json.loads(USUARIOS_FILE.read_text(encoding="utf-8")).get("usuarios", [])

def _salvar_usuarios(usuarios: list):
    raw = json.loads(USUARIOS_FILE.read_text(encoding="utf-8")) if USUARIOS_FILE.exists() else {}
    raw["usuarios"] = usuarios
    USUARIOS_FILE.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")

def _get_user(username: str) -> dict | None:
    for u in _carregar_usuarios():
        if u["username"].lower() == username.lower():
            return u
    return None

def _get_user_by_email(email: str) -> dict | None:
    for u in _carregar_usuarios():
        if u.get("email", "").lower() == email.lower():
            return u
    return None

def _is_admin(user: dict) -> bool:
    return user.get("admin", False) or user["username"].lower() == "admin"

# =========================================================
# RATE LIMITING
# =========================================================

def _rate_limit_check(username: str):
    agora = time.time()
    tentativas = _login_falhas.get(username.lower(), [])
    tentativas = [t for t in tentativas if agora - t < JANELA_BLOQUEIO]
    _login_falhas[username.lower()] = tentativas
    if len(tentativas) >= MAX_FALHAS:
        espera = int(JANELA_BLOQUEIO - (agora - tentativas[0]))
        raise HTTPException(
            status_code=429,
            detail=f"Conta bloqueada temporariamente após {MAX_FALHAS} tentativas. "
                   f"Tente novamente em {espera} segundos.",
        )

def _registrar_falha(username: str):
    key = username.lower()
    tentativas = _login_falhas.get(key, [])
    tentativas.append(time.time())
    _login_falhas[key] = tentativas

def _limpar_falhas(username: str):
    _login_falhas.pop(username.lower(), None)

def _rate_limit_registro(ip: str):
    agora = time.time()
    tentativas = _registro_tentativas.get(ip, [])
    tentativas = [t for t in tentativas if agora - t < JANELA_REGISTRO]
    if len(tentativas) >= MAX_REGISTROS:
        raise HTTPException(
            status_code=429,
            detail="Limite de cadastros atingido neste IP. Tente novamente em 1 hora.",
        )
    tentativas.append(agora)
    _registro_tentativas[ip] = tentativas

# =========================================================
# SESSÕES
# =========================================================

def _criar_sessao(username: str) -> str:
    token = secrets.token_hex(32)
    _sessions[token] = {
        "username":   username,
        "expires_at": time.time() + SESSION_TTL,
    }
    return token

def _verificar_token(username: str, token: str):
    sessao = _sessions.get(token)
    if not sessao:
        raise HTTPException(status_code=401, detail="Sessão inválida. Faça login novamente.")
    if sessao["username"].lower() != username.lower():
        raise HTTPException(status_code=401, detail="Token não pertence a este usuário.")
    if time.time() > sessao["expires_at"]:
        _sessions.pop(token, None)
        raise HTTPException(status_code=401, detail="Sessão expirada. Faça login novamente.")

# =========================================================
# MIGRAÇÃO: senha em texto puro → hash (retrocompatibilidade)
# =========================================================

def _autenticar_e_migrar(user: dict, senha_digitada: str) -> bool:
    if "senha_salt" in user:
        return _verificar_senha(senha_digitada, user["senha"], user["senha_salt"])

    if not secrets.compare_digest(user.get("senha", ""), senha_digitada):
        return False

    novo_hash, salt = _hash_senha(senha_digitada)
    usuarios = _carregar_usuarios()
    for u in usuarios:
        if u["username"].lower() == user["username"].lower():
            u["senha"]      = novo_hash
            u["senha_salt"] = salt
            break
    _salvar_usuarios(usuarios)
    return True

# =========================================================
# HELPERS DE ARQUIVO / PERMISSÃO
# =========================================================

def _extrair_identificador(arq: Path) -> str:
    pasta = arq.parent.name
    if pasta.startswith("SEMANA_"):
        return pasta
    avo = arq.parent.parent.name if arq.parent.parent else ""
    if avo.startswith("SEMANA_") and pasta.startswith("PAT"):
        return f"{avo}_{pasta}"
    return pasta

def _usuario_pode_avaliar(user: dict, modelo: str, id_resumo: str) -> bool:
    for permissao in user.get("permissoes_revisao", []):
        modelo_nome = permissao.split("/")[0]
        if modelo_nome != modelo:
            continue
        padrao = f"{permissao}/**/SEMANA*/resumo_alta.txt"
        for arq in BASE_OUTPUTS.glob(padrao):
            if _extrair_identificador(arq) == id_resumo:
                return True
    return False

# =========================================================
# MODELOS PYDANTIC
# =========================================================

class LoginRequest(BaseModel):
    usuario: str
    senha:   str

    @field_validator("usuario", "senha")
    @classmethod
    def nao_vazio(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Campo obrigatório.")
        if len(v) > 128:
            raise ValueError("Valor muito longo.")
        return v


class CadastrarRequest(BaseModel):
    username: str
    email:    str
    senha:    str

    @field_validator("username")
    @classmethod
    def username_valido(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 2:
            raise ValueError("Username deve ter pelo menos 2 caracteres.")
        if len(v) > 64:
            raise ValueError("Username muito longo.")
        return v

    @field_validator("email")
    @classmethod
    def email_valido(cls, v: str) -> str:
        v = v.strip().lower()
        if "@" not in v or "." not in v.split("@")[-1]:
            raise ValueError("E-mail inválido.")
        if len(v) > 254:
            raise ValueError("E-mail muito longo.")
        return v

    @field_validator("senha")
    @classmethod
    def senha_forte(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("Senha deve ter pelo menos 6 caracteres.")
        if len(v) > 128:
            raise ValueError("Senha muito longa.")
        return v


class AlterarSenhaRequest(BaseModel):
    usuario:               str
    token:                 str
    senha_atual:           str
    nova_senha:            str
    nova_senha_confirmacao: str

    @field_validator("nova_senha")
    @classmethod
    def senha_forte(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("Nova senha deve ter pelo menos 6 caracteres.")
        if len(v) > 128:
            raise ValueError("Senha muito longa.")
        return v

    @model_validator(mode="after")
    def senhas_coincidem(self) -> "AlterarSenhaRequest":
        if self.nova_senha != self.nova_senha_confirmacao:
            raise ValueError("A nova senha e a confirmação não coincidem.")
        return self


class AtualizarEmailRequest(BaseModel):
    usuario: str
    token:   str
    email:   str

    @field_validator("email")
    @classmethod
    def email_valido(cls, v: str) -> str:
        v = v.strip().lower()
        if "@" not in v or "." not in v.split("@")[-1]:
            raise ValueError("E-mail inválido.")
        if len(v) > 254:
            raise ValueError("E-mail muito longo.")
        return v


class CadastrarUsuarioRequest(BaseModel):
    admin_usuario:      str
    admin_senha:        str
    novo_username:      str
    novo_email:         str = ""
    nova_senha:         str
    permissoes_revisao: list[str] = []

    @field_validator("novo_username")
    @classmethod
    def username_valido(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 2:
            raise ValueError("Username deve ter pelo menos 2 caracteres.")
        if len(v) > 64:
            raise ValueError("Username muito longo.")
        return v

    @field_validator("nova_senha")
    @classmethod
    def senha_forte(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("Senha deve ter pelo menos 6 caracteres.")
        if len(v) > 128:
            raise ValueError("Senha muito longa.")
        return v


class ResetarSenhaRequest(BaseModel):
    admin_usuario: str
    admin_senha:   str
    usuario_alvo:  str
    nova_senha:    str

    @field_validator("nova_senha")
    @classmethod
    def senha_forte(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("Nova senha deve ter pelo menos 6 caracteres.")
        if len(v) > 128:
            raise ValueError("Senha muito longa.")
        return v


class Avaliacao(BaseModel):

    id_resumo: str
    modelo:    str
    avaliador: str

    # F1 — Fidelidade (Likert 1–6)
    grau_incerteza:    int
    sem_contradicoes:  int
    dados_respaldados: int

    # F2 — Erros Factuais
    erro_factual:      str
    natureza_erro:     Optional[str] = None
    gravidade_clinica: Optional[str] = None

    # F3 — Concisão (Likert 1–6)
    evita_redundancias: int
    tamanho_apropriado: int

    # F4 — Cobertura (grid 11 seções × 0–4, serializado como JSON)
    secoes_cobertura:  str

    # F5 — Completude (Likert 1–6)
    eventos_clinicos:  int
    info_essencial:    int

    # Global
    uso_clinico:       str
    tempo_avaliacao:   int

    comentarios: str = ""

# =========================================================
# BANCO
# =========================================================

def inicializar_banco():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='avaliacoes'")
    if c.fetchone():
        c.execute("PRAGMA table_info(avaliacoes)")
        cols = {row[1] for row in c.fetchall()}
        if "precisao_factual" in cols:
            c.execute("ALTER TABLE avaliacoes RENAME TO avaliacoes_legacy")

    c.execute("""
    CREATE TABLE IF NOT EXISTS avaliacoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp          TEXT,
        id_resumo          TEXT,
        modelo             TEXT,
        avaliador          TEXT,
        grau_incerteza     INTEGER,
        sem_contradicoes   INTEGER,
        dados_respaldados  INTEGER,
        erro_factual       TEXT,
        natureza_erro      TEXT,
        gravidade_clinica  TEXT,
        evita_redundancias INTEGER,
        tamanho_apropriado INTEGER,
        secoes_cobertura   TEXT,
        eventos_clinicos   INTEGER,
        info_essencial     INTEGER,
        uso_clinico        TEXT,
        tempo_avaliacao    INTEGER,
        comentarios        TEXT
    )
    """)

    conn.commit()
    conn.close()

inicializar_banco()
BACKUPS_DIR.mkdir(exist_ok=True)

# =========================================================
# BACKUP
# =========================================================

def _salvar_backup(av: Avaliacao):
    ts     = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:20]
    safe_id = av.id_resumo[:40].replace("/", "_")
    nome   = f"{ts}_{av.avaliador}_{safe_id}.json"
    data   = {
        "timestamp":          datetime.now().isoformat(),
        "id_resumo":          av.id_resumo,
        "modelo":             av.modelo,
        "avaliador":          av.avaliador,
        "grau_incerteza":     av.grau_incerteza,
        "sem_contradicoes":   av.sem_contradicoes,
        "dados_respaldados":  av.dados_respaldados,
        "erro_factual":       av.erro_factual,
        "natureza_erro":      av.natureza_erro,
        "gravidade_clinica":  av.gravidade_clinica,
        "evita_redundancias": av.evita_redundancias,
        "tamanho_apropriado": av.tamanho_apropriado,
        "secoes_cobertura":   av.secoes_cobertura,
        "eventos_clinicos":   av.eventos_clinicos,
        "info_essencial":     av.info_essencial,
        "uso_clinico":        av.uso_clinico,
        "tempo_avaliacao":    av.tempo_avaliacao,
        "comentarios":        av.comentarios,
    }
    (BACKUPS_DIR / nome).write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )

# =========================================================
# HELPER ADMIN
# =========================================================

def _autenticar_admin(username: str, senha: str) -> dict:
    _rate_limit_check(username)
    user = _get_user(username)
    if not user or not _autenticar_e_migrar(user, senha):
        _registrar_falha(username)
        raise HTTPException(status_code=401, detail="Usuário ou senha incorretos")
    if not _is_admin(user):
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores")
    _limpar_falhas(username)
    return user

# =========================================================
# ENDPOINTS — AUTENTICAÇÃO
# =========================================================

@app.get("/")
def home():
    return {"status": "API funcionando"}


@app.post("/login")
def login(req: LoginRequest):
    _rate_limit_check(req.usuario)
    user = _get_user(req.usuario)

    if not user or not _autenticar_e_migrar(user, req.senha):
        _registrar_falha(req.usuario)
        raise HTTPException(status_code=401, detail="Usuário ou senha incorretos")

    _limpar_falhas(req.usuario)
    token = _criar_sessao(user["username"])
    return {"ok": True, "usuario": user["username"], "token": token}


@app.post("/logout")
def logout(usuario: str = Query(...), token: str = Query(...)):
    _verificar_token(usuario, token)
    _sessions.pop(token, None)
    return {"ok": True, "mensagem": "Sessão encerrada"}


@app.post("/cadastrar")
def cadastrar(req: CadastrarRequest, request: Request):
    ip = request.client.host if request.client else "unknown"
    _rate_limit_registro(ip)

    if _get_user(req.username):
        raise HTTPException(status_code=409, detail="Este username já está em uso")
    if req.email and _get_user_by_email(req.email):
        raise HTTPException(status_code=409, detail="Este e-mail já está cadastrado")

    novo_hash, salt = _hash_senha(req.senha)
    usuarios = _carregar_usuarios()
    usuarios.append({
        "username":           req.username,
        "email":              req.email,
        "senha":              novo_hash,
        "senha_salt":         salt,
        "permissoes_revisao": [],
    })
    _salvar_usuarios(usuarios)

    _enviar_email(
        NOTIFY_EMAIL,
        f"[Resumos Alta] Novo cadastro: {req.username}",
        f"Novo usuário registrado.\n\nUsername : {req.username}\nE-mail   : {req.email}\nData     : {datetime.now().strftime('%d/%m/%Y %H:%M')}\n\nEle ainda não tem permissões — configure via /admin/cadastrar-usuario ou edite usuarios.json.",
    )
    return {"ok": True, "mensagem": "Cadastro realizado. Aguarde a liberação de acesso pelo administrador."}


@app.post("/alterar-senha")
def alterar_senha(req: AlterarSenhaRequest):
    _verificar_token(req.usuario, req.token)
    user = _get_user(req.usuario)
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    if not _autenticar_e_migrar(user, req.senha_atual):
        raise HTTPException(status_code=401, detail="Senha atual incorreta")

    novo_hash, salt = _hash_senha(req.nova_senha)
    usuarios = _carregar_usuarios()
    for u in usuarios:
        if u["username"].lower() == user["username"].lower():
            u["senha"]      = novo_hash
            u["senha_salt"] = salt
            break
    _salvar_usuarios(usuarios)

    email_destino = user.get("email", "")
    if email_destino:
        _enviar_email(
            email_destino,
            "[Resumos Alta] Sua senha foi alterada",
            f"Olá, {user['username']}.\n\nSua senha foi alterada em {datetime.now().strftime('%d/%m/%Y %H:%M')}.\n\nSe não foi você, entre em contato com o administrador imediatamente.",
        )

    return {"ok": True, "mensagem": "Senha alterada com sucesso"}


@app.post("/atualizar-email")
def atualizar_email(req: AtualizarEmailRequest):
    _verificar_token(req.usuario, req.token)
    user = _get_user(req.usuario)
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    existente = _get_user_by_email(req.email)
    if existente and existente["username"].lower() != req.usuario.lower():
        raise HTTPException(status_code=409, detail="Este e-mail já está cadastrado por outro usuário")

    usuarios = _carregar_usuarios()
    for u in usuarios:
        if u["username"].lower() == req.usuario.lower():
            u["email"] = req.email
            break
    _salvar_usuarios(usuarios)
    return {"ok": True, "mensagem": "E-mail atualizado com sucesso"}


# =========================================================
# ENDPOINTS — ADMINISTRAÇÃO
# =========================================================

@app.post("/admin/cadastrar-usuario")
def cadastrar_usuario(req: CadastrarUsuarioRequest):
    _autenticar_admin(req.admin_usuario, req.admin_senha)

    if _get_user(req.novo_username):
        raise HTTPException(status_code=409, detail="Usuário já existe")
    if req.novo_email and _get_user_by_email(req.novo_email):
        raise HTTPException(status_code=409, detail="E-mail já cadastrado")

    novo_hash, salt = _hash_senha(req.nova_senha)
    usuarios = _carregar_usuarios()
    usuarios.append({
        "username":           req.novo_username,
        "email":              req.novo_email,
        "senha":              novo_hash,
        "senha_salt":         salt,
        "permissoes_revisao": req.permissoes_revisao,
    })
    _salvar_usuarios(usuarios)
    return {"ok": True, "mensagem": f"Usuário '{req.novo_username}' criado com sucesso"}


@app.post("/admin/resetar-senha")
def resetar_senha(req: ResetarSenhaRequest):
    _autenticar_admin(req.admin_usuario, req.admin_senha)

    alvo = _get_user(req.usuario_alvo)
    if not alvo:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    novo_hash, salt = _hash_senha(req.nova_senha)
    usuarios = _carregar_usuarios()
    for u in usuarios:
        if u["username"].lower() == req.usuario_alvo.lower():
            u["senha"]      = novo_hash
            u["senha_salt"] = salt
            break
    _salvar_usuarios(usuarios)

    tokens_invalidar = [t for t, s in _sessions.items()
                        if s["username"].lower() == req.usuario_alvo.lower()]
    for t in tokens_invalidar:
        _sessions.pop(t, None)

    email_alvo = alvo.get("email", "")
    if email_alvo:
        _enviar_email(
            email_alvo,
            "[Resumos Alta] Sua senha foi redefinida pelo administrador",
            f"Olá, {alvo['username']}.\n\nO administrador redefiniu sua senha em {datetime.now().strftime('%d/%m/%Y %H:%M')}.\n\nUse a nova senha fornecida para fazer login.",
        )

    return {"ok": True, "mensagem": f"Senha de '{req.usuario_alvo}' redefinida com sucesso"}


@app.get("/admin/usuarios")
def listar_usuarios(usuario: str = Query(...), token: str = Query(...)):
    _verificar_token(usuario, token)
    admin = _get_user(usuario)
    if not admin or not _is_admin(admin):
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores")
    return [
        {
            "username":           u["username"],
            "email":              u.get("email", ""),
            "permissoes_revisao": u.get("permissoes_revisao", []),
            "senha_definida":     bool(u.get("senha")),
        }
        for u in _carregar_usuarios()
    ]


# =========================================================
# ENDPOINTS — RESUMOS / AVALIAÇÕES
# =========================================================

@app.get("/resumos")
def listar_resumos(usuario: str = Query(...), token: str = Query(...)):
    _verificar_token(usuario, token)
    user = _get_user(usuario)
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "SELECT DISTINCT id_resumo, modelo FROM avaliacoes WHERE avaliador = ?",
        (user["username"],)
    )
    ja_avaliados = {(row[0], row[1]) for row in c.fetchall()}
    conn.close()

    resultado = []
    vistos: set[tuple[str, str]] = set()
    for permissao in user.get("permissoes_revisao", []):
        modelo_nome = permissao.split("/")[0]
        padrao = f"{permissao}/**/SEMANA*/resumo_alta.txt"
        for arq in BASE_OUTPUTS.glob(padrao):
            try:
                identificador = _extrair_identificador(arq)
                chave = (identificador, modelo_nome)
                if chave in ja_avaliados or chave in vistos:
                    continue
                vistos.add(chave)
                texto = arq.read_text(encoding="utf-8", errors="ignore")
                resultado.append({
                    "modelo":    modelo_nome,
                    "id_resumo": identificador,
                    "texto":     texto,
                })
            except Exception as e:
                print(f"Erro lendo {arq}: {e}")

    grupos: dict[str, list] = {}
    for item in resultado:
        grupos.setdefault(item["id_resumo"], []).append(item)

    resultado_final = []
    for id_resumo in sorted(grupos):
        modelos = grupos[id_resumo]
        random.shuffle(modelos)
        resultado_final.extend(modelos)

    return resultado_final


@app.post("/avaliar")
def salvar(av: Avaliacao, token: str = Query(...)):
    _verificar_token(av.avaliador, token)
    user = _get_user(av.avaliador)
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if not _usuario_pode_avaliar(user, av.modelo, av.id_resumo):
        raise HTTPException(status_code=403, detail="Sem permissão para avaliar este resumo")

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute(
        "SELECT 1 FROM avaliacoes WHERE avaliador = ? AND id_resumo = ? AND modelo = ? LIMIT 1",
        (av.avaliador, av.id_resumo, av.modelo),
    )
    if c.fetchone():
        conn.close()
        raise HTTPException(
            status_code=409,
            detail=f"Avaliação de '{av.id_resumo}' ({av.modelo}) já registrada para {av.avaliador}.",
        )

    c.execute("""
    INSERT INTO avaliacoes (
        timestamp, id_resumo, modelo, avaliador,
        grau_incerteza, sem_contradicoes, dados_respaldados,
        erro_factual, natureza_erro, gravidade_clinica,
        evita_redundancias, tamanho_apropriado,
        secoes_cobertura,
        eventos_clinicos, info_essencial,
        uso_clinico, tempo_avaliacao,
        comentarios
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        datetime.now().isoformat(),
        av.id_resumo, av.modelo, av.avaliador,
        av.grau_incerteza, av.sem_contradicoes, av.dados_respaldados,
        av.erro_factual, av.natureza_erro, av.gravidade_clinica,
        av.evita_redundancias, av.tamanho_apropriado,
        av.secoes_cobertura,
        av.eventos_clinicos, av.info_essencial,
        av.uso_clinico, av.tempo_avaliacao,
        av.comentarios,
    ))
    conn.commit()
    conn.close()

    _salvar_backup(av)
    _email_avaliacao(av)

    return {"ok": True, "mensagem": "Avaliação salva com sucesso"}


@app.get("/avaliacoes")
def listar_avaliacoes(usuario: str = Query(...), token: str = Query(...)):
    _verificar_token(usuario, token)
    user = _get_user(usuario)
    if not user or not _is_admin(user):
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores")
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT * FROM avaliacoes ORDER BY timestamp DESC")
    rows = c.fetchall()
    conn.close()
    return [dict(r) for r in rows]


# =========================================================
# ENDPOINTS — PDFs
# =========================================================

@app.get("/pdfs")
def listar_pdfs(id_resumo: str = Query(...), usuario: str = Query(...), token: str = Query(...)):
    _verificar_token(usuario, token)
    parts = id_resumo.split("_", 2)
    if len(parts) < 3:
        return []
    semana = f"SEMANA_{parts[1]}"
    pat_id = parts[2]
    pasta  = BASE_PDFS / semana / pat_id
    if not pasta.exists():
        return []
    resultado = []
    for visita in sorted(pasta.iterdir()):
        if not visita.is_dir():
            continue
        for pdf in sorted(visita.glob("*.pdf")):
            resultado.append({
                "nome":    pdf.name,
                "visita":  visita.name,
                "caminho": f"{semana}/{pat_id}/{visita.name}/{pdf.name}",
            })
    return resultado


@app.get("/pdf")
def servir_pdf(caminho: str = Query(...), usuario: str = Query(...), token: str = Query(...)):
    _verificar_token(usuario, token)
    arquivo = (BASE_PDFS / caminho).resolve()
    raiz    = BASE_PDFS.resolve()
    try:
        arquivo.relative_to(raiz)
    except ValueError:
        raise HTTPException(status_code=403, detail="Acesso negado")
    if not arquivo.exists() or arquivo.suffix.lower() != ".pdf":
        raise HTTPException(status_code=404, detail="PDF não encontrado")
    return FileResponse(
        arquivo,
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename=\"{arquivo.name}\""},
    )
