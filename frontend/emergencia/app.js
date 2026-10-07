"use strict";

const estado = {
  casos: [],
  gabaritos: [],
  casoAtual: null,      // objeto de /admin/emergencia/casos
  legendaAtual: {},     // "Doc N" -> caminho do documento de origem (da Legenda)
  fontes: null,         // .fontes.json do relatório (MapReduce_v2), ou null
};

// Como cada evidência foi localizada no texto do documento (MapReduce_v2/fontes.py).
const ROTULO_MODO = { exato: "trecho exato", aproximado: "trecho aproximado", nao_encontrado: "não encontrado" };
const ROTULO_ORIGEM = {
  trecho_do_modelo: "trecho citado pelo modelo na leitura do documento",
  texto_do_exame: "texto do exame lido pelo modelo",
  texto_da_linha: "texto da própria linha do resumo (o modelo não citou trecho)",
  codigo_cid: "código CID da tabela de diagnósticos do S3",
  laboratorio_regra: "resultado lido por regra (BNP, troponina, Chagas)",
  queixa_atual: "Queixa / Atual",
  ao_exame: "Ao exame",
  impressao: "Impressão",
};
const ORDEM_MODO = { exato: 0, aproximado: 1, nao_encontrado: 2 };

const $ = (sel) => document.querySelector(sel);

// Sessão do site (a mesma do Resumo de Alta, gravada no login). Os dados vêm de
// /admin/emergencia/*, que exige token de admin — sem sessão válida, volta para o login.
const AUTH = { usuario: localStorage.getItem("usuario"), token: localStorage.getItem("token") };
if (!AUTH.usuario || !AUTH.token) window.location.replace("/");

function urlApi(rota, params = {}) {
  return `/admin/emergencia/${rota}?${new URLSearchParams({ ...params, usuario: AUTH.usuario, token: AUTH.token })}`;
}

async function api(rota, params) {
  const resp = await fetch(urlApi(rota, params));
  if (resp.status === 401 || resp.status === 403) {
    window.location.replace("/");
    throw new Error("sem acesso");
  }
  return resp.json();
}

// gfm: tabelas GFM (sem isto, tabela markdown não vira <table>).
// breaks: quebra de linha simples vira <br> — os relatórios (sobretudo o v1 original)
// separam item por UMA quebra de linha só, não pela sintaxe de lista "- item"; sem esta
// opção, linhas soltas colam num parágrafo só.
marked.setOptions({ gfm: true, breaks: true });

async function carregarCasos() {
  estado.casos = await api("casos");
  const sel = $("#sel-caso");
  sel.innerHTML = "";
  if (estado.casos.length === 0) {
    sel.innerHTML = "<option>nenhum relatório R10 encontrado</option>";
    return;
  }
  for (const c of estado.casos) {
    const opt = document.createElement("option");
    opt.value = c.arquivo;
    opt.textContent = `Paciente ${c.paciente_num} — ${c.pipeline} (${c.nome_arquivo})`;
    sel.appendChild(opt);
  }
  sel.addEventListener("change", () => abrirCaso(sel.value));
  await abrirCaso(sel.value);
}

async function carregarGabaritosDoPaciente(pacienteNum) {
  const sel = $("#sel-medico");
  const doPaciente = estado.gabaritos.filter((g) => g.paciente_num === pacienteNum);
  sel.innerHTML = "";
  if (doPaciente.length === 0) {
    sel.innerHTML = "<option value=''>nenhum gabarito para este paciente</option>";
    $("#conteudo-gabarito").textContent = "Nenhum gabarito encontrado para este paciente.";
    return;
  }
  for (const g of doPaciente) {
    const opt = document.createElement("option");
    opt.value = g.arquivo;
    opt.textContent = g.medico;
    sel.appendChild(opt);
  }
  await abrirGabarito(sel.value);
}

