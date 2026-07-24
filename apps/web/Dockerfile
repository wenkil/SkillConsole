# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:22-bookworm-slim
ARG NGINX_IMAGE=nginx:1.29-alpine

FROM ${NODE_IMAGE} AS development

WORKDIR /workspace

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json

RUN npm ci

COPY apps/web apps/web

EXPOSE 5173

CMD ["npm", "run", "dev", "--workspace", "@skillconsole/web"]

FROM development AS build

RUN npm run build --workspace @skillconsole/web

FROM ${NGINX_IMAGE} AS production

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html

EXPOSE 8080
