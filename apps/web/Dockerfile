# syntax=docker/dockerfile:1.7

# ---- Build stage ----
# The bundle is the same on every architecture: build it once, on the
# builder's own platform. Emulating arm64 made the release build take hours.
FROM --platform=$BUILDPLATFORM node:22.23.4-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 AS build
WORKDIR /app
ENV NODE_OPTIONS=--max-old-space-size=1536

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Copy monorepo manifests for better caching
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
COPY libs/shared/package.json libs/shared/package.json

# Install dependencies (Hoisted with pnpm)
RUN pnpm install --frozen-lockfile

# Build shared (required by web)
WORKDIR /app/libs/shared
COPY libs/shared/ ./
RUN pnpm build

# Build web app
# VITE_API_BASE_URL is baked into the bundle. By default it is a placeholder
# replaced at container start from API_PUBLIC_URL (see docker/), so the same
# image works for any deployment.
ARG VITE_API_BASE_URL="__OPENATHLETE_API_BASE_URL__"
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_SOURCE_CODE_URL=__OPENATHLETE_SOURCE_CODE_URL__

WORKDIR /app/apps/web
COPY apps/web/ ./
RUN pnpm build

# ---- Runtime stage ----
FROM nginx:alpine@sha256:fed7e14be83cbd2661a75cdc5b872d936cf155d46c327084d30b8df19ae88d72 AS runtime
ARG SOURCE_CODE_URL=__OPENATHLETE_SOURCE_CODE_URL__

# Copy built assets
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

# Copy nginx configuration
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

# Run by the nginx image entrypoint before nginx starts
COPY --chmod=755 apps/web/docker/40-api-public-url.sh /docker-entrypoint.d/40-api-public-url.sh
COPY --chmod=755 apps/web/docker/50-source-code-url.sh /docker-entrypoint.d/50-source-code-url.sh

# Set by the deployment at runtime; the entrypoint updates only index.html.
ENV SOURCE_CODE_URL=$SOURCE_CODE_URL

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

