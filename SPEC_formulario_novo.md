# Especificação: App.jsx + index.html — Novo Formulário
**Questionário de Avaliação de Resumo Automático**
Versão baseada nas imagens do Google Forms + código legado analisado.

---

## 1. O que muda vs. o que permanece

| Aspecto | Versão Antiga | Versão Nova |
|---|---|---|
| Escala Likert | 1–5 | **1–6** |
| Grid de seções (colunas) | 1–5 | **0–4** (0 = Ausente, 4 = Cobriu tudo) |
| Campos no formulário | 8 escalares + secoes_qualidade | **12 campos + grid + campo numérico** |
| Campos condicionais | Nenhum | **natureza_erro** e **gravidade_clinica** (aparecem se erro_factual = "Sim") |
| Campo de tempo | Não existe | **tempo_avaliacao** (número inteiro em minutos) |
| Avaliador | Radio lista fixa | Mantém igual |
| Progressbar + navegação | Mantém | Mantém |
| Lógica de save/skip/reset | Mantém | Mantém |
| API base | `http://127.0.0.1:8000` | Mantém |
| Endpoints | `/resumos` (GET) e `/avaliar` (POST) | Mantém — **payload muda** (ver seção 5) |

---

## 2. Novo `FORM_INICIAL` — todos os campos e tipos

```js
const FORM_INICIAL = {
  // ── Bloco Fidelidade (Likert 1–6) ──────────────────────────
  grau_incerteza:      null,   // number 1-6
  sem_contradicoes:    null,   // number 1-6
  dados_respaldados:   null,   // number 1-6

  // ── Bloco Erros Factuais ────────────────────────────────────
  erro_factual:        null,   // string: "Sim" | "Não"
  natureza_erro:       null,   // string | null (só visível se erro_factual === "Sim")
                               // "Contradição" | "Ilusão de Certeza" | "Fabricação Total"
  gravidade_clinica:   null,   // string | null (só visível se erro_factual === "Sim")
                               // "Inócuo" | "Moderado" | "Grave"

  // ── Bloco Concisão (Likert 1–6) ────────────────────────────
  evita_redundancias:  null,   // number 1-6
  tamanho_apropriado:  null,   // number 1-6

  // ── Bloco Cobertura — Grid 11 seções × colunas 0–4 ─────────
  secoes_cobertura:    Object.fromEntries(SECOES.map((_, i) => [i, null])),
                               // { 0: null|0|1|2|3|4, 1: null|0|1|2|3|4, ... }

  // ── Bloco Completude (Likert 1–6) ──────────────────────────
  eventos_clinicos:    null,   // number 1-6
  info_essencial:      null,   // number 1-6

  // ── Avaliação Global ────────────────────────────────────────
  uso_clinico:         null,   // string: "Sim" | "Sim, com ressalvas" | "Não" | "Inutilizável"
  tempo_avaliacao:     "",     // string numérica (minutos), input text restrito a número
};
```

---

## 3. Seções e questões do formulário (na ordem de exibição)

### 3.1 BLOCO — Fidelidade
*Título do card:* **"Fidelidade"** (badge `F1`)

| Campo | Pergunta | Componente |
|---|---|---|
| `grau_incerteza` | O texto preserva o grau de incerteza diagnóstica (não transforma hipótese em fato) * | `LikertRow6` (1–6, "Discordo Totalmente" → "Concordo Totalmente") |
| `sem_contradicoes` | Não há contradições no resumo em relação aos prontuários (datas, dosagens, diagnósticos) * | `LikertRow6` |
| `dados_respaldados` | Os dados clínicos apresentados no resumo são totalmente respaldados pelo prontuário original. * | `LikertRow6` |

### 3.2 BLOCO — Erros Factuais
*Título do card:* **"Erros Factuais"** (badge `F2`)

| Campo | Pergunta | Componente |
|---|---|---|
| `erro_factual` | Foi detectado erro factual relevante * | `RadioGroup` — opções: `"Sim"`, `"Não"` |
| `natureza_erro` | *(exibido somente se `erro_factual === "Sim"`)* Caso tenha pontuado 3 ou menos em qualquer item acima, identifique a natureza do erro principal | `RadioGroup` — opções: `"Contradição"`, `"Ilusão de Certeza"`, `"Fabricação Total"` |
| `gravidade_clinica` | *(exibido somente se `erro_factual === "Sim"`)* **Gravidade Clínica:** *Qual o impacto desse erro de fidelidade na segurança do paciente?* | `RadioGroup` — opções: `"Inócuo"`, `"Moderado"`, `"Grave"` |

