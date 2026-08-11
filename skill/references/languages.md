# Languages and Polyglot Scanning

The router is not locked to one source type. The registry records, per skill, every script language found in its `scripts/` dir, so Go, Rust, Java, shell, Python, and TypeScript tooling are indexed identically.

## Detection Table

| Extension | Language recorded |
|---|---|
| .py, .pyw | python |
| .ts, .mts, .tsx | typescript |
| .js, .mjs, .cjs, .jsx | javascript |
| .go | go |
| .rs | rust |
| .java | java |
| .kt, .kts | kotlin |
| .rb | ruby |
| .php | php |
| .sh, .bash, .zsh | shell |
| .ps1 | powershell |
| .c, .h, .cpp, .hpp, .cc | c/c++ |
| .cs | csharp |
| .swift | swift |
| .zig | zig |
| .lua | lua |
| .r | r |
| .sql | sql |

The engine binaries themselves are dual-runtime: `conductor.py` (Python 3.14) and `router.ts` (Bun/TypeScript 1.3) both read and write the same `registry.json`, so either runtime can route, scan, and generate.

## MCP Extension Path

Skills are procedure; MCP servers are tools. When a request needs external capabilities, the AI layer routes to MCP-building/integration skills and frameworks:

- `mcp-builder` — build high-quality MCP servers
- `system-connector` — deterministic connectors to third-party systems
- FastMCP (Python `fastmcp`, TypeScript `@prefecthq/fastmcp-ts`) and Go fast-MCP implementations (gofastmcp.com) — full-lifecycle MCP servers with clients and apps
- `browser-to-api` — derive OpenAPI specs from observed browser traffic

The router can optionally expose its own MCP surface later (tools: scan, route, sets, refs, wikis, trace, link) — the registry schema is already transport-agnostic JSON.
