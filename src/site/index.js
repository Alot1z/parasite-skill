// Site generator — `parasite-skill site build`.
//
// Derives a real multi-page static site from the project's own data:
//   /                  landing (hero + stats + quickstart)
//   /features/         README as the product pitch
//   /architecture/     design.md + live source-tree map
//   /configuration/    parasite-skill.example.json + option reference
//   /guides/<slug>/    skill/references/*.md
//   /reference/...     commands, changelog
//   /skills/<id>/      every scanned skill (public-safe fields only)
//   /tools/<id>/       every callable AI tool
//   /agents/<id>/      the declarative agent profiles
//   /clients/<id>/     every supported client
//   /mcp/, /hooks/     integration surfaces
//   /docs/, /wiki/     existing markdown, rendered + mirrored as .md twins
// plus llms.txt, llms-full.txt, sitemap.xml, robots.txt, site-index.json,
// routes.json, data/index.json, 404.html. Every route is a physical
// directory with an index.html — deep links and refreshes work with no JS.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { collectSiteData } from "./data.js";
import { renderMarkdown, markdownToPlain } from "./render.js";
import { layout, esc, badge } from "./page.js";
import { breadcrumbsFor, pagerFor } from "./nav.js";
import { buildSearchIndex, searchJs } from "./search.js";
import { llmsTxt, llmsFullTxt, sitemapXml, robotsTxt } from "./llms.js";
import { routeManifest, validateSite } from "./validate.js";
import { SITE_CSS } from "./css.js";
import { cmdWikis } from "../commands/wikis.js";

export const SITE_URL = "https://alot1z.github.io/parasite-skill";

const write = (dir, file, content) => {
  mkdirSync(join(dir, file.split("/").slice(0, -1).join("/")), { recursive: true });
  writeFileSync(join(dir, file), content);
};

const rel = (from, to) => {
  let r = posix.relative(from, to);
  if (!r) r = "index.html";
  if (!r.endsWith("/") && !r.endsWith(".html") && !r.endsWith(".md")) r += "/";
  return r;
};

// Root-level markdown aliases: a repo file links to a site section.
const MD_ALIASES = {
  "README.md": "features/",
  "CHANGELOG.md": "changelog/",
  "design.md": "architecture/",
  "SKILL.md": "guides/full-skill/",
  "skill/SKILL.md": "guides/full-skill/",
  "parasite-skill.example.json": "configuration/",
};

// Raw wiki artifacts linked from the wiki Home page; rewritten directly to
// their copied location (no index.html suffix).
const RAW_ARTIFACTS = new Set(["wiki/graph.json", "wiki/graph.dot", "wiki/graph.mmd"]);

// A .md path maps to its generated dir url: dir/index.md -> dir/, else
// dir/<stem>/.
const mdToDir = (abs) => {
  const idx = abs.lastIndexOf("/");
  const dir = idx === -1 ? "" : abs.slice(0, idx);
  const base = abs.slice(idx + 1);
  if (base === "index.md") return `${dir}/`;
  return `${dir}/${base.replace(/\.md$/, "")}/`;
};

// Link to a page dir from the current page dir; when the target IS the current
// dir (a self-link) the relative path is just index.html with no extra suffix.
const linkTo = (pageDir, target) => {
  const r = rel(pageDir, target);
  return r === "index.html" ? r : r + "index.html";
};

