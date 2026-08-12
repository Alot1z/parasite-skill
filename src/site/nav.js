// Hierarchical navigation model for the generated site.
// The sidebar shows top-level sections; only the active section expands its
// children (clean hierarchy, not a flat list of every route). Breadcrumbs and
// prev/next pager are derived from the same tree.

export const SITE_SECTIONS = [
  { id: "home", label: "Home", href: "index.html" },
  { id: "features", label: "Features", href: "features/index.html" },
  { id: "architecture", label: "Architecture", href: "architecture/index.html" },
  { id: "configuration", label: "Configuration", href: "configuration/index.html" },
  {
    id: "guides",
    label: "Guides",
    href: "guides/index.html",
    children: [
      { id: "guide-routing", label: "Routing", href: "guides/routing/index.html" },
      { id: "guide-skill-sets", label: "Skill-sets", href: "guides/skill-sets/index.html" },
      { id: "guide-spec", label: "Skill spec", href: "guides/spec/index.html" },
      { id: "guide-languages", label: "Languages", href: "guides/languages/index.html" },
      { id: "guide-always-on", label: "Always-on cadence", href: "guides/always-on/index.html" },
      { id: "guide-full-skill", label: "Full skill reference", href: "guides/full-skill/index.html" },
    ],
  },
  {
    id: "reference",
    label: "Reference",
    href: "reference/index.html",
    children: [
      { id: "ref-commands", label: "Commands", href: "reference/commands/index.html" },
      { id: "ref-skills", label: "Skills", href: "skills/index.html" },
      { id: "ref-tools", label: "Tools", href: "tools/index.html" },
      { id: "ref-agents", label: "Agent profiles", href: "agents/index.html" },
      { id: "ref-clients", label: "Clients", href: "clients/index.html" },
      { id: "ref-mcp", label: "MCP", href: "mcp/index.html" },
      { id: "ref-hooks", label: "Hooks & extensions", href: "hooks/index.html" },
      { id: "ref-changelog", label: "Changelog", href: "changelog/index.html" },
    ],
  },
  {
    id: "docs",
    label: "Docs",
    href: "docs/index.html",
    children: [
      { id: "doc-mcp", label: "MCP guide", href: "docs/mcp/index.html" },
      { id: "doc-research", label: "Research", href: "docs/research/index.html" },
    ],
  },
  {
    id: "wiki",
    label: "Wiki",
    href: "wiki/home/index.html",
    children: [
      { id: "wiki-skills", label: "All skills", href: "wiki/skills/index.html" },
      { id: "wiki-categories", label: "Categories", href: "wiki/categories/index.html" },
      { id: "wiki-sets", label: "Skill-sets", href: "wiki/skillsets/index.html" },
      { id: "wiki-agents", label: "Agent profiles", href: "wiki/agents/index.html" },
      { id: "wiki-pairs", label: "Multiplicative pairs", href: "wiki/multiplicativepairs/index.html" },
    ],
  },
];

// Depth of a page = number of directories between it and the site root. A
// dir-index page at skills/foo/ renders to skills/foo/index.html (depth 2);
// a bare file like index.html or 404.html sits at the root (depth 0).
export function pageDepth(url) {
  const segments = url.split("/").filter(Boolean);
  if (url.endsWith(".html")) return Math.max(0, segments.length - 1);
  return segments.length;
}

// Relative prefix from a page url back to the site root.
export function relRoot(url) {
  return "../".repeat(pageDepth(url));
}

export function breadcrumbsFor(section, label, url) {
  const crumbs = [{ label: "Home", href: relRoot(url) + "index.html" }];
  if (section && section !== "home") {
    const sec = SITE_SECTIONS.find((s) => s.id === section);
    const href = sec ? sec.href : `${section.toLowerCase()}/index.html`;
    crumbs.push({ label: sec?.label ?? section, href: relRoot(url) + href });
  }
  crumbs.push({ label, href: null });
  return crumbs;
}

// Find the sibling pages for prev/next pager within a list of pages.
export function pagerFor(pages, url) {
  const idx = pages.findIndex((p) => p.url === url);
  if (idx === -1) return { prev: null, next: null };
  const prev = idx > 0 ? pages[idx - 1] : null;
  const next = idx < pages.length - 1 ? pages[idx + 1] : null;
  return { prev, next };
}
