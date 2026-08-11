# Research: the agent-skills ecosystem (2026-08-11)

Everything below was gathered from the sources cited, to shape skill-router.
Patterns adopted are marked **[adopted]**.

## skills.sh (Vercel Labs) — github.com/vercel-labs/skills, skills.sh

The package manager + registry for agent skills. What we copied:

- `npx skills add <source>`, `-g` for global scope -> `~/<agent>/skills/`, project scope -> `./<agent>/skills/` **[adopted: --global/--project]**
- Default install uses **symlinks to a canonical copy**; independent copy as fallback **[adopted: --link/--copy]**
- Auto-detects installed agents; `-a/--agent <agents...>` and `--all` targeting **[adopted: --agent/--all]**
- Supports **76+ agents**; install targets are per-client path conventions
- Skills live in `<agent>/skills/` per client; verified paths for 12 major clients in `src/clients.js`

## Agent Skills open standard — agentskills.io/specification

- Skill = directory whose name **must equal** the `name` frontmatter field
- `name`: 1-64 chars, lowercase alnum + hyphens; `description`: 1-1024 chars (what + when + trigger keywords)
- Optional: `license`, `compatibility` (<=500), `metadata`, `allowed-tools`
- Optional dirs: `scripts/`, `references/`, `assets/`
- Progressive disclosure: catalog (name+description) -> SKILL.md body on trigger (<5000 tokens) -> resources on demand
- Scopes: project `.claude/skills`, `.agents/skills`; user `~/.claude/skills`, `~/.agents/skills`; project overrides user
- **[adopted]**: `--validate` enforces name=dirname, name format, description bounds; scan order = later dirs win

## Claude Code conventions

User `~/.claude/skills/`, project `.claude/skills/`; descriptions drive automatic triggering; concise SKILL.md + bundled refs.

## Marketplaces

- **awesomeskill.ai** — 50,000+ skills cataloged; categories: developer tools, API dev, data science, productivity, devops, web dev, testing, MCP tools. Template skills: `SKILL.md` + scripts/references/assets. **[adopted]**: our frontmatter + bundled-resource anatomy matches the template-skill shape.
- **mcpservers.org/agent-skills** — official + community skill packages from Anthropic, OpenAI, GitHub, Microsoft, Cloudflare, Vercel, Stripe, Figma.

## GitHub repos + star analysis (mid-2026)

| Repo | Stars | What it is | Pattern worth copying |
|---|---|---|---|
| dair-ai/Prompt-Engineering-Guide | ~77,400 | The prompt engineering reference | Taxonomic separation of prompt paradigms **[adopted: separate refs per concern]** |
| karpathy/autoresearch | ~42,000 | Autonomous ML research loop, 5-min budget, single editable file | Strict file-scope + time-budget constraints |
| obra/superpowers | ~32,000 | Full dev methodology; brainstorming -> specs -> 2-5 min atomic tasks; worktree isolation | Mandatory git worktree isolation before edits **[adopted: always-on cadence discipline]** |
| addyosmani/agent-skills | ~24,500 | 24 production skills + personas; `npx skills add addyosmani/agent-skills` | Anti-rationalization tables mapping agent excuses to rebuttals **[adopted: verification-before-completion gates]** |
| mattpocock/skills | ~20,400 | Lean practical skills; `npx skills@latest add mattpocock/skills` | Dual-invocation (user vs model invoked) + project glossary (CONTEXT.md) |
| affaan-m/ECC | ~212,000 | 68 agents / 285 skills harness; `npx ecc-universal setup` | Guided multi-harness preflight wizard: preview, dependency-check, verify before writing **[adopted: installer verifies SKILL.md after every install]** |
| x1xhlol/system-prompts-and-models-of-ai-tools | ~134k views | Crowdsourced extracted system prompts | Vendor meta-prompt defense patterns |
| anthropics/skills | (canonical) | The original skills repo | Format canon |
| voltagent/awesome-agent-skills | (canonical) | Curated skill list | Discovery patterns |

Other sources consulted: promptingguide.ai, gofastmcp.com (FastMCP/MCP extension path),
and the `npx skills` CLI docs.

## Alot1z profile + stars (the user's own GitHub)

- Bio: full-stack web developer working in CRO, meta-prompting systems, and AI tooling harnesses.
- Pinned: **Alot1z/get-shit-indexed** — a meta-prompting / context-engineering / spec-driven
  development system for Claude Code, OpenCode, and Gemini CLI (a fork of get-shit-done with
  MCP tool integration claiming 80-90% token savings vs native tools).
- Starred-repo trends (two independent readings, mid-2026): heavy weighting toward agent skills,
  MCP servers, CLI tooling, and context-engineering — the same clusters skill-router targets.
  Star counts fluctuate and the two readings disagree at times; treat as approximate ranges:

| Repo | Reading 1 | Reading 2 |
|---|---|---|
| addyosmani/agent-skills | ~24.5k | ~84k |
| obra/superpowers | ~32k | ~269k (implausibly high; suspect) |
| affaan-m/ECC | ~212k | ~239k |
| karpathy/autoresearch | ~42k | ~26-31k |
| dair-ai/Prompt-Engineering-Guide | ~77.4k | ~77.4k (stable) |
| x1xhlol/system-prompts-and-models-of-ai-tools | ~134k views | ~138k |
| mattpocock/skills | ~20.4k | (community framework) |

Takeaway for skill-router: the ecosystem is shifting from prompt engineering toward
context engineering + agentic skill frameworks + token-efficient MCP harnesses — which is
precisely the design space this package occupies (registry + routing + cadence + MCP-ready).

## Design consequences

1. Registry is a shared JSON (`~/.agents/skills/.skill-router/registry.json`) read by both the JS and Python engines.
2. The installer never touches a client skills-dir root: it always installs to `<dir>/skill-router` (tested; an early bug wrote into the root — caught by sandbox tests).
3. Scores are hypotheses; SKILL.md mandates an agent judgment layer (per addyosmani's anti-rationalization approach).
4. Refs/wikis live in the central registry; `link` creates per-skill junctions/symlinks + `.skill-router.links.json` manifests, never hardcoded vendor content.
