# Authoring Custom Scenarios

[Previous: LLM Judge Arena & Multi-Agent Debates](../interactive-features/arena-debates.md) | [Table of Contents](../README.md)

This guide provides a comprehensive tutorial for designing, authoring, and validating custom benchmark scenarios to evaluate new agent skills and domains.

---

## 1. Anatomy of a Scenario Definition

Scenarios are defined as structured JSON documents in `scenarios/<category>/<scenario-id>.json`. Each scenario specifies the initial repository workspace, task instructions, execution constraints, and multi-tier evaluation checks.

```json
{
  "id": "custom-feature-flag",
  "name": "Feature Flag Router Implementation",
  "category": "coding",
  "difficulty": "medium",
  "targetSkill": "clean-architecture",
  "baselineModel": "claude-3-7-sonnet-20250219",
  "description": "Benchmark evaluating safe implementation of dynamic feature flag routing.",
  "instructions": "Implement the FeatureFlagManager class in src/flags.ts...",
  "workspace": {
    "fixtures": {
      "src/flags.ts": "export class FeatureFlagManager {}",
      "package.json": "{\"name\": \"flag-fixture\", \"type\": \"module\"}",
      "tsconfig.json": "{\"compilerOptions\": {\"strict\": true}}"
    },
    "initialGitCommit": "Initial fixture state"
  },
  "limits": {
    "maxTurns": 15,
    "maxCostUSD": 1.00,
    "maxWallClockTimeMs": 300000
  },
  "evaluation": {
    "deterministicChecks": [
      {
        "id": "check-flags-exist",
        "name": "Verify flags.ts exists",
        "type": "file_exists",
        "filePath": "src/flags.ts",
        "mustExist": true,
        "weight": 0.2
      },
      {
        "id": "check-class-methods",
        "name": "Verify evaluate method signature",
        "type": "file_content",
        "filePath": "src/flags.ts",
        "fileContentPattern": "evaluate\\(flagKey:\\s*string",
        "weight": 0.4
      },
      {
        "id": "check-git-diff",
        "name": "Ensure changes are confined to src/flags.ts",
        "type": "git_diff",
        "maxFilesChanged": 1,
        "weight": 0.4
      }
    ],
    "judgeRubrics": [
      {
        "name": "Type Safety and Error Handling",
        "description": "Evaluates defensive programming and TypeScript strictness",
        "weight": 0.5
      },
      {
        "name": "Code Cleanliness and Architecture",
        "description": "Evaluates modularity and maintainability",
        "weight": 0.5
      }
    ]
  }
}
```

---

## 2. Deterministic Check Types

| Check Type | Required Properties | Description |
| :--- | :--- | :--- |
| `file_exists` | `filePath`, `mustExist` | Confirms creation or deletion of a specific file |
| `file_content` | `filePath`, `fileContentPattern` | Asserts regex or string match against target file |
| `git_diff` | `maxFilesChanged` | Asserts that agent modifications did not touch unauthorized files |
| `command_output`| `command`, `expectedPattern` | Executes a shell command and validates standard output |

---

## 3. Registering Scenarios in the Catalog

After creating your scenario JSON file in `scenarios/<category>/<scenario-id>.json`:

1. Add your scenario metadata to `scenarios/catalog.json`:

```json
{
  "id": "custom-feature-flag",
  "name": "Feature Flag Router Implementation",
  "category": "coding",
  "difficulty": "medium",
  "path": "scenarios/coding/custom-feature-flag.json"
}
```

2. Validate all scenarios using the built-in validator:

```bash
bun run src/scripts/verify-scenarios.ts
```

3. Test run your scenario with a single trial:

```bash
bun run cli -- run \
  --scenario custom-feature-flag \
  --skill clean-architecture \
  --model claude-3-7-sonnet
```

---

## Next Steps

Return to the Table of Contents or run a matrix sweep with your new scenario:

- [Previous: LLM Judge Arena & Multi-Agent Debates](../interactive-features/arena-debates.md)
- [Table of Contents](../README.md)
