import { appendFile } from "node:fs/promises";

export async function initializeEventArtifactFiles(eventsPath: string, rawLogPath: string): Promise<void> {
  await Promise.all([
    appendFile(eventsPath, "", "utf8"),
    appendFile(rawLogPath, "", "utf8"),
  ]);
}