async function abrirCaso(arquivo) {
  const caso = estado.casos.find((c) => c.arquivo === arquivo);
  if (!caso) return;
  estado.casoAtual = caso;

  const dados = await api("relatorio", { arquivo });
  estado.legendaAtual = dados.legenda || {};
  estado.fontes = null;
  estado.carregandoFontes = true;
  fecharFonte();
  renderizarRelatorio(dados.markdown);          // o relatório aparece na hora

  // Fontes: do .fontes.json do pipeline, ou calculadas pelo visualizador na primeira abertura
  // (alguns segundos num paciente grande; depois vem do cache). Chega depois e redesenha.
  api("fontes", { arquivo })
    .then((fontes) => {
      if (estado.casoAtual !== caso) return;    // o usuário já trocou de caso
      estado.fontes = fontes.disponivel ? fontes : null;
      estado.motivoSemFontes = fontes.motivo || "";
      estado.carregandoFontes = false;
      renderizarRelatorio(dados.markdown);
    })
    .catch(() => {
      if (estado.casoAtual !== caso) return;
      estado.carregandoFontes = false;
      renderizarRelatorio(dados.markdown);
    });

  if (estado.gabaritos.length === 0) {
    estado.gabaritos = await api("gabaritos");
  }
  await carregarGabaritosDoPaciente(caso.paciente_num);
}

function renderizarRelatorio(markdown) {
  // Marca [Doc N] como span clicável ANTES de converter markdown -> HTML, pra sobreviver ao
  // parser (marked preserva HTML inline do fonte). No site não há PDF: o clique mostra o texto
  // (anonimizado) que o pipeline leu, gravado no .fontes.json.
  const comMarcacao = marcarLinhasComFonte(markdown).replace(/\[Doc (\d+)\]/g, (casado, n) => {
    const chave = `Doc ${n}`;
    const classe = estado.legendaAtual[chave] ? "cita" : "cita sem-legenda";
    return `<span class="${classe}" role="button" tabindex="0" data-doc="${chave}">${casado}</span>`;
  });
  const html = marked.parse(comMarcacao);
  const alvo = $("#conteudo-ia");
  alvo.innerHTML = faixaRastreabilidade() + html;

  alvo.querySelectorAll(".cita").forEach((el) => {
    // Com .fontes.json, o clique abre o documento grifado ao lado; citação fora de uma linha
    // registrada cai na busca aproximada (modal).
    const abrir = () => {
      const idx = estado.fontes ? indiceDaLinha(el) : null;
      if (idx !== null) abrirFonte(idx, el.dataset.doc);
      else onCitacaoClicada(el);
    };
    el.addEventListener("click", abrir);
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); abrir(); }
    });
  });
  alvo.querySelectorAll(".marca-fonte").forEach((el) => {
    el.addEventListener("click", () => abrirFonte(Number(el.dataset.fonte), null));
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); abrirFonte(Number(el.dataset.fonte), null); }
    });
  });
}

// Faixa no topo do relatório: diz se há rastreabilidade para ESTE relatório, e por quê não.
function faixaRastreabilidade() {
  if (estado.carregandoFontes) {
    return `<div class="faixa-fontes sem">Localizando no prontuário a origem de cada linha…</div>`;
  }
  if (!estado.fontes) {
    return `<div class="faixa-fontes sem">Sem rastreabilidade para este relatório${estado.motivoSemFontes ? ` (${escapeHtml(estado.motivoSemFontes)})` : ""}.
      Os <code>[Doc N]</code> usam a busca aproximada no texto do documento.</div>`;
  }
  const evs = estado.fontes.linhas.flatMap((l) => l.evidencias || []);
  const n = (m) => evs.filter((e) => e.modo === m).length;
  const como = estado.fontes.com_extracao
    ? "trechos citados pelo modelo nesta execução"
    : "texto de cada linha procurado no documento (os logs desta execução não estão disponíveis)";
  return `<div class="faixa-fontes com">Rastreabilidade: ${estado.fontes.linhas.length} linhas ·
    <span class="selo exato">${n("exato")} exatas</span> <span class="selo aproximado">${n("aproximado")} aproximadas</span>
    <span class="selo nao_encontrado">${n("nao_encontrado")} não encontradas</span> · ${como} — clique na bolinha ou no [Doc N].</div>`;
}

