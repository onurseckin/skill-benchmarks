# Adapter Contract

[Book index](../README.md) | [Part index](README.md) | [Next: live readiness](live-readiness.md)

**Status:** Implemented & public

The fake adapter is implemented and public through `run`; live adapters are implemented but internally bounded.

The factory resolves a provider adapter from the admitted provider/model/mode. Fake mode always produces `MockProviderAdapter`. Live Anthropic, Google, and OpenAI selection preflights configured credentials before construction; unsupported custom live construction fails.

The normalized adapter contract accepts messages, tools, and generation options, then returns turns or chunks with token usage.

## Source anchors

[`src/providers/factory.ts`](../../../src/providers/factory.ts), [`src/providers/types.ts`](../../../src/providers/types.ts), [`src/providers/anthropic.ts`](../../../src/providers/anthropic.ts), [`src/providers/gemini.ts`](../../../src/providers/gemini.ts), and [`src/providers/openai.ts`](../../../src/providers/openai.ts).

## Limitations

The adapter contract is not a promise that every provider wire envelope, retry, cancellation, or stream is currently equivalent.
