# Official Specification Grounding

Facts verified against official sources on 2026-08-11. The router implements these rules in `--validate`.

## Agent Skills Open Standard

Source: https://agentskills.io/specification (spun out of the Anthropic skills format; adopted by Claude Code, Copilot, and others).

- A skill is a self-contained directory whose name **must match** the `name` field in its `SKILL.md` frontmatter.
- `SKILL.md` is required: YAML frontmatter + markdown body.
- Required frontmatter:
  - `name` — 1-64 chars, lowercase unicode alphanumerics and hyphens only; must not start/end with a hyphen; no consecutive hyphens.
  - `description` — 1-1024 chars, non-empty; must state *what* the skill does and *when* to use it, with trigger keywords.
- Optional frontmatter: `license`, `compatibility` (<=500 chars), `metadata` (string map), `allowed-tools` (experimental).
- Optional resource dirs: `scripts/` (executable code), `references/` (on-demand docs), `assets/` (templates/schemas/static files).
- **Progressive disclosure** (3 tiers):
  1. Catalog: name + description only (~50-100 tokens/skill) — always in context.
  2. Instructions: full SKILL.md body on trigger (<5000 tokens recommended; keep under 500 lines).
  3. Resources: individual scripts/references/assets loaded only when pointed at.
- Discovery scopes: project `.claude/skills/`, project `.agents/skills/`, user `~/.claude/skills/`, user `~/.agents/skills/`. Project overrides user on name collision.

## Claude Code Conventions

- User skills: `~/.claude/skills/`; project skills: `.claude/skills/` (checked into the repo).
- Same SKILL.md frontmatter contract; descriptions drive automatic triggering.
- Best practices: precise action-oriented descriptions; modular single-purpose skills; concise SKILL.md with reference material in bundled files.

## MCP and FastMCP (extension path)

Source: https://gofastmcp.com/getting-started/welcome

- MCP (Model Context Protocol) is the open standard for exposing tools/resources/prompts to AI hosts. Any MCP-compatible host can use a server without per-platform integration code.
- FastMCP (Prefect) is a high-level framework over MCP: servers, clients, and apps (interactive UI components). Available in Python (`fastmcp`) and TypeScript (`@prefecthq/fastmcp-ts`); the Go ecosystem has fast-MCP implementations too (gofastmcp.com is the Go entry point).
- Relation to skills: skills carry *procedure* (instructions); MCP servers carry *tools* (execution). A skill can point at an MCP server it relies on. The router stays language-agnostic: it detects bundled scripts in any language and records them in the registry, so MCP/Go/Rust/Java tooling is indexed the same as Python/Bun scripts.

## How parasite-skill Implements This

- `--scan` discovers skills from all four scope dirs, parses frontmatter, detects bundled script languages, infers tags/keywords.
- `--validate` checks: SKILL.md exists, name matches directory name, name format regex, description present and 1-1024 chars. Non-conforming skills are reported, not skipped.
- `--link` creates per-skill junctions/symlinks + `.parasite-skill.links.json` manifests so refs/wikis are reachable from each skill dir without editing vendor content.
