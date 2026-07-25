# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS dependencies

WORKDIR /workspace

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json

RUN npm ci

FROM dependencies AS build

COPY apps/web apps/web
COPY apps/server apps/server

RUN npm run build --workspace @skillconsole/web
RUN npm run build --workspace @skillconsole/server

FROM ${NODE_IMAGE} AS production

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

EXPOSE 3000

CMD ["npm", "run", "start", "--workspace", "@skillconsole/server"]