// Põe uma bolinha no início de cada linha do markdown que tem fonte registrada. A cor é a melhor
// localização entre os documentos citados (verde: trecho exato em algum documento).
function marcarLinhasComFonte(markdown) {
  if (!estado.fontes) return markdown;
  const porLinha = new Map();
  estado.fontes.linhas.forEach((l, i) => { if (!porLinha.has(l.linha)) porLinha.set(l.linha, i); });
  return markdown.split("\n").map((linha) => {
    const idx = porLinha.get(linha.trim());
    if (idx === undefined) return linha;
    const evs = estado.fontes.linhas[idx].evidencias || [];
    const modo = evs.length
      ? evs.map((e) => e.modo).sort((a, b) => ORDEM_MODO[a] - ORDEM_MODO[b])[0]
      : "nao_encontrado";
    const marca = `<span class="marca-fonte ${modo}" data-fonte="${idx}" role="button" tabindex="0" title="Ver no documento de origem (${ROTULO_MODO[modo]})"></span>`;
    const t = linha.trimStart();
    // linha de tabela: a bolinha vai dentro da primeira célula, senão quebra a tabela
    return t.startsWith("|") ? linha.replace("|", `| ${marca}`) : marca + linha;
  }).join("\n");
}

// A linha do resumo a que pertence uma citação: a bolinha mais próxima antes dela no mesmo
// bloco (parágrafo com <br> entre linhas) ou na mesma linha de tabela.
function indiceDaLinha(el) {
  const tr = el.closest("tr");
  if (tr) {
    const m = tr.querySelector(".marca-fonte");
    return m ? Number(m.dataset.fonte) : null;
  }
  for (let n = el.previousSibling; n; n = n.previousSibling) {
    if (n.nodeType === 1 && n.classList.contains("marca-fonte")) return Number(n.dataset.fonte);
    if (n.nodeType === 1 && n.querySelector && n.querySelector(".marca-fonte")) {
      const todas = n.querySelectorAll(".marca-fonte");
      return Number(todas[todas.length - 1].dataset.fonte);
    }
  }
  return null;
}

function fecharFonte() {
  $("#painel-fonte").classList.add("fechado");
  if ($("#painel-gabarito").classList.contains("fechado")) $("#resizer-gabarito").classList.add("fechado");
}

function abrirFonte(idx, docPreferido) {
  const linha = estado.fontes && estado.fontes.linhas[idx];
  if (!linha) return;
  $("#painel-gabarito").classList.add("fechado");
  $("#painel-fonte").classList.remove("fechado");
  $("#resizer-gabarito").classList.remove("fechado");
  // linha de tabela: as células viram "Ecocardiograma · 17/10/2017: …" (sem as barras do markdown)
  const bruta = linha.linha.replace(/\s*\[Fonte:[^\]]*\]\s*$/, "");
  $("#fonte-linha").textContent = bruta.trim().startsWith("|")
    ? bruta.split("|").map((c) => c.trim()).filter((c) => c && c !== "--" && !/^\[Doc/.test(c)).join(" · ")
    : bruta;

  const evs = linha.evidencias || [];
  const abas = $("#fonte-abas");
  abas.innerHTML = "";
  if (evs.length === 0) {
    $("#fonte-info").innerHTML = "";
    $("#fonte-texto").innerHTML = `<div class="fonte-nao-achado">Nenhum documento de origem registrado para esta linha.</div>`;
    return;
  }
  let inicial = evs.findIndex((e) => e.doc === `[${docPreferido}]`);
  if (inicial < 0) inicial = 0;
  evs.forEach((ev, i) => {
    const aba = document.createElement("button");
    aba.className = "fonte-aba";
    // seção 7: uma aba por subitem (Queixa / Ao exame / Impressão) do mesmo documento
    const rotulo = ["queixa_atual", "ao_exame", "impressao"].includes(ev.origem)
      ? ROTULO_ORIGEM[ev.origem] : escapeHtml(ev.doc.replace(/[\[\]]/g, ""));
    aba.innerHTML = `${rotulo}<span class="selo ${ev.modo}">${ROTULO_MODO[ev.modo]}</span>`;
    aba.addEventListener("click", () => mostrarEvidencia(evs, i));
    abas.appendChild(aba);
  });
  mostrarEvidencia(evs, inicial);
}

