import { ApiHandler } from "./routes/api.js";

export function createBackendServer(port = 4000): {
  readonly start: () => void;
  readonly stop: () => void;
  readonly handler: ApiHandler;
} {
  const handler = new ApiHandler();

  return {
    start: (): void => {
      void port;
    },
    stop: (): void => {
      void port;
    },
    handler,
  };
}
