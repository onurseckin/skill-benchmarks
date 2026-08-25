import { createBackendServer } from "./server.js";

export * from "./types.js";
export * from "./routes/api.js";
export * from "./routes/files.js";
export * from "./services/store.js";
export * from "./utils/merge.js";
export * from "./server.js";

const server = createBackendServer(4000);
server.start();
