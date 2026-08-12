# Changelog

All notable changes to parasite-skill are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/), and the
project aims for [Semantic Versioning](https://semver.org/).

## [1.2.0] - 2026-08-12

The tools release. parasite-skill grew a first-class tool layer: an
inventory of every callable AI-tool, a scoped policy engine, an audit
ledger with its own lifecycle, garbage collection with a TTL policy and
automatic sweeps, native tool-calling in the `llm` loop, and a `doctor`
that checks the whole installation. The Python twin reached parity across
most of it, and CI grew from a smoke test into a release gate.

### Added

#### Tool inventory and policy

- `tools list` enumerates every callable tool in the registry, with
  `--skill <glob>` and `--risk <level>` filters. JSON output carries each
  tool's static-audit risk; the join is lazy, so a plain list pays no
  per-asset read cost.
- `tools policy` reads and edits the project tools policy (allow/deny/env/
  timeoutMs/scoped rules) from the CLI. `--dry-run` previews, `--drop-policy`
  removes the block, `--policy-file` targets another config.
- Scoped policy rules (`profile:<name>`, `sets:<set>`) let each agent
  profile's tools obey its own rules.
- Skills can declare tool metadata in SKILL.md frontmatter (`tools:` JSON
  block): description overrides and an `argsSchema` for typed tool calls.
- `tools verify` checks tool readiness — script exists, policy status,
  schema shape — and exits 1 when any tool is broken.
- `tools audit` runs a static risk scan (never executes anything) and can
  persist a baseline with `--write-baseline`. Later runs diff against it:
  a new tool is drift, a low→high risk move is a regression and exits 1.
- `tools docs` generates a TOOLS.md reference of the callable surface.
  `--out` is absolute-path safe.

#### Execution

- `tools run <name>` executes one tool with a time bound and captured,
  redacted output. Typed `--json-args` are validated against the tool's
  declared `argsSchema`; invalid args exit 3. `--tool-env KEY=VALUE` sets
  inline env for a single run.
- `tools run-batch` runs tools sequentially against a shared audit ledger,
  with `--continue`, a per-tool json-args map, and `--dry-run` previews
  that print the exact commands without executing or touching the ledger.
- A per-tool declared `timeoutMs` in frontmatter acts as the execution
  fallback; the project `tools.timeoutMs` and an explicit `--timeout-ms`
  still win.

#### Audit ledger

- Every executed tool run (CLI, agents, llm, MCP, both twins) appends to
  `tool-runs.jsonl` in the registry, capped at 5000 entries.
- `tools ledger --stats` reports integrity (valid/corrupt/out-of-order
  lines) plus aggregates — ok/fail counts, average duration, per-skill and
  per-tool breakdowns — and exits 2 on corrupt lines.
- `tools ledger --export <file>` dumps the full ledger as a JSON array;
  `--purge` clears it.
- `tools history` filters the ledger by name, skill, status, and a
  `--since`/`--until` time window.

#### Garbage collection and retention

- `tools gc [--age N] [--keep N]` prunes stale agent report and dry-run
  files by mtime and audit-ledger entries by timestamp. `--dry-run`
  previews, `--json` reports, and running without any knob exits 1.
- Project TTL policy in `parasite-skill.json` — `"gc": { "ageDays",
  "keep", "auto" }` — is merged by the engine; `tools gc` falls back to it
  when no CLI knobs are given. `tools gc --status` shows the posture:
  policy, last/next sweep, throttle state, stale count.
- Ledger retention: `"gc": { "ledger": { "ageDays", "keep" } }` gives the
  audit ledger its own expiry schedule, independent of the agent-report
  TTL, with `--ledger-age`/`--ledger-keep` CLI equivalents and fallback to
  the shared knobs.
- Scheduled auto-gc: with `"auto": true`, the sweep runs at the scan,
  export, and doctor entry points — best-effort, one stderr note, never
  throws, never changes the host command's exit code.
- `gc.intervalDays` throttles the auto sweep to at most once per N days
  via a timestamped marker shared by both twins. A throttled sweep prints
  "auto-gc: skipped" and never fails doctor; only stale artifacts
  surviving an executed sweep fail the doctor gc check.

#### LLM tool-calling

- `llm` now executes model-requested tools in a real tool-calling loop,
  capped at `max_tool_calls`, feeds results back, and records executed
  calls in the audit ledger.
- `--tool-dry-run` previews model tool calls as would-run commands without
  executing or recording anything.
- Declared schemas are presented to the model and structured args are
  validated against them. `llm --json` includes a `tool_calls` trace with
  per-call name/status/ok/duration_ms/dry_run.

#### Agent profiles

- `agents list` and `agents show <profile>` inventory the shipped
  profiles; `agents run` executes them with `--all`, `--profiles a,b`,
  `--continue`, `--names`, `--json`, and `--min-tools N`.
- `agents run --dry-run` writes preview reports (`.dryrun.md` / `.dryrun.json`)
  listing every command a profile would run; nothing executes and the
  ledger stays untouched.
- `--strict` exits 2 when any selected tool is policy-blocked, wired
  through single-profile, `--all`, dry-run, and real runs.

#### Health checks

- `doctor` runs a one-shot health check: spec validation, tool readiness,
  audit baseline or high-risk gate, project config parse, registry
  freshness, ledger integrity, and MCP registration. The first failing
  check exits 1; `--json` is supported.
- The auto-gc sweep runs before the doctor gc check, so doctor reports
  post-sweep state. Genuinely stuck TTL cleanup still fails the check.

#### Registry and routing

- `registryStale`: any SKILL.md newer than `registry.json` (2s coarse-mtime
  epsilon) makes the cache stale; `loadRegistry` re-scans automatically and
  `route` prints a one-line stderr note. Python `load_registry` mirrors it.
- Hyphen routing: multi-word ideas like "fresh skill" now match
  hyphenated skill names like `fresh-skill`. Hyphen/underscore tokens are
  split at scan-keyword time and in scoreIdea/ids name matching, in both
  twins.

#### Export, sync, trace, refs, wikis

- `export` records the tool inventory (name/skill/language/risk/declared
  timeout/schema), the callable-tool count, the gc posture (including
  interval and the ledger sub-policy), audit-ledger stats, and the sync
  backup posture. It runs the auto-gc sweep before inventorying, so the
  numbers reflect post-gc state.
- `export --public` strips filesystem paths from the output and basenames
  the rest, marked `public: true`.
- `sync --push/--pull --dry-run` previews via `git add -A --dry-run` and
  `git fetch --dry-run` — nothing staged, committed, or fetched.
- `trace` aggregates a directory or multiple transcript files (each read
  once) and counts ledger tool runs alongside skill mentions.
- `refs` pages and wiki skill pages list each skill's callable tools
  (name, language, schema presence); the compose payload lists selected
  skills' tools.

#### MCP, both twins

- The JS MCP server gained `skill_tools_history`, `skill_tools_gc`,
  `skill_tools_ledger`, `skill_tools_export`, `skill_tools_llm`, and a
  `doctor` tool. The Python twin gained the same surface plus
  `skill_tools_ledger` and doctor ledger/freshness checks.
- `skill_tools_run` accepts typed `json_args`; `skill_tools_gc` accepts
  `age_days`/`keep` and `ledger_age_days`/`ledger_keep`.

### Fixed

- Windows: the Python twin's `scan_assets` used absolute path parts for
  the dot-directory check, so every asset was skipped when the skills root
  itself was a dot-directory (`PARASITE_SKILL_HOME/.agents/skills`) — the
  Python tool surface was empty after any real scan. Now checks relative
  parts, with a regression test.
- `tools docs --out` and `tools ledger --export` absolute-path escapes.
- The Python twin's `do_doctor` crashed with `policy.get` on None when no
  gc policy was set.
- CI: the python parity gate referenced `reg` across a heredoc boundary
  (two separate processes) — `NameError: name 'reg' is not defined`. The
  gate now redefines it standalone.

### Changed

- The test suite grew from 120 to 206 tests across this release.
- `skill/SKILL.md` cut from 171 to 58 lines: the injected skill is now a
  compact dispatch doc (contract, core commands, cadence, privacy
  boundary). Flag tables, sets, project config, and the parasite layer
  moved to `references/full-skill.md`, read on demand — installing or
  refreshing no longer pushes a 336-line document into every chat
  session that invokes the skill.
- CI is now a release gate: it writes the audit baseline first (approving
  the shipped subprocess-using scripts), then runs doctor, verify,
  baseline-diff, and `agents run --dry-run --strict` in an isolated
  `PARASITE_SKILL_HOME`, plus a ledger lifecycle gate and an auto-gc sweep
  gate that asserts the sweep note on stderr.

## [1.1.0] - 2026-08-11

Rename and configuration release.

### Added

- Project configuration via `parasite-skill.json` (or `.parasite-skill.json`),
  found by walking up from the working directory: registry path, scan
  dirs, default set, force, project skill-sets, `enabledSets` (route only
  within a set union), `excludeSkills`, route knobs (`top`/`minScore`),
  per-project `env` isolation, a parasite-layer toggle with client
  allowlist, and a client allowlist. CLI flags always win.
- `export`: an ecosystem inventory (skills, sets, clients, parasite
  extensions, MCP registrations, rule files) into human-ready
  `ECOSYSTEM.md` and LLM-ready `ecosystem.json` — paths and names only,
  never contents.
- `parasite-skill.example.json` shipped: a commented template of the full
  project config, copyable to `parasite-skill.json`.
- Six mega skill-sets — brainstorm-max, plan-execute, research-deep,
  thinking-max, mega-injector, token-saver — plus three multiplicative
  pairs, and `sets --template` with a new-set design template.
- Scan follows symlink/junction skill dirs, so `--link`-installed skills
  are discovered (regression-tested).
- GitHub Pages release of the ecosystem graph and bundle artifacts.

### Changed

- Renamed from skill-router to parasite-skill everywhere: package, CLI,
  registry directory, MCP server, env var (`PARASITE_SKILL_HOME`), docs,
  and tests.
- Routing documented as two layers: name + description keywords at full
  weight, SKILL.md body keywords at half weight (3+ char tokens).
- Fixed a latent `generateServerWrapper` crash (eager template
  interpolation of `${enhancement.code}`) by inlining case bodies at
  generation time.
- GitHub Pages deployment workflow: temporarily removed while the push
  token was refreshed with workflow scope, then restored.

## [1.0.0] - 2026-08-11

Initial release, as skill-router.

### Added

- Core engine: scan, validate, route, plan, compose, refs, wikis, link,
  trace, sets, graph, sync, bundle, agents, refresh, and install commands.
- A 25-client registry of AI coding clients with per-client install paths.
- A custom TUI installer.
- MCP auto-registration into client configs (JS + Python).
- GitHub Pages no-npm distribution (tarball + install.json).
- Skill-set editor (`--new`/`--add`/`--remove`/`--delete` custom sets),
  within-set routing (`--set`), a custom install path (`--dest`, copy and
  link modes), Rust manifest detection with a `fast_scan.rs` helper, and a
  multicolor gradient logo.
- The parasite extension system: runtime injection without source
  modification — per-client extension folders, build-time hooks (Vite and
  webpack plugins), server wrapping, and traceability protection
  (light/medium/heavy levels).
- Cloud sync (`--sync --init/--push/--pull`), an AGENTS.md generator, and
  a relatedness graph (DOT + Mermaid) over skill keywords.

[1.2.0]: https://github.com/Alot1z/parasite-skill/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Alot1z/parasite-skill/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Alot1z/parasite-skill/releases/tag/v1.0.0
