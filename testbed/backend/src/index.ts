import { createBackendServer } from "./server.js";

export * from "./types.js";
export * from "./routes/api.js";
export * from "./routes/files.js";
export * from "./services/store.js";
export * from "./utils/merge.js";
export * from "./server.js";

const port = Number(process.env.BACKEND_PORT ?? "4000");
const hostname = process.env.BACKEND_HOST ?? "0.0.0.0";
const server = createBackendServer(port, hostname);
const urlHostname = hostname.includes(":") ? `[${hostname}]` : hostname;

await server.start();
console.log(`Backend ready at http://${urlHostname}:${port}/`);

let stopping = false;

async function stopBackend(signal: NodeJS.Signals): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  console.log(`Backend received ${signal}`);
  await server.stop();
}

process.once("SIGINT", () => {
  void stopBackend("SIGINT");
});
process.once("SIGTERM", () => {
  void stopBackend("SIGTERM");
});
