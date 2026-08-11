# skill-router

Route any request to the right agent skills. One package, every AI client.

`skill-router` scans the whole skill ecosystem (user + Claude Code + project scopes),
validates every skill against the official [Agent Skills spec](https://agentskills.io/specification),
routes an idea text to the best skills and skill-sets (IDF-weighted keyword scoring +
an agent judgment layer), generates refs/wikis, and installs the `skill-router`
skill itself into any AI coding client — **copy or symlink**, one command.

- One codebase, zero build: plain ESM JavaScript that runs under **Bun** (`bunx`) and **Node** (`npx`).
- A Python twin engine (`scripts/conductor.py`) shares the same `registry.json` for the `++` anything path.
- Multi-client: Claude Code, Codex, OpenCode, Cline, Cursor, Windsurf, Gemini CLI, Warp, GitHub Copilot, Continue, Zed, and the universal `~/.agents/skills`.

## Quickstart

```bash
# run without installing the npm package
bunx skill-router --help        # or: npx skill-router --help

# local package, no registry publish (as requested):
bun /e/E-github-repos/skill-router-soucecode/bin/skill-router.js install --yes
npx --yes /e/E-github-repos/skill-router-soucecode install --yes --force
# or link it globally once:
npm install -g /e/E-github-repos/skill-router-soucecode && skill-router install --yes
```

## Install (custom CLI install session)

```bash
bun bin/skill-router.js install            # interactive: pick clients
bun bin/skill-router.js install --yes      # auto: every detected client
bun bin/skill-router.js install --yes --link       # symlink/junction (single source of truth)
bun bin/skill-router.js install --yes --copy       # independent copy (default)
bun bin/skill-router.js install -a claude-code,codex,opencode   # specific clients
bun bin/skill-router.js install --project            # install into ./<client>/skills instead
bun bin/skill-router.js list                 # show installed instances
bun bin/skill-router.js remove --yes         # uninstall from detected clients
bun bin/skill-router.js install --yes --dest <path>   # install to any custom path
bun bin/skill-router.js install --yes --dest <path> --link   # custom path, symlink mode
bun bin/skill-router.js mcp add             # auto-register the MCP server in client configs (no manual config)
bun bin/skill-router.js mcp remove          # remove MCP registration
```

`--dest` installs to any directory you choose — not just the known client paths.
Works with both `--copy` (default) and `--link` (junction/symlink).

The installer detects which clients you have, dedupes shared directories
(e.g. Cline/Warp/Zed all read `~/.agents/skills`), and verifies `SKILL.md`
exists after every install. Symlinks fall back to Windows junctions automatically.
The interactive mode is a custom TUI: arrow keys + space to pick clients, live
progress bar, custom logo — no package installs required.

## Routing

```bash
bun bin/skill-router.js scan                    # re-analyze the ecosystem
bun bin/skill-router.js validate                # spec-check all skills (exit 1 on issues)
bun bin/skill-router.js route "write api docs for a new rest endpoint" --set
bun bin/skill-router.js route "create a new skill" --set skill-authoring   # route within ONE set
bun bin/skill-router.js plan "build a frontend todo app with auth"
bun bin/skill-router.js sets --apply thinking   # load order for a skill-set
SKILL_ROUTER_HOME=/tmp/sandbox skill-router route "idea"   # full env isolation for any command
bun bin/skill-router.js refs                    # generate ref pages
bun bin/skill-router.js wikis                   # wiki + graph.dot + graph.mmd
bun bin/skill-router.js trace session.log       # which skills a session used
bun bin/skill-router.js link                    # per-skill refs/wiki links (--unlink, --no-default)
```

Scoring is deterministic (tokenized, stemmed, IDF-weighted; rare tokens weigh
more; name matches get a bonus). It is a ranked *hypothesis* — the skill's
SKILL.md instructs the agent to re-verify and apply semantic judgment.

`route --set <name>` restricts scoring to one skill-set (custom sets from
`sets --new` work too — e.g. `--set skill-authoring`), and `SKILL_ROUTER_HOME`
redirects the registry/installs/MCP for sandboxed runs. The MCP route tool
accepts the same optional `set` argument.

## Skill-sets

Named bundles activated in one word: `thinking`, `research`, `planning`, `build`,
`docs`, `review`, `frontend`, `ops`, `intelligence`. Composable — a docs task is
`planning x docs x thinking`.

## Always-on cadence

Thinking skills are re-invoked *throughout* execution, not once at the start:
`tractatus-thinking` + `sequential-thinking` before tool use, `doubt-driven-development`
before every non-trivial decision, `debug-thinking` on failure, `stop-slop` before
prose, `verification-before-completion` + review after every milestone.

## Development

```bash
bun test          # engine unit tests
bun run scan      # refresh registry.json
SKILL_ROUTER_HOME=/tmp/fake-home bun bin/skill-router.js install --yes   # sandbox install
```

See `docs/RESEARCH.md` for the ecosystem research that shaped this package
(skills.sh, agentskills.io, 10+ starred repos, star analysis).

## Beyond the CLI

- **No-npm install from GitHub Pages** — `bundle` builds a tarball + `install.json`;
  the included `.github/workflows/deploy-pages.yml` serves it, and
  `scripts/gh-install.sh` installs with a single curl (no node/npm/bun needed).
- **Polyglot MCP** — the server ships in JS (`src/mcp-server.js`, runs under
  bun and node) and Python (`scripts/mcp_server.py`) with identical JSON-RPC
  protocol and tools. Boots in ~0.3s, zero resident memory.
- **Cloud sync** — `sync --init <repo> / --push / --pull` backs up the whole
  skills tree to git; the `template/` dir is a ready-made repo for it.
- **Skill-sets editor** — `sets --new/--add/--remove` create custom sets
  persisted to `sets.custom.json` (marked `*` in listings).
- **AGENTS.md generator** — `agents` writes a project AGENTS.md with the full
  skill inventory + always-on cadence.
- **IX-inspired graph** — `graph --dot|--mmd` emits a skill-relatedness graph
  (Jaccard over keywords). Self-contained; no upstream code vendored, so
  upstream ix updates can never conflict.
- **Manifest-based language detection** — the scanner reads `Cargo.toml`,
  `go.mod`, `package.json`, `pyproject.toml` and more, so a skill with only
  build manifests is still tagged `rust`/`go`/etc. The skill payload also ships
  `fast_scan.rs`, a zero-dependency Rust scanner for very large skill trees
  (pattern from the Rust CLI tools in the starred-repo research).
- **Scan timing** — `scan` reports elapsed ms (110ms for 84 skills).
- **Privacy-clean** — the repo contains no usernames, hardcoded home paths,
  tokens, or emails (verified by an automated scan). All machine paths are
  resolved at runtime from `os.homedir()`.

## License

MIT