// Context-aware rewriter: resolves a .md link relative to the source file's
// directory, maps it onto the generated site url (case-insensitively, so a
// wiki link to "Home.md" finds the page at wiki/home/), and re-relativizes it
// from the output page's directory. Unknown .md targets (repo-internal corpus
// files) are left untouched.
export function makeRewriter(stemLookup) {
  return (href, { srcDir, pageDir }) => {
    if (/^(https?:|mailto:|#|\/)/.test(href)) return href;
    if (MD_ALIASES[href]) {
      const target = MD_ALIASES[href];
      return stemLookup.has(target.toLowerCase()) ? linkTo(pageDir, target) : href;
    }
    const absolute = posix.normalize(posix.join(srcDir || ".", href));
    if (RAW_ARTIFACTS.has(absolute)) return posix.relative(pageDir, absolute);
    if (!href.endsWith(".md") && !href.endsWith(".json")) return href;
    const targetDir = mdToDir(absolute);
    const actual = stemLookup.get(targetDir.toLowerCase());
    return actual ? linkTo(pageDir, actual) : href;
  };
}

// ---------------------------------------------------------------- page types

function mdPage({ url, title, section, sectionLabel, source, md, crumbsLabel, metaDesc }) {
  return { url, title, section, sectionLabel, source, md, crumbsLabel, metaDesc };
}

function landingPage(data) {
  const counts = data.counts;
  const intro = data.docs.readme.split(/^##\s/m)[0].trim();
  const cards = [
    ["features/", "Features", "Routing, scanning, validation, refs/wikis, tools, MCP, sync — one entry point for the whole skill ecosystem.", "full CLI"],
    ["architecture/", "Architecture", "Engine, bilingual twins (Node + Python), registry as single source of truth, parasite extension layer.", `${data.srcTree.length} source files`],
    ["configuration/", "Configuration", "Per-project parasite-skill.json: dirs, sets, enabledSets, excludeSkills, gc/ledger TTL, tools policy, env isolation.", "per-project"],
    ["guides/routing/", "Guides", "Routing process, skill-sets, the spec, polyglot detection, always-on cadence, full skill reference.", `${Object.keys(data.docs.references).length} guides`],
    ["skills/", "Skills", "Every skill in the scan environment — tags, languages, spec status, sets, related skills, callable tools.", `${counts.skills} scanned`],
    ["tools/", "Tools", "Skill scripts and hooks exposed as bounded, auditable AI tools with risk and schema metadata.", `${counts.tools} callable`],
    ["agents/", "Agent profiles", "Declarative routing recipes — skills, sets, assets, MCP tools, clients, guardrails.", `${counts.agents} profiles`],
    ["clients/", "Clients", "Every supported AI client and where the skill installs, plus install commands.", `${counts.clients} supported`],
    ["mcp/", "MCP", "The stdio MCP server, auto-registration, and the tool surface exposed to clients.", `${counts.mcpRegistered} registered`],
    ["hooks/", "Hooks & extensions", "Runtime injection without touching source: pre-init, post-init, middleware, hook types, wrappers.", `${counts.extensions} active`],
    ["changelog/", "Changelog", "Release history with compare links and the recent commit log.", `v${data.version}`],
    ["llms.txt", "LLM corpus", "llms.txt, llms-full.txt, search index, and route manifest for agents and crawlers.", "machine-readable"],
  ];
  const cardHtml = cards
    .map(([href, title, p, count]) => `<a class="card" href="${href}"><span class="count">${esc(count)}</span><h3>${esc(title)}</h3><p>${esc(p)}</p></a>`)
    .join("");
  const stats = [
    ["Skills", counts.skills],
    ["Skill-sets", counts.sets],
    ["Tools", counts.tools],
    ["Agent profiles", counts.agents],
    ["Clients", counts.clients],
    ["Clients installed", counts.clientsInstalled],
  ]
    .map(([label, n]) => `<div class="stat"><div class="n">${n}</div><div class="l">${esc(label)}</div></div>`)
    .join("");
  return {
    url: "index.html",
    title: "Home",
    section: "home",
    sectionLabel: "Home",
    source: "README.md",
    htmlBuilder: (rewriter) => `
      <div class="hero">
        <span class="kicker">v${esc(data.version)} · ${esc(data.pkgDescription)}</span>
        <h1>parasite-skill</h1>
        <p class="lede">${esc(intro.split("\n")[0])}</p>
        <div class="stat-row">${stats}</div>
      </div>
      <h2>Quick start</h2>
      <pre><code>npm i -g parasite-skill        # or: npx parasite-skill
parasite-skill install          # install the skill into your AI clients
parasite-skill scan             # index the whole skill ecosystem
parasite-skill route "debug a failing test"</code></pre>
      <h2>Explore</h2>
      <div class="cards">${cardHtml}</div>
      <h2>What it is</h2>
      ${renderMarkdown(intro, { rewriteHref: rewriter })}`,
    plain: markdownToPlain(intro),
    metaDesc: "Route any request to the right agent skills. One package, every AI client.",
    crumbs: breadcrumbsFor("home", "Home", "index.html"),
  };
}

function architecturePage(data) {
  const rows = data.srcTree
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((f) => `<tr><td><a href="${data.repo}/blob/main/${esc(f.path)}">${esc(f.path)}</a></td><td style="text-align:right">${f.lines}</td></tr>`)
    .join("");
  return {
    url: "architecture/",
    title: "Architecture",
    section: "architecture",
    sectionLabel: "Architecture",
    source: "design.md",
    md: data.docs.design,
    htmlBuilder: (rewriter) => `
      ${renderMarkdown(data.docs.design, { rewriteHref: rewriter })}
      <h2>Source map</h2>
      <table><thead><tr><th>File</th><th style="text-align:right">Lines</th></tr></thead><tbody>${rows}</tbody></table>`,
    metaDesc: "Architecture of parasite-skill: engine, bilingual twins, parasite extension layer.",
    crumbs: breadcrumbsFor("architecture", "Architecture", "architecture/"),
  };
}

function configurationPage(data) {
  const example = data.docs.exampleConfig || "{}";
  let config = example;
  try {
    config = JSON.stringify(JSON.parse(example), null, 2);
  } catch {
    /* show raw */
  }
  const options = [
    ["registry", "Path to the registry dir (default ~/.agents/skills/.parasite-skill)"],
    ["dirs", "Extra scan directories, array or comma string"],
    ["defaultSet", "Default skill-set for routing (same as --set NAME)"],
    ["force", "Force rescan on every run"],
    ["enabledSets", "Route only within the union of these sets"],
    ["excludeSkills", "Skills never routed in this project"],
    ["route", "Scoring knobs: top, minScore"],
    ["gc", "Artifact retention: auto, intervalDays, ageDays, keep, ledger"],
    ["env", "Per-project env isolation (key names only, never values)"],
    ["parasite", "Toggle the runtime injection layer per project"],
    ["clients", "Project-wide client allowlist"],
    ["sets", "Project-defined skill-sets, marked (project), override same-named sets"],
  ];
  const rows = options.map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td>${esc(v)}</td></tr>`).join("");
  const md = `# Configuration\n\nPer-project defaults via \`parasite-skill.json\`:\n\n${options.map(([k, v]) => `- **${k}** — ${v}`).join("\n")}\n\nExample config:\n\n\`\`\`json\n${config}\n\`\`\`\n\n\`PARASITE_SKILL_HOME\` overrides the registry/install/sync/MCP base; \`PARASITE_SKILL_VERBOSE=1\` prints the loaded config file.`;
  return {
    url: "configuration/",
    title: "Configuration",
    section: "configuration",
    sectionLabel: "Configuration",
    source: "parasite-skill.example.json",
    md,
    htmlBuilder: () => `
      <h1>Configuration</h1>
      <p>Each project can define defaults in <code>parasite-skill.json</code> (or <code>.parasite-skill.json</code>) in the project root. The CLI walks up the directory tree to find it; CLI flags always win over config values.</p>
      <h2>Example</h2>
      <div class="cmd-block">${esc(config)}</div>
      <h2>Options</h2>
      <table><thead><tr><th>Key</th><th>Purpose</th></tr></thead><tbody>${rows}</tbody></table>
      <h2>Isolation</h2>
      <p><code>PARASITE_SKILL_HOME</code> overrides the home base for the registry, installs, sync, MCP, and every command — full environment isolation for sandboxes and tests. <code>PARASITE_SKILL_VERBOSE=1</code> prints which config file is loaded.</p>`,
    metaDesc: "Per-project configuration via parasite-skill.json.",
    crumbs: breadcrumbsFor("configuration", "Configuration", "configuration/"),
  };
}

function guidesPages(data) {
  const pages = [];
  const entries = Object.entries(data.docs.references);
  for (const [slug, md] of entries) {
    const title = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    pages.push(mdPage({ url: `guides/${slug}/`, title, section: "guides", sectionLabel: "Guides", source: `skill/references/${slug}.md`, md, crumbsLabel: title }));
  }
  const cards = pages
    .map((p) => `<a class="card" href="${p.url.replace(/^guides\//, "")}"><h3>${esc(p.title)}</h3><p>${esc(markdownToPlain(p.md).slice(0, 110))}…</p></a>`)
    .join("");
  pages.unshift({
    url: "guides/",
    title: "Guides",
    section: "guides",
    sectionLabel: "Guides",
    htmlBuilder: () => `<h1>Guides</h1><p>Hands-on references for using the parasite-skill system, generated from <code>skill/references/</code>.</p><div class="cards">${cards}</div>`,
    plain: "Guides index",
    metaDesc: "Guides: routing, skill-sets, spec, languages, always-on cadence.",
    crumbs: breadcrumbsFor("guides", "Guides", "guides/"),
  });
  return pages;
}

async function referencePages(data) {
  const { HELP } = await import("../cli.js");
  const head = HELP.split("  --version | --help")[0];
  const cmds = [];
  for (const line of head.split("\n")) {
    const m = /^  ([a-z][\w-]*)\s{2,}(.+)$/.exec(line);
    if (m) cmds.push({ name: m[1], desc: m[2].trim() });
  }
  const rows = cmds.map((c) => `<tr><td><a href="#cmd-${esc(c.name)}"><code>${esc(c.name)}</code></a></td><td>${esc(c.desc)}</td></tr>`).join("");
  const anchors = cmds.map((c) => `<h3 id="cmd-${esc(c.name)}"><code>${esc(c.name)}</code></h3><p>${esc(c.desc)}</p>`).join("");
  return [
    {
      url: "reference/",
      title: "Reference",
      section: "reference",
      sectionLabel: "Reference",
      htmlBuilder: () => `<h1>Reference</h1><div class="cards">${[
        ["commands/", "Commands", "The full CLI surface, with flags."],
        ["../skills/", "Skills", "Every scanned skill in the environment."],
        ["../tools/", "Tools", "Callable AI tools with risk + schema."],
        ["../agents/", "Agent profiles", "Declarative routing recipes."],
        ["../clients/", "Clients", "Supported AI clients and installs."],
        ["../mcp/", "MCP", "The MCP server and registration."],
        ["../hooks/", "Hooks & extensions", "Runtime injection without source edits."],
        ["../changelog/", "Changelog", "Release history."],
      ]
        .map(([href, t, p]) => `<a class="card" href="${href}"><h3>${t}</h3><p>${p}</p></a>`)
        .join("")}</div>`,
      plain: "Reference: commands, skills, tools, agents, clients, mcp, hooks, changelog.",
      metaDesc: "Reference sections for parasite-skill.",
      crumbs: breadcrumbsFor("reference", "Reference", "reference/"),
      index: false,
    },
    {
      url: "reference/commands/",
      title: "Commands",
      section: "reference",
      sectionLabel: "Reference",
      source: "src/cli.js",
      md: `# Commands\n\n${cmds.map((c) => `- \`${c.name}\` — ${c.desc}`).join("\n")}\n\n\`\`\`\n${HELP}\n\`\`\``,
      htmlBuilder: () => `<h1>Commands</h1><p>The full <code>parasite-skill</code> command surface — one entry point for the whole skill ecosystem.</p>
        <table><thead><tr><th>Command</th><th>What it does</th></tr></thead><tbody>${rows}</tbody></table>
        <h2>Reference</h2>${anchors}
        <h2>Full help</h2>
        <div class="cmd-block">${esc(HELP)}</div>`,
      plain: cmds.map((c) => `${c.name}: ${c.desc}`).join("\n"),
      metaDesc: `Every parasite-skill CLI command (${cmds.length}).`,
      crumbs: breadcrumbsFor("reference", "Commands", "reference/commands/"),
    },
  ];
}

function skillsPages(data) {
  const pages = [];
  const rows = data.skills
    .map((s) => {
      const toolCount = (data.toolsBySkill.get(s.name) ?? []).length;
      return `<tr><td><a href="${esc(s.name)}/"><code>${esc(s.name)}</code></a></td><td>${esc(s.description.slice(0, 90))}</td><td>${s.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</td><td>${s.languages.join(", ") || "-"}</td><td>${s.spec_ok ? badge("ok", "ok") : badge("issue", "issue")}</td><td style="text-align:right">${toolCount}</td></tr>`;
    })
    .join("");
  pages.push({
    url: "skills/",
    title: "Skills",
    section: "reference",
    sectionLabel: "Skills",
    htmlBuilder: () => `<h1>Skills</h1><p>${data.counts.skills} skills in the scan environment. Public-safe fields only — no filesystem paths. Rebuild with <code>parasite-skill site build</code> after a <code>scan</code>.</p>
      <table><thead><tr><th>Skill</th><th>Description</th><th>Tags</th><th>Languages</th><th>Spec</th><th style="text-align:right">Tools</th></tr></thead><tbody>${rows}</tbody></table>`,
    plain: `Skills (${data.counts.skills}):\n` + data.skills.map((s) => `${s.name}: ${s.description}`).join("\n"),
    metaDesc: `${data.counts.skills} skills indexed.`,
    crumbs: breadcrumbsFor("reference", "Skills", "skills/"),
    index: false,
  });
  for (const s of data.skills) {
    const tools = data.toolsBySkill.get(s.name) ?? [];
    const toolRows = tools.length
      ? `<h2>Callable tools</h2><table><thead><tr><th>Tool</th><th>Language</th><th>Risk</th><th>Schema</th></tr></thead><tbody>${tools
          .map((t) => `<tr><td><a href="../../tools/${esc(t.name)}/"><code>${esc(t.name)}</code></a></td><td>${esc(t.language)}</td><td>${badge(t.risk, t.risk)}</td><td>${t.argsSchema ? "yes" : "-"}</td></tr>`)
          .join("")}</tbody></table>`
      : "";
    pages.push({
      url: `skills/${s.name}/`,
      title: `Skill: ${s.name}`,
      section: "reference",
      sectionLabel: "Skills",
      md: `# ${s.name}\n\n${s.description}\n\n- Languages: ${s.languages.join(", ") || "none"}\n- Spec: ${s.spec_ok ? "ok" : "ISSUE"}\n- Tags: ${s.tags.join(", ") || "none"}\n- Sets: ${s.sets.join(", ") || "none"}\n\nRelated: ${s.related.join(", ") || "none"}`,
      htmlBuilder: () => `<h1><code>${esc(s.name)}</code></h1><p>${esc(s.description)}</p>
        <dl class="kv"><dt>Languages</dt><dd>${esc(s.languages.join(", ") || "none")}</dd><dt>Spec</dt><dd>${s.spec_ok ? badge("ok", "ok") : badge("issue", "issue")}</dd><dt>Tags</dt><dd>${s.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</dd><dt>Sets</dt><dd>${s.sets.map((set) => `<a href="../../wiki/skillsets/"><span class="tag">${esc(set)}</span></a>`).join("") || "none"}</dd></dl>
        ${toolRows}
        ${s.related.length ? `<h2>Related skills</h2><p>${s.related.map((n) => `<a href="../${esc(n)}/"><span class="tag">${esc(n)}</span></a>`).join("")}</p>` : ""}`,
      plain: `${s.name}: ${s.description}`,
      metaDesc: s.description.slice(0, 160),
      crumbs: breadcrumbsFor("reference", `Skills / ${s.name}`, `skills/${s.name}/`),
    });
  }
  return pages;
}

function toolsPages(data) {
  const pages = [];
  const rows = data.tools
    .map((t) => `<tr><td><a href="${esc(t.name)}/"><code>${esc(t.name)}</code></a></td><td><a href="../skills/${esc(t.skill)}/">${esc(t.skill)}</a></td><td>${esc(t.language)}</td><td>${badge(t.risk, t.risk)}</td><td>${t.argsSchema ? "yes" : "-"}</td><td>${t.timeoutMs ?? "default"}</td></tr>`)
    .join("");
  pages.push({
    url: "tools/",
    title: "Tools",
    section: "reference",
    sectionLabel: "Tools",
    htmlBuilder: () => `<h1>Tools</h1><p>${data.counts.tools} callable AI tools — skill scripts and hooks exposed as bounded, explicit, captured tools for the host LLM.</p>
      <table><thead><tr><th>Tool</th><th>Skill</th><th>Language</th><th>Risk</th><th>Schema</th><th>Timeout</th></tr></thead><tbody>${rows}</tbody></table>`,
    plain: `Tools (${data.counts.tools}):\n` + data.tools.map((t) => `${t.name} (${t.skill}, ${t.risk}): ${t.description}`).join("\n"),
    metaDesc: `${data.counts.tools} callable AI tools.`,
    crumbs: breadcrumbsFor("reference", "Tools", "tools/"),
    index: false,
  });
  for (const t of data.tools) {
    pages.push({
      url: `tools/${t.name}/`,
      title: `Tool: ${t.name}`,
      section: "reference",
      sectionLabel: "Tools",
      md: `# ${t.name}\n\n${t.description}\n\n- Skill: ${t.skill}\n- Language: ${t.language}\n- Risk: ${t.risk}\n- Args schema: ${t.argsSchema ? "yes" : "no"}\n- Timeout: ${t.timeoutMs ?? "default"}`,
      htmlBuilder: () => `<h1><code>${esc(t.name)}</code></h1><p>${esc(t.description)}</p>
        <dl class="kv"><dt>Skill</dt><dd><a href="../../skills/${esc(t.skill)}/">${esc(t.skill)}</a></dd><dt>Language</dt><dd>${esc(t.language)}</dd><dt>Risk</dt><dd>${badge(t.risk, t.risk)}</dd><dt>Args schema</dt><dd>${t.argsSchema ? "yes" : "-"}</dd><dt>Timeout</dt><dd>${t.timeoutMs ?? "default"}</dd></dl>`,
      plain: `${t.name}: ${t.description}`,
      metaDesc: t.description.slice(0, 160),
      crumbs: breadcrumbsFor("reference", `Tools / ${t.name}`, `tools/${t.name}/`),
    });
  }
  return pages;
}

function agentsPages(data) {
  const pages = [];
  const cards = Object.entries(data.agents)
    .map(([name, profile]) => `<a class="card" href="${esc(name)}/"><h3>${esc(name)}</h3><p>${esc(profile.desc)}</p></a>`)
    .join("");
  pages.push({
    url: "agents/",
    title: "Agent profiles",
    section: "reference",
    sectionLabel: "Agents",
    htmlBuilder: () => `<h1>Agent profiles</h1><p>Declarative routing recipes — they describe which existing skills, assets, MCP tools, clients, and guardrails a model should use for a bounded job. They never execute hidden code or bypass client permissions.</p><div class="cards">${cards}</div>`,
    plain: `Agent profiles (${data.counts.agents}):\n` + Object.entries(data.agents).map(([n, p]) => `${n}: ${p.desc}`).join("\n"),
    metaDesc: `${data.counts.agents} declarative agent profiles.`,
    crumbs: breadcrumbsFor("reference", "Agent profiles", "agents/"),
    index: false,
  });
  const clientIds = new Set(data.clients.map((c) => c.id));
  for (const [name, profile] of Object.entries(data.agents)) {
    const clientLinks = (profile.clients ?? [])
      .map((c) => (clientIds.has(c) ? `<a href="../../clients/${esc(c)}/">${esc(c)}</a>` : esc(c)))
      .join(", ");
    const kv = [
      ["Skills", profile.skills?.map((s) => `<a href="../../skills/${esc(s)}/">${esc(s)}</a>`).join(", ") ?? "none"],
      ["Sets", profile.sets?.map((s) => `<a href="../../wiki/skillsets/">${esc(s)}</a>`).join(", ") ?? "none"],
      ["Assets", profile.assets?.join(", ") ?? "none"],
      ["Rules", profile.rules?.join(", ") ?? "none"],
      ["MCP tools", profile.mcpTools?.join(", ") ?? "none"],
      ["Clients", clientLinks || "none"],
    ]
      .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`)
      .join("");
    const guards = (profile.guardrails ?? []).map((g) => `<li>${esc(g)}</li>`).join("");
    pages.push({
      url: `agents/${name}/`,
      title: `Agent profile: ${name}`,
      section: "reference",
      sectionLabel: "Agents",
      md: `# ${name}\n\n${profile.desc}\n\n- Skills: ${(profile.skills ?? []).join(", ") || "none"}\n- Sets: ${(profile.sets ?? []).join(", ") || "none"}\n- Assets: ${(profile.assets ?? []).join(", ") || "none"}\n- Rules: ${(profile.rules ?? []).join(", ") || "none"}\n- MCP tools: ${(profile.mcpTools ?? []).join(", ") || "none"}\n- Clients: ${(profile.clients ?? []).join(", ") || "none"}\n\n## Guardrails\n\n${(profile.guardrails ?? []).map((g) => `- ${g}`).join("\n")}`,
      htmlBuilder: () => `<h1>${esc(name)}</h1><p>${esc(profile.desc)}</p><dl class="kv">${kv}</dl><h2>Guardrails</h2><ul>${guards}</ul>`,
      plain: `${name}: ${profile.desc}`,
      metaDesc: profile.desc.slice(0, 160),
      crumbs: breadcrumbsFor("reference", `Agents / ${name}`, `agents/${name}/`),
    });
  }
  return pages;
}

