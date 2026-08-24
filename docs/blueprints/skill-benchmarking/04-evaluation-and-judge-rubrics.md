# 04. Evaluation and Judge Rubrics Specification

## 1. Evaluation Architecture Overview

The `skill-benchmarks` evaluation engine uses a **Dual-Layer Evaluation Framework** to combine absolute objective verifications with nuanced semantic quality assessments.

```
+-----------------------------------------------------------------------------------+
|                               Benchmark Run Output                                |
|  - Unified Git Diff (Code changes)                                                |
|  - Agent Conversation Transcript (Reasoning & Tool Steps)                         |
|  - Final Agent Message / Artifacts Generated                                      |
+-----------------------------------------------------------------------------------+
                                      |
          +---------------------------+---------------------------+
          |                                                       |
          v                                                       v
+-----------------------------------+   +-------------------------------------------+
|    Layer 1: Deterministic Check   |   |        Layer 2: LLM Semantic Judge        |
|  - Automated Test Suites          |   |  - Multi-Dimensional Rubric Scoring       |
|  - Typecheck & Linter Audits      |   |  - Blind Absolute Grading (1-5 per dim)   |
|  - AST Mutation Invariant Checks  |   |  - Blind Pairwise Head-to-Head Tournaments|
|  - File Tree Delta Constraints    |   |  - Position-Debiased Elo Rank Engine      |
+-----------------------------------+   +-------------------------------------------+
          |                                                       |
          +---------------------------+---------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------------+
|                             Composite Evaluation Score                            |
|       Score_final = (W_det * Score_det) + (W_judge * Score_judge) \in [0, 100]    |
+-----------------------------------------------------------------------------------+
```

---

## 2. Layer 1: Deterministic Evaluation Engine

Deterministic checks verify functional correctness with zero subjectivity.

### 2.1 Check Primitives

```typescript
export interface CommandCheckResult {
  readonly name: string;
  readonly command: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly passed: boolean;
  readonly executionTimeMs: number;
}

export interface FileInvariantResult {
  readonly name: string;
  readonly passed: boolean;
  readonly violations: ReadonlyArray<string>;
}

export interface DeterministicEvaluationResult {
  readonly allPassed: boolean;
  readonly score: number; // 0 to 100
  readonly commandResults: ReadonlyArray<CommandCheckResult>;
  readonly fileInvariants: ReadonlyArray<FileInvariantResult>;
  readonly gitDiffMetrics: {
    readonly filesChanged: number;
    readonly insertions: number;
    readonly deletions: number;
    readonly rawDiff: string;
  };
}
```

### 2.2 Standard Invariants Checked
1. **Target Test Suite**: `bun test` or scenario-specific test command must exit with code `0`.
2. **Type Safety Gate**: `bun run typecheck` or equivalent must exit with `0` (zero new type errors).
3. **Lint & Formatting Invariants**: Zero new linter errors; disallowed patterns (e.g. `@ts-ignore`, `console.log`, `any`) are flagged.
4. **Diff Scope Guard**: The agent must NOT mutate forbidden files (e.g. modifying test assertions to force a pass instead of fixing source code).

---

## 3. Layer 2: LLM-as-a-Judge Evaluation

Semantic evaluation assesses code quality, reasoning validity, documentation clarity, and architectural soundness.

### 3.1 Judge Configuration & Debiasing Rules
- **Model**: Frontier LLM (`claude-3-7-sonnet-20250219` or `gpt-4o`) operating at `temperature: 0.0`.
- **Blind Execution**: All skill metadata, model identity, and run provenance are stripped from the judge prompt.
- **Structured JSON Output**: The judge is constrained to return a strict JSON payload validated against a Zod schema.

### 3.2 Rubric Taxonomy by Category

```
Scoring Dimensions (1 to 5 Likert Scale per Dimension)
├── Debugging
│    ├── Root Cause Precision (Accuracy of diagnosis)
│    ├── Solution Minimalism (Laser focus vs. bloated refactor)
│    └── Regression Prevention (Robustness of fix)
├── Testing & QA
│    ├── Test Case Diversity (Edge cases, boundaries, error paths)
│    ├── Test Isolation & Determinism (No flaky timers/sleeps)
│    └── Assertion Quality (Meaningful failure messages)
├── Security
│    ├── Exploit Surface Coverage (Identifies all vulnerability vectors)
│    ├── Defense-in-Depth (Safe defaults, input sanitization)
│    └── Zero Regression (Does not break legitimate client flows)
├── Documentation
│    ├── Diátaxis Compliance (Clear separation of concerns)
│    ├── Executable Accuracy (Code samples are runnable & correct)
│    └── Conciseness & Readability (Information density)
└── Code Review
     ├── Precision of Findings (True bugs identified)
     ├── False Positive Rate (Absence of hallucinated flaws)
     └── Constructiveness (Actionable diff suggestions)
```

