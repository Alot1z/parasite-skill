# parasite-skill

Route any request to the right agent skills. Scans the skill ecosystem, validates skills against the Agent Skills spec, routes ideas to skills and skill-sets, and installs itself into any AI client via copy or symlink.

Extends this with a runtime injection system: enhancements are applied without modifying the client's source files.

## What it does

- Scans skill directories (user, Claude Code, project) and builds a registry
- Validates each skill against the official spec: name equals directory name, description 1-1024 chars, name format
- Scores an idea against every skill using IDF-weighted keyword scoring
- Groups skills into named sets (thinking, research, planning, build, docs, review, frontend, ops, intelligence)
- Generates ref pages, a wiki, and a relatedness graph
- Installs the skill into AI clients: Claude Code, Codex, OpenCode, Cline, Cursor, Windsurf, Gemini CLI, Warp, GitHub Copilot, Continue, Zed, and `~/.agents/skills`
- Injects runtime enhancements into clients without touching their source

## Install

```bash
# npm
npm install -g parasite-skill

# bun
bun add -g parasite-skill

# run without installing
npx parasite-skill --help
```

Install the skill into clients:

```bash
parasite-skill install                # interactive: pick clients
parasite-skill install --yes          # auto: every detected client
parasite-skill install --yes --link   # symlink/junction instead of copy
parasite-skill install -a claude-code,codex,opencode
parasite-skill install --project      # install into ./<client>/skills
parasite-skill list                   # show installed instances
parasite-skill remove --yes           # uninstall from detected clients
parasite-skill refresh                # update all installed copies
```

The installer detects which clients you have, dedupes shared directories, and verifies SKILL.md exists after every install. Symlinks fall back to Windows junctions automatically.

## Routing

```bash
parasite-skill scan                                # rebuild the registry
parasite-skill validate                            # spec-check all skills, exit 1 on issues
parasite-skill route "write api docs for a rest endpoint"
parasite-skill route "create a new skill" --set build   # route within one set
parasite-skill plan "build a todo app with auth"
parasite-skill sets --apply thinking               # load order for a set
parasite-skill refs                                # generate ref pages
parasite-skill wikis                               # wiki + graph.dot + graph.mmd
parasite-skill trace session.log                   # which skills a session used
parasite-skill graph --dot                         # relatedness graph
```

Scoring is deterministic: tokenized, stemmed, IDF-weighted. It returns a ranked hypothesis. The SKILL.md instructs agents to re-verify and apply judgment.

`route --set <name>` restricts scoring to one set. Custom sets from `sets --new` work too.

## Project config

A `parasite-skill.json` (or `.parasite-skill.json`) in the project root sets defaults. The CLI walks up from the working directory to find it.

```json
{
  "registry": "./.parasite-skill",
  "dirs": ["./skills", "./.agents/skills"],
  "defaultSet": "build",
  "force": false
}
```

CLI flags override config values.

## Parasite extension system

`parasite-skill parasite` manages runtime injections.

```bash
parasite-skill parasite --status                      # injection status per client
parasite-skill parasite --add --agent claude-code --type hook --code "console.log('x')"
parasite-skill parasite --toggle injection-1723 --enable
parasite-skill parasite --remove injection-1723
```

Injections are stored in a `.parasite-skill-extensions/` folder per client, tracked in a `parasite-manifest.json`. Original files are never modified. Each injection can be toggled or removed.

Injection types: `pre-init` (before client init), `post-init` (after init), `middleware` (HTTP middleware), `hook` (wrap existing functions).

### Build hooks

```bash
parasite-skill parasite --hook vite --out vite-plugin.js
parasite-skill parasite --hook webpack --out webpack-plugin.js
```

Generates a plugin that injects pre-init code into the HTML build.

### Server wrapping

```bash
parasite-skill parasite --wrap --server ./upstream-server.js --out wrapped-server.js
```

Generates a module that imports the upstream server, applies enhancement layers (middleware, routes, hooks), and re-exports.

### Traceability protection

```bash
parasite-skill parasite --protect --file input.js --level medium --out protected.js
```

Levels: `light` (strip comments, minify), `medium` (rename variables, add dead code), `heavy` (obfuscate with control flow).

## Skill-sets

| Set | Members |
|---|---|
| thinking | tractatus-thinking, sequential-thinking, doubt-driven-development, debug-thinking |
| research | deepwiki, context7, find-docs, web-reader, source-driven-development |
| planning | brainstorming, spec-driven-development, writing-plans, planning-and-task-breakdown |
| build | incremental-implementation, api-and-interface-design, system-connector, tdd |
| docs | documentation-writer, readme-skill, stop-slop, documentation-and-adrs |
| review | code-review-and-quality, verification-before-completion, code-simplification |
| frontend | frontend-ui-engineering, frontend-design, browser-testing-with-devtools |
| ops | ci-cd-and-automation, shipping-and-launch, observability-and-instrumentation |
| intelligence | ix, understand, code-review-graph, knip |
| all | every registered skill |

Custom sets:

```bash
parasite-skill sets --new my-set --members "brainstorming,tdd" --desc "my workflow"
parasite-skill sets --add my-set:code-review-and-quality
parasite-skill sets --remove my-set:code-review-and-quality
parasite-skill sets --delete my-set
```

Custom sets persist to `sets.custom.json` in the registry and show a `*` marker in listings.

## MCP

```bash
parasite-skill mcp add       # register the MCP server in client configs
parasite-skill mcp remove
parasite-skill mcp list
```

The server ships in JS (`src/mcp-server.js`) and Python (`scripts/mcp_server.py`) with the same protocol and tools.

## Sync

```bash
parasite-skill sync --init <repo-url>
parasite-skill sync --push
parasite-skill sync --pull
```

Backs up the whole skills tree to a git remote. The `template/` dir is a ready-made sync repo.

## Development

```bash
bun test          # engine unit tests
bun run scan      # refresh registry.json
```

`PARASITE_SKILL_HOME=/tmp/sandbox parasite-skill <cmd>` redirects the registry, installs, and MCP for isolated runs.

## License

MIT
