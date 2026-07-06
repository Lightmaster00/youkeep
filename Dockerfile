# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

# Install compilation dependencies for better-sqlite3 native build on Alpine
RUN apk add --no-cache python3 ffmpeg build-base

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine
WORKDIR /app

# Install runtime dependencies for yt-dlp & video/audio operations plus su-exec
RUN apk add --no-cache python3 ffmpeg curl su-exec

COPY --from=builder /app/.output ./.output
COPY --from=builder /app/package.json ./package.json
COPY entrypoint.sh ./entrypoint.sh

RUN chmod +x ./entrypoint.sh

ENV PORT=3000
ENV HOST=0.0.0.0
ENV NODE_ENV=production

EXPOSE 3000

ENTRYPOINT ["/bin/sh", "./entrypoint.sh"]