function clientsPages(data) {
  const pages = [];
  const rows = data.clients
    .map((c) => `<tr><td><a href="${esc(c.id)}/"><code>${esc(c.id)}</code></a></td><td>${esc(c.label)}</td><td>${c.verified ? badge("ok", "verified") : badge("neutral", "best-effort")}</td><td>${c.installed ? badge("ok", "installed") : "-"}</td></tr>`)
    .join("");
  pages.push({
    url: "clients/",
    title: "Clients",
    section: "reference",
    sectionLabel: "Clients",
    htmlBuilder: () => `<h1>Clients</h1><p>${data.counts.clients} supported AI coding clients. Paths are never published — install state only.</p>
      <table><thead><tr><th>Id</th><th>Client</th><th>Path status</th><th>Installed</th></tr></thead><tbody>${rows}</tbody></table>`,
    plain: `Clients (${data.counts.clients}):\n` + data.clients.map((c) => `${c.id}: ${c.label}${c.installed ? " (installed)" : ""}`).join("\n"),
    metaDesc: `${data.counts.clients} supported clients.`,
    crumbs: breadcrumbsFor("reference", "Clients", "clients/"),
    index: false,
  });
  for (const c of data.clients) {
    pages.push({
      url: `clients/${c.id}/`,
      title: `Client: ${c.label}`,
      section: "reference",
      sectionLabel: "Clients",
      md: `# ${c.label} (${c.id})\n\n- Id: ${c.id}\n- Path status: ${c.verified ? "verified" : "best-effort"}\n- Installed: ${c.installed ? "yes" : "no"}\n\nInstall with:\n\n\`\`\`bash\nparasite-skill install -a ${c.id}\n\`\`\``,
      htmlBuilder: () => `<h1>${esc(c.label)}</h1><dl class="kv"><dt>Id</dt><dd><code>${esc(c.id)}</code></dd><dt>Path status</dt><dd>${c.verified ? badge("ok", "verified") : badge("neutral", "best-effort")}</dd><dt>Installed</dt><dd>${c.installed ? badge("ok", "yes") : "no"}</dd></dl><h2>Install</h2><div class="cmd-block">parasite-skill install -a ${esc(c.id)}</div>`,
      plain: `${c.label} (${c.id})`,
      metaDesc: `${c.label} client support.`,
      crumbs: breadcrumbsFor("reference", `Clients / ${c.label}`, `clients/${c.id}/`),
    });
  }
  return pages;
}

