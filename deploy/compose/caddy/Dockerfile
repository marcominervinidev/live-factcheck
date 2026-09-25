# syntax=docker/dockerfile:1.7
# Caddy as non-root: listens on 8080/8443 inside the container (published as 80/443), so it
# needs no NET_BIND_SERVICE capability. /data (certificates, local CA) and /config are owned
# by the runtime user, so the named volumes Compose creates from them are writable.
FROM caddy:2.11.4-alpine
# The upstream binary carries cap_net_bind_service as a file capability; with cap_drop ALL and
# no-new-privileges the kernel refuses to exec it. Unprivileged ports make it unnecessary.
RUN setcap -r /usr/bin/caddy \
 && mkdir -p /data/caddy /config/caddy && chown -R 1000:1000 /data /config
COPY deploy/compose/caddy/Caddyfile /etc/caddy/Caddyfile
USER 1000:1000
EXPOSE 8080 8443
