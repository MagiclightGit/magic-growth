FROM node:24-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/agent/package.json packages/agent/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
RUN pnpm --filter @guangmo/api deploy --legacy --prod /out/api \
 && pnpm --filter @guangmo/worker deploy --legacy --prod /out/worker
RUN test -f /out/api/dist/main.js \
 && test -f /out/api/node_modules/@guangmo/database/dist/migrate.js \
 && test -d /out/api/node_modules/@guangmo/database/drizzle/meta \
 && test -f /out/worker/dist/main.js \
 && test -f /out/worker/node_modules/@guangmo/agent/dist/index.js

FROM node:24-bookworm-slim AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/api .
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]

FROM node:24-bookworm-slim AS worker
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/worker .
USER node
CMD ["node", "dist/main.js"]

FROM caddy:2-alpine AS web
COPY --from=build /workspace/apps/web/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
