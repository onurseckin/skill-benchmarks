FROM oven/bun:1.3.14-alpine AS bun-builder
WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/
RUN bun install --frozen-lockfile

COPY scripts/ ./scripts/
COPY frontend/ ./frontend/
COPY backend/ ./backend/
RUN bun run build:frontend && bun run build:backend && bun run build:supervisor

FROM golang:1.22-alpine AS go-builder
WORKDIR /app/microservice
COPY microservice/go.mod ./
COPY microservice/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/dist/microservice .

FROM oven/bun:1.3.14-alpine AS runtime
WORKDIR /app

COPY --from=bun-builder --chown=bun:bun /app/dist ./dist
COPY --from=go-builder --chown=bun:bun /app/dist/microservice ./dist/microservice

ENV NODE_ENV=production
EXPOSE 3000 4000
USER bun

CMD ["bun", "run", "dist/start.js"]
