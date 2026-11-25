# Mergio backend: the Express API and the GitHub sync worker. Build from the repo root:
#   docker build -f apps/backend/Dockerfile -t mergio-backend .
# deploy/compose.yaml builds it for the server; see deploy/README.md.

FROM node:24-alpine AS base
RUN npm install -g pnpm@12.6.0
WORKDIR /app

# Keep only the backend and the workspace packages it uses (@repo/db, @repo/scoring, ...).
FROM base AS prune
COPY . .
RUN npx --yes turbo@2.11.9 prune backend --docker

# Build: full install, generate the Prisma client (it is git-ignored; generating needs no
# database), then bundle with tsup. Also the image for one-off database commands
# (`docker compose run --rm migrate`), since it has the Prisma CLI.
FROM base AS build
COPY --from=prune /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=prune /app/out/full/ .
RUN pnpm --filter @repo/db db:generate && pnpm --filter backend build

# Runtime dependencies only, installed fresh so no build tools come along.
FROM base AS deps
COPY --from=prune /app/out/json/ .
RUN pnpm install --frozen-lockfile --prod

FROM node:24-alpine AS run
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps --chown=node:node /app ./
COPY --from=build --chown=node:node /app/apps/backend/dist ./apps/backend/dist
USER node
WORKDIR /app/apps/backend
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:4000/health || exit 1
CMD ["node", "dist/index.js"]
