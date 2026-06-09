FROM nginx:alpine

COPY index.html /usr/share/nginx/html/
# nginx.conf fica como template; ${BACKEND_HOST} é substituído em tempo de execução
COPY nginx.conf /tmp/nginx.conf.template

EXPOSE 80

# envsubst substitui SOMENTE ${BACKEND_HOST} — variáveis nginx ($host, $uri, etc.) ficam intactas
CMD ["/bin/sh", "-c", "envsubst '${BACKEND_HOST}' < /tmp/nginx.conf.template > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'"]
