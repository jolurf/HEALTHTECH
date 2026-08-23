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
- [ ] **Pendente**: aplicar o mesmo reset em produção (Railway) antes de liberar pros
  dois — apagar/recriar o `avaliacoes.db` de lá (ou copiar o `usuarios.json` novo pra lá)
  e confirmar variável de ambiente/volume de produção. Isso não foi feito por aqui —
  sem acesso ao Railway nesta sessão.

## Etapa 3 — reavaliação parcial (mês que vem)

- Pedir para o Carlo reavaliar somente a parte de escala Likert (os 11 tópicos, 1–6)
  — sem mexer no resto do formulário.
- A estudar: o formulário hoje não tem um modo de "avaliação parcial por bloco"
  (ex: abrir só o bloco F1/F3/F5 e mandar salvar sem tocar em F2/F4/Global). Precisa
  decidir se isso vira uma tela separada, um parâmetro na URL, ou uma flag de
  permissão por usuário.