function mcpPage(data) {
  return {
    url: "mcp/",
    title: "MCP",
    section: "reference",
    sectionLabel: "MCP",
    source: "docs/MCP.md",
    md: `# MCP\n\nThe parasite-skill MCP server exposes the engine over MCP. Auto-registration:\n\n\`\`\`bash\nparasite-skill mcp add\nparasite-skill mcp list\nparasite-skill mcp remove\n\`\`\`\n\nRegistered: ${data.mcp.filter((m) => m.registered).length}/${data.mcp.length} clients.\n\n${data.docs.mcp}`,
    htmlBuilder: (rewriter) => {
      const rows = data.mcp.map((m) => `<tr><td>${esc(m.label)}</td><td>${m.registered ? badge("ok", "registered") : "-"}</td></tr>`).join("");
      return `<h1>MCP</h1><p>The parasite-skill MCP server exposes the engine over Model Context Protocol with auto-registration into supported client configs — no manual configuration.</p>
      <h2>Registration state</h2><table><thead><tr><th>Client</th><th>Status</th></tr></thead><tbody>${rows || "<tr><td colspan=2>none registered</td></tr>"}</tbody></table>
      <h2>Guide</h2>${renderMarkdown(data.docs.mcp, { rewriteHref: rewriter })}`;
    },
    metaDesc: "The parasite-skill MCP server and registration.",
    crumbs: breadcrumbsFor("reference", "MCP", "mcp/"),
  };
}

