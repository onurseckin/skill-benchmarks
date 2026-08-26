# Unified Full-Stack Target Testbed

High-throughput, polyglot benchmark target testbed designed for automated evaluation of coding and debugging agent skills.

## Architecture

1. **Frontend (`frontend/`)**: React 19 single-page application with intentional accessibility defects (missing ARIA attributes, low-contrast color palettes, broken keyboard navigation focus rings) and memory leak patterns (unbounded event listeners and timer accumulation).
2. **Backend API (`backend/`)**: TypeScript REST API service with intentional prototype pollution in recursive merge utilities and path traversal defects in file storage route handlers.
3. **Microservice (`microservice/`)**: Concurrent Go event worker microservice with intentional channel race conditions and mutex acquisition deadlock hazards.
4. **Container Manifest (`Dockerfile`, `package.json`)**: Multi-stage container build packaging Node.js, Bun, and Go runtimes into a unified evaluation environment.

## Requirements

- Bun 1.3.14
- Go 1.22 or newer for local builds
- Docker for container delivery

## Local delivery

Install exactly the locked dependency graph, typecheck, build, and start:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run build
bun run start
```

Run these commands from `testbed/`. The build writes only to `testbed/dist/`. The supervisor starts the built frontend on port 3000 and the backend on port 4000. It also runs the Go microservice as a finite workload; the Go program does not bind a network port.

Verify the nonmutating readiness routes:

```bash
curl --fail http://127.0.0.1:3000/health
curl --fail http://127.0.0.1:4000/health
curl --fail http://127.0.0.1:4000/api/items
```

Stop the supervisor with `Ctrl-C` or send it `SIGTERM`. The supervisor forwards the signal to its running children, waits up to three seconds, and force-stops only children it created.

The bind addresses and ports can be set with `FRONTEND_HOST`, `FRONTEND_PORT`, `BACKEND_HOST`, and `BACKEND_PORT`. `READINESS_HOST` selects the address used by the supervisor readiness checks and defaults to `127.0.0.1`.

## Component commands

After `bun run build`, start either network service from its workspace:

```bash
bun run --cwd frontend start
bun run --cwd backend start
```

Run the finite Go workload directly:

```bash
./dist/microservice
```

## Container delivery

Build and start the artifact-only, non-root image:

```bash
docker build -t skill-benchmarks-testbed:local .
docker run --rm --name skill-benchmarks-testbed -p 3000:3000 -p 4000:4000 skill-benchmarks-testbed:local
```

Use the same three readiness routes on `127.0.0.1`. Stop with `Ctrl-C` or:

```bash
docker stop skill-benchmarks-testbed
```
