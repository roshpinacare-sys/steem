# TFA Sovereign — Production Container Image
# Node 24+ provides native TypeScript execution via --experimental-strip-types
# (or built-in in v24). Zero build step, zero external runtime dependencies.

FROM node:24-slim

# Install curl for Docker HEALTHCHECK (no other runtime deps).
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy entire repo (honours .dockerignore).
COPY . .

# Production mode: fail-closed boot if persistence config is incomplete.
ENV NODE_ENV=production
ENV PORT=7700

# Expose the HTTP port (must match PORT and docker-compose service port).
EXPOSE 7700

# Docker-native healthcheck — polls the liveness endpoint.
# Fails fast (1s timeout) so orchestrators react quickly to dead containers.
# Interval 10s aligns with typical Kubernetes livenessProbe defaults.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -fsS http://localhost:7700/healthz || exit 1

# Start the sovereign server directly (Node strip-types, zero compilation).
# The entry point wires graceful shutdown on SIGTERM/SIGINT and exits 0.
CMD ["node", "src/http/sovereign-server.ts"]
