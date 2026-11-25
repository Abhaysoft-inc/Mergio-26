# Deploying the backend

The Express backend (`apps/backend`: the API and the GitHub sync worker) runs in Docker on our
VPS. The web app stays on Vercel. The VPS already has a reverse proxy (Nginx Proxy Manager)
that owns ports 80 and 443, so the backend joins its Docker network and has no public port of
its own; the proxy serves it at `https://api.mergio.in` with a Let's Encrypt certificate.

```
Browser ─► mergio.in (Vercel) ─► api.mergio.in ─► Nginx Proxy Manager ─► mergio-backend:4000
                                                                           │
                         production Postgres + Upstash Redis ◄─────────────┘
```

## First deploy

On the server, as root:

```sh
git clone https://github.com/mergio-org/Mergio-26.git /opt/mergio/src
cd /opt/mergio/src/deploy

cp .env.example .env                      # PROXY_NETWORK: the proxy's Docker network
cp backend.env.example /opt/mergio/backend.env
chmod 600 /opt/mergio/backend.env
nano /opt/mergio/backend.env              # fill in DATABASE_URL, Redis, GitHub App

docker compose run --rm migrate           # what is pending in the database?
docker compose run --rm migrate migrate deploy   # apply it (never drops data)
docker compose up -d --build
docker exec mergio-backend wget -qO- http://127.0.0.1:4000/health
```

Then:

1. DNS: an A record for `api.mergio.in` pointing to the server's IP.
2. Nginx Proxy Manager (`http://<server>:81`) → Hosts → Proxy Hosts → Add: domain
   `api.mergio.in`, scheme `http`, forward hostname `mergio-backend`, port `4000`, Block
   Common Exploits on; SSL tab: request a new Let's Encrypt certificate, Force SSL, HTTP/2.
3. Check `https://api.mergio.in/health` → `{"status":"ok","database":"connected"}`.

## Updating

```sh
cd /opt/mergio/src && git pull
cd deploy
docker compose run --rm migrate           # new migrations? apply them before restarting
docker compose up -d --build
docker image prune -f                     # remove the previous build's leftovers
```

Logs: `docker compose logs -f backend`. Roll back: `git checkout <commit>` and
`docker compose up -d --build`.

## Settings

All in `/opt/mergio/backend.env` (template: `backend.env.example`); restart after a change
with `docker compose up -d`. Without the GitHub App ID and key the API still runs, and sync
jobs wait in the queue until they are set.
