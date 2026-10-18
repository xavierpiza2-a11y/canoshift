# syntax=docker/dockerfile:1
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Copy dependency files
COPY package.json bun.lock* ./

# Install all dependencies with Bun (ultra-rapide, sans conflit)
RUN bun install --frozen-lockfile || bun install

# Copy application source code
COPY . .

# Build Vite frontend bundle
RUN bun run build

# ----------------------------------------------------------------------------
# Production Runner
# ----------------------------------------------------------------------------
FROM oven/bun:1-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy package definitions and install only production dependencies
COPY package.json bun.lock* ./
RUN bun install --production

# Copy built frontend assets
COPY --from=builder /app/dist ./dist

# Copy backend server files
COPY server.ts ./
COPY src/server ./src/server
COPY src/config ./src/config
COPY src/types ./src/types

# Create persistent storage directory for planning database
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["bun", "run", "server.ts"]