function mostrarEvidencia(evs, i) {
  const ev = evs[i];
  document.querySelectorAll(".fonte-aba").forEach((a, j) => a.classList.toggle("ativa", j === i));
  const doc = estado.fontes.documentos[ev.doc] || { arquivo: "", texto: "" };
  $("#fonte-titulo").textContent = `${ev.doc} — ${doc.arquivo.split("/").pop() || "documento"}`;
  $("#fonte-info").innerHTML = `
    <span class="selo ${ev.modo}">${ROTULO_MODO[ev.modo]}${ev.modo === "aproximado" ? ` · ${Math.round(ev.score * 100)}%` : ""}</span>
    <span>${escapeHtml(ROTULO_ORIGEM[ev.origem] || ev.origem)}</span>
    ${ev.agente ? `<span class="selo agente" title="quem produziu a linha">${escapeHtml(ev.agente)}</span>` : ""}`;

  const texto = doc.texto || "";
  const corpo = $("#fonte-texto");
  if (ev.modo === "nao_encontrado" || ev.inicio === null || ev.inicio === undefined) {
    corpo.innerHTML = `<div class="fonte-nao-achado">Trecho não encontrado neste documento:<br><span class="fonte-trecho-citado">${escapeHtml(ev.trecho)}</span></div>${escapeHtml(texto)}`;
    corpo.scrollTop = 0;
    return;
  }
  corpo.innerHTML = escapeHtml(texto.slice(0, ev.inicio))
    + `<mark class="${ev.modo}">${escapeHtml(texto.slice(ev.inicio, ev.fim))}</mark>`
    + escapeHtml(texto.slice(ev.fim));
  const mark = corpo.querySelector("mark");
  if (mark) mark.scrollIntoView({ block: "center" });
}

function textoDoBlocoQueContem(el) {
  // Sobe até a linha/item mais próximo (célula de tabela, item de lista, parágrafo) e
  // usa o texto dele como "claim" pra busca — é o contexto que sustenta a citação.
  const alvo = el.closest("td, th, li, p, tr") || el.parentElement;
  return (alvo ? alvo.textContent : el.textContent || "").trim();
}

async function onCitacaoClicada(el) {
  const doc = el.dataset.doc;
  const caminho = estado.legendaAtual[doc];
  const modal = $("#modal-trecho");
  const corpo = $("#modal-corpo");
  $("#modal-titulo").textContent = `Trecho de origem — ${doc}`;
  modal.classList.remove("escondido");

  if (!caminho) {
    corpo.innerHTML = `<p class="aviso">Este relatório não tem a seção "Legenda dos Documentos Analisados" (comum no v1 original) — não dá pra resolver ${doc} num arquivo.</p>`;
    return;
  }

  const claim = textoDoBlocoQueContem(el);
  corpo.innerHTML = `
    <div class="doc-caminho">${caminho}</div>
    <div class="claim">${escapeHtml(claim)}</div>
    <p class="carregando">Buscando trecho de origem…</p>
  `;

  try {
    const dados = await api("trecho", { arquivo: estado.casoAtual.arquivo, doc_id: doc, claim });
    renderizarTrechos(dados, caminho, claim);
  } catch (e) {
    corpo.innerHTML = `<div class="doc-caminho">${caminho}</div><p class="aviso">Erro ao buscar: ${e}</p>`;
  }
}

function renderizarTrechos(dados, caminho, claim) {
  const corpo = $("#modal-corpo");
  let html = `<div class="doc-caminho">${caminho}</div><div class="claim">${escapeHtml(claim)}</div>`;

  if (dados.origem === "extracao_llm") {
    html += `<p class="origem origem-real">Trecho extraído pelo próprio modelo na hora da leitura — não é aproximação.</p>`;
  } else if (dados.origem === "busca_heuristica") {
    html += `<p class="origem origem-aprox">Aproximação por busca de palavras — esta citação não está ligada a uma linha com trecho registrado.</p>`;
  }

  if (dados.aviso) {
    html += `<p class="aviso">${dados.aviso}</p>`;
  } else if (!dados.trechos || dados.trechos.length === 0) {
    html += `<p class="aviso">Nenhum trecho candidato encontrado.</p>`;
  } else {
    for (const t of dados.trechos) {
      const cabecalho = dados.origem === "extracao_llm"
        ? `<span class="score">${escapeHtml(t.item || "")} · score ${t.score}</span>`
        : `<span class="score">score ${t.score} (palavras ${t.jaccard} · fuzzy ${t.fuzzy})</span>`;
      html += `
        <div class="trecho-candidato">
          ${cabecalho}
          <div class="texto">${escapeHtml(t.trecho)}</div>
        </div>
      `;
    }
  }
  corpo.innerHTML = html;
}

