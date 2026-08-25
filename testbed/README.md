# Unified Full-Stack Target Testbed

High-throughput, polyglot benchmark target testbed designed for automated evaluation of coding and debugging agent skills.

## Architecture

1. **Frontend (`frontend/`)**: React 19 single-page application with intentional accessibility defects (missing ARIA attributes, low-contrast color palettes, broken keyboard navigation focus rings) and memory leak patterns (unbounded event listeners and timer accumulation).
2. **Backend API (`backend/`)**: TypeScript REST API service with intentional prototype pollution in recursive merge utilities and path traversal defects in file storage route handlers.
3. **Microservice (`microservice/`)**: Concurrent Go event worker microservice with intentional channel race conditions and mutex acquisition deadlock hazards.
4. **Container Manifest (`Dockerfile`, `package.json`)**: Multi-stage container build packaging Node.js, Bun, and Go runtimes into a unified evaluation environment.

## Usage

Run services standalone or inside container:

```bash
bun run start:all
```
