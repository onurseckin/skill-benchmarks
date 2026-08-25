# Environment Configuration & Provider Keys

[Previous: Installation](installation.md) | [Table of Contents](../README.md) | [Next: CLI Command Manual](../cli-reference/commands.md)

This document details all configuration options, environment variables, LLM provider credentials, database paths, and execution resource limits for the Agent Skill Benchmarks platform.

---

## 1. Quickstart Configuration

The platform reads configuration variables from process environment variables and an optional `.env` file located at the repository root.

Create your local `.env` file from the provided template:

```bash
cp .env.example .env
```

Edit `.env` and supply the API keys for the providers you intend to benchmark.

---

## 2. LLM Provider API Keys

The platform supports multi-provider evaluation across commercial and open-weights model families. Supply keys for the providers you want to evaluate:

| Variable | Provider | Supported Models Example | Description |
| :--- | :--- | :--- | :--- |
| `ANTHROPIC_API_KEY` | Anthropic | `claude-3-7-sonnet`, `claude-3-5-sonnet`, `claude-3-5-haiku` | Anthropic Claude API authentication token |
| `ANTHROPIC_BASE_URL` | Anthropic (Proxy) | Custom proxy endpoint | Optional custom endpoint URL for Anthropic API |
| `OPENAI_API_KEY` | OpenAI | `gpt-4o`, `gpt-4o-mini`, `o1`, `o3-mini` | OpenAI API key |
| `OPENAI_BASE_URL` | OpenAI (Proxy) | Custom proxy endpoint | Optional custom proxy endpoint (e.g. LiteLLM, Azure OpenAI) |
| `DEEPSEEK_API_KEY` | DeepSeek | `deepseek-chat`, `deepseek-reasoner` | DeepSeek V3 / R1 API key |
| `DEEPSEEK_BASE_URL` | DeepSeek | `https://api.deepseek.com` | Base endpoint for DeepSeek API |
| `GEMINI_API_KEY` | Google | `gemini-2.0-flash`, `gemini-1.5-pro` | Google AI Studio API key |
| `GROQ_API_KEY` | Groq | `llama-3.3-70b-versatile` | Groq high-speed inference API key |
| `OLLAMA_BASE_URL` | Ollama (Local) | `qwen2.5-coder:32b`, `deepseek-r1:14b` | Local Ollama endpoint (default: `http://localhost:11434`) |

---

## 3. Platform & Storage Settings

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `BENCHMARK_DB_PATH` | `./benchmarks.db` | Absolute or relative path to the SQLite telemetry database |
| `BENCHMARK_OUTPUT_DIR` | `./data/` | Directory where exported HTML reports, markdown leaderboards, and JSON dumps are stored |
| `BENCHMARK_CATALOG_PATH` | `./scenarios/` | Directory containing scenario definitions and fixtures |
| `BENCHMARK_SKILLS_PATH` | `./skills/` | Directory containing installed agent skill manifests (`SKILL.md`) |
| `BENCHMARK_LOG_LEVEL` | `info` | Logging verbosity: `debug`, `info`, `warn`, `error` |

---

## 4. Execution Sandbox Limits & Cgroups v2

To ensure safety and prevent runaway resource consumption, trials enforce strict execution quotas:

| Limit Parameter | Default Value | CLI Flag Override | Description |
| :--- | :--- | :--- | :--- |
| **Max Turns** | `15` | `--max-turns <N>` | Maximum agent turns (prompt-response-tool cycles) permitted per trial |
| **Max Cost USD** | `$1.00` | `--max-cost <USD>` | Hard dollar spending limit per trial; halts execution if exceeded |
| **Timeout Seconds** | `300` (5 min) | `--timeout <sec>` | Wall-clock execution timeout per trial |
| **Memory Limit** | `1024 MB` | Configurable in scenario | Maximum RAM allocated to trial sandbox |
| **CPU Quota** | `200%` (2 cores) | Configurable in scenario | Maximum CPU bandwidth allocated to sandbox container |
| **Max Global Concurrency**| `2` | `--concurrency <N>` | Maximum concurrent trials running simultaneously |

---

## 5. Sample Configuration File (`.env`)

Here is a recommended `.env` configuration for benchmark workstations:

```dotenv
ANTHROPIC_API_KEY=sk-ant-api03-...
OPENAI_API_KEY=sk-proj-...
DEEPSEEK_API_KEY=sk-...
GEMINI_API_KEY=AIzaSy...

BENCHMARK_DB_PATH=./benchmarks.db
BENCHMARK_OUTPUT_DIR=./data
BENCHMARK_CONCURRENCY=4
BENCHMARK_MAX_TURNS=20
BENCHMARK_MAX_COST_USD=2.50
BENCHMARK_TIMEOUT_SECONDS=400

JUDGE_MODEL_ID=claude-3-7-sonnet
JUDGE_PROVIDER_ID=anthropic
JUDGE_TEMPERATURE=0.0
```

---

## 6. Verifying Provider Connectivity

You can test provider connectivity and credentials by running a dry-run or single-trial test:

```bash
bun run src/cli/index.ts run \
  --scenario git-worktrees \
  --skill using-git-worktrees \
  --model claude-3-7-sonnet \
  --max-turns 1
```

---

## Next Steps

Now that your configuration is complete, proceed to the CLI command manual to explore all available commands:

- [Previous: Installation & System Prerequisites](installation.md)
- [Next: CLI Command Manual](../cli-reference/commands.md)
