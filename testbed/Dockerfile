FROM golang:1.22-alpine AS go-builder
WORKDIR /app
COPY microservice/go.mod ./
COPY microservice/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/bin/microservice main.go

FROM oven/bun:1.3.14-alpine AS base
WORKDIR /app

COPY package.json ./
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/

COPY frontend/ ./frontend/
COPY backend/ ./backend/
COPY --from=go-builder /app/bin/microservice ./bin/microservice

EXPOSE 3000 4000 8080
ENV NODE_ENV=production

CMD ["bun", "run", "start"]
