# syntax=docker/dockerfile:1
# frontend - OpenMaps React + Vite web application
# Runtime config.json is generated at startup via docker-entrypoint.sh
#
# Stages:
#   deps     Node, pnpm and node_modules for the lockfile (needs the network:
#            npm registry). Tagged openmaps-frontend-deps:<arch>, the build
#            toolchain for offline rebuilds; it also runs the unit tests
#            (tsc, vitest, eslint).
#   builder  deps + the source, built with Vite
#   base     nginx + Node (for the runtime config) without the app. Tagged
#            openmaps-frontend-base:<arch> so an offline rebuild can lay the
#            built app on top with no network.
#   runtime  base + the built app, its entrypoint and the nginx config (the
#            default target; what compose builds)

ARG NODE_VERSION=22
ARG NGINX_VERSION=1.27-alpine
ARG TARGETARCH

# =============================================================================
# Stage 1: Deps - Node, pnpm and node_modules (openmaps-frontend-deps:<arch>)
# =============================================================================
# No --platform=$BUILDPLATFORM: this stage is also the toolchain for offline
# rebuilds, so it must be the target's architecture — node_modules carries
# native binaries (esbuild, rollup, lightningcss, the Tailwind engine).
FROM node:${NODE_VERSION}-slim AS deps

# Enable pnpm via corepack
RUN corepack enable

WORKDIR /build

# Copy package files first for layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install all dependencies (including devDependencies needed for build)
RUN pnpm install --frozen-lockfile

# corepack fetched pnpm (package.json "packageManager") during the install and
# keeps it cached in the image; never fetch again, so builds work offline.
ENV COREPACK_ENABLE_NETWORK=0

# =============================================================================
# Stage 2: Builder - build static assets with Vite (includes TypeScript check)
# =============================================================================
FROM deps AS builder

# Copy source code (.dockerignore keeps node_modules and dist out)
COPY . .

RUN pnpm build

# =============================================================================
# Stage 3: Base - nginx + Node without the app (openmaps-frontend-base:<arch>)
# =============================================================================
FROM nginx:${NGINX_VERSION} AS base

ARG TARGETARCH

LABEL maintainer="openmaps" \
      service="frontend" \
      arch="${TARGETARCH}"

# Install Node.js (needed by docker-entrypoint.sh for runtime config generation)
RUN apk add --no-cache nodejs

# Remove default nginx config and content
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/default.conf

# Create directories needed by entrypoint and set ownership for non-root
RUN mkdir -p /usr/share/nginx/html/static \
             /usr/share/nginx/html/client \
             /usr/share/nginx/html/client/static \
             /app \
    && chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/log/nginx /app \
    && touch /var/run/nginx.pid \
    && chown nginx:nginx /var/run/nginx.pid

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]

# Switch to non-root user
USER nginx

# =============================================================================
# Stage 4: Runtime - base + the built app (the default target)
# =============================================================================
# Dockerfile.offline ends with the same four COPY lines; keep them in step.
FROM base AS runtime

# The built app, owned by nginx so the entrypoint can write config.json into it
COPY --from=builder --chown=nginx:nginx /build/dist /usr/share/nginx/html

# Entrypoint and config generation script (runtime config.json is produced by
# scripts/generate-config.cjs; docker-entrypoint.sh is executable in git)
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY scripts/generate-config.cjs /usr/local/bin/scripts/generate-config.cjs

# Nginx config: serve static files, SPA fallback, runtime config.json, and
# proxy /api/ and /tiles/ (see nginx/default.conf)
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
