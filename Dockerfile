# Build stage
FROM node:24-alpine AS builder
WORKDIR /app

# Install compilation dependencies for better-sqlite3 native build on Alpine
RUN apk add --no-cache python3 ffmpeg build-base

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production stage
FROM node:24-alpine
WORKDIR /app

# Install runtime dependencies for yt-dlp & video/audio operations plus su-exec
# tini runs as PID 1: it forwards signals to node and reaps orphaned
# yt-dlp/ffmpeg children (node as PID 1 leaves them as zombies).
RUN apk add --no-cache python3 ffmpeg curl su-exec tini

COPY --from=builder /app/.output ./.output
COPY --from=builder /app/package.json ./package.json
COPY entrypoint.sh ./entrypoint.sh

RUN chmod +x ./entrypoint.sh

ENV PORT=3000
ENV HOST=0.0.0.0
ENV NODE_ENV=production

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/auth/setup-status" >/dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/bin/sh", "./entrypoint.sh"]