function hooksPage(data) {
  const rows = data.extensions
    .map((e) => `<tr><td>${esc(e.label)}</td><td>${e.injections}</td><td>${e.active ? badge("ok", "active") : badge("neutral", "off")}</td></tr>`)
    .join("");
  return {
    url: "hooks/",
    title: "Hooks & extensions",
    section: "reference",
    sectionLabel: "Hooks",
    source: "design.md",
    md: `# Hooks & extensions\n\nThe parasite layer injects enhancements at runtime without modifying source. Types: pre-init, post-init, middleware, hook. Protection levels: light, medium, heavy. Extensions are toggleable and removable.`,
    htmlBuilder: (rewriter) => `<h1>Hooks &amp; extensions</h1><p>The parasite layer injects enhancements at runtime <em>without modifying source</em>: extension folders, build-time hooks, server wrappers, and traceability protection. Everything is toggleable and removable.</p>
      <h2>Injection types</h2>
      <table><thead><tr><th>Type</th><th>Runs</th></tr></thead><tbody><tr><td><code>pre-init</code></td><td>before client initialization</td></tr><tr><td><code>post-init</code></td><td>after client initialization</td></tr><tr><td><code>middleware</code></td><td>as HTTP middleware</td></tr><tr><td><code>hook</code></td><td>wraps existing functions</td></tr></tbody></table>
      <h2>Current state</h2><table><thead><tr><th>Client</th><th>Injections</th><th>State</th></tr></thead><tbody>${rows || "<tr><td colspan=3>no extensions registered</td></tr>"}</tbody></table>
      <h2>Design notes</h2>${renderMarkdown(data.docs.design.split(/^## (?:Build hooks|Server wrapper|Traceability protection)/m)[1] ?? data.docs.design, { rewriteHref: rewriter })}`,
    metaDesc: "Runtime injection: hooks, wrappers, protection.",
    crumbs: breadcrumbsFor("reference", "Hooks & extensions", "hooks/"),
  };
}