### 3.3 Absolute Judge Prompt Template

```markdown
You are an expert, impartial code benchmark judge. Your task is to evaluate the quality of a coding agent's final solution against a specific scenario benchmark.

# Scenario Specification
[SCENARIO_DESCRIPTION]

# Instructions Given to Agent
[AGENT_PROMPT]

# Agent Changes (Git Diff)
```diff
[GIT_DIFF]
```

# Agent Final Explanation
[AGENT_FINAL_MESSAGE]

# Evaluation Rubrics
[RUBRIC_DIMENSIONS]

# Instructions:
1. Carefully evaluate each rubric dimension from 1 to 5 based strictly on the criteria provided.
2. Provide a rigorous, critical justification for each score.
3. Calculate the overall weighted score normalized from 0 to 100.
4. Output strictly valid JSON conforming to the schema below.

```json
{
  "dimensions": [
    {
      "name": "Dimension Name",
      "score": 4,
      "justification": "Detailed explanation of why score was awarded..."
    }
  ],
  "overallScore": 85,
  "summary": "Executive critique of the agent's performance."
}
```
```

---

## 4. Pairwise Blind Win-Rate & Tournament System

To compare two skills head-to-head (e.g. `Skill A` vs `Skill B` or `Skill A` vs `Vanilla Baseline`), the harness conducts **Blind Pairwise Matches**.

```
                           +--------------------+
                           | Benchmark Scenario |
                           +--------------------+
                                     |
                 +-------------------+-------------------+
                 |                                       |
                 v                                       v
         +---------------+                       +---------------+
         |  Run A Output |                       |  Run B Output |
         +---------------+                       +---------------+
                 |                                       |
                 +-------------------+-------------------+
                                     |
                                     v
                       +---------------------------+
                       | Position Randomizer       |
                       | Permutation 1: [A vs B]   |
                       | Permutation 2: [B vs A]   |
                       +---------------------------+
                                     |
                                     v
                       +---------------------------+
                       | Blind Pairwise Judge LLM  |
                       +---------------------------+
                                     |
                 +-------------------+-------------------+
                 |                                       |
                 v                                       v
        [ Decision 1: A wins ]                  [ Decision 2: A wins ]
                 \                                       /
                  +------------------+------------------+
                                     |
                                     v
                           +-------------------+
                           | Consistency Check |
                           | (Pass: A wins)    |
                           +-------------------+
```

### 4.1 Position Bias Mitigation
LLM judges exhibit position bias (favoring Candidate A over Candidate B). The harness evaluates every pairwise comparison in **both permutations**:
1. Prompt 1: Candidate 1 = Output A, Candidate 2 = Output B
2. Prompt 2: Candidate 1 = Output B, Candidate 2 = Output A

- If Permutation 1 selects Candidate 1 (A) and Permutation 2 selects Candidate 2 (A) $\rightarrow$ **A Wins**.
- If both select Candidate 1 or both select Candidate 2 $\rightarrow$ **Position Bias Detected / Marked as Tie**.

---

## 5. Bradley-Terry & Elo Rating Engine

Pairwise match outcomes update global skill ratings using the Bradley-Terry probabilistic model.

### 5.1 Probability of Win Formula

$$P(A > B) = \frac{1}{1 + 10^{(R_B - R_A)/400}}$$

### 5.2 Rating Update Rule

$$R_A' = R_A + K \cdot (S_A - P(A > B))$$

Where:
- $S_A = 1.0$ for Win, $0.5$ for Tie, $0.0$ for Loss.
- $K = 32$ (Standard tournament sensitivity).
- Initial Rating $R_0 = 1500$.

### 5.3 Win-Rate Confidence Intervals (Wilson Score Interval)

For a skill with $W$ wins out of $N$ total matches ($p = W/N$), the $95\%$ confidence interval is computed as:

$$CI_{95\%} = \frac{p + \frac{z^2}{2N} \pm z \sqrt{\frac{p(1-p)}{N} + \frac{z^2}{4N^2}}}{1 + \frac{z^2}{N}} \quad (z = 1.96)$$
