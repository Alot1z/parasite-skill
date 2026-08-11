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

`compose` is the runtime boundary. It returns selected skills, rationale, relevant asset metadata, small safe excerpts, execution order, and verification cadence. Full skill documents, scripts, hooks, and templates remain on demand instead of being pasted into the chat.

Routing is deterministic and inspectable: token and body-keyword matches, request mode, tags, explicit skill names, project set filters, and exclusions contribute to the result. The model still makes the semantic decision; scores are candidates, not proof.

Project defaults live in `parasite-skill.json` or `.parasite-skill.json` and can define registry/scan paths, sets, enabled sets, exclusions, output limits, client allowlists, isolated environment keys, and the parasite toggle. `PARASITE_SKILL_HOME` isolates the complete runtime for tests or sandboxes.

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
