// Tag inference rules and polyglot language detection tables.
export const TAG_RULES = {
  security: ["security", "secure", "secret", "auth", "owasp", "vulnerab", "hardening", "privacy", "gitleaks"],
  performance: ["perform", "fast", "optim", "latency", "cache", "speed", "bottleneck", "scale"],
  frontend: ["frontend", "ui", "css", "html", "react", "component", "accessib", "design", "theme", "canvas", "art", "favicon", "typography"],
  browser: ["browser", "playwright", "devtools", "web", "dom", "console", "screenshot", "chrome", "network"],
  testing: ["test", "tdd", "red-green", "verif", "qa", "regression"],
  debugging: ["debug", "fix", "error", "bug", "root-cause", "trace", "localize", "reproduce"],
  research: ["documentation", "research", "wiki", "find", "retriev", "search", "source", "docs", "official"],
  api: ["api", "mcp", "rest", "graphql", "endpoint", "sdk", "connector", "openapi", "interface", "integration", "schema"],
  git: ["git", "commit", "branch", "worktree", "version", "ci", "cd", "deploy", "release", "pipeline", "action", "rollback"],
  planning: ["plan", "spec", "task", "breakdown", "requirement", "story", "roadmap", "acceptance"],
  docs: ["doc", "readme", "adr", "write", "content", "prose", "guide", "manual", "communicat", "report"],
  automation: ["autom", "cli", "script", "launcher", "pinokio", "computer", "desktop", "mcp", "orchestr"],
  data: ["pdf", "docx", "pptx", "slide", "form", "table", "extract", "convert"],
  thinking: ["think", "reason", "decompos", "logic", "proposition", "clarif", "question", "interview", "doubt", "sequential", "tractatus", "cognitive"],
  codebase: ["codebase", "graph", "symbol", "architect", "module", "dependency", "knip", "unused", "refactor", "smell", "callers", "impact"],
};

export const LANG_EXT = {
  ".py": "python", ".pyw": "python",
  ".ts": "typescript", ".mts": "typescript", ".tsx": "typescript",
  ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".jsx": "javascript",
  ".go": "go", ".rs": "rust", ".java": "java", ".kt": "kotlin", ".kts": "kotlin",
  ".rb": "ruby", ".php": "php", ".sh": "shell", ".bash": "shell", ".zsh": "shell",
  ".ps1": "powershell", ".c": "c/c++", ".h": "c/c++", ".cpp": "c/c++", ".hpp": "c/c++",
  ".cc": "c/c++", ".cs": "csharp", ".swift": "swift", ".zig": "zig", ".lua": "lua",
  ".r": "r", ".sql": "sql",
};
