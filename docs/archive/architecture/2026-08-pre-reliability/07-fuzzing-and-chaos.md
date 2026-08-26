# Chapter 07: Chaos Fault Injection

[← Previous: 06. Telemetry & Reporting](06-telemetry-and-reporting.md) | [Architecture Index](README.md) | [Next: 08. Binary Terminal Streaming →](08-binary-terminal-streaming.md)

## 1. Boundary

The maintained chaos subsystem schedules explicit faults against a running container and records operational observations. It does not mutate scenario source, fabricate agent executions, or assign empirical model-quality scores.

## 2. Fault Scheduling

[`src/chaos/chaos-engine.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/chaos/chaos-engine.ts) validates a chaos plan and coordinates [`src/chaos/fault-injector.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/chaos/fault-injector.ts). Supported injections include network delay or loss, process pause, resource pressure, and signals.

```text
validated fault plan
        |
        v
scheduled injection
        |
        v
container observation
        |
        v
diagnostic event record
```

Fault observations are operational diagnostics. They cannot be converted into benchmark pass, rank, winner, rating, regression, or resilience claims without the same persisted evidence and authority checks used by ordinary runs.

## 3. Safety Rules

- A plan must target an explicit managed container.
- Fault timing and duration must be finite and validated.
- Cleanup restores injected state even after an interrupted schedule.
- Diagnostic output preserves the configured fault and observed lifecycle facts.
- An empty or simulated observation does not imply successful recovery.

## 4. Module Reference

- [`src/chaos/chaos-engine.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/chaos/chaos-engine.ts): validates plans and coordinates fault schedules.
- [`src/chaos/fault-injector.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/chaos/fault-injector.ts): applies and removes container faults.
- [`src/chaos/types.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/chaos/types.ts): fault plan and diagnostic observation contracts.

## 5. Automated Fault Scenarios Summary

Automated fault schedules remain diagnostic until their container target, timing, cleanup, and observed lifecycle are verified. The schedule itself does not establish recovery quality or benchmark eligibility.

[← Previous: 06. Telemetry & Reporting](06-telemetry-and-reporting.md) | [Architecture Index](README.md) | [Next: 08. Binary Terminal Streaming →](08-binary-terminal-streaming.md)
