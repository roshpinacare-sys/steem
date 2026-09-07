# ============================================================
# ECOS API Server — V97 Production Dockerfile
# ============================================================
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
# [V145] Health check — used by Docker, Render, Railway, Fly.io, ECS
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3   CMD node -e "require('http').get('http://localhost:3000/api/v1/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"
CMD ["node", "ecos-api-server.js"]
