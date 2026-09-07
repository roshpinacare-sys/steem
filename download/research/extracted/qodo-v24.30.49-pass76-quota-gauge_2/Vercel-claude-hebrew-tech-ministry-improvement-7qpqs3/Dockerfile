FROM node:20-slim AS base

# ── Build stage ──────────────────────────────────────────────────────────────
FROM base AS builder

WORKDIR /app

# Install build tools for native modules (ts-morph, onnxruntime)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy manifests first — layer-cache friendly
COPY package*.json ./
COPY packages/agent/package*.json ./packages/agent/
COPY apps/mission-control/package*.json ./apps/mission-control/

# Install all deps (including devDeps needed for build)
RUN npm ci --prefer-offline

# Copy source and build
COPY . .
RUN npm run build --workspace packages/agent

# ── Production stage ─────────────────────────────────────────────────────────
FROM base AS production

WORKDIR /app

ENV NODE_ENV=production

# Only install production deps
COPY package*.json ./
COPY packages/agent/package*.json ./packages/agent/
RUN npm ci --omit=dev --prefer-offline && npm cache clean --force

# Copy compiled artefacts from builder. (The mission-control frontend is a
# static Vite bundle deployed separately — nothing in this image serves it.)
COPY --from=builder /app/packages/agent/dist ./packages/agent/dist

# Non-root user for security
RUN addgroup --system --gid 1001 qodo && \
    adduser  --system --uid 1001 --ingroup qodo qodo
USER qodo

# This image runs a one-shot batch CLI: it exposes no ports, and the previous
# HEALTHCHECK (node -e "process.exit(0)") could never fail — both removed as
# they misrepresented the process model.
ENTRYPOINT ["node", "packages/agent/dist/cli.js"]