function changelogPage(data) {
  const commits = (data.commit ?? [])
    .map((c) => `<tr><td><a href="${data.repo}/commit/${esc(c.sha)}"><code>${esc(c.sha.slice(0, 7))}</code></a></td><td>${esc(c.date)}</td><td>${esc(c.subject)}</td></tr>`)
    .join("");
  return {
    url: "changelog/",
    title: "Changelog",
    section: "reference",
    sectionLabel: "Changelog",
    source: "CHANGELOG.md",
    md: data.docs.changelog,
    htmlBuilder: (rewriter) => `<h1>Changelog</h1>${renderMarkdown(data.docs.changelog, { rewriteHref: rewriter })}
      <h2>Recent commits</h2><table><thead><tr><th>Commit</th><th>Date</th><th>Subject</th></tr></thead><tbody>${commits || "<tr><td colspan=3>no git history available</td></tr>"}</tbody></table>`,
    metaDesc: "Release history for parasite-skill.",
    crumbs: breadcrumbsFor("reference", "Changelog", "changelog/"),
  };
}

function docsPages(data) {
  return [
    {
      url: "docs/",
      title: "Docs",
      section: "docs",
      sectionLabel: "Docs",
      htmlBuilder: () => `<h1>Docs</h1><div class="cards"><a class="card" href="mcp/"><h3>MCP guide</h3><p>Model Context Protocol server, tools, registration.</p></a><a class="card" href="research/"><h3>Research</h3><p>Design notes and research records.</p></a></div>`,
      plain: "Docs: MCP guide, research.",
      metaDesc: "Documentation for parasite-skill.",
      crumbs: breadcrumbsFor("docs", "Docs", "docs/"),
      index: false,
    },
    mdPage({ url: "docs/mcp/", title: "MCP guide", section: "docs", sectionLabel: "Docs", source: "docs/MCP.md", md: data.docs.mcp, crumbsLabel: "Docs / MCP" }),
    mdPage({ url: "docs/research/", title: "Research", section: "docs", sectionLabel: "Docs", source: "docs/RESEARCH.md", md: data.docs.research || "# Research\n\nNo research notes yet.", crumbsLabel: "Docs / Research" }),
  ];
}

