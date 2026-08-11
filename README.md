# parasite-skill

`parasite-skill` is a local CLI and Agent Skill that routes a request through the skills already installed on a machine. It scans skill metadata, ranks relevant skills and sets, selects supporting assets on demand, and emits a bounded execution payload for an AI client.

It also provides opt-in adapters for supported client configuration files, MCP registration, generated build hooks, and server wrappers. It does not bypass permissions or inject code into arbitrary closed-source applications.

## Install

```bash
npm install -g parasite-skill
# or
npx parasite-skill --help
```

Install the skill payload into detected clients:

```bash
parasite-skill install                 # choose detected clients
parasite-skill install --yes           # install into every known target
parasite-skill install --agent claude-code,codex --link
parasite-skill refresh
parasite-skill list
```

The installer supports copy and link modes, verifies `SKILL.md`, deduplicates shared destinations, and uses Windows junctions when symlinks are unavailable.

## Route without dumping the ecosystem

```bash
parasite-skill scan
parasite-skill validate
parasite-skill route "write secure API documentation"
parasite-skill plan "add authentication to the service"
parasite-skill compose "debug the failing MCP request" --json
```

`compose` is the runtime boundary. It returns selected skills, rationale, relevant asset metadata, small safe excerpts, the callable AI-tools each selected skill declares, execution order, and verification cadence. Full skill documents, scripts, hooks, and templates remain on demand instead of being pasted into the chat.

Run a one-shot health check with `parasite-skill doctor`: it validates every
skill against the spec, verifies tool readiness (scripts exist, policy, schema
shape), diffs the static audit against the persisted baseline (falling back to
a high-risk gate when none exists), and parses the project config — exiting 1
on the first failing check. `--json` gives the machine-readable view. This is
the same surface the CI workflow gates on.

Routing is deterministic and inspectable: token and body-keyword matches, request mode, tags, explicit skill names, project set filters, and exclusions contribute to the result. The model still makes the semantic decision; scores are candidates, not proof.

Project defaults live in `parasite-skill.json` or `.parasite-skill.json` and can define registry/scan paths, sets, enabled sets, exclusions, output limits, client allowlists, isolated environment keys, and the parasite toggle. `PARASITE_SKILL_HOME` isolates the complete runtime for tests or sandboxes.

## AI tools: run skill scripts as tools

Routing and composing describe the ecosystem; `tools` executes it. Every
installed skill's scripts, hooks, and tools become callable, bounded AI tools
the main LLM can invoke directly:

```bash
parasite-skill tools list
parasite-skill tools list --skill "demo*" --risk medium   # filtered inventory
parasite-skill tools describe <name>
parasite-skill tools run <name> --args "some args"
parasite-skill tools run-batch a,b,c --args "..."  # sequential run, shared ledger
parasite-skill tools run-batch a,b,c --dry-run     # preview the whole batch
parasite-skill tools docs                          # generate registry/TOOLS.md
```

`tools list` accepts `--skill G` (glob-filter by owning skill) and `--risk X`
(only tools at or above a `low`/`medium`/`high` static-audit risk), so you can
answer "which dangerous tools does this skill expose?" without scanning the
whole inventory. `tools run-batch --dry-run` resolves and policy-checks every
tool in the batch and prints the exact commands — nothing executes and the
ledger stays untouched.

Tool names are `<skill>__<asset>` (for example `parasite-skill__conductor`).
Python, JavaScript, and shell assets are discovered automatically. Execution
is explicit, time-bounded (default 30s), captured, redacted, and recorded to an
audit ledger — routing or planning alone never runs a tool. `run-batch` stops
on the first failure unless `--continue` is given. The same tools are exposed
to MCP hosts as `skill_tools_list`, `skill_tools_run`, and
`skill_tools_audit`, so the host LLM can call them as functions instead of
only reading metadata.

Extra tool workflows:

