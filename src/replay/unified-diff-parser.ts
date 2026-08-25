import type { DiffChangeType, DiffDelta } from "./types.js";

export function parseUnifiedDiff(rawDiff: string): readonly DiffDelta[] {
  if (rawDiff.trim().length === 0) return [];
  const deltas: DiffDelta[] = [];
  const lines = rawDiff.split("\n");
  let currentPath = "";
  let changeType: DiffChangeType = "modified";
  let insertions = 0;
  let deletions = 0;
  const hunks: string[] = [];
  const publish = (): void => {
    if (currentPath.length === 0) return;
    deltas.push({
      path: currentPath,
      changeType,
      insertions,
      deletions,
      ...(hunks.length === 0 ? {} : { diffHunk: hunks.join("\n") }),
    });
  };
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      publish();
      const parts = line.split(" ");
      currentPath = cleanDiffPath(parts[3] ?? parts[2] ?? "");
      changeType = "modified";
      insertions = 0;
      deletions = 0;
      hunks.length = 0;
    } else if (line.startsWith("new file mode")) {
      changeType = "added";
    } else if (line.startsWith("deleted file mode")) {
      changeType = "deleted";
    } else if (line.startsWith("rename to ")) {
      currentPath = line.slice(10).trim();
      changeType = "renamed";
    } else if (line.startsWith("+++ b/")) {
      currentPath = line.slice(6).trim();
    } else if (line.startsWith("--- a/")) {
      if (currentPath.length === 0) currentPath = line.slice(6).trim();
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      insertions += 1;
      hunks.push(line);
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deletions += 1;
      hunks.push(line);
    } else if (line.startsWith("@@") || line.startsWith(" ")) {
      hunks.push(line);
    }
  }
  publish();
  return deltas;
}

function cleanDiffPath(value: string): string {
  if (value.startsWith("a/") || value.startsWith("b/")) return value.slice(2);
  return value;
}
