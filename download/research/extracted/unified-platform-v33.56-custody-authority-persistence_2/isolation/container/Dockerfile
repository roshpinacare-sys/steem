FROM node:22.16.0-bookworm-slim
RUN useradd --create-home --uid 10001 capability
WORKDIR /app
COPY dist/ ./dist/
USER 10001:10001
ENV NODE_ENV=production
ENTRYPOINT ["node", "dist/src/cli/demo.js"]