```bash
parasite-skill tools dry-run <name> --args "..."   # preview the exact command
parasite-skill tools audit                          # static risk audit of tools
parasite-skill tools audit --write-baseline         # seed a risk baseline file
parasite-skill tools audit --baseline               # diff current risk vs baseline
parasite-skill tools verify                         # readiness: scripts/policy/schemas
parasite-skill tools history                        # audit ledger of executed tools
parasite-skill tools history --name "demo*" --status fail   # filter the ledger
parasite-skill tools history --since 2026-01-01T00:00:00Z --until 2026-02-01T00:00:00Z
parasite-skill tools history --clear                # reset the ledger
```

`tools verify` checks every discovered tool (script exists, policy status,
schema shape) and exits 1 when anything is broken — a cheap readiness gate
before a release or a fresh machine. `tools audit --write-baseline` persists
the expected per-tool risk, and `tools audit --baseline` diffs against it,
exiting 1 when any tool regressed to a higher risk level. `tools history`
filters the ledger by tool-name glob (`--name`), skill glob (`--skill`),
status (`--status ok|fail`), or a time window (`--since`/`--until` ISO
timestamps) — "what ran in the last hour?" is one command.

Skills can declare per-tool metadata in their `SKILL.md` frontmatter as a
`tools:` JSON block keyed by tool name or asset path — overriding the
auto-extracted description and adding an `argsSchema` the LLM sees in
`describe`/native tool-calling:

```markdown
---
name: demo-skill
description: Debug failing tests.
tools: |
  {
    "demo-skill__inspect": {
      "description": "Inspect the failing test output",
      "argsSchema": { "type": "object", "properties": { "args": { "type": "string" } } },
      "timeoutMs": 5000
    }
  }
---
```

A per-tool `timeoutMs` (>= 1000) becomes that tool's execution default; an
explicit `--timeout-ms` or the project `tools.timeoutMs` still wins, and the
declared value is shown in `describe` and `TOOLS.md`.

`tools audit` reads each asset statically (never executes it) and flags code
execution, network, secrets-read, and destructive patterns as `high`/`medium`/
`low` risk; `--threshold high` fails the run when any tool is at or above that
risk.

Projects can gate execution with `parasite-skill.json`:

```json
{
  "tools": {
    "allow": ["demo-skill__*"],
    "deny": ["dangerous-skill__*"],
    "env": ["PATH", "HOME"],
    "timeoutMs": 60000,
    "scoped": {
      "profile:security-auditor": { "deny": ["*__deploy*"] },
      "sets:ops": { "allow": ["release-skill__*"] }
    }
  }
}
```

Deny wins; a non-empty allow list must match (`*` globs supported). The `env`
array is the only environment exposed to tool processes (PATH is always kept).
`--env-filter a,b` overrides it per invocation, and `--timeout-ms N` overrides
`timeoutMs`. `scoped` merges extra rules per agent profile (`profile:<name>`)
or skill-set (`sets:<name>`) when `agents run` resolves each profile's policy.
`trace <file|dir>` also reports tool runs from the ledger alongside skill
mentions, and can aggregate a whole directory of transcripts (`--json` for
machine-readable output).

Edit the policy from the CLI instead of by hand (`--dry-run` previews):

```bash
parasite-skill tools policy                          # print effective policy
parasite-skill tools policy --allow "a__*" --deny "b__*" --env PATH --policy-timeout-ms 60000
parasite-skill tools policy --scoped profile:security-auditor --scoped-deny "*__deploy*"
parasite-skill tools policy --drop-policy
```

Per-invocation knobs: `tools run <name> --json-args '{"port":8080}'` validates
structured args against the tool's declared `argsSchema` (exit 3 on invalid),
and `--tool-env KEY=VALUE,...` injects inline env overrides for that run.
`tools run-batch a,b --json-args '{"tool-a__x": {"port": 8080}, "tool-b__y": {}}'`
accepts a per-tool map so each tool in the batch is validated against its own
schema. `export` records the active tools policy (names/keys only) in
`ecosystem.json` so the AI layer knows the execution gate without rescanning —
and now also a `tools` array (tool name, owning skill, language, static-audit
risk, declared timeout, schema presence) plus a `callable_tools` count, so the
AI layer sees the whole executable surface and its risk posture from the
export alone.

