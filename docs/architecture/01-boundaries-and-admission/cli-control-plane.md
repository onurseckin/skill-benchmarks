# CLI Control Plane

[Book index](../README.md) | [Part index](README.md) | [Previous: catalog admission](catalog-and-admission.md) | [Next part: execution](../02-execution-and-artifacts/README.md)

**Status:** Implemented & public

The CLI control plane is implemented and public.

`runCli` parses one grammar specification, dispatches the supported handlers, buffers normal output, and emits safe diagnostic codes on failures. The public executable is `bin/skill-benchmarks`; commands are `run`, `arena`, `tournament`, `report`, `list`, `replay`, `help`, and `version`.

The grammar, help renderer, parser, and handlers share one source of command truth.

## Source anchors

[`src/cli/index.ts`](../../../src/cli/index.ts), [`src/cli/grammar/specification.ts`](../../../src/cli/grammar/specification.ts), [`src/cli/parser.ts`](../../../src/cli/parser.ts), and [`bin/skill-benchmarks`](../../../bin/skill-benchmarks).

## Limitations

Use the [CLI command reference](../../usage-guide/cli-reference/commands.md) for flags and examples. Source modules do not create extra public commands.
