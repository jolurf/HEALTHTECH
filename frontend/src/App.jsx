import { useState, useEffect } from "react";

const API = import.meta.env.VITE_BACKEND_HOST;

// =========================================================
// CONSTANTES
// =========================================================

const SECOES = [
  "1. Dados do Paciente",
  "2. Dados da Internação",
  "3. Exames da Internação",
  "4. Terapia Medicamentosa",
  "5. Terapia Intervencionista",
  "6. Dispositivos",
  "7. Situação funcional na alta",
  "8. Status laboratorial na alta",
  "9. Prescrição de Alta",
  "10. Orientações de alta (paciente)",
  "11. Orientações de alta (seguimento)",
];

const FORM_INICIAL = {
  grau_incerteza:      null,
  sem_contradicoes:    null,
  dados_respaldados:   null,
  erro_factual:        null,
  natureza_erro:       null,
  gravidade_clinica:   null,
  evita_redundancias:  null,
  tamanho_apropriado:  null,
  secoes_cobertura:    Object.fromEntries(SECOES.map((_, i) => [i, null])),
  eventos_clinicos:    null,
  info_essencial:      null,
  uso_clinico:         null,
  tempo_avaliacao:     "",
};

// =========================================================
// HELPERS
// =========================================================

function formCompleto(form, avaliador) {
  if (!avaliador) return false;
  const obrigatorios = [
    "grau_incerteza", "sem_contradicoes", "dados_respaldados",
    "erro_factual",
    "evita_redundancias", "tamanho_apropriado",
    "eventos_clinicos", "info_essencial",
    "uso_clinico",
  ];
  if (obrigatorios.some((k) => form[k] === null || form[k] === "")) return false;
  if (form.erro_factual === "Sim") {
    const f1Baixo = [form.grau_incerteza, form.sem_contradicoes, form.dados_respaldados]
      .some((v) => v !== null && v <= 3);
    if (f1Baixo) {
      if (!form.natureza_erro) return false;
      if (!form.gravidade_clinica) return false;
    }
  }
  if (Object.values(form.secoes_cobertura).some((v) => v === null)) return false;
  if (!form.tempo_avaliacao || isNaN(Number(form.tempo_avaliacao))) return false;
  return true;
}

// =========================================================
// COMPONENTES BASE
// =========================================================

function ProgressBar({ atual, total }) {
  const pct = total > 0 ? Math.round((atual / total) * 100) : 0;
  return (
    <div className="w-full bg-gray-200 rounded-full h-2">
      <div
        className="bg-gray-900 h-2 rounded-full transition-all duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function Card({ children, className = "" }) {
  return (
    <div className={`bg-white rounded-2xl shadow p-6 ${className}`}>
      {children}
    </div>
  );
}

function FatorLabel({ codigo, nome }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="text-xs font-mono font-bold text-white bg-gray-900 px-2 py-0.5 rounded-md">
        {codigo}
      </span>
      <span className="text-sm font-bold text-gray-700 uppercase tracking-wide">
        {nome}
      </span>
    </div>
  );
}

function Pergunta({ titulo, children }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold text-gray-800 leading-snug">{titulo}</p>
      {children}
    </div>
  );
}

function RadioGroup({ name, opcoes, valor, onChange }) {
  return (
    <div className="space-y-2 mt-3">
      {opcoes.map((op) => (
        <label key={op.value} className="flex items-center gap-3 cursor-pointer group">
          <input
            type="radio"
            name={name}
            checked={valor === op.value}
            onChange={() => onChange(op.value)}
            className="w-4 h-4 accent-gray-900 shrink-0"
          />
          <span className="text-sm text-gray-700 group-hover:text-gray-900">{op.label}</span>
        </label>
      ))}
    </div>
  );
}

function LikertRow6({ valor, onChange }) {
  return (
    <div className="flex items-center gap-3 mt-3 flex-wrap">
      <span className="text-xs text-gray-500 w-32 text-right shrink-0">Discordo Totalmente</span>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className={`w-11 h-11 rounded-xl text-base font-bold border-2 transition-all duration-150
              ${valor === n
                ? "bg-gray-900 text-white border-gray-900 scale-105 shadow-md"
                : "bg-white text-gray-700 border-gray-300 hover:border-gray-500"
              }`}
          >
            {n}
          </button>
        ))}
      </div>
      <span className="text-xs text-gray-500 w-32 shrink-0">Concordo Totalmente</span>
    </div>
  );
}