function wikiPages(data) {
  const pages = [];
  const wiki = data.wikiDir;
  if (!existsSync(wiki)) return pages;
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (name.startsWith(".")) continue;
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full, prefix ? `${prefix}/${name}` : name);
      } else if (name.endsWith(".md")) {
        const md = readFileSync(full, "utf-8");
        const rel = prefix ? `${prefix}/${name}` : name;
        const slug = rel.replace(/\.md$/, "").replace(/\/index$/, "").toLowerCase();
        const url = `wiki/${slug}/`;
        pages.push(mdPage({ url, title: slug === "Home" ? "Wiki home" : slug.replace(/\//g, " / "), section: "wiki", sectionLabel: "Wiki", source: null, md, crumbsLabel: slug === "Home" ? "Wiki" : `Wiki / ${slug}` }));
      }
    }
  };
  walk(wiki, "");
  return pages;
}

// ------------------------------------------------------------------ builder

export async function buildSite(args = {}) {
  const out = args.out || "public";
  const data = { ...collectSiteData(args), siteUrl: args.base || SITE_URL };

  // The wiki is the canonical markdown mirror of the ecosystem — generate it
  // (public-safe) so the site renders it and the LLM corpus stays complete.
  cmdWikis({ ...args, public: true, registry: data.registry, dirs: args.dirs, force: args.force });

  const specs = [];
  specs.push(landingPage(data));
  specs.push({ ...mdPage({ url: "features/", title: "Features", section: "features", sectionLabel: "Features", source: "README.md", md: data.docs.readme, crumbsLabel: "Features" }), htmlBuilder: null });
  specs.push(architecturePage(data));
  specs.push(configurationPage(data));
  specs.push(...guidesPages(data));
  specs.push(...(await referencePages(data)));
  specs.push(...skillsPages(data));
  specs.push(...toolsPages(data));
  specs.push(...agentsPages(data));
  specs.push(...clientsPages(data));
  specs.push(mcpPage(data));
  specs.push(hooksPage(data));
  specs.push(changelogPage(data));
  specs.push(...docsPages(data));
  const wiki = wikiPages(data);
  if (!wiki.length) console.error("warning: no wiki pages generated — run `parasite-skill scan` first");
  specs.push(...wiki);

  // Two-phase: every page url is known before any markdown is rendered, so the
  // link rewriter can resolve .md references onto the real generated routes.
  const stemLookup = new Map();
  for (const url of specs.map((p) => p.url)) {
    if (url.endsWith(".html")) continue;
    stemLookup.set(url.toLowerCase(), url);
  }
  const pages = specs.map((spec) => {
    const rewriter = makeRewriter(stemLookup);
    const srcDir = spec.source ? posix.dirname(spec.source) : spec.url.startsWith("wiki/") ? "wiki" : ".";
    const pageDir = spec.url.endsWith(".html") ? posix.dirname(spec.url) : spec.url;
    const bound = (href) => rewriter(href, { srcDir, pageDir });
    let html;
    if (spec.htmlBuilder) {
      html = spec.htmlBuilder(bound);
    } else if (spec.md !== undefined) {
      html = renderMarkdown(spec.md, { rewriteHref: bound });
    }
    const plain = spec.plain ?? (spec.md !== undefined ? markdownToPlain(spec.md) : "");
    const crumbs = spec.crumbs ?? breadcrumbsFor(spec.section, spec.crumbsLabel ?? spec.title, spec.url);
    return { ...spec, html, plain, crumbs, mdPath: spec.md !== undefined ? "index.md" : null };
  });

  // 404 page (not in index/routes/pager).
  pages.push({
    url: "404.html",
    title: "Page not found",
    section: "home",
    sectionLabel: "Home",
    html: `<h1>404</h1><p>That page does not exist. Try the <a href="index.html">home page</a> or search above.</p>`,
    plain: "404 page not found",
    metaDesc: "Page not found",
    crumbs: breadcrumbsFor("home", "Not found", "404.html"),
    index: false,
  });

  const paged = pages.filter((p) => p.url !== "404.html" && p.url !== "index.html");
  for (const page of pages) {
    page.pager = page.url === "404.html" ? null : page.url === "index.html" ? { prev: null, next: null } : pagerFor(paged, page.url);
  }

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  for (const page of pages) {
    const file = page.file ?? (page.url.endsWith(".html") ? page.url : `${page.url}index.html`);
    write(
      out,
      file,
      layout({
        title: page.title,
        metaDesc: page.metaDesc,
        section: page.section,
        crumbs: page.crumbs,
        contentHtml: page.html,
        pager: page.pager,
        source: page.source,
        mdPath: page.mdPath,
        data,
        url: page.url,
      }),
    );
    if (page.mdPath) write(out, `${page.url}${page.mdPath}`, page.md ?? `# ${page.title}\n\n${page.plain ?? ""}`);
  }

  // Wiki graph artifacts (graph.json / graph.dot / graph.mmd) are generated by
  // `wikis` into the registry and linked from the wiki Home page — mirror them
  // into the site so those links resolve.
  for (const name of ["graph.json", "graph.dot", "graph.mmd"]) {
    const src = join(data.wikiDir, name);
    if (existsSync(src)) write(out, `wiki/${name}`, readFileSync(src, "utf-8"));
  }

  write(out, "site.css", SITE_CSS);
  write(out, "search.js", searchJs());
  write(out, "site-index.json", JSON.stringify(buildSearchIndex(pages), null, 2));
  write(out, "routes.json", JSON.stringify(routeManifest(pages.filter((p) => p.url !== "404.html")), null, 2));
  write(out, "llms.txt", llmsTxt(data, pages));
  write(out, "llms-full.txt", llmsFullTxt(pages));
  write(out, "sitemap.xml", sitemapXml(data, pages.filter((p) => p.url !== "404.html")));
  write(out, "robots.txt", robotsTxt(data));
  write(out, "data/index.json", JSON.stringify({
    kind: "parasite-skill-site-data",
    version: data.version,
    generated_at: data.generatedAt,
    repo: data.repo,
    counts: data.counts,
    skills: data.skills,
    sets: Object.fromEntries(Object.entries(data.sets).map(([name, set]) => [name, { desc: set.desc, members: set.members, project: !!set.project }])),
    tools: data.tools,
    agents: data.agents,
    clients: data.clients,
    mcp: data.mcp,
    extensions: data.extensions,
  }, null, 2));

  const validation = validateSite(out);
  return { out, pages: pages.length, data, validation };
}
