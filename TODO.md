# TODO

## Etapa 2 — reavaliação de 10 casos (Carolina e Carlo)

- [x] Backup do `avaliacoes.db` de produção preservado em `data/avaliacoes.db.backup`
  (211 avaliações — 50 casos × {HUMANO_CARLO, MapReduce} para Carolina, 50 × {HUMANO_CAROLINA, MapReduce} para Carlo).
- [x] Sorteados 10 pacientes em comum para os dois (mesma amostra, pra poder comparar
  concordância entre avaliadores): `SEMANA_02_PAT14`, `PAT17`, `PAT18`, `SEMANA_03_PAT23`,
  `PAT24`, `PAT29`, `SEMANA_04_PAT31`, `PAT35`, `SEMANA_05_PAT40`, `PAT43`
  (ids completos com hash em `backend/usuarios.json`, campo `amostra_casos`).
- [x] Novo mecanismo no backend: campo opcional `amostra_casos` no usuário
  (`_usuario_pode_avaliar` e `GET /resumos` em `backend/main.py`) restringe os casos
  apresentados a essa lista, sem tocar nas permissões de modelo existentes
  (`permissoes_revisao`). Usuário sem `amostra_casos` continua vendo tudo (admin).
- [x] Banco local (`docker-compose`) resetado do zero para testar — Carolina e Carlo
  agora só veem os 10 pacientes sorteados (20 avaliações cada, todas "não iniciado").
- [x] Nova coluna `rodada` (1 = avaliação original, 2 = reavaliação) na tabela
  `avaliacoes`. `/resumos` e `/avaliar` calculam a rodada automaticamente a partir da
  `amostra_casos` do usuário — a reavaliação sempre entra como linha nova, a rodada 1
  nunca é sobrescrita/apagada. Necessário porque vamos medir concordância
  intra-avaliador comparando rodada 1 × rodada 2 por caso.
- [x] Endpoints admin em produção: `POST /admin/sincronizar-usuarios` (atualiza
  `permissoes_revisao`/`amostra_casos` a partir do `usuarios.json` versionado, sem
  mexer em senha) e `POST /admin/reabrir-avaliacoes` (só reseta progresso de rodada 2,
  nunca toca rodada 1) — comandos prontos em `comandos_producao.txt` (não versionado).
- [ ] **Pendente**: rodar `sincronizar-usuarios` em produção depois do deploy do
  Railway (é o único passo manual que falta — a reavaliação já nasce isolada em
  rodada 2 sozinha, não precisa mais "reabrir" nada).
- [ ] **Depois que os dois reavaliarem**: comparar rodada 1 × rodada 2 por
  `(avaliador, id_resumo, modelo)` pra calcular a concordância intra-avaliador
  (via `GET /avaliacoes`, admin, que já traz a coluna `rodada`).

## Etapa 3 — reavaliação parcial (mês que vem)

- Pedir para o Carlo reavaliar somente a parte de escala Likert (os 11 tópicos, 1–6)
  — sem mexer no resto do formulário.
- A estudar: o formulário hoje não tem um modo de "avaliação parcial por bloco"
  (ex: abrir só o bloco F1/F3/F5 e mandar salvar sem tocar em F2/F4/Global). Precisa
  decidir se isso vira uma tela separada, um parâmetro na URL, ou uma flag de
  permissão por usuário.