function SecoesGrid({ valores, onChange }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            <th className="text-left text-xs font-semibold text-gray-500 pb-2 pr-4 w-56">
              Seção
            </th>
            {[0, 1, 2, 3, 4].map((n) => (
              <th key={n} className="text-center text-xs font-semibold text-gray-500 pb-2 px-2">
                <div>{n}</div>
                {n === 0 && <div className="font-normal text-gray-400">Ausente</div>}
                {n === 4 && <div className="font-normal text-gray-400">Cobriu tudo</div>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SECOES.map((secao, i) => (
            <tr key={i} className={i % 2 === 0 ? "bg-gray-50" : "bg-white"}>
              <td className="py-2 pr-4 pl-2 text-gray-700 text-xs">{secao}</td>
              {[0, 1, 2, 3, 4].map((n) => (
                <td key={n} className="text-center py-2">
                  <input
                    type="radio"
                    name={`secao-${i}`}
                    checked={valores[i] === n}
                    onChange={() => onChange(i, n)}
                    className="w-4 h-4 accent-gray-900 cursor-pointer"
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// =========================================================
// PAINEL DE PDFs
// =========================================================

function PainelPDFs({ pdfs, carregando, urlPdf, onFechar }) {
  const visitas = pdfs.reduce((acc, pdf) => {
    if (!acc[pdf.visita]) acc[pdf.visita] = [];
    acc[pdf.visita].push(pdf);
    return acc;
  }, {});

  function labelVisita(v) {
    const m = v.match(/^(\d{4})_(\d{2})_(\d{2})_\d+_(\w+)$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
  }

  function labelPdf(nome) {
    const m = nome.match(/^(\d{4})_(\d{2})_(\d{2})-([^-]+)-/);
    return m ? `${m[3]}/${m[2]} — ${m[4]}` : nome.replace(".pdf", "");
  }

  return (
    <Card className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <h3 className="text-sm font-semibold text-gray-800">Documentos do Caso</h3>
        <button
          onClick={onFechar}
          className="text-gray-400 hover:text-gray-700 text-sm leading-none transition"
          title="Fechar painel"
        >
          ✕
        </button>
      </div>

      {carregando ? (
        <p className="text-xs text-gray-400">Carregando documentos...</p>
      ) : Object.keys(visitas).length === 0 ? (
        <p className="text-xs text-gray-400">Nenhum documento encontrado para este caso.</p>
      ) : (
        <div className="space-y-4 flex-1 min-h-0 overflow-y-auto pr-2">
          {Object.entries(visitas).map(([visita, arquivos]) => (
            <div key={visita}>
              <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">
                {labelVisita(visita)}
              </p>
              <ul className="space-y-1.5">
                {arquivos.map((pdf) => (
                  <li key={pdf.caminho}>
                    <a
                      href={urlPdf(pdf.caminho)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-1.5 text-xs text-blue-600 hover:text-blue-800
                                 hover:underline"
                      title={pdf.nome}
                    >
                      <span className="shrink-0 mt-0.5">📄</span>
                      <span className="break-all">{labelPdf(pdf.nome)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// =========================================================
// LOGIN
// =========================================================

function LoginScreen({ onLogin }) {
  const [usuario,    setUsuario]    = useState("");
  const [senha,      setSenha]      = useState("");
  const [erro,       setErro]       = useState("");
  const [carregando, setCarregando] = useState(false);

  async function entrar(e) {
    e?.preventDefault();
    if (!usuario || !senha) { setErro("Preencha usuário e senha."); return; }
    setCarregando(true);
    setErro("");
    try {
      const r = await fetch(`${API}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario, senha }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "Credenciais inválidas");
      localStorage.setItem("usuario", data.usuario);
      localStorage.setItem("token",   data.token);
      onLogin(data.usuario, data.token);
    } catch (err) {
      setErro(err.message);
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm space-y-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Avaliação de Resumos</h1>
          <p className="text-sm text-gray-500 mt-1">InCor — Acesso restrito</p>
        </div>
        <form onSubmit={entrar} className="space-y-4">
          <div>
            <label className="text-sm font-semibold text-gray-700 block mb-1">Usuário</label>
            <input
              type="text"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              autoFocus
              autoComplete="username"
              className="w-full border border-gray-300 rounded-xl px-4 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>
          <div>
            <label className="text-sm font-semibold text-gray-700 block mb-1">Senha</label>
            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="current-password"
              className="w-full border border-gray-300 rounded-xl px-4 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>
          {erro && <p className="text-sm text-red-600">{erro}</p>}
          <button
            type="submit"
            disabled={carregando}
            className="w-full bg-gray-900 text-white py-3 rounded-xl font-semibold
                       text-sm hover:bg-gray-700 disabled:opacity-50 transition"
          >
            {carregando ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}

// =========================================================
// APP
// =========================================================

export default function App() {
  const [auth, setAuth] = useState(() => {
    const u = localStorage.getItem("usuario");
    const t = localStorage.getItem("token");
    return u && t ? { usuario: u, token: t } : null;
  });

  const [resumos,            setResumos]            = useState([]);
  const [indice,             setIndice]             = useState(0);
  const [form,               setForm]               = useState(FORM_INICIAL);
  const [comentarios,        setComentarios]        = useState("");
  const [status,             setStatus]             = useState("idle");
  const [erro,               setErro]               = useState("");
  const [carregandoResumos,  setCarregandoResumos]  = useState(false);
  const [salvosNestaSessao,  setSalvosNestaSessao]  = useState(0);
  const [puladosNestaSessao, setPuladosNestaSessao] = useState(0);

  const [sidebarAberta,   setSidebarAberta]   = useState(false);
  const [pdfsDoCaso,      setPdfsDoCaso]      = useState([]);
  const [carregandoPdfs,  setCarregandoPdfs]  = useState(false);

  function sair() {
    localStorage.removeItem("usuario");
    localStorage.removeItem("token");
    setAuth(null);
    setResumos([]);
    setIndice(0);
    setForm(FORM_INICIAL);
    setComentarios("");
    setErro("");
    setPdfsDoCaso([]);
    setCarregandoResumos(false);
    setSalvosNestaSessao(0);
    setPuladosNestaSessao(0);
  }

  function resetar() {
    setForm(FORM_INICIAL);
    setComentarios("");
    setErro("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function carregarResumos() {
    if (!auth) return;
    setCarregandoResumos(true);
    setErro("");
    const params = new URLSearchParams({
      usuario: auth.usuario,
      token:   auth.token,
    });
    try {
      const r = await fetch(`${API}/resumos?${params}`);
      if (r.status === 401) { sair(); return; }
      if (!r.ok) throw new Error();
      const data = await r.json();
      setResumos(data);
      setIndice(0);
      setSalvosNestaSessao(0);
      setPuladosNestaSessao(0);
      resetar();
    } catch {
      setErro("Não foi possível conectar ao servidor. Verifique se o backend está em execução.");
    } finally {
      setCarregandoResumos(false);
    }
  }

  useEffect(() => { carregarResumos(); }, [auth]);

  const resumoAtual = resumos[indice];

  useEffect(() => {
    if (!resumoAtual || !auth) { setPdfsDoCaso([]); return; }
    let cancelado = false;
    setCarregandoPdfs(true);
    const params = new URLSearchParams({
      id_resumo: resumoAtual.id_resumo,
      usuario:   auth.usuario,
      token:     auth.token,
    });
    fetch(`${API}/pdfs?${params}`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => { if (!cancelado) setPdfsDoCaso(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelado) setPdfsDoCaso([]); })
      .finally(() => { if (!cancelado) setCarregandoPdfs(false); });
    return () => { cancelado = true; };
  }, [resumoAtual?.id_resumo]);

  function urlPdf(caminho) {
    const params = new URLSearchParams({
      caminho,
      usuario: auth.usuario,
      token:   auth.token,
    });
    return `${API}/pdf?${params}`;
  }

  function setField(campo, valor) {
    setForm((prev) => ({ ...prev, [campo]: valor }));
  }

  function setSecao(idx, valor) {
    setForm((prev) => ({
      ...prev,
      secoes_cobertura: { ...prev.secoes_cobertura, [idx]: valor },
    }));
  }

  const pronto = formCompleto(form, auth?.usuario || "");

  async function salvar() {
    if (!pronto) {
      setErro("Preencha todos os campos antes de salvar.");
      return;
    }
    setErro("");
    setStatus("saving");
    const f1Baixo = form.erro_factual === "Sim" &&
      [form.grau_incerteza, form.sem_contradicoes, form.dados_respaldados].some((v) => v <= 3);
    try {
      const params = new URLSearchParams({ token: auth.token });
      const resp = await fetch(`${API}/avaliar?${params}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id_resumo:          resumoAtual.id_resumo,
          modelo:             resumoAtual.modelo,
          avaliador:          auth.usuario,
          grau_incerteza:     form.grau_incerteza,
          sem_contradicoes:   form.sem_contradicoes,
          dados_respaldados:  form.dados_respaldados,
          erro_factual:       form.erro_factual,
          natureza_erro:      f1Baixo ? form.natureza_erro     : null,
          gravidade_clinica:  f1Baixo ? form.gravidade_clinica : null,
          evita_redundancias: form.evita_redundancias,
          tamanho_apropriado: form.tamanho_apropriado,
          secoes_cobertura:   JSON.stringify(form.secoes_cobertura),
          eventos_clinicos:   form.eventos_clinicos,
          info_essencial:     form.info_essencial,
          uso_clinico:        form.uso_clinico,
          tempo_avaliacao:    Number(form.tempo_avaliacao),
          comentarios,
        }),
      });
      if (resp.status === 401) { sair(); return; }
      if (resp.status === 409) {
        setStatus("idle");
        setErro("Esta avaliação já foi registrada. Avançando para o próximo.");
        setTimeout(() => { resetar(); setIndice((i) => i + 1); setErro(""); }, 1500);
        return;
      }
      if (!resp.ok) throw new Error();
      setStatus("saved");
      setSalvosNestaSessao((s) => s + 1);
      setTimeout(() => {
        setStatus("idle");
        resetar();
        setIndice((i) => i + 1);
      }, 800);
    } catch {
      setStatus("error");
      setErro("Erro ao salvar. Verifique a conexão com o backend.");
    }
  }

  function pular() {
    resetar();
    setPuladosNestaSessao((p) => p + 1);
    setIndice((i) => i + 1);
  }

  // ── login ────────────────────────────────────────────────

  if (!auth) {
    return (
      <LoginScreen
        onLogin={(u, t) => setAuth({ usuario: u, token: t })}
      />
    );
  }

  // ── telas especiais ──────────────────────────────────────

  if (carregandoResumos) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="text-4xl animate-pulse">⏳</div>
        <p className="text-gray-500 text-lg">Carregando resumos...</p>
      </div>
    </div>
  );

  if (!resumos.length && !erro) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="max-w-md text-center space-y-4 p-10 bg-white rounded-3xl shadow-xl">
        <div className="text-5xl">✅</div>
        <h2 className="text-2xl font-bold">Nenhum resumo pendente</h2>
        <p className="text-gray-500">
          Não há resumos para avaliar no momento, {auth.usuario}.
        </p>
        <button onClick={sair}
          className="bg-gray-900 text-white px-6 py-3 rounded-xl hover:bg-gray-700">
          Sair
        </button>
      </div>
    </div>
  );

  if (erro && !resumos.length) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="max-w-md text-center space-y-4 p-8 bg-white rounded-2xl shadow-lg">
        <div className="text-4xl">❌</div>
        <p className="text-red-600 font-semibold">{erro}</p>
        <div className="flex gap-3 justify-center">
          <button onClick={() => window.location.reload()}
            className="bg-gray-900 text-white px-6 py-3 rounded-xl hover:bg-gray-700">
            Tentar novamente
          </button>
          <button onClick={sair}
            className="border border-gray-300 text-gray-600 px-6 py-3 rounded-xl hover:bg-gray-50">
            Sair
          </button>
        </div>
      </div>
    </div>
  );

  if (indice >= resumos.length) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="max-w-md text-center space-y-4 p-10 bg-white rounded-3xl shadow-xl">
        <div className="text-5xl">✅</div>
        <h2 className="text-2xl font-bold">Sessão concluída!</h2>
        <p className="text-gray-500">
          {salvosNestaSessao === resumos.length
            ? `Todos os ${resumos.length} resumos foram avaliados.`
            : `Você percorreu os ${resumos.length} resumos desta sessão (${salvosNestaSessao} salvos${puladosNestaSessao > 0 ? `, ${puladosNestaSessao} pulados` : ""}).`}
          {" "}Obrigado, {auth.usuario}!
        </p>
        <div className="flex gap-3 justify-center">
          <button onClick={carregarResumos}
            className="bg-gray-900 text-white px-6 py-3 rounded-xl hover:bg-gray-700">
            Recarregar lista
          </button>
          <button onClick={sair}
            className="border border-gray-300 text-gray-600 px-6 py-3 rounded-xl hover:bg-gray-50">
            Sair
          </button>
        </div>
      </div>
    </div>
  );

  // ── tela principal ───────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-100 py-8 px-4">
      <div className={`mx-auto transition-all ${sidebarAberta ? "max-w-6xl" : "max-w-3xl"}`}>
        <div className={sidebarAberta ? "flex gap-5 items-start" : ""}>

          {/* Coluna principal */}
          <div className={`${sidebarAberta ? "flex-1 min-w-0" : ""} space-y-5`}>

            {/* Cabeçalho */}
            <Card className="space-y-3">
              <div className="flex items-center justify-between">
                <h1 className="text-xl font-bold text-gray-900">Avaliação de Resumos de Alta</h1>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setSidebarAberta((v) => !v)}
                    title="Ver documentos do caso"
                    className={`text-xs px-3 py-1.5 rounded-lg border transition flex items-center gap-1.5 ${
                      sidebarAberta
                        ? "bg-gray-900 text-white border-gray-900"
                        : "border-gray-300 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    Documentos
                    {pdfsDoCaso.length > 0 && (
                      <span className={`text-xs font-bold rounded-full px-1.5 py-0.5 leading-none ${
                        sidebarAberta ? "bg-white text-gray-900" : "bg-gray-900 text-white"
                      }`}>
                        {pdfsDoCaso.length}
                      </span>
                    )}
                  </button>
                  <span className="text-sm text-gray-500 font-medium">
                    {indice + 1} / {resumos.length}
                  </span>
                  <span className="text-sm font-medium text-gray-700 bg-gray-100
                                   px-3 py-1 rounded-lg">
                    {auth.usuario}
                  </span>
                  <button
                    onClick={sair}
                    className="text-xs text-gray-400 hover:text-red-500 transition"
                  >
                    Sair
                  </button>
                </div>
              </div>
              <ProgressBar atual={indice + 1} total={resumos.length} />
            </Card>

            {/* Metadados */}
            <Card>
              <div className="text-sm">
                <span className="font-semibold text-gray-600 block mb-1">Identificador</span>
                <span className="bg-gray-100 text-gray-800 px-3 py-1 rounded-lg inline-block font-mono text-xs break-all">
                  {resumoAtual.id_resumo}
                </span>
              </div>
            </Card>

            {/* Resumo */}
            <Card>
              <h2 className="font-semibold text-gray-700 mb-3">Resumo de Alta</h2>
              <div className="whitespace-pre-wrap text-sm text-gray-800 leading-relaxed
                              max-h-80 overflow-y-auto bg-gray-50 rounded-xl p-4 border border-gray-200">
                {resumoAtual.texto}
              </div>
            </Card>

            {/* F1 — Fidelidade */}
            <Card>
              <FatorLabel codigo="F1" nome="Fidelidade" />
              <div className="space-y-6">
                <Pergunta titulo="O texto preserva o grau de incerteza diagnóstica (não transforma hipótese em fato) *">
                  <LikertRow6
                    valor={form.grau_incerteza}
                    onChange={(v) => setField("grau_incerteza", v)}
                  />
                </Pergunta>
                <Pergunta titulo="Não há contradições no resumo em relação aos prontuários (datas, dosagens, diagnósticos) *">
                  <LikertRow6
                    valor={form.sem_contradicoes}
                    onChange={(v) => setField("sem_contradicoes", v)}
                  />
                </Pergunta>
                <Pergunta titulo="Os dados clínicos apresentados no resumo são totalmente respaldados pelo prontuário original. *">
                  <LikertRow6
                    valor={form.dados_respaldados}
                    onChange={(v) => setField("dados_respaldados", v)}
                  />
                </Pergunta>
              </div>
            </Card>

            {/* F2 — Erros Factuais */}
            <Card>
              <FatorLabel codigo="F2" nome="Erros Factuais" />
              <div className="space-y-6">
                <Pergunta titulo="Foi detectado erro factual relevante *">
                  <RadioGroup
                    name="erro_factual"
                    opcoes={[
                      { value: "Sim", label: "Sim" },
                      { value: "Não", label: "Não" },
                    ]}
                    valor={form.erro_factual}
                    onChange={(v) => setForm((prev) => ({
                      ...prev,
                      erro_factual:      v,
                      natureza_erro:     v === "Não" ? null : prev.natureza_erro,
                      gravidade_clinica: v === "Não" ? null : prev.gravidade_clinica,
                    }))}
                  />
                </Pergunta>
                {form.erro_factual === "Sim" && (
                  <>
                    <Pergunta titulo="Caso tenha pontuado 3 ou menos em qualquer item acima, identifique a natureza do erro principal">
                      <RadioGroup
                        name="natureza_erro"
                        opcoes={[
                          { value: "Contradição",       label: "Contradição: Informação inversa ao prontuário." },
                          { value: "Ilusão de Certeza", label: "Ilusão de Certeza: Atribuiu certeza a algo que era apenas uma hipótese." },
                          { value: "Fabricação Total",  label: "Fabricação Total: Dado que não consta em lugar nenhum dos documentos." },
                        ]}
                        valor={form.natureza_erro}
                        onChange={(v) => setField("natureza_erro", v)}
                      />
                    </Pergunta>
                    <Pergunta titulo="Gravidade Clínica: Qual o impacto desse erro de fidelidade na segurança do paciente?">
                      <RadioGroup
                        name="gravidade_clinica"
                        opcoes={[
                          { value: "Inócuo",   label: "Inócuo: Erro menor (ex: erro de digitação de nome não crítico)" },
                          { value: "Moderado", label: "Moderado: Pode confundir, mas não induz a conduta imediata errada." },
                          { value: "Grave",    label: "Grave: Pode induzir a condutas clínicas perigosas ou erros de prescrição." },
                        ]}
                        valor={form.gravidade_clinica}
                        onChange={(v) => setField("gravidade_clinica", v)}
                      />
                    </Pergunta>
                  </>
                )}
              </div>
            </Card>

            {/* F3 — Concisão */}
            <Card>
              <FatorLabel codigo="F3" nome="Concisão" />
              <div className="space-y-6">
                <Pergunta titulo="O resumo evita redundâncias desnecessárias. *">
                  <LikertRow6
                    valor={form.evita_redundancias}
                    onChange={(v) => setField("evita_redundancias", v)}
                  />
                </Pergunta>
                <Pergunta titulo="O tamanho do documento é apropriado para uma transição de cuidados segura *">
                  <LikertRow6
                    valor={form.tamanho_apropriado}
                    onChange={(v) => setField("tamanho_apropriado", v)}
                  />
                </Pergunta>
              </div>
            </Card>

            {/* F4 — Cobertura */}
            <Card>
              <FatorLabel codigo="F4" nome="Cobertura" />
              <Pergunta titulo="O modelo cobriu todos os tópicos do template institucional">
                <SecoesGrid valores={form.secoes_cobertura} onChange={setSecao} />
              </Pergunta>
            </Card>

            {/* F5 — Completude */}
            <Card>
              <FatorLabel codigo="F5" nome="Completude" />
              <div className="space-y-6">
                <Pergunta titulo="O resumo contém os principais eventos clínicos relevantes da internação. *">
                  <LikertRow6
                    valor={form.eventos_clinicos}
                    onChange={(v) => setField("eventos_clinicos", v)}
                  />
                </Pergunta>
                <Pergunta titulo="Nenhuma informação essencial para continuidade do cuidado foi omitida. *">
                  <LikertRow6
                    valor={form.info_essencial}
                    onChange={(v) => setField("info_essencial", v)}
                  />
                </Pergunta>
              </div>
            </Card>

            {/* Global */}
            <Card>
              <FatorLabel codigo="★" nome="Avaliação Global" />
              <div className="space-y-6">
                <Pergunta titulo="Este resumo poderia ser usado clinicamente sem revisão humana substancial? *">
                  <RadioGroup
                    name="uso_clinico"
                    opcoes={[
                      { value: "Sim",                label: "Sim" },
                      { value: "Sim, com ressalvas",  label: "Sim, com ressalvas" },
                      { value: "Não",                label: "Não" },
                      { value: "Inutilizável",        label: "Inutilizável" },
                    ]}
                    valor={form.uso_clinico}
                    onChange={(v) => setField("uso_clinico", v)}
                  />
                </Pergunta>
                <Pergunta titulo="Quanto tempo você levou para avaliar o texto, sem ter que preencher o formulário (faça estimativa do tempo em minutos - entre apenas o número)?">
                  <input
                    type="number"
                    min="0"
                    value={form.tempo_avaliacao}
                    onChange={(e) => setField("tempo_avaliacao", e.target.value)}
                    placeholder="Ex: 5"
                    className="mt-3 w-28 border border-gray-300 rounded-xl px-4 py-2 text-sm
                               focus:outline-none focus:ring-2 focus:ring-gray-400"
                  />
                </Pergunta>
              </div>
            </Card>

            {/* Comentários */}
            <Card>
              <label className="font-semibold text-gray-700 block mb-2">
                Comentários{" "}
                <span className="text-gray-400 font-normal text-sm">(opcional)</span>
              </label>
              <textarea
                rows={3}
                value={comentarios}
                onChange={(e) => setComentarios(e.target.value)}
                placeholder="Observações adicionais sobre o resumo..."
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm
                           focus:outline-none focus:ring-2 focus:ring-gray-400 resize-none"
              />
            </Card>

            {/* Erro */}
            {erro && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
                {erro}
              </div>
            )}

            {/* Ações */}
            <div className="flex justify-between items-center pb-8">
              <button onClick={pular}
                className="text-sm text-gray-500 border border-gray-300 px-5 py-3
                           rounded-xl hover:bg-gray-50 transition">
                Pular →
              </button>
              <button onClick={salvar}
                disabled={status === "saving" || status === "saved"}
                className={`px-8 py-3 rounded-xl font-semibold text-sm transition-all
                  ${status === "saved"   ? "bg-green-600 text-white"
                  : status === "saving" ? "bg-gray-400 text-white cursor-not-allowed"
                  : pronto              ? "bg-gray-900 text-white hover:bg-gray-700"
                  :                       "bg-gray-200 text-gray-400 cursor-not-allowed"
                  }`}>
                {status === "saving" ? "Salvando..."
                  : status === "saved" ? "✓ Salvo!"
                  : "Salvar avaliação"}
              </button>
            </div>

          </div>{/* fim coluna principal */}

          {/* Sidebar de documentos */}
          {sidebarAberta && (
            <div className="w-72 shrink-0 sticky top-4" style={{ height: "calc(100vh - 2rem)" }}>
              <PainelPDFs
                pdfs={pdfsDoCaso}
                carregando={carregandoPdfs}
                urlPdf={urlPdf}
                onFechar={() => setSidebarAberta(false)}
              />
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
