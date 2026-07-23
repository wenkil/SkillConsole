# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS dependencies

ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"

RUN corepack enable && corepack prepare pnpm@11.9.0 --activate

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages packages

RUN pnpm install --frozen-lockfile

FROM dependencies AS build

COPY apps/web apps/web
COPY apps/server apps/server

RUN pnpm --filter @skillconsole/web build
RUN pnpm --filter @skillconsole/server build

FROM ${NODE_IMAGE} AS production

ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"
ENV HOST=0.0.0.0
ENV PORT=3000
ENV STATIC_ROOT=/workspace/apps/web/dist

RUN corepack enable && corepack prepare pnpm@11.9.0 --activate

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY packages packages

RUN pnpm --filter @skillconsole/server install --prod --frozen-lockfile

COPY --from=build /workspace/apps/server/dist apps/server/dist
COPY --from=build /workspace/apps/web/dist apps/web/dist

EXPOSE 3000

CMD ["pnpm", "--filter", "@skillconsole/server", "start"]
