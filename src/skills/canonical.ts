import type { CanonicalSkill, CanonicalSkillDomain, SkillCategory } from "./types";

function parseAuthorFromSource(source: string): { readonly name: string; readonly handle: string; readonly repository: string } {
  const parts = source.split("/");
  if (parts.length >= 2) {
    const handle = parts[0] ?? "unknown";
    return { name: handle, handle, repository: source };
  }
  return { name: source, handle: source, repository: source };
}

function parseInstalls(raw: string): number {
  const c = raw.trim().toUpperCase().replace(/,/g, "");
  if (c.endsWith("M")) {
    const n = Number.parseFloat(c.slice(0, -1));
    return Number.isNaN(n) ? 0 : Math.round(n * 1000000);
  }
  if (c.endsWith("K")) {
    const n = Number.parseFloat(c.slice(0, -1));
    return Number.isNaN(n) ? 0 : Math.round(n * 1000);
  }
  const num = Number.parseFloat(c);
  return Number.isNaN(num) ? 0 : Math.round(num);
}

function createSkill(
  id: string,
  name: string,
  domain: CanonicalSkillDomain,
  category: SkillCategory,
  source: string,
  installsDisplay: string,
  description: string,
  tags: readonly string[]
): CanonicalSkill {
  return {
    id,
    name,
    domain,
    category,
    source,
    sourceType: source.includes("/") ? "git" : "local",
    author: parseAuthorFromSource(source),
    installs: { rawInstalls: parseInstalls(installsDisplay), display: installsDisplay },
    description,
    tags,
    status: "available",
  };
}

