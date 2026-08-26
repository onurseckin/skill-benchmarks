# Testbed Delivery

[Maintainer verification](verification.md) | [Usage guide](../README.md) | [Testbed source guide](../../../testbed/README.md)

The testbed is an optional polyglot target for delivery verification. It is not required for the fake-first consumer run. Local testbed work requires Bun and Go; container delivery also requires Docker.

## Install, typecheck, and build

Run from the repository root:

```bash
bun install --cwd testbed --frozen-lockfile
bun run --cwd testbed typecheck
bun run --cwd testbed build
```

All generated output is written below `testbed/dist/`. The build produces the frontend bundle, backend bundle, Bun supervisor, and finite Go executable.

## Start locally

```bash
bun run --cwd testbed start
```

The supervisor starts the frontend on port 3000 and the backend on port 4000. The Go program runs as a finite workload and does not bind a port.

Check the read-only routes:

```bash
curl --fail http://127.0.0.1:3000/health
curl --fail http://127.0.0.1:4000/health
curl --fail http://127.0.0.1:4000/api/items
```

Stop with `Ctrl-C` or send the supervisor `SIGTERM`. It forwards shutdown to the frontend and backend it owns.

## Configure addresses

`FRONTEND_HOST`, `FRONTEND_PORT`, `BACKEND_HOST`, and `BACKEND_PORT` select bind addresses and ports. `READINESS_HOST` selects the host used by supervisor readiness checks and defaults to `127.0.0.1`.

Use unbracketed IPv6 values such as `::1`; the supervisor brackets them when building URLs.

## Build and run the container

```bash
docker build -t skill-benchmarks-testbed:local testbed
docker run --rm \
  --name skill-benchmarks-testbed \
  -p 3000:3000 \
  -p 4000:4000 \
  skill-benchmarks-testbed:local
```

The runtime image contains built artifacts, runs as user `bun`, and exposes only ports 3000 and 4000. Use the same three routes, then stop with `Ctrl-C` or:

```bash
docker stop skill-benchmarks-testbed
```

There is no Go HTTP service or port 8080.