async function abrirGabarito(arquivo) {
  if (!arquivo) return;
  $("#conteudo-gabarito").textContent = "Carregando…";
  const dados = await api("gabarito", { arquivo });
  $("#conteudo-gabarito").textContent = dados.texto;
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function ligarUI() {
  $("#btn-fechar-fonte").addEventListener("click", fecharFonte);
  $("#btn-gabarito").addEventListener("click", () => {
    $("#painel-fonte").classList.add("fechado");
    $("#painel-gabarito").classList.remove("fechado");
    $("#resizer-gabarito").classList.remove("fechado");
  });
  $("#btn-fechar-gabarito").addEventListener("click", () => {
    $("#painel-gabarito").classList.add("fechado");
    $("#resizer-gabarito").classList.add("fechado");
  });
  $("#sel-medico").addEventListener("change", (ev) => abrirGabarito(ev.target.value));
  $("#modal-fechar").addEventListener("click", () => $("#modal-trecho").classList.add("escondido"));
  $("#modal-trecho").addEventListener("click", (ev) => {
    if (ev.target.id === "modal-trecho") $("#modal-trecho").classList.add("escondido");
  });
}

// leitura/escrita de preferência é best-effort: em aba anônima ou com storage
// bloqueado, cai de volta pro padrão em vez de quebrar a página.
function lerPreferencia(chave) {
  try { return localStorage.getItem(chave); } catch (e) { return null; }
}
function salvarPreferencia(chave, valor) {
  try { localStorage.setItem(chave, valor); } catch (e) { /* ignora */ }
}

function ligarRedimensionamentoGabarito() {
  const resizer = $("#resizer-gabarito");
  const LARGURA_MIN = 280;

  function larguraMaxima() {
    return Math.round(window.innerWidth * 0.9);
  }

  function aplicarLargura(px) {
    const largura = Math.min(larguraMaxima(), Math.max(LARGURA_MIN, Math.round(px)));
    document.documentElement.style.setProperty("--largura-gabarito", `${largura}px`);
    salvarPreferencia("largura-gabarito", String(largura));
  }

  const larguraSalva = parseInt(lerPreferencia("largura-gabarito"), 10);
  if (!Number.isNaN(larguraSalva)) aplicarLargura(larguraSalva);

  resizer.addEventListener("mousedown", (ev) => {
    ev.preventDefault();
    resizer.classList.add("arrastando");
    document.body.classList.add("redimensionando");

    const aoMover = (moveEv) => aplicarLargura(window.innerWidth - moveEv.clientX);
    const aoSoltar = () => {
      resizer.classList.remove("arrastando");
      document.body.classList.remove("redimensionando");
      window.removeEventListener("mousemove", aoMover);
      window.removeEventListener("mouseup", aoSoltar);
    };
    window.addEventListener("mousemove", aoMover);
    window.addEventListener("mouseup", aoSoltar);
  });
}

function ligarControleDeFonte() {
  const FONTE_MIN = 0.7;
  const FONTE_MAX = 1.6;
  const PASSO = 0.08;

  let atual = parseFloat(lerPreferencia("fonte-gabarito"));
  if (Number.isNaN(atual)) atual = 0.88;

  function aplicarFonte(rem) {
    atual = Math.min(FONTE_MAX, Math.max(FONTE_MIN, rem));
    document.documentElement.style.setProperty("--gabarito-font-size", `${atual.toFixed(2)}rem`);
    salvarPreferencia("fonte-gabarito", String(atual));
  }
  aplicarFonte(atual);

  $("#btn-fonte-menor").addEventListener("click", () => aplicarFonte(atual - PASSO));
  $("#btn-fonte-maior").addEventListener("click", () => aplicarFonte(atual + PASSO));
}

ligarUI();
ligarRedimensionamentoGabarito();
ligarControleDeFonte();
carregarCasos();
