# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS runtime-base

# Keep common document and command-line tooling available to every Agent role.
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

FROM dependencies AS build

COPY apps/web apps/web
COPY apps/server apps/server
COPY agent-prompts agent-prompts

RUN npm run build --workspace @skillconsole/web
RUN npm run build --workspace @skillconsole/server

FROM runtime-base AS production

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV STATIC_ROOT=/workspace/apps/web/dist

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json

RUN npm ci --omit=dev --workspace @skillconsole/server

COPY --from=build /workspace/apps/server/dist apps/server/dist
COPY --from=build /workspace/apps/web/dist apps/web/dist
COPY apps/server/config apps/server/config
COPY apps/server/resources apps/server/resources
COPY agent-prompts agent-prompts

RUN mkdir -p /workspace/var \
  && chown -R node:node /workspace/var

EXPOSE 3000

CMD ["npm", "run", "start", "--workspace", "@skillconsole/server"]
