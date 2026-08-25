# Chapter 05: Dual-Layer Evaluation & Scoring Engine

[← Previous: 04. Runner & Interceptor](04-runner-and-interceptor.md) | [Architecture Index](README.md) | [Next: 06. Telemetry & Reporting →](06-telemetry-and-reporting.md)

---

## 1. Dual-Layer Evaluation Architecture

Evaluating software engineering agents requires both hard mechanical verification and subtle semantic judgment. **Skill-Benchmarks** implements a **Dual-Layer Evaluation Framework**:

```
+-------------------------------------------------------------------------------+
|                            EVALUATION PIPELINE                                |
+-------------------------------------------------------------------------------+
|                                                                               |
|   AGENT EXECUTION ARTIFACTS (Workspace Diffs, Source Code, Test Logs)         |
|                                     │                                         |
|                                     ▼                                         |
|   ┌───────────────────────────────────────────────────────────────────────┐   |
|   │ LAYER 1: DETERMINISTIC EVALUATOR (src/eval/deterministic.ts)          │   |
|   │ • TypeScript Compiler AST Node Validation                             │   |
|   │ • Invariant Rules (0 Comments, <= 400 Lines, 0 Any Annotations)       │   |
|   │ • Sandboxed Unit & Integration Test Execution Exit Codes              │   |
|   └───────────────────────────────────┬───────────────────────────────────┘   |
|                                       │ Passes Gate / Emits Metric Breakdown  |
|                                       ▼                                       |
|   ┌───────────────────────────────────────────────────────────────────────┐   |
|   │ LAYER 2: MULTI-JUDGE SEMANTIC ARENA (src/eval/llm-judge.ts)           │   |
|   │ • Blind Pairwise Debates (Model A vs. Model B)                        │   |
|   │ • 5-Dimensional Qualitative Rubric Scoring                            │   |
|   │ • Position Bias Inversion & Majority Consensus Filter                 │   |
|   └───────────────────────────────────┬───────────────────────────────────┘   |
|                                       │ Win / Loss / Tie Match Matrix         |
|                                       ▼                                       |
|   ┌───────────────────────────────────────────────────────────────────────┐   |
|   │ BRADLEY-TERRY ELO SOLVER (src/eval/pairwise-elo.ts)                   │   |
|   │ • Iterative Newton-Raphson Maximum Likelihood Estimation (MLE)        │   |
|   │ • Calibrated Skill Ratings (Elo ± Confidence Intervals)               │   |
|   └───────────────────────────────────────────────────────────────────────┘   |
+-------------------------------------------------------------------------------+
```

---

## 2. Layer 1: Deterministic AST & Invariant Grading

The deterministic grading layer ([`src/eval/deterministic.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/eval/deterministic.ts)) analyzes the agent's code diffs using the TypeScript Compiler AST API:

```
+-------------------------------------------------------------------------------+
| AST STATIC VERIFICATION CHECKS                                                |
+-------------------------------------------------------------------------------+
| CHECK                     | PASS CRITERIA                  | AST MATCHER      |
+---------------------------+--------------------------------+------------------+
| No Forbidden Comments     | Zero `//`, `/* */`, JSDoc      | Leading Trivia   |
| Strict File Length        | Total line count <= 400        | Line Map Count   |
| Zero `any` Types          | 0 explicit or implicit `any`   | `ts.SyntaxKind.  |
|                           |                                |  AnyKeyword`     |
| Zero Lint Suppressions    | 0 `@ts-ignore`, `@ts-expect`   | Comment Directive|
| Automated Test Suite      | Process exit code === 0        | Test Runner Exec |
+-------------------------------------------------------------------------------+
```

---

## 3. Layer 2: LLM-as-a-Judge Semantic Rubric

When code compiles and tests pass, semantic quality is judged across five normalized dimensions ([`src/eval/scoring.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/eval/scoring.ts)):

$$\text{Score}_{\text{composite}} = 0.35 \cdot S_{\text{correct}} + 0.25 \cdot S_{\text{robust}} + 0.15 \cdot S_{\text{read}} + 0.15 \cdot S_{\text{sec}} + 0.10 \cdot S_{\text{eff}}$$

```
+-------------------------------------------------------------------------------+
| QUALITATIVE JUDGING DIMENSIONS                                                |
+-------------------------------------------------------------------------------+
| 1. Correctness (35%): Adherence to scenario requirements and edge behaviors.  |
| 2. Robustness (25%): Error handling, recovery paths, and boundary safety.     |
| 3. Readability (15%): Idiomatic code style, naming clarity, modularity.       |
| 4. Security (15%): Absence of injection flaws, memory leaks, unsafe APIs.    |
| 5. Efficiency (10%): Computational complexity and minimal resource overhead.  |
+-------------------------------------------------------------------------------+
```

To eliminate position bias, the judge engine ([`src/judge/judge-engine.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/judge/judge-engine.ts)) executes both forward `(A, B)` and reversed `(B, A)` blind evaluations.

---

## 4. Bradley-Terry Pairwise Elo Solver

Skill-Benchmarks resolves non-transitive pairwise judge outcomes into calibrated numerical Elo ratings via Maximum Likelihood Estimation (MLE) in [`src/eval/pairwise-elo.ts`](file:///Users/onurseckinsenoglu/repos/skill-benchmarks/src/eval/pairwise-elo.ts).

### 4.1 Mathematical Formulation

1. **Pairwise Win Probability**:
   The probability that model $i$ beats model $j$ given latent skill ratings $R_i, R_j$:
   $$P(i > j) = \frac{1}{1 + 10^{(R_j - R_i)/400}} = \frac{\pi_i}{\pi_i + \pi_j} \quad \text{where } \pi_k = 10^{R_k / 400}$$

2. **Log-Likelihood Function**:
   Given empirical match win counts $W_{ij}$ and $W_{ji}$:
   $$\ln L(\mathbf{R}) = \sum_{i < j} \left[ W_{ij} \ln P(i > j) + W_{ji} \ln P(j > i) \right]$$

3. **Newton-Raphson Iterative Update**:
   The gradient vector $\nabla \ln L$ and Hessian matrix $\mathbf{H}$ are iteratively computed:
   $$\mathbf{R}^{(t+1)} = \mathbf{R}^{(t)} - \mathbf{H}^{-1} \nabla \ln L\left(\mathbf{R}^{(t)}\right)$$
   Iterating converges within 10-15 cycles to the global maximum likelihood rating vector with residual tolerance $\epsilon < 10^{-6}$.

---

[← Previous: 04. Runner & Interceptor](04-runner-and-interceptor.md) | [Architecture Index](README.md) | [Next: 06. Telemetry & Reporting →](06-telemetry-and-reporting.md)