## Auto-max routing

Add `--auto` to `plan` or `compose` to pin the always-on thinking cadence
around the routed skills in the execution order — decomposition and doubt
first, verification and review last — without dumping the registry into chat:

```bash
parasite-skill plan "debug the failing test" --auto
parasite-skill compose "ship the release" --auto --json
```

## Execute a declarative agent

Agent profiles are executable workflows, not just recipes:

```bash
parasite-skill agents run ecosystem-architect "map the ecosystem impact"
parasite-skill agents run release-engineer "verify the release" --max-tools 4
```

The run routes the request through the profile's sets, executes the selected
skills' script tools, asserts the profile's guardrails, and saves a report to
the registry (`agents/<profile>-<request>.md` + `.json`). Run every profile
once with `agents run --all "<request>"` — tool execution is deduplicated
across profiles and a combined report is written to `agents/all-<request>.md`
+ `.json`. Narrow `--all` to a subset with `--profiles a,b`, and gate real
runs with `--min-tools N` (exit 1 when fewer than N tools succeeded — useful in
CI; the gate applies to executed runs, not `--dry-run` previews). `--json`
prints the report (single, combined, or dry-run) to stdout for scripts and CI:

```bash
parasite-skill agents run ecosystem-architect "verify the release" --json
parasite-skill agents run --all "audit the boundary" --json --dry-run
```

```bash
parasite-skill agents list          # inventory all profiles
parasite-skill agents show security-auditor   # print one profile's recipe
parasite-skill agents run security-auditor "audit the LLM boundary" --dry-run
parasite-skill agents run security-auditor "audit the boundary" --dry-run --strict
```

`--dry-run` resolves and policy-checks every tool a profile would run, prints
the exact commands, and writes a preview report
(`agents/<profile>-<request>.dryrun.md` + `.json`) — nothing executes and the
ledger stays untouched. Add `--strict` to turn any policy-blocked tool into a
hard failure (exit 2), so CI can gate on a partially-blocked profile.

## Typed ecosystem graph

Generate a names-and-relationships-only inventory and graph:

```bash
parasite-skill export
parasite-skill wikis
parasite-skill graph --ecosystem --json
parasite-skill graph --ecosystem --dot
parasite-skill graph --ecosystem --mmd
parasite-skill graph --ecosystem --json --public   # safe for public Pages/artifacts
```

The typed graph models:

- skills and their asset groups (`references`, `templates`, `scripts`, `hooks`, `tools`, and similar directories);
- built-in, custom, and project skill-sets;
- detected client destinations and installed copies;
- parasite extension directories and injection counts;
- MCP registration targets;
- known global/per-client rule paths;
- declarative agent profiles and the tools they may call.

`graph --dot` and `graph --mmd` are suitable for Graphviz and Mermaid. The legacy skill vocabulary graph remains available with `parasite-skill graph --dot` without `--ecosystem`. The `ix` skill can map this repository for symbol-level callers, callees, impact, and smells; the generated ecosystem graph is the portable package-level view and does not vendor Ix.

`export` and private `wikis` inventories never publish file contents, secrets, environment values, or chat history. Use `--public` for graph/wiki artifacts intended for Pages: it removes filesystem paths and sanitizes generated descriptions while keeping only public metadata.

## Wiki lists each skill's AI-tools

`parasite-skill wikis` now mirrors the refs pages: the `Skills.md` index and
every per-skill wiki page carry a **Callable AI-Tools** section with the same
`<skill>__<asset>` tool names, languages, and schema markers, so the
human-readable wiki and the executable surface stay in lockstep.

## Refs list each skill's AI-tools

`parasite-skill refs` now includes a **Callable AI-Tools** section on every
skill's ref page — the exact `<skill>__<asset>` tool names, their language,
whether they declare an `argsSchema`, and a short description. The refs index
and per-skill pages become the human-readable twin of `tools list`, so the
readable inventory and the executable surface never disagree.

