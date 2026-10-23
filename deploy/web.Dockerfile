# Builds the React app and serves it with Caddy (HTTPS + /api proxy).
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY app/package.json app/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY app ./
ARG VITE_CHAIN_ID=84532
ARG VITE_RPC_URL=https://sepolia.base.org
ARG VITE_WALLETCONNECT_PROJECT_ID=
ARG VITE_PUBLIC_URL=
ENV VITE_API_URL=/api
RUN pnpm build

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