> **Labels completos das opções de `natureza_erro`:**
> - Contradição: Informação inversa ao prontuário.
> - Ilusão de Certeza: Atribuiu certeza a algo que era apenas uma hipótese.
> - Fabricação Total: Dado que não consta em lugar nenhum dos documentos.
>
> **Labels completos das opções de `gravidade_clinica`:**
> - Inócuo: Erro menor (ex: erro de digitação de nome não crítico)
> - Moderado: Pode confundir, mas não induz a conduta imediata errada.
> - Grave: Pode induzir a condutas clínicas perigosas ou erros de prescrição.

### 3.3 BLOCO — Concisão
*Título do card:* **"Concisão"** (badge `F3`)

| Campo | Pergunta | Componente |
|---|---|---|
| `evita_redundancias` | O resumo evita redundâncias desnecessárias. * | `LikertRow6` |
| `tamanho_apropriado` | O tamanho do documento é apropriado para uma transição de cuidados segura * | `LikertRow6` |

### 3.4 BLOCO — Cobertura das Seções
*Título do card:* **"Cobertura"** (badge `F4`)

**Pergunta:** O modelo cobriu todos os tópicos do template institucional

**Componente:** `SecoesGrid` — grade 11 linhas × 5 colunas

| Linhas (SECOES) | Colunas (valores) |
|---|---|
| 1. Dados do Paciente | `0` — Ausente |
| 2. Dados da Internação | `1` |
| 3. Exames da Internação | `2` |
| 4. Terapia Medicamentosa | `3` |
| 5. Terapia Intervencionista | `4` — Cobriu tudo o que era importante |
| 6. Dispositivos | |
| 7. Situação funcional na alta | |
| 8. Status laboratorial na alta | |
| 9. Prescrição de Alta | |
| 10. Orientações de alta (paciente) | |
| 11. Orientações de alta (seguimento) | |

> ⚠️ A coluna `0` agora significa **"Ausente"** (seção não coberta). Nas versões antigas era `1` o mínimo. Agora vai de **0 a 4**.

### 3.5 BLOCO — Completude
*Título do card:* **"Completude"** (badge `F5`)

| Campo | Pergunta | Componente |
|---|---|---|
| `eventos_clinicos` | O resumo contém os principais eventos clínicos relevantes da internação. * | `LikertRow6` |
| `info_essencial` | Nenhuma informação essencial para continuidade do cuidado foi omitida. * | `LikertRow6` |

### 3.6 BLOCO — Avaliação Global
*Título do card:* **"Avaliação Global"** (badge `★`)

| Campo | Pergunta | Componente |
|---|---|---|
| `uso_clinico` | Este resumo poderia ser usado clinicamente sem revisão humana substancial? * | `RadioGroup` — opções: `"Sim"`, `"Sim, com ressalvas"`, `"Não"`, `"Inutilizável"` |
| `tempo_avaliacao` | Quanto tempo você levou para avaliar o texto, sem ter que preencher o formulário (faça estimativa do tempo em minutos - entre apenas o número)? | `<input type="number" min="0" />` (campo de texto curto numérico) |

### 3.7 BLOCO — Comentários

| Campo | Pergunta | Componente |
|---|---|---|
| `comentarios` | Espaço para comentários | `<textarea>` (resposta longa, opcional) |

---

## 4. Componentes de UI a criar/adaptar

### `LikertRow6` (novo — substitui `LikertRow`)
- Escala de **1 a 6** (não mais 1–5)
- Exibe número acima do radio button, estilo Google Forms
- Rótulos nas extremidades: `"Discordo Totalmente"` (esquerda) e `"Concordo Totalmente"` (direita)
- Props: `valor`, `onChange`

### `RadioGroup` (renomear/simplificar `RadioScaleGroup`)
- Exibe somente label (sem número ordinal visível ao lado)
- Props: `name`, `opcoes: [{value, label}]`, `valor`, `onChange`

### `SecoesGrid` (adaptar)
- Colunas: `[0, 1, 2, 3, 4]` (antes era `[1, 2, 3, 4, 5]`)
- Header: coluna `0` = "0 - Ausente", coluna `4` = "4 - Cobriu tudo"
- Internamente, `secoes_cobertura` no lugar de `secoes_qualidade`

