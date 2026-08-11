#!/usr/bin/env python3
"""
skill-router engine — Python edition (Python 3.14+).

Scans the skill ecosystem, validates against the Agent Skills open spec,
routes requests to skills and skill-sets, generates refs/wikis, plans
execution, traces usage, and manages adaptive links (junction/symlink +
manifest). Shares registry.json with the Bun/TypeScript twin (router.ts).

Commands:
  scan      --dirs a,b   --force   Rebuild registry.json
  validate  --dirs a,b             Check skills against the spec
  route     "<idea>"     --top N   --json   --set    Score skills for an idea
  sets      [--apply NAME]          List sets / print load order
  plan      "<request>"             Route + best set -> phased plan (markdown)
  refs      [--per-skill]           Generate ref pages (central, optional per-skill)
  wikis                             Generate the wiki + graph
  trace     [file]                  Count skill usage in a transcript
  link      [--unlink]    --dirs a,b  Create/remove adaptive links

Global flags:
  --registry DIR   Override the central registry dir (default ~/.agents/skills/.skill-router)
  --json           Machine-readable output
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

VERSION = "1.0.0"
REGISTRY_NAME = ".skill-router"

STOPWORDS = set(
    "a an and or of to in for on with use when this that is are be was were it its as at by from into over after before "
    "between then what how all can not you your they them he she we will would could should may might must if than so such "
    "do does did have has had the their there here about which who whom any each more most other some only own same too "
    "very just also ever never once many few much well good great like using used use usage user users request idea text "
    "skill skills need needs want wants help would can will do".split()
)

TAG_RULES = {
    "security": ["security", "secure", "secret", "auth", "owasp", "vulnerab", "hardening", "privacy", "gitleaks"],
    "performance": ["perform", "fast", "optim", "latency", "cache", "speed", "bottleneck", "scale", "web vitals"],
    "frontend": ["frontend", "ui", "css", "html", "react", "component", "accessib", "design", "theme", "canvas", "art", "favicon", "typography"],
    "browser": ["browser", "playwright", "devtools", "web", "dom", "console", "screenshot", "chrome", "network"],
    "testing": ["test", "tdd", "red-green", "verif", "qa", "regression"],
    "debugging": ["debug", "fix", "error", "bug", "root-cause", "trace", "localize", "reproduce"],
    "research": ["documentation", "research", "wiki", "find", "retriev", "search", "source", "docs", "official"],
    "api": ["api", "mcp", "rest", "graphql", "endpoint", "sdk", "connector", "openapi", "interface", "integration", "schema"],
    "git": ["git", "commit", "branch", "worktree", "version", "ci", "cd", "deploy", "release", "pipeline", "action", "rollback"],
    "planning": ["plan", "spec", "task", "breakdown", "requirement", "story", "roadmap", "acceptance", "milestone"],
    "docs": ["doc", "readme", "adr", "write", "content", "prose", "guide", "manual", "communicat", "report"],
    "automation": ["autom", "cli", "script", "launcher", "pinokio", "computer", "desktop", "mcp", "orchestr"],
    "data": ["pdf", "docx", "pptx", "slide", "form", "table", "extract", "convert", "excel"],
    "thinking": ["think", "reason", "decompos", "logic", "proposition", "clarif", "question", "interview", "doubt", "sequential", "tractatus", "cognitive"],
    "codebase": ["codebase", "graph", "symbol", "architect", "module", "dependency", "knip", "unused", "refactor", "smell", "callers", "impact"],
}

LANG_EXT = {
    ".py": "python", ".pyw": "python",
    ".ts": "typescript", ".mts": "typescript", ".tsx": "typescript",
    ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".jsx": "javascript",
    ".go": "go", ".rs": "rust", ".java": "java", ".kt": "kotlin", ".kts": "kotlin",
    ".rb": "ruby", ".php": "php", ".sh": "shell", ".bash": "shell", ".zsh": "shell",
    ".ps1": "powershell", ".c": "c/c++", ".h": "c/c++", ".cpp": "c/c++", ".hpp": "c/c++",
    ".cc": "c/c++", ".cs": "csharp", ".swift": "swift", ".zig": "zig", ".lua": "lua",
    ".r": "r", ".sql": "sql",
}

SETS = {
    "thinking": ("Decompose, reason, doubt", ["tractatus-thinking", "sequential-thinking", "7-scared-circle-clarity", "debug-thinking", "doubt-driven-development"]),
    "research": ("Verify against real sources", ["deepwiki", "context7", "find-docs", "web-reader", "research", "gitingest", "source-driven-development"]),
    "planning": ("Idea -> spec -> tasks", ["interview-me", "brainstorming", "idea-refine", "spec-driven-development", "writing-plans", "planning-and-task-breakdown", "story-quality"]),
    "build": ("Implement in slices", ["incremental-implementation", "api-and-interface-design", "system-connector", "mcp-builder", "tdd", "test-driven-development", "autonomous-implementation-pattern"]),
    "docs": ("Write + keep docs honest", ["documentation-writer", "documentation-and-adrs", "readme-skill", "api-docs-skill", "internal-comms", "stop-slop", "docx", "pdf", "pptx"]),
    "review": ("Gate before merge", ["code-review-and-quality", "code-review-graph", "code-simplification", "verification-before-completion"]),
    "frontend": ("UI that actually works", ["frontend-design", "frontend-ui-engineering", "theme-factory", "artifacts-builder", "favicon", "browser-testing-with-devtools", "webapp-testing", "playwright-cli", "agent-browser"]),
    "ops": ("Ship safely", ["git-workflow-and-versioning", "using-git-worktrees", "ci-cd-and-automation", "github-actions-docs", "shipping-and-launch", "observability-and-instrumentation", "security-and-hardening"]),
    "intelligence": ("Understand the codebase", ["ix", "understand", "code-review-graph", "graphify", "improve-codebase-architecture", "knip"]),
}

MULTIPLICATIVE_PAIRS = [
    ("Correct implementation", ["source-driven-development", "incremental-implementation", "test-driven-development"]),
    ("Working UI", ["frontend-ui-engineering", "browser-testing-with-devtools", "webapp-testing"]),
    ("Safe launch", ["security-and-hardening", "ci-cd-and-automation", "observability-and-instrumentation", "shipping-and-launch"]),
    ("Right thing built", ["interview-me", "brainstorming", "spec-driven-development"]),
    ("Maintainable codebase", ["code-review-and-quality", "code-simplification", "documentation-and-adrs", "knip"]),
]


# ---------------------------------------------------------------- helpers

def home() -> Path:
    # SKILL_ROUTER_HOME overrides the home base everywhere (installs, sync, MCP,
    # registry) so sandboxed runs and tests stay fully isolated.
    override = os.environ.get("SKILL_ROUTER_HOME")
    return Path(override) if override else Path.home()


def registry_dir(override: str | None = None) -> Path:
    d = Path(override) if override else home() / ".agents" / "skills" / REGISTRY_NAME
    d.mkdir(parents=True, exist_ok=True)
    return d


def default_scan_dirs() -> list[Path]:
    dirs: list[Path] = []
    user = home() / ".agents" / "skills"
    if user.exists():
        dirs.append(user)
    claude = home() / ".claude" / "skills"
    if claude.exists():
        dirs.append(claude)
    for rel in (Path(".agents/skills"), Path(".claude/skills")):
        if rel.exists():
            dirs.append(rel)
    return dirs


def expand_dirs(extra: str | None) -> list[Path]:
    dirs = default_scan_dirs()
    if extra:
        for part in extra.split(","):
            p = Path(part.strip()).expanduser()
            if p.exists():
                dirs.append(p)
    seen: set[Path] = set()
    out: list[Path] = []
    for d in dirs:
        r = d.resolve()
        if r not in seen:
            seen.add(r)
            out.append(d)
    return out


def parse_frontmatter(text: str) -> dict[str, str]:
    """Minimal YAML frontmatter parser: name/description/other scalar keys,
    including folded block scalars (e.g. `description: >-`)."""
    meta: dict[str, str] = {}
    m = re.match(r"^---[ \t]*\r?\n(.*?)^---[ \t]*\r?\n", text, re.S | re.M)
    if not m:
        return meta
    lines = m.group(1).splitlines()
    key: str | None = None
    buf: list[str] = []
    in_block = False

    def commit() -> None:
        nonlocal key, buf
        if key is not None:
            meta[key] = " ".join(buf).strip() if buf else ""
        key, buf = None, []

    for raw in lines:
        line = raw.rstrip()
        if not line.strip():
            continue
        if in_block:
            if line[:1] in (" ", "\t"):
                buf.append(line.strip())
                continue
            in_block = False
        k, sep, rest = line.partition(":")
        if not sep or not re.match(r"^[A-Za-z0-9_-]+$", k.strip()):
            continue
        commit()
        key = k.strip()
        rest = rest.strip()
        if rest in ("", "|", ">", "|-", ">-", "|2", "|2-"):
            in_block = True
            buf = []
        else:
            buf = [rest.strip().strip('"\'')]
            commit()
    commit()
    return meta


def stem(w: str) -> str:
    if len(w) > 4:
        for suf in ("ing", "ed", "es"):
            if w.endswith(suf):
                base = w[: -len(suf)]
                if len(base) > 2 and base[-1] == base[-2]:
                    base = base[:-1]
                return base
        if w.endswith("s"):
            return w[:-1]
    return w


def tokenize(text: str) -> list[str]:
    words = re.findall(r"[a-z0-9][a-z0-9\-']*", text.lower())
    return [stem(w) for w in words if w not in STOPWORDS and len(w) > 1]


def infer_tags(name: str, description: str) -> list[str]:
    hay = f"{name} {description}".lower()
    return sorted(tag for tag, words in TAG_RULES.items() if any(w in hay for w in words))


def scan_skill_dir(skill_path: Path) -> dict | None:
    md = skill_path / "SKILL.md"
    if not md.exists():
        return None
    try:
        text = md.read_text(encoding="utf-8", errors="replace")
    except OSError:
        text = ""
    meta = parse_frontmatter(text)
    name = meta.get("name", skill_path.name)
    description = meta.get("description", "")
    subdirs = {d: [f.name for f in (skill_path / d).iterdir() if f.is_file() or f.is_dir()]
               for d in ("scripts", "references", "assets") if (skill_path / d).is_dir()}
    languages: list[str] = []
    for f in (skill_path / "scripts").rglob("*") if (skill_path / "scripts").is_dir() else []:
        if f.is_file():
            lang = LANG_EXT.get(f.suffix.lower())
            if lang and lang not in languages:
                languages.append(lang)
    issues: list[str] = []
    if name != skill_path.name:
        issues.append(f"name '{name}' != directory '{skill_path.name}'")
    if not description:
        issues.append("missing description")
    elif not (1 <= len(description) <= 1024):
        issues.append(f"description length {len(description)} outside 1-1024")
    if not re.match(r"^[a-z0-9]+(-[a-z0-9]+)*$", name):
        issues.append(f"name '{name}' fails spec format")
    return {
        "name": name,
        "path": skill_path.as_posix(),
        "description": description,
        "license": meta.get("license", ""),
        "compatibility": meta.get("compatibility", ""),
        "metadata": meta.get("metadata", ""),
        "dirs": subdirs,
        "languages": sorted(languages),
        "tags": infer_tags(name, description),
        "keywords": sorted(set(tokenize(f"{name} {description}") + infer_tags(name, description))),
        "spec_ok": not issues,
        "issues": issues,
    }


def scan(extra_dirs: str | None, registry: Path, force: bool = False) -> dict:
    dirs = expand_dirs(extra_dirs)
    skills: dict[str, dict] = {}
    for d in dirs:
        if not d.is_dir():
            continue
        for entry in sorted(d.iterdir()):
            if entry.name.startswith(".") or not entry.is_dir():
                continue
            s = scan_skill_dir(entry)
            if s:
                # project scope overrides user scope (later dirs win)
                skills[s["name"]] = s
    payload = {
        "version": VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "scan_dirs": [p.as_posix() for p in dirs],
        "skills": sorted(skills.values(), key=lambda s: s["name"]),
    }
    (registry / "registry.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


def load_registry(registry: Path, extra_dirs: str | None, force: bool = False) -> dict:
    f = registry / "registry.json"
    if not force and f.exists():
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return scan(extra_dirs, registry, force)


def ids(registry: dict, text: str) -> dict[str, float]:
    skills = registry["skills"]
    n = max(len(skills), 1)
    df: dict[str, int] = {}
    for s in skills:
        for k in set(s["keywords"]):
            df[k] = df.get(k, 0) + 1
    tokens = tokenize(text)
    name_sets = {s["name"]: set(tokenize(s["name"])) for s in skills}
    out: dict[str, float] = {}
    for s in skills:
        kw = set(s["keywords"])
        score = 0.0
        for t in tokens:
            if t in kw:
                score += 1.0 + math.log(1.0 + n / (1 + df.get(t, 0)))
            if t in name_sets[s["name"]]:
                score += 2.0
        if score > 0:
            out[s["name"]] = round(score, 2)
    return out


def best_set(registry: dict, scores: dict[str, float], sets: dict | None = None) -> list[tuple[str, float]]:
    names = {s["name"] for s in registry["skills"]}
    table = sets if sets is not None else SETS
    out: list[tuple[str, float]] = []
    for set_name, entry in table.items():
        members = entry[1] if isinstance(entry, tuple) else entry.get("members", [])
        total = sum(scores.get(m, 0.0) for m in members if m in names)
        out.append((set_name, round(total, 2)))
    out.sort(key=lambda x: x[1], reverse=True)
    return out


def project_sets() -> dict:
    """Merge skill-sets defined in the nearest skill-router.json over the
    built-ins (Python tuple shape). Walks up from the current directory so a
    project root config applies from any subdirectory."""
    merged = dict(SETS)
    cur = Path.cwd()
    for _ in range(64):
        for name in ("skill-router.json", ".skill-router.json"):
            f = cur / name
            if f.exists():
                try:
                    cfg = json.loads(f.read_text(encoding="utf-8"))
                except Exception as e:
                    # JS twin logs a warning and keeps walking up — same here.
                    print(f"Warning: failed to parse {f}: {e}", file=sys.stderr)
                    break
                raw = cfg.get("sets") if isinstance(cfg, dict) else None
                if isinstance(raw, dict):
                    for sn, d in raw.items():
                        if isinstance(d, dict) and isinstance(d.get("members"), list):
                            merged[sn] = (str(d.get("desc", "project set")), [m for m in d["members"] if isinstance(m, str)])
                return merged
        nxt = cur.parent
        if nxt == cur:
            break
        cur = nxt
    return merged


def fmt_path(p: Path) -> str:
    return p.as_posix()


# ---------------------------------------------------------------- commands

def cmd_scan(args) -> int:
    reg = registry_dir(args.registry)
    payload = scan(args.dirs, reg, force=args.force)
    langs = sorted({l for s in payload["skills"] for l in s["languages"]})
    invalid = [s["name"] for s in payload["skills"] if not s["spec_ok"]]
    print(f"scanned {len(payload['skills'])} skills from {len(payload['scan_dirs'])} dirs")
    print(f"languages detected: {', '.join(langs) if langs else 'none'}")
    print(f"spec issues: {len(invalid)} ({', '.join(invalid) if invalid else 'none'})")
    print(f"registry: {fmt_path(reg / 'registry.json')}")
    return 0


def cmd_validate(args) -> int:
    reg = registry_dir(args.registry)
    payload = load_registry(reg, args.dirs, args.force)
    issues = [(s["name"], s["issues"]) for s in payload["skills"] if not s["spec_ok"]]
    if args.json:
        print(json.dumps({"total": len(payload["skills"]), "issues": issues}, indent=2))
        return 0
    print(f"{len(payload['skills'])} skills, {len(issues)} with spec issues")
    for name, iss in issues:
        print(f"  ! {name}: {'; '.join(iss)}")
    return 0 if not issues else 1


def cmd_route(args) -> int:
    reg = registry_dir(args.registry)
    payload = load_registry(reg, args.dirs, args.force)
    scores = ids(payload, args.idea)
    table = project_sets()
    # --set <NAME>: constrain routing to one skill-set. Bare --set keeps the
    # legacy boolean toggle (print the best set's load order).
    if isinstance(args.set, str):
        members = table.get(args.set, (None, []))[1]
        if not members:
            print(f"unknown skill-set: {args.set}", file=sys.stderr)
            return 1
        within = sorted((nm, sc) for nm, sc in scores.items() if nm in members)[: args.top]
        print(f"idea: {args.idea!r}")
        print(f"top skills within set '{args.set}':")
        for name, score in within:
            print(f"  {score:6.2f}  {name}")
        return 0
    top = sorted(scores.items(), key=lambda x: x[1], reverse=True)[: args.top]
    sets = best_set(payload, scores, table)
    if args.json:
        print(json.dumps({"idea": args.idea, "scores": top, "sets": sets}, indent=2))
        return 0
    print(f"idea: {args.idea!r}")
    print("top skills:")
    for name, score in top:
        print(f"  {score:6.2f}  {name}")
    print("best skill-sets:")
    for name, score in sets[:3]:
        print(f"  {score:6.2f}  {name}")
    if args.set:
        print(f"\nload order for '{sets[0][0]}':")
        names = {s["name"] for s in payload["skills"]}
        for i, m in enumerate(table[sets[0][0]][1], 1):
            print(f"  {i}. {m}" + ("" if m in names else "  (not installed)"))
    return 0


def cmd_sets(args) -> int:
    reg = registry_dir(args.registry)
    payload = load_registry(reg, args.dirs, args.force)
    names = {s["name"] for s in payload["skills"]}
    table = project_sets()
    if args.apply:
        if args.apply not in table:
            print(f"unknown set '{args.apply}'. available: {', '.join(table)}", file=sys.stderr)
            return 1
        members = table[args.apply][1]
        print(f"set '{args.apply}': {table[args.apply][0]}")
        for i, m in enumerate(members, 1):
            print(f"  {i}. {m}" + ("" if m in names else "  (not installed)"))
        print("\nalways-on prepend: tractatus-thinking, sequential-thinking")
        print("always-on append: verification-before-completion, code-review-and-quality")
        return 0
    for set_name, (desc, members) in table.items():
        present = [m for m in members if m in names]
        print(f"{set_name:14s} {desc:32s} {len(present)}/{len(members)} installed")
    return 0


def cmd_refs(args) -> int:
    reg = registry_dir(args.registry)
    payload = load_registry(reg, args.dirs, args.force)
    refs_root = reg / "refs"
    refs_root.mkdir(parents=True, exist_ok=True)
    template = (Path(__file__).parent.parent / "templates" / "ref-skill.md").read_text(encoding="utf-8")
    index_lines = ["# Skill Refs Index", ""]
    for s in payload["skills"]:
        d = refs_root / s["name"]
        d.mkdir(parents=True, exist_ok=True)
        scripts = s["dirs"].get("scripts", [])
        refs = s["dirs"].get("references", [])
        assets = s["dirs"].get("assets", [])
        page = (template
                .replace("{{name}}", s["name"])
                .replace("{{description}}", s["description"])
                .replace("{{path}}", s["path"])
                .replace("{{languages}}", ", ".join(s["languages"]) or "none")
                .replace("{{tags}}", ", ".join(s["tags"]) or "none")
                .replace("{{spec_ok}}", str(s["spec_ok"]))
                .replace("{{scripts_count}}", str(len(scripts)))
                .replace("{{references_count}}", str(len(refs)))
                .replace("{{assets_count}}", str(len(assets)))
                .replace("{{scripts_list}}", "\n".join(f"- {x}" for x in scripts) or "- none")
                .replace("{{references_list}}", "\n".join(f"- {x}" for x in refs) or "- none"))
        (d / "index.md").write_text(page, encoding="utf-8")
        index_lines.append(f"- [{s['name']}]({s['name']}/index.md) — {s['description'][:90]}")
        if args.per_skill:
            dest = Path(s["path"]) / "refs"
            dest.mkdir(exist_ok=True)
            (dest / "index.md").write_text(page, encoding="utf-8")
    (refs_root / "index.md").write_text("\n".join(index_lines), encoding="utf-8")
    print(f"refs written: {fmt_path(refs_root)} ({len(payload['skills'])} skills)"
          + (" + per-skill copies" if args.per_skill else ""))
    return 0


def cmd_wikis(args) -> int:
    reg = registry_dir(args.registry)
    payload = load_registry(reg, args.dirs, args.force)
    skills = payload["skills"]
    wiki = reg / "wikis"
    wiki.mkdir(parents=True, exist_ok=True)
    by_tag: dict[str, list[str]] = {}
    for s in skills:
        for t in s["tags"]:
            by_tag.setdefault(t, []).append(s["name"])
    skills_md = ["# All Skills", "", f"{len(skills)} registered", "",
                 "| Skill | Tags | Languages | Spec |", "|---|---|---|---|"]
    for s in skills:
        skills_md.append(f"| [{s['name']}](skills/{s['name']}/index.md) | {', '.join(s['tags'])} | {', '.join(s['languages']) or '-'} | {'ok' if s['spec_ok'] else 'ISSUE'} |")
    (wiki / "Skills.md").write_text("\n".join(skills_md), encoding="utf-8")
    cats = ["# Categories", ""]
    for tag in sorted(by_tag):
        cats.append(f"## {tag}")
        cats.append(", ".join(by_tag[tag]))
        cats.append("")
    (wiki / "Categories.md").write_text("\n".join(cats), encoding="utf-8")
    sets_md = ["# Skill-Sets", ""]
    for set_name, (desc, members) in SETS.items():
        sets_md.append(f"## {set_name} — {desc}")
        sets_md.append(", ".join(members))
        sets_md.append("")
    (wiki / "SkillSets.md").write_text("\n".join(sets_md), encoding="utf-8")
    mult = ["# Multiplicative Pairs (A x B x C)", "",
            "An outcome is a product: if any factor fails, the outcome fails.", ""]
    for outcome, members in MULTIPLICATIVE_PAIRS:
        mult.append(f"## {outcome}")
        for m in members:
            mult.append(f"- {m}")
        mult.append("")
    (wiki / "MultiplicativePairs.md").write_text("\n".join(mult), encoding="utf-8")
    dot = ["digraph skills {", "  rankdir=LR;", "  node [shape=box, style=rounded];"]
    for s in skills:
        dot.append(f'  "{s["name"]}" [label="{s["name"]}"];')
    for set_name, (desc, members) in SETS.items():
        dot.append(f'  subgraph cluster_{set_name} {{ label="{set_name}";')
        for m in members:
            if any(x["name"] == m for x in skills):
                dot.append(f'    "{m}";')
        dot.append("  }")
    dot.append("}")
    (wiki / "graph.dot").write_text("\n".join(dot), encoding="utf-8")
    mmd = ["graph LR"]
    for set_name, (desc, members) in SETS.items():
        mmd.append(f"  subgraph {set_name}")
        for m in members:
            if any(x["name"] == m for x in skills):
                mmd.append(f"    {m.replace('-', '_')}[{m}]")
        mmd.append("  end")
    (wiki / "graph.mmd").write_text("\n".join(mmd), encoding="utf-8")
    # per-skill wiki pages
    wiki_tpl = (Path(__file__).parent.parent / "templates" / "wiki-skill.md").read_text(encoding="utf-8")
    per = wiki / "skills"
    per.mkdir(parents=True, exist_ok=True)
    for s in skills:
        member_sets = [sn for sn, (_, ms) in SETS.items() if s["name"] in ms]
        related = ", ".join(sorted({t for tag in s["tags"] for t in by_tag.get(tag, []) if t != s["name"]})[:12]) or "none"
        page = (wiki_tpl
                .replace("{{name}}", s["name"])
                .replace("{{description}}", s["description"])
                .replace("{{tags}}", ", ".join(s["tags"]))
                .replace("{{languages}}", ", ".join(s["languages"]) or "none")
                .replace("{{sets}}", ", ".join(member_sets) or "none")
                .replace("{{related}}", related))
        (per / s["name"]).mkdir(exist_ok=True)
        (per / s["name"] / "index.md").write_text(page, encoding="utf-8")
    home = ["# Skill Router Wiki", "",
            f"{len(skills)} skills indexed. {len(SETS)} skill-sets.",
            f"Generated {payload['generated_at']} by skill-router v{payload.get('version', '?')}.", "",
            "- [All skills](Skills.md)", "- [Categories](Categories.md)", "- [Skill-sets](SkillSets.md)",
            "- [Multiplicative pairs](MultiplicativePairs.md)", "- [Graph (DOT)](graph.dot)", "- [Graph (Mermaid)](graph.mmd)", ""]
    (wiki / "Home.md").write_text("\n".join(home), encoding="utf-8")
    print(f"wiki written: {fmt_path(wiki)}")
    return 0


def cmd_plan(args) -> int:
    reg = registry_dir(args.registry)
    payload = load_registry(reg, args.dirs, args.force)
    scores = ids(payload, args.request)
    top = sorted(scores.items(), key=lambda x: x[1], reverse=True)[:5]
    best = best_set(payload, scores)[0][0]
    slug = re.sub(r"[^a-z0-9]+", "-", args.request.lower())[:40].strip("-")
    plan = [f"# Execution Plan: {args.request}", "",
            f"Routed by skill-router v{VERSION} — deterministic scores are hypotheses; the agent layer re-verifies.", "",
            "## Phases", "",
            "### START (before tool use)", "1. tractatus-thinking — decompose the request",
            "2. sequential-thinking — build a reasoning chain",
            "3. deepwiki / context7 / find-docs — verify domain facts", "",
            "### ROUTE (top skills)", ""]
    for name, score in top:
        plan.append(f"- {name} (score {score})")
    table = project_sets()
    plan += ["", f"### EXECUTE (skill-set: {best})", ""]
    for m in table.get(best, (None, []))[1]:
        plan.append(f"- load: {m}")
    plan += ["", "### BETWEEN tool calls", "- doubt-driven-development before non-trivial decisions",
             "- debug-thinking / debugging-and-error-recovery on failure",
             "- context-engineering on drift; stop-slop before prose",
             "- re-invoke thinking skills (--force) rather than continuing stale", "",
             "### AFTER each milestone", "- verification-before-completion (evidence before claims)",
             "- code-review-and-quality", "- documentation-and-adrs if decisions were made", ""]
    out = reg / "plan"
    out.mkdir(exist_ok=True)
    f = out / f"{slug or 'request'}-plan.md"
    f.write_text("\n".join(plan), encoding="utf-8")
    print("\n".join(plan))
    print(f"\nplan saved: {fmt_path(f)}")
    return 0


def cmd_trace(args) -> int:
    reg = registry_dir(args.registry)
    payload = load_registry(reg, args.dirs, args.force)
    text = ""
    if args.file and Path(args.file).exists():
        text = Path(args.file).read_text(encoding="utf-8", errors="replace")
    else:
        print("provide a transcript file path, or pipe text on stdin", file=sys.stderr)
        return 1
    counts: list[tuple[str, int]] = []
    for s in payload["skills"]:
        c = len(re.findall(re.escape(s["name"]), text, re.I))
        if c:
            counts.append((s["name"], c))
    counts.sort(key=lambda x: x[1], reverse=True)
    always_on = {"tractatus-thinking", "sequential-thinking", "doubt-driven-development",
                 "debug-thinking", "stop-slop", "verification-before-completion"}
    print(f"skills mentioned in transcript: {len(counts)}")
    for name, c in counts:
        mark = "  [always-on]" if name in always_on else ""
        print(f"  {c:4d}  {name}{mark}")
    return 0


def _make_link(skill_path: Path, registry: Path, unlink: bool) -> str:
    name = skill_path.name
    manifest = skill_path / ".skill-router.links.json"
    refs_target = registry / "refs" / name
    wiki_target = registry / "wikis" / "skills" / name
    if unlink:
        errors: list[str] = []
        for link in (skill_path / "refs", skill_path / "wiki"):
            if link.is_symlink():
                link.unlink()
            elif link.exists():
                if os.name == "nt":
                    try:
                        subprocess.run(["cmd", "/c", "rmdir", str(link)], check=True, capture_output=True)
                    except subprocess.CalledProcessError:
                        errors.append(f"could not remove {link.name}")
                else:
                    try:
                        link.rmdir()
                    except OSError:
                        errors.append(f"could not remove {link.name}")
        if errors:
            return f"{name}: {'; '.join(errors)} (left in place, no data removed)"
        if manifest.exists():
            manifest.unlink()
        return f"unlinked {name}"
    refs_target.mkdir(parents=True, exist_ok=True)
    wiki_target.mkdir(parents=True, exist_ok=True)
    messages: list[str] = []
    for link_name, target in (("refs", refs_target), ("wiki", wiki_target)):
        link = skill_path / link_name
        if link.exists() or link.is_symlink():
            messages.append(f"{link_name}:skipped-exists")
            continue
        try:
            os.symlink(target, link, target_is_directory=True)
            messages.append(f"{link_name}:symlink")
        except OSError:
            if os.name == "nt":
                try:
                    subprocess.run(
                        ["cmd", "/c", "mklink", "/J", str(link), str(target)],
                        check=True, capture_output=True)
                    messages.append(f"{link_name}:junction")
                    continue
                except subprocess.CalledProcessError:
                    pass
            messages.append(f"{link_name}:manifest-only")
    data = {
        "skill": name,
        "registry": registry.as_posix(),
        "refs": (refs_target / "index.md").as_posix(),
        "wiki": (wiki_target / "index.md").as_posix(),
        "links": messages,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    manifest.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return f"{name}: {', '.join(messages)}"


def cmd_link(args) -> int:
    reg = registry_dir(args.registry)
    if args.no_default:
        dirs = [Path(p.strip()).expanduser() for p in (args.dirs or "").split(",") if p.strip()]
        if not dirs:
            print("no dirs given: use --dirs <path> with --no-default", file=sys.stderr)
            return 1
    else:
        dirs = expand_dirs(args.dirs)
    statuses = []
    for d in dirs:
        if not d.is_dir():
            continue
        for entry in sorted(d.iterdir()):
            if entry.name.startswith(".") or not entry.is_dir():
                continue
            if (entry / "SKILL.md").exists():
                statuses.append(_make_link(entry, reg, args.unlink))
    print("\n".join(statuses))
    print(f"{'unlinked' if args.unlink else 'linked'} {len(statuses)} skills")
    return 0


# ---------------------------------------------------------------- main

def main() -> int:
    parser = argparse.ArgumentParser(prog="skill-router", description="Skill ecosystem router (Python engine)")
    sub = parser.add_subparsers(dest="command", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--registry", help="central registry dir (default ~/.agents/skills/.skill-router)")
    common.add_argument("--dirs", help="extra scan dirs, comma-separated")
    common.add_argument("--force", action="store_true", help="force rescan / fresh load")
    common.add_argument("--json", action="store_true", help="machine-readable output")

    p_scan = sub.add_parser("scan", parents=[common], help="rebuild the registry")
    p_scan.set_defaults(func=cmd_scan)

    p_val = sub.add_parser("validate", parents=[common], help="check skills against the spec")
    p_val.set_defaults(func=cmd_validate)

    p_route = sub.add_parser("route", parents=[common], help="score skills for an idea")
    p_route.add_argument("idea")
    p_route.add_argument("--top", type=int, default=8)
    p_route.add_argument("--set", nargs="?", const=True, default=None, help="route within this skill-set; bare --set prints the best set load order")
    p_route.set_defaults(func=cmd_route)

    p_sets = sub.add_parser("sets", parents=[common], help="list skill-sets or print load order")
    p_sets.add_argument("--apply", help="print load order for this set")
    p_sets.set_defaults(func=cmd_sets)

    p_refs = sub.add_parser("refs", parents=[common], help="generate ref pages")
    p_refs.add_argument("--per-skill", action="store_true", help="also write refs/ into each skill dir")
    p_refs.set_defaults(func=cmd_refs)

    p_wiki = sub.add_parser("wikis", parents=[common], help="generate the wiki + graph")
    p_wiki.set_defaults(func=cmd_wikis)

    p_plan = sub.add_parser("plan", parents=[common], help="emit a routed execution plan")
    p_plan.add_argument("request")
    p_plan.set_defaults(func=cmd_plan)

    p_trace = sub.add_parser("trace", parents=[common], help="count skill usage in a transcript")
    p_trace.add_argument("file", nargs="?", help="transcript file path")
    p_trace.set_defaults(func=cmd_trace)

    p_link = sub.add_parser("link", parents=[common], help="create/remove adaptive links")
    p_link.add_argument("--unlink", action="store_true")
    p_link.add_argument("--no-default", action="store_true", help="only touch dirs given via --dirs")
    p_link.set_defaults(func=cmd_link)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
