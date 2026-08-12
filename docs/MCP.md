# parasite-skill as an MCP server

parasite-skill exposes its routing engine as a dependency-free MCP server over
stdio (JSON-RPC 2.0). Any MCP-compatible host can call the same tool surface
implemented by JavaScript and Python.

## Run it

```bash
bun src/mcp-server.js
# or
node src/mcp-server.js
# Python twin / compatibility entrypoint
python scripts/mcp_server.py
```

The Python implementation is canonical at `skill/scripts/mcp_server.py`; the
root `scripts/mcp_server.py` is a compatibility launcher so the two entrypoints
cannot drift. Both twins expose `graph` in addition to the routing and composition
surface. The JavaScript twin also owns client/config adapters because those are
Node-facing integrations.

## Register it with a host

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "parasite-skill": {
      "command": "bun",
      "args": ["/absolute/path/to/parasite-skill/src/mcp-server.js"]
    }
  }
}
```

**Claude Code**:

```bash
claude mcp add parasite-skill -- bun /absolute/path/to/parasite-skill/src/mcp-server.js
```

Any MCP host can use the same stdio command. The server has no runtime npm
dependencies and does not require model credentials.

## Tools

| Tool | Input | Returns |
|---|---|---|
| `scan` | `dirs?` | re-analyze the ecosystem and rebuild the registry |
| `validate` | — | Agent Skills spec check |
| `route` | `idea`, `top?`, `set?` | ranked skills and best sets |
| `sets` | `apply?` | list sets or print a set load order |
| `compose` | `idea`, `top?`, `maxChars?`, `enabledSets?`, `excludeSkills?` | bounded grounded runtime payload |
| `plan` | `request`, `top?`, `maxChars?`, `enabledSets?`, `excludeSkills?` | concise execution plan; MCP output uses relative paths |
| `refs` | `per_skill?` | generate ref pages |
| `wikis` | — | generate wiki and graphs |
| `graph` | `format?` (`json`, `dot`, `mmd`) | typed ecosystem graph |
| `list_installs` | — | installed client locations |
| `skill_tools_list` | `dirs?`, `allow?`, `deny?` | inventory callable skill AI-tools (scripts, hooks, tools); policy-filtered |
| `skill_tools_audit` | `threshold?`, `dirs?` | static risk audit of discovered skill AI-tools; never executes anything |
| `skill_tools_docs` | `dirs?`, `allow?`, `deny?` | TOOLS.md reference of the callable skill AI-tool surface |
| `skill_tools_run` | `name`, `args?`, `json_args?`, `timeout_ms?`, `dirs?`, `allow?`, `deny?`, `env?` | explicitly execute one skill AI-tool; bounded, captured, redacted, policy-gated; `json_args` is validated against the tool's declared `argsSchema`; a per-tool `timeoutMs` declared by the skill (via the `tools:` frontmatter block) is the fallback when `timeout_ms` is omitted — in both twins |
| `skill_tools_history` | `name?`, `skill?`, `status?` (`ok`/`fail`), `since?`, `until?`, `limit?` | read the shared tool-run audit ledger (`tool-runs.jsonl`) with the same filters as the JS twin's `tools history`; newest first; written by both twins' tool-execution paths |
| `skill_tools_gc` | `status?`, `age_days?`, `keep?`, `dry_run?` | prune stale registry artifacts (agent reports + audit ledger) by age/keep, or with `status: true` report the gc posture (policy, last/next sweep, throttle, stale dry-run) without pruning — parity with the JS twin's `tools gc` / `tools gc --status` |
| `skill_tools_ledger` | `stats?`, `export?`, `purge?` | audit-ledger lifecycle — `stats: true` reports integrity (valid/corrupt/out-of-order) + aggregates (ok/fail, avg duration, per-skill/per-tool; exits 2 on corrupt), `export: <path>` dumps the full ledger as a JSON array, `purge: true` clears it — parity with the JS twin's `tools ledger` |
| `doctor` | `dirs?` (JS twin); `—` (Python twin) | one-shot health check: registry load + spec validation + tool readiness + audit-baseline diff + project-config parse + gc posture + ledger integrity (corrupt lines fail) + registry freshness (informational; both twins); auto-sweeps stale artifacts first under an `auto: true` policy (interval-throttled sweeps are informational, not failures); exits 1 on the first failing check |
| `export` | `public?`, `dirs?` | LLM-ready ecosystem inventory (skills, sets, tools with risk, gc policy incl. `intervalDays`, sync posture). JS twin covers clients/extensions/MCP/rules too; Python twin covers the registry-derived subset. `public: true` strips filesystem paths |
| `llm` | `request`, `endpoint?`, `model?`, `allow_remote?`, `max_output_tokens?`, `max_response_chars?`, `max_tool_calls?`, `tool_dry_run?`, `no_tools?`, `top?`, `max_chars?`, `dirs?` | bounded completion against an explicitly configured OpenAI-compatible endpoint. Both twins expose risk-annotated skill tools as native functions and execute model-requested calls through the shared run path, looping results back until the model answers or `max_tool_calls` is reached; `tool_dry_run` previews commands without executing. Local-only by default |

`compose` responses now carry per-selected-skill `tools` arrays (name,
language, `argsSchema` presence) so the host can see the executable surface
without a separate `skill_tools_list` round trip. The local `refs` pages list
the same tools per skill.

`skill_tools_run` makes the skill ecosystem executable by the host LLM: the
host first lists the tools, then calls the ones it needs with a space-separated
argument string. Execution only ever happens when this tool is called, is
capped at 30s by default, and the returned stdout/stderr are redacted.

`allow` and `deny` are tool-name glob lists (deny wins; a non-empty allow must
match). `env` is an optional allowlist of environment keys visible to the tool
process (PATH is always kept). These map to the same policy as the
`parasite-skill.json` `tools` block and protect the host when it calls tools
autonomously.

## Adaptive execution model

`route` is the compatibility/debugging view. For execution, use `compose`:

```json
{
  "name": "compose",
  "arguments": {
    "idea": "implement a secure REST endpoint",
    "top": 6,
    "maxChars": 9000,
    "enabledSets": ["build", "security"],
    "excludeSkills": ["obsolete-skill"]
  }
}
```

The deterministic engine selects relevant skills, sets, asset manifests, and
bounded excerpts. Each selected skill also lists its callable AI-tools (names,
language, declared-schema presence) so the host knows what can actually be
executed via `skill_tools_run`. The MCP host's LLM makes semantic decisions
using that payload. `compose` itself is not an LLM and does not dump every
installed skill into chat.

## Privacy and security

The runtime payload excludes absolute paths, environment values, credentials,
unselected documents, and unselected asset contents. Redaction is explicitly
best-effort; user-owned asset text is untrusted data and must not be executed
as instructions. Full files remain local and load on demand.

MCP `plan` responses use relative labels such as `Payload: plan/request-payload.json`.
Normal local CLI plan output may still show absolute paths so the user can find
saved files.

## Direct model adapter

The CLI also has an opt-in provider-neutral adapter:

```bash
PARASITE_SKILL_LLM_URL=http://localhost:11434/v1 \
PARASITE_SKILL_LLM_MODEL=local-model \
parasite-skill llm "explain the selected implementation plan"
```

It expects an OpenAI-compatible `POST /chat/completions` endpoint. The API key
is optional for local endpoints and should be supplied through
`PARASITE_SKILL_LLM_API_KEY`; `--api-key` exists for explicit use but may be
visible in shell history or process listings. Never commit keys to source.
The adapter sends `max_tokens` (default 1200) and caps response text. HTTPS is
required for non-local endpoints, and external access must be explicitly enabled with `--allow-remote`; plain HTTP is accepted only for localhost.
Network calls happen only when `llm` is explicitly invoked.

## Freebuff history recovery

parasite-skill does not assume where Freebuff stores chat history. Use:

```bash
parasite-skill history discover
parasite-skill history discover --history-dirs /path/to/export
parasite-skill history import --file /path/to/exported-transcript.json
```

Discovery reports candidate paths and metadata only. Import is explicit, reads
only the selected file, redacts common credentials/emails/absolute paths, and
stores the sanitized copy under the local registry's ignored `history/` folder.
It does not modify the original transcript or automatically scrape the home
directory.

## Test it

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"compose","arguments":{"idea":"write API docs","maxChars":500}}}' \
  | bun src/mcp-server.js
```
