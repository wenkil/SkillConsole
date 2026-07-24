# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS dependencies

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

FROM ${NODE_IMAGE} AS production

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json

RUN npm ci --omit=dev --workspace @skillconsole/server

COPY --from=build /workspace/apps/server/dist apps/server/dist
COPY apps/server/migrations apps/server/migrations

EXPOSE 3000

CMD ["npm", "run", "start", "--workspace", "@skillconsole/server"]

FROM production AS migration

CMD ["npm", "run", "migrate", "--workspace", "@skillconsole/server"]