export const CANONICAL_SKILLS: readonly CanonicalSkill[] = [
  createSkill("find-skills", "find-skills", "overall", "general", "vercel-labs/skills", "3.1M", "Discover and install AI agent skills across the ecosystem", ["discovery", "catalog", "ecosystem"]),
  createSkill("grill-me", "grill-me", "overall", "general", "mattpocock/skills", "936.7K", "Interactive design, architecture, and logic interrogation", ["interview", "architecture", "socratic"]),
  createSkill("frontend-design", "frontend-design", "overall", "frontend", "anthropics/skills", "806.6K", "Modern frontend design and responsive UI patterns", ["frontend", "ui", "react"]),
  createSkill("grill-with-docs", "grill-with-docs", "overall", "general", "mattpocock/skills", "797.7K", "Deep technical interrogation against official documentation", ["docs", "interrogation", "validation"]),
  createSkill("improve-codebase-architecture", "improve-codebase-architecture", "overall", "workflow", "mattpocock/skills", "769.0K", "Architectural refactoring and code organization heuristics", ["architecture", "refactoring", "clean-code"]),
  createSkill("azure-diagnostics", "azure-diagnostics", "debugging", "debugging", "microsoft/azure-skills", "465.1K", "Azure cloud infrastructure diagnostic and telemetry triage", ["azure", "cloud", "diagnostics"]),
  createSkill("azure-messaging", "azure-messaging", "debugging", "debugging", "microsoft/azure-skills", "453.6K", "Azure messaging queue and event stream troubleshooting", ["azure", "messaging", "queues"]),
  createSkill("diagnosing-bugs", "diagnosing-bugs", "debugging", "debugging", "mattpocock/skills", "450.3K", "Systematic root cause analysis and bug reproduction", ["debugging", "troubleshooting", "root-cause"]),
  createSkill("safe-debug", "safe-debug", "debugging", "debugging", "lllllllama/rigorpilot-skills", "153.9K", "Non-destructive debugging with invariant guardrails", ["safe", "debugging", "invariants"]),
  createSkill("golang-troubleshooting", "golang-troubleshooting", "debugging", "debugging", "samber/cc-skills-golang", "33.5K", "Go runtime, goroutine leak, and race detector triage", ["golang", "concurrency", "troubleshooting"]),
  createSkill("tdd", "tdd", "testing", "testing", "mattpocock/skills", "742.8K", "Test-driven development workflows and red-green cycles", ["tdd", "unit-testing", "workflow"]),
  createSkill("qa", "qa", "testing", "testing", "mattpocock/skills", "204.2K", "Automated quality assurance and test suite design", ["qa", "testing", "automation"]),
  createSkill("webapp-testing", "webapp-testing", "testing", "testing", "anthropics/skills", "138.9K", "End-to-end web application testing and browser verification", ["webapp", "e2e", "browser"]),
  createSkill("playwright-cli", "playwright-cli", "testing", "testing", "microsoft/playwright-cli", "127.9K", "Playwright CLI headless browser automation and traces", ["playwright", "e2e", "cli"]),
  createSkill("playwright-best-practices", "playwright-best-practices", "testing", "testing", "currents-dev", "63K", "Playwright robust locators and flaky test mitigation", ["playwright", "best-practices", "testing"]),
  createSkill("azure-compliance", "azure-compliance", "security", "security", "microsoft/azure-skills", "464K", "Azure cloud security compliance and policy verification", ["azure", "compliance", "security"]),
  createSkill("firebase-security-rules-auditor", "firebase-security-rules-auditor", "security", "security", "firebase/agent-skills", "74.8K", "Firebase Firestore and Storage security rules auditor", ["firebase", "security", "rules"]),
  createSkill("skill-vetter", "skill-vetter", "security", "security", "useai-pro/openclaw-skills-security", "20.5K", "Agent skill sandbox isolation and permission vetter", ["security", "sandbox", "audit"]),
  createSkill("security-review", "security-review", "security", "security", "affaan-m/ecc", "11.7K", "OWASP top-10 vulnerability and input sanitization review", ["security", "owasp", "vulnerabilities"]),
  createSkill("pci-compliance", "pci-compliance", "security", "security", "wshobson/agents", "8K", "PCI-DSS payment card data security standard compliance", ["pci", "compliance", "payments"]),
  createSkill("golang-documentation", "golang-documentation", "documentation", "documentation", "samber/cc-skills-golang", "33.7K", "Idiomatic Go package documentation and godoc conventions", ["golang", "godoc", "documentation"]),
  createSkill("documentation-writer", "documentation-writer", "documentation", "documentation", "github/awesome-copilot", "23.4K", "Technical architecture and API documentation authoring", ["docs", "technical-writing", "architecture"]),
  createSkill("create-readme", "create-readme", "documentation", "documentation", "github/awesome-copilot", "15.9K", "Project README blueprint generation and quickstart scaffolds", ["readme", "scaffold", "documentation"]),
  createSkill("documentation-and-adrs", "documentation-and-adrs", "documentation", "documentation", "addyosmani/agent-skills", "14.3K", "Architecture Decision Record (ADR) synthesis and capture", ["adr", "architecture", "decisions"]),
  createSkill("readme-blueprint-generator", "readme-blueprint-generator", "documentation", "documentation", "github/awesome-copilot", "9.3K", "Structured markdown README scaffold generator", ["readme", "markdown", "scaffold"]),
  createSkill("code-review", "code-review", "code-review", "code-review", "mattpocock/skills", "390.3K", "Automated code review heuristics and maintainability checks", ["review", "clean-code", "quality"]),
  createSkill("code-review-excellence", "code-review-excellence", "code-review", "code-review", "wshobson/agents", "25.2K", "Rigorous stylistic, architectural, and edge-case review", ["review", "quality", "excellence"]),
  createSkill("code-review-and-quality", "code-review-and-quality", "code-review", "code-review", "addyosmani/agent-skills", "17.1K", "Code quality metrics, complexity analysis, and reviews", ["review", "quality", "metrics"]),
  createSkill("frontend-code-review", "frontend-code-review", "code-review", "frontend", "langgenius/dify", "8.9K", "Frontend accessibility, performance, and state review", ["frontend", "react", "review"]),
  createSkill("code-reviewer", "code-reviewer", "code-review", "code-review", "google-gemini/gemini-cli", "8.4K", "Multi-pass code quality and edge-case analyzer", ["review", "analysis", "gemini"]),
  createSkill("azure-deploy", "azure-deploy", "devops", "devops", "microsoft/azure-skills", "465.3K", "Azure resource provisioning and deployment automation", ["azure", "deploy", "devops"]),
  createSkill("agent-browser", "agent-browser", "browser-automation", "browser-automation", "vercel-labs/agent-browser", "713.8K", "Browser automation agent runtime and DOM interactions", ["browser", "automation", "agent"]),
  createSkill("supabase-postgres-best-practices", "supabase-postgres-best-practices", "database", "database", "supabase/agent-skills", "363.5K", "PostgreSQL schema design and index query optimization", ["postgres", "database", "supabase"]),
  createSkill("caveman-commit", "caveman-commit", "workflow", "workflow", "juliusbrussee/caveman", "253.7K", "Atomic git commits, diff hygiene, and git worktrees", ["git", "commits", "worktree"]),
  createSkill("just-scrape", "just-scrape", "integrations", "integrations", "ScrapeGraphAI/just-scrape", "244.9K", "LLM-driven web scraping and data extraction pipelines", ["scraping", "extraction", "web"]),
  createSkill("pdf", "pdf", "productivity", "productivity", "anthropics/skills", "183.0K", "PDF text extraction, form parsing, and document layout", ["pdf", "documents", "extraction"]),
  createSkill("request-refactor-plan", "request-refactor-plan", "refactoring", "refactoring", "mattpocock/skills", "157.9K", "Step-by-step refactoring plans with safety invariants", ["refactoring", "planning", "clean-code"]),
  createSkill("mcp-builder", "mcp-builder", "integrations", "integrations", "anthropics/skills", "92.1K", "Model Context Protocol (MCP) server and tool builders", ["mcp", "tools", "integrations"]),
  createSkill("convex-performance-audit", "convex-performance-audit", "productivity", "database", "get-convex", "88.2K", "Convex reactive backend query and index performance audit", ["convex", "performance", "audit"]),
  createSkill("api-design-principles", "api-design-principles", "api-design", "backend", "wshobson/agents", "24.9K", "REST, GraphQL, and RPC API contract design principles", ["api", "design", "rest"]),
];
