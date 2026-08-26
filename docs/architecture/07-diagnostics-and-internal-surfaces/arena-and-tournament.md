# Arena and Tournament

[Book index](../README.md) | [Part index](README.md) | [Next: chaos](chaos.md)

**Status:** planned or simulated diagnostics; unranked.

Arena admission resolves one scenario, one skill, and two models. A dry run emits a planned pairing without candidate execution. Fake candidate execution uses the common sweep but returns diagnostic provenance. Tournament planning creates round-robin pairings or the first Swiss round and planned byes; later Swiss rounds remain unplanned when results are unavailable.

## Source anchors

[`src/cli/commands/arena.ts`](../../../src/cli/commands/arena.ts), [`src/runner/arena-runner.ts`](../../../src/runner/arena-runner.ts), [`src/cli/commands/tournament.ts`](../../../src/cli/commands/tournament.ts), [`src/runner/tournament-planner.ts`](../../../src/runner/tournament-planner.ts), and [`src/runner/tournament-scheduler.ts`](../../../src/runner/tournament-scheduler.ts).

## Limitations

There is no winner, confidence, judge, Elo, standings, rating, champion, or live comparison claim. The consumer behavior is defined in the [usage guide](../../usage-guide/interactive-features/arena-debates.md).
