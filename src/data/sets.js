// Skill-set definitions — single source of truth shared by engine, CLI, and MCP.
export const SETS = {
  thinking: { desc: "Decompose, reason, doubt", members: ["tractatus-thinking", "sequential-thinking", "7-scared-circle-clarity", "debug-thinking", "doubt-driven-development"] },
  research: { desc: "Verify against real sources", members: ["deepwiki", "context7", "find-docs", "web-reader", "research", "gitingest", "source-driven-development"] },
  planning: { desc: "Idea -> spec -> tasks", members: ["interview-me", "brainstorming", "idea-refine", "spec-driven-development", "writing-plans", "planning-and-task-breakdown", "story-quality"] },
  build: { desc: "Implement in slices", members: ["incremental-implementation", "api-and-interface-design", "system-connector", "mcp-builder", "tdd", "test-driven-development", "autonomous-implementation-pattern"] },
  docs: { desc: "Write + keep docs honest", members: ["documentation-writer", "documentation-and-adrs", "readme-skill", "api-docs-skill", "internal-comms", "stop-slop", "docx", "pdf", "pptx"] },
  review: { desc: "Gate before merge", members: ["code-review-and-quality", "code-review-graph", "code-simplification", "verification-before-completion"] },
  frontend: { desc: "UI that actually works", members: ["frontend-design", "frontend-ui-engineering", "theme-factory", "artifacts-builder", "favicon", "browser-testing-with-devtools", "webapp-testing", "playwright-cli", "agent-browser"] },
  ops: { desc: "Ship safely", members: ["git-workflow-and-versioning", "using-git-worktrees", "ci-cd-and-automation", "github-actions-docs", "shipping-and-launch", "observability-and-instrumentation", "security-and-hardening"] },
  intelligence: { desc: "Understand the codebase", members: ["ix", "understand", "code-review-graph", "graphify", "improve-codebase-architecture", "knip"] },

  // ---- Mega-sets: full-workflow bundles (the "insane" ones) ----------------
  "brainstorm-max": { desc: "Interview -> diverge -> converge -> doubt", members: ["interview-me", "brainstorming", "idea-refine", "7-scared-circle-clarity", "doubt-driven-development"] },
  "plan-execute": { desc: "Spec -> plan -> slice -> test -> land", members: ["writing-plans", "planning-and-task-breakdown", "spec-driven-development", "incremental-implementation", "autonomous-implementation-pattern", "test-driven-development"] },
  "research-deep": { desc: "Live docs + source-grounded verification", members: ["deepwiki", "context7", "find-docs", "web-reader", "source-driven-development", "gitingest"] },
  "thinking-max": { desc: "Full before/during/after thinking cadence", members: ["tractatus-thinking", "sequential-thinking", "doubt-driven-development", "debug-thinking", "verification-before-completion"] },
  "mega-injector": { desc: "Connect, wrap, inject, extend anything", members: ["system-connector", "mcp-builder", "api-and-interface-design", "security-and-hardening", "cli-anything", "computer-use"] },
  "token-saver": { desc: "Max token + context efficiency", members: ["agent-token-optimizer", "context-engineering", "prompt-optimizer", "stop-slop", "workspace-memory"] },
};

// Multiplicative pairs: outcome = product of members; any missing factor fails it.
export const MULTIPLICATIVE_PAIRS = [
  ["Correct implementation", ["source-driven-development", "incremental-implementation", "test-driven-development"]],
  ["Working UI", ["frontend-ui-engineering", "browser-testing-with-devtools", "webapp-testing"]],
  ["Safe launch", ["security-and-hardening", "ci-cd-and-automation", "observability-and-instrumentation", "shipping-and-launch"]],
  ["Right thing built", ["interview-me", "brainstorming", "spec-driven-development"]],
  ["Maintainable codebase", ["code-review-and-quality", "code-simplification", "documentation-and-adrs", "knip"]],
  ["Verified research", ["deepwiki", "context7", "source-driven-development"]],
  ["Max-quality thinking", ["tractatus-thinking", "sequential-thinking", "doubt-driven-development"]],
  ["Zero-cost deep dive", ["ix", "gitingest", "understand"]],
];
