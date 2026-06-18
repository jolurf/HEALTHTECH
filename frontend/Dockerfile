# ---- Build stage: compila JSX -> JS puro e gera CSS do Tailwind ----
# Tudo isso roda no build (servidor do Railway), nunca no navegador do
# usuário final. Elimina a dependência de Babel Standalone em runtime e
# dos CDNs externos (unpkg.com, cdn.tailwindcss.com), que travavam sob
# interceptação HTTPS de antivírus/proxies locais (ex: Avast Antitrack).
FROM node:20-alpine AS build
WORKDIR /build

RUN npm init -y >/dev/null \
  && npm install --no-save react@18 react-dom@18 @babel/core@7 @babel/preset-react@7 tailwindcss@3

COPY app.jsx tailwind.config.js input.css ./

RUN node -e " \
  const babel = require('@babel/core'); \
  const fs = require('fs'); \
  const src = fs.readFileSync('app.jsx', 'utf8'); \
  const out = babel.transform(src, { \
    presets: [['@babel/preset-react', { runtime: 'classic' }]], \
  }).code; \
  fs.writeFileSync('app.js', out); \
"

RUN npx tailwindcss -i ./input.css -o ./tailwind.css --minify

# ---- Imagem final: nginx servindo tudo estático, mesma origem ----
FROM nginx:alpine

COPY index.html /usr/share/nginx/html/
COPY --from=build /build/app.js /usr/share/nginx/html/app.js
COPY --from=build /build/tailwind.css /usr/share/nginx/html/tailwind.css
COPY --from=build /build/node_modules/react/umd/react.production.min.js /usr/share/nginx/html/react.production.min.js
COPY --from=build /build/node_modules/react-dom/umd/react-dom.production.min.js /usr/share/nginx/html/react-dom.production.min.js

# nginx.conf fica como template; ${BACKEND_HOST} é substituído em tempo de execução
COPY nginx.conf /tmp/nginx.conf.template

EXPOSE 80

# Defaults: BACKEND_HOST já vem configurado no Railway (URL pública do backend);
# RESOLVER cai num DNS público porque o backend é alcançado pelo domínio público
# *.up.railway.app, não pela rede privada do Railway.
# envsubst substitui SOMENTE essas duas vars — variáveis nginx ($host, $uri, etc.) ficam intactas
CMD ["/bin/sh", "-c", "export BACKEND_HOST=${BACKEND_HOST:-https://healthtech-production-da6a.up.railway.app}; export RESOLVER=${RESOLVER:-8.8.8.8}; envsubst '${BACKEND_HOST} ${RESOLVER}' < /tmp/nginx.conf.template > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'"]
