# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS runtime-base

# Skills may declare Python/Pandoc-backed transformations. Keep the development,
# migration, and production server images on the same explicit capability set.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python-is-python3 pandoc bubblewrap socat \
  && rm -rf /var/lib/apt/lists/*

COPY apps/server/docker-entrypoint.sh /usr/local/bin/skillconsole-entrypoint
RUN chmod 0755 /usr/local/bin/skillconsole-entrypoint

ENTRYPOINT ["/usr/local/bin/skillconsole-entrypoint"]

FROM runtime-base AS dependencies

WORKDIR /workspace

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json

RUN npm ci

FROM dependencies AS development

ENV NODE_ENV=development
ENV HOST=0.0.0.0
ENV PORT=3000

COPY apps/server apps/server

EXPOSE 3000

CMD ["npm", "run", "dev", "--workspace", "@skillconsole/server"]

FROM dependencies AS build

COPY apps/server apps/server

RUN npm run build --workspace @skillconsole/server

FROM runtime-base AS production

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json

RUN npm ci --omit=dev --workspace @skillconsole/server

COPY --from=build /workspace/apps/server/dist apps/server/dist
COPY apps/server/migrations apps/server/migrations
COPY apps/server/config apps/server/config
COPY apps/server/resources apps/server/resources

RUN mkdir -p /workspace/var /home/node/.claude \
  && chown -R node:node /workspace/var /home/node/.claude

EXPOSE 3000

CMD ["npm", "run", "start", "--workspace", "@skillconsole/server"]

FROM production AS migration

CMD ["npm", "run", "migrate", "--workspace", "@skillconsole/server"]
