# Web Streaming Is Unavailable

[Usage guide](../README.md) | [Replay](tui-player.md) | [CLI reference](../cli-reference/commands.md)

The public CLI has no server, live-stream, event-stream, web-tunnel, or terminal-tunnel command. Do not use source modules as consumer entry points.

For current supported presentation, use:

- `report --format html --output <path>` for a static HTML report
- `replay --format html --output <path>` for a static HTML replay
- `replay --format tui` for interactive terminal playback

These commands read persisted evidence; they do not provide live web streaming.
