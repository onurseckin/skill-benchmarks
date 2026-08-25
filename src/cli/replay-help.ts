export function getReplayHelpText(): string {
  return [
    "Usage:",
    "  skill-benchmarks replay <events.jsonl|replay.json> [options]",
    "",
    "Description:",
    "  Read and render validated persisted execution evidence.",
    "",
    "Options:",
    "  --run-id <id>            Canonical persisted run ID",
    "  --db <path>               Existing benchmark database for run lookup",
    "  --output-dir <path>       Canonical benchmark output root",
    "  -f, --format <format>     Replay format: tui, json, html",
    "  -o, --output <path>       Derived JSON or HTML output path",
    "  --speed <number>          TUI replay speed",
    "  -h, --help                Show help for replay command",
    "",
    "Examples:",
    "  skill-benchmarks replay ./events.jsonl --format json --output ./replay.json",
    "  skill-benchmarks replay --run-id run-123 --db ./db/benchmarks.sqlite --output-dir ./artifacts",
  ].join("\n");
}
