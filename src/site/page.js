// Page layout shell for every generated page. Zero-JS navigation; the only
// client script is the search box. Every page carries a breadcrumb trail, a
// hierarchical sidebar (active section expanded), prev/next pager, and a
// source link back to the repo plus a raw-markdown twin link.
import { SITE_SECTIONS, relRoot } from "./nav.js";

export const esc = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export function badge(kind, label) {
  return `<span class="badge ${esc(kind)}">${esc(label)}</span>`;
}

function searchBox(rel) {
  return `
    <div class="search">
      <span class="icon" aria-hidden="true">⌕</span>
      <input id="site-search" type="search" placeholder="Search skills, tools, guides…" autocomplete="off" aria-label="Search the documentation">
      <div id="search-results" class="search-results" hidden></div>
    </div>`;
}

export function sidebarHtml(activeSection, rel) {
  const parts = [];
  for (const section of SITE_SECTIONS) {
    const active = section.id === activeSection;
    const cls = active ? "active" : "";
    parts.push(`<div class="sec"><a class="sec-head ${cls}" href="${rel}${section.href}">${esc(section.label)}</a>`);
    if (active && section.children?.length) {
      parts.push(section.children.map((child) => `<a class="child" href="${rel}${child.href}">${esc(child.label)}</a>`).join(""));
    }
    parts.push("</div>");
  }
  parts.push(`<div class="sec corpus"><a class="sec-head" href="${rel}llms.txt">LLM corpus</a><a class="child" href="${rel}llms.txt">llms.txt</a><a class="child" href="${rel}llms-full.txt">llms-full.txt</a><a class="child" href="${rel}site-index.json">search index</a><a class="child" href="${rel}routes.json">route manifest</a></div>`);
  return parts.join("\n");
}

export function layout({ title, metaDesc, section, crumbs, contentHtml, pager, source, mdPath, data, url }) {
  const rel = relRoot(url);
  const crumbHtml = crumbs
    .map((c) => (c.href ? `<li><a href="${c.href}">${esc(c.label)}</a></li>` : `<li aria-current="page">${esc(c.label)}</li>`))
    .join("");
  // The prefix is the current page's depth to root, not the target's: this
  // page is the one the browser is standing on.
  const rootPrefix = relRoot(url);
  const pageHref = (targetUrl) => esc(rootPrefix + targetUrl);
  const pagerHtml = pager
    ? `<nav class="pager" aria-label="Page navigation">${pager.prev ? `<a class="prev" href="${pageHref(pager.prev.url)}"><span class="dir">← Previous</span>${esc(pager.prev.title)}</a>` : "<span></span>"}${pager.next ? `<a class="next" href="${pageHref(pager.next.url)}"><span class="dir">Next →</span>${esc(pager.next.title)}</a>` : ""}</nav>`
    : "";
  const sourceHtml = source
    ? `<div class="page-source">Source: <a href="${data.repo}/blob/main/${esc(source)}">${esc(source)}</a>${mdPath ? ` · <a href="${mdPath}">raw markdown</a>` : ""}</div>`
    : "";
  const commit = data.commit?.[0];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · parasite-skill</title>
<meta name="description" content="${esc(metaDesc ?? title)}">
<link rel="stylesheet" href="${rel}site.css">
<link rel="canonical" href="${esc(data.siteUrl)}/${esc(url)}">
</head>
<body data-root="${esc(rel)}">
<header class="top">
  <a class="brand" href="${rel}index.html">parasite<span class="dot">-</span>skill<span class="ver">v${esc(data.version)}</span></a>
  ${searchBox(rel)}
  <button class="nav-toggle" aria-label="Toggle navigation" onclick="document.querySelector('.sidebar').classList.toggle('open')">☰</button>
</header>
<div class="wrap">
  <aside class="sidebar">${sidebarHtml(section, rel)}</aside>
  <main>
    <nav class="crumbs" aria-label="Breadcrumb"><ol>${crumbHtml}</ol></nav>
    <article>${contentHtml}</article>
    ${pagerHtml}
    ${sourceHtml}
  </main>
</div>
<footer>
  Generated ${new Date(data.generatedAt).toUTCString()} by <a href="${data.repo}">parasite-skill</a> v${esc(data.version)}
  ${commit ? `from <a href="${data.repo}/commit/${esc(commit.sha)}">${esc(commit.sha)}</a>` : ""} ·
  <a href="${rel}llms.txt">llms.txt</a> · <a href="${rel}sitemap.xml">sitemap</a> · <a href="${rel}robots.txt">robots</a>
</footer>
<script src="${rel}search.js"></script>
</body>
</html>`;
}