### Componentes que permanecem sem mudança
- `ProgressBar`, `Card`, `FatorLabel`, `Pergunta`

---

## 5. Payload enviado ao backend (`POST /avaliar`)

```json
{
  "id_resumo": "string",
  "modelo": "string",
  "avaliador": "string",

  "grau_incerteza": 1,
  "sem_contradicoes": 4,
  "dados_respaldados": 5,

  "erro_factual": "Sim",
  "natureza_erro": "Contradição",
  "gravidade_clinica": "Moderado",

  "evita_redundancias": 3,
  "tamanho_apropriado": 6,

  "secoes_cobertura": "{\"0\":4,\"1\":3,\"2\":0,\"3\":4,\"4\":2,\"5\":4,\"6\":1,\"7\":3,\"8\":4,\"9\":2,\"10\":4}",

  "eventos_clinicos": 5,
  "info_essencial": 4,

  "uso_clinico": "Sim, com ressalvas",
  "tempo_avaliacao": 7,

  "comentarios": "texto livre ou vazio"
}
```

> `secoes_cobertura` deve ser serializado como string JSON (igual ao antigo `secoes_qualidade`).
>
> `natureza_erro` e `gravidade_clinica` devem ser enviados como `null` se `erro_factual === "Não"`.

---

## 6. Lógica de validação (`formCompleto`)

```js
function formCompleto(form, avaliador) {
  if (!avaliador) return false;

  // Campos obrigatórios escalares simples
  const obrigatorios = [
    "grau_incerteza", "sem_contradicoes", "dados_respaldados",
    "erro_factual",
    "evita_redundancias", "tamanho_apropriado",
    "eventos_clinicos", "info_essencial",
    "uso_clinico",
  ];
  if (obrigatorios.some(k => form[k] === null || form[k] === "")) return false;

  // Condicionais: só obrigatórios se erro_factual === "Sim"
  if (form.erro_factual === "Sim") {
    if (!form.natureza_erro) return false;
    if (!form.gravidade_clinica) return false;
  }

  // Grid: todas as 11 seções preenchidas
  if (Object.values(form.secoes_cobertura).some(v => v === null)) return false;

  // tempo_avaliacao: obrigatório, deve ser número positivo
  if (!form.tempo_avaliacao || isNaN(Number(form.tempo_avaliacao))) return false;

  return true;
}
```

---

## 7. Estrutura do `index.html` (standalone sem bundler)

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Questionário de Avaliação de Resumo Automático — InCor</title>
  <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100 min-h-screen">
  <div id="root"></div>
  <script type="text/babel">
    const { useState, useEffect } = React;
    const API = "http://127.0.0.1:8000";

    // Constantes + FORM_INICIAL + Componentes + App
    // ... (todo o código React embutido aqui, como estava antes)

    ReactDOM.createRoot(document.getElementById("root")).render(<App />);
  </script>
</body>
</html>
```

> **Não mudar**: CDN do React 18, Babel standalone, Tailwind CDN, `id="root"`.
> O arquivo `App.jsx` é a versão modular (para projetos com Vite/CRA). O `index.html` é o standalone, idêntico em lógica mas com todo o código embutido na tag `<script type="text/babel">`.

---

## 8. Resumo das diferenças de nomes de campo (antigo → novo)

| Campo Antigo | Campo Novo | Observação |
|---|---|---|
| `precisao_factual` | `grau_incerteza` + `sem_contradicoes` + `dados_respaldados` | Desmembrado em 3 perguntas Likert 1-6 |
| `terminologia` | *(removido)* | — |
| `completude` | `eventos_clinicos` + `info_essencial` | Desmembrado em 2 perguntas Likert 1-6 |
| `secoes_qualidade` (1–5) | `secoes_cobertura` (0–4) | Escala e semântica alteradas |
| `clareza_estrutural` | *(removido)* | — |
| `sintese` | *(removido)* | — |
| `alucinacao_severidade` | `erro_factual` + `natureza_erro` + `gravidade_clinica` | Separado em detecção + tipagem + gravidade |
| `concisao` | `evita_redundancias` + `tamanho_apropriado` | Desmembrado em 2 perguntas Likert 1-6 |
| `intervencao_humana` | `uso_clinico` | Opções reordenadas e renomeadas |
| *(não existia)* | `tempo_avaliacao` | Novo campo numérico (minutos) |
| `comentarios` | `comentarios` | Mantém |