## Declarative agent profiles and sets

The repository includes focused profiles for:

- `ecosystem-architect`
- `release-engineer`
- `security-auditor`
- `mcp-integrator`
- `frontend-verifier`
- `history-recovery`

They are routing recipes, not hidden autonomous processes. Each profile lists skills, sets, asset groups, MCP tools, clients, and guardrails. Matching role sets are available as `agent-ecosystem`, `agent-release`, `agent-security`, `agent-mcp`, `agent-frontend`, and `agent-history`.

Create project-specific sets without editing the package:

```bash
parasite-skill sets --new my-release --members "git-workflow-and-versioning,verification-before-completion" --desc "release checks"
parasite-skill sets --add my-release:shipping-and-launch
parasite-skill sets --apply my-release
```

## Adapters and parasite extensions

The adapter boundary is explicit:

```bash
parasite-skill mcp add --clients claude-code,cursor
parasite-skill mcp list
parasite-skill mcp remove

parasite-skill parasite --status
parasite-skill parasite --add --agent claude-code --type hook --code "console.log('active')"
parasite-skill parasite --toggle injection-id --enable
parasite-skill parasite --remove injection-id
parasite-skill parasite --hook vite --out vite-plugin.js
parasite-skill parasite --wrap --server ./upstream-server.js --out wrapped-server.js
```

Supported paths are configured explicitly and existing JSON files are backed up before writes. Generated build hooks and server wrappers leave upstream source files unchanged.

No local adapter can universally inject into arbitrary closed-source clients, rewrite a remote MCP server, bypass a client sandbox, or silently modify global rules. Such a client needs an approved plugin/configuration surface, an explicit wrapper, or a separately implemented adapter. `--status` reports actual local state; it does not imply capabilities that are not present.

## LLM and history boundaries

Direct model calls are opt-in and provider-neutral:

```bash
PARASITE_SKILL_LLM_URL=http://localhost:11434/v1 \
PARASITE_SKILL_LLM_MODEL=local-model \
parasite-skill llm "review this routing plan"
```

Local endpoints are allowed by default. External HTTPS endpoints require `--allow-remote`; redirects are disabled and response/output sizes are bounded. Prefer `PARASITE_SKILL_LLM_API_KEY` over command-line keys.

When the registry contains runnable skill tools, `llm` exposes them to the
model as native functions and executes the tool calls it makes, feeding the
redacted results back in a loop (max `--max-tool-calls` iterations, default 8)
until the model produces a final answer. Disable with `--no-tools`. Add
`--tool-dry-run` to preview the model's tool calls instead: each requested tool
is resolved and reported as the exact command that *would* run, but nothing is
ever executed or recorded.

Freebuff history recovery is explicit:

```bash
parasite-skill history discover
parasite-skill history import --file ./exported-transcript.json
```

The command does not scrape chat history automatically. It reads only a selected file, bounds the read, redacts common secrets, paths, and email addresses, and never modifies the original.

## GitHub Pages distribution

The `GitHub Pages` workflow publishes on `main`:

- the generated wiki and agent profile pages;
- `ecosystem-graph.json`;
- `install.json`;
- the zero-npm skill bundle;
- a small landing page.

The workflow uses a temporary isolated registry and does not publish user data. It requires Pages to be enabled with the GitHub Actions source in repository settings.

## Development

```bash
npm test -- --runInBand
npm run check
npm run pack:smoke
npm pack --dry-run --json
```

The package has no runtime dependency. The smoke test exercises the actual packed tarball. CI also rejects cache/test files in the npm artifact and rejects `Co-authored-by:` trailers across the checked commit range.

For repository structure and impact analysis, use the installed Ix skill when available:

```bash
ix map --silent
ix status
ix stats
ix impact cmdGraph --format llm
```

Ix is an optional local dependency graph, backed by the installed Ix service. It is not bundled into this package and is not required for routing or Pages.

## License

MIT
