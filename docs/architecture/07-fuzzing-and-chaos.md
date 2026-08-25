# Chapter 07: Scenario Fuzzing & Chaos Engineering

[← Previous: 06. Telemetry & Reporting](06-telemetry-and-reporting.md) | [Architecture Index](README.md) | [Next: 08. Binary Terminal Streaming →](08-binary-terminal-streaming.md)

---

## 1. Scenario Fuzzing & AST Mutation

To evaluate how robust agents are against unpredictable, malformed, or hostile inputs, the **Fuzzer Engine** ([`src/fuzzer/fuzzer-engine.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/fuzzer/fuzzer-engine.ts)) programmatically mutates scenario codebases and specifications via AST transforms in [`src/fuzzer/mutator.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/fuzzer/mutator.ts).

```
                      ┌────────────────────────────┐
                      │    CANONICAL SCENARIO      │
                      │  (Spec, Test Files, Code)  │
                      └─────────────┬──────────────┘
                                    │
                                    ▼
                      ┌────────────────────────────┐
                      │    AST MUTATION ENGINE     │
                      │   (src/fuzzer/mutator.ts)  │
                      └─────────────┬──────────────┘
                                    │
         ┌──────────────────────────┼──────────────────────────┐
         ▼                          ▼                          ▼
┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
│ IDENTIFIER FUZZ  │       │ BOUNDARY FUZZ    │       │ SYNTAX FAULT     │
│ • Typo injection │       │ • Off-by-one ints│       │ • Missing braces │
│ • Case mangling  │       │ • Max safe integer│      │ • Invalid imports│
│ • Unicode homoglyphs     │ • Null/undefined │       │ • Malformed JSON │
└──────────────────┘       └──────────────────┘       └──────────────────┘
```

---

## 2. Chaos Fault Injection Engine

The **Chaos Engine** ([`src/chaos/chaos-engine.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/chaos/chaos-engine.ts)) simulates real-world infrastructure failures and hostile environments during agent execution via [`src/chaos/fault-injector.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/chaos/fault-injector.ts):

```
+-------------------------------------------------------------------------------+
|                       CHAOS FAULT INJECTION TAXONOMY                          |
+-------------------------------------------------------------------------------+
| FAULT TYPE           | INJECTION MECHANISM         | TARGET IMPACT            |
+----------------------+-----------------------------+--------------------------+
| `NETWORK_LATENCY`    | `tc qdisc add netem delay`  | Injects 50-500ms jitter  |
|                      |                             | on host-container bridge |
+----------------------+-----------------------------+--------------------------+
| `PACKET_LOSS`        | `tc qdisc add netem loss`   | Drops 10-30% of packets  |
|                      |                             | to test retry resilience |
+----------------------+-----------------------------+--------------------------+
| `PROCESS_FREEZE`     | `kill -SIGSTOP <pid>`       | Suspends process to test |
|                      |                             | agent timeout handling   |
+----------------------+-----------------------------+--------------------------+
| `PROCESS_KILL`       | `kill -SIGKILL <pid>`       | Abrupt process death to  |
|                      |                             | test state recovery      |
+----------------------+-----------------------------+--------------------------+
| `RESOURCE_OOM`       | Dynamic `memory.max` write  | Starves container RAM,   |
|                      | to cgroups v2 controller    | triggering kernel OOM    |
+----------------------+-----------------------------+--------------------------+
| `DISK_PRESSURE`      | Fills ephemeral workspace   | Triggers ENOSPC on write |
|                      | with dummy zero-byte files  | operations               |
+----------------------+-----------------------------+--------------------------+
```

---

## 3. Resilience Metrics & Degradation Scoring

Agent resilience under chaos is quantified through three standardized indices ([`src/chaos/types.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/chaos/types.ts)):

1. **Recovery Rate ($R_{\text{rec}}$)**:
   The proportion of injected faults where the agent successfully detected the failure, initiated a remediation action, and completed the task:
   $$R_{\text{rec}} = \frac{N_{\text{recovered}}}{N_{\text{injected}}}$$

2. **Degradation Slope ($\Delta S$)**:
   The percentage drop in benchmark pass rate under chaos relative to the pristine baseline:
   $$\Delta S = \frac{\text{Pass}_{\text{baseline}} - \text{Pass}_{\text{chaos}}}{\text{Pass}_{\text{baseline}}}$$

3. **Recovery Time Objective (RTO)**:
   The median wall-clock time in milliseconds between fault injection and the agent's first corrective tool execution.

---

## 4. Chaos & Fuzzing Module Reference

- [`src/chaos/chaos-engine.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/chaos/chaos-engine.ts): Chaos experiment orchestrator and scheduler.
- [`src/chaos/fault-injector.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/chaos/fault-injector.ts): Kernel fault injection primitives (`tc netem`, signals, cgroups OOM).
- [`src/fuzzer/fuzzer-engine.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/fuzzer/fuzzer-engine.ts): AST mutator runner.
- [`src/fuzzer/mutator.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/fuzzer/mutator.ts): TypeScript AST mutation transformers.

---

[← Previous: 06. Telemetry & Reporting](06-telemetry-and-reporting.md) | [Architecture Index](README.md) | [Next: 08. Binary Terminal Streaming →](08-binary-terminal-streaming.md)
