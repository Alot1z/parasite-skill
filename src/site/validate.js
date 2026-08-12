// Route manifest + validation.
// routes.json lists every generated page; validateSite() re-reads the build
// and asserts that every internal href resolves to a physically emitted file
// and that the corpus/search/sitemap artifacts exist and parse.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, normalize } from "node:path";

export function routeManifest(pages) {
  return {
    kind: "parasite-skill-site-routes",
    generated_at: new Date().toISOString(),
    count: pages.length,
    routes: pages.map((p) => ({ url: p.url, file: p.file, title: p.title, section: p.section })),
  };
}

function collectFiles(dir, prefix, out) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (stat.isDirectory()) collectFiles(full, rel, out);
    else out.push(rel);
  }
  return out;
}

export function validateSite(outDir) {
  const files = collectFiles(outDir, "", []);
  // Compare case-insensitively: Windows treats wiki/skills and wiki/Skills as
  // the same directory, so the emitted file set and href targets must agree
  // modulo case (GitHub Pages on Linux is case-sensitive, so hrefs should
  // still match the emitted names exactly where possible).
  const set = new Set(files.map((f) => f.replace(/\\/g, "/").toLowerCase()));
  const problems = [];
  const normalizeHref = (href) => {
    const clean = href.split(/[?#]/)[0];
    if (!clean) return null;
    let p = clean;
    if (p.endsWith("/")) p += "index.html";
    return p;
  };
  for (const file of files) {
    if (!file.endsWith(".html")) continue;
    const html = readFileSync(join(outDir, file), "utf-8");
    const rel = file.replace(/\\/g, "/");
    for (const match of html.matchAll(/href="([^"]+)"/g)) {
      const href = match[1];
      if (/^(https?:|mailto:|#|javascript:|data:)/.test(href)) continue;
      const target = normalizeHref(href);
      if (!target) continue;
      const resolved = normalize(join(dirname(rel), target)).replace(/\\/g, "/");
      if (!set.has(resolved.toLowerCase())) {
        problems.push(`broken link in ${rel}: ${href} -> missing ${resolved}`);
      }
    }
  }
  const checks = {
    html: files.filter((f) => f.endsWith(".html")).length,
    markdownTwins: files.filter((f) => f.endsWith(".md")).length,
    llms_txt: existsSync(join(outDir, "llms.txt")),
    llms_full: existsSync(join(outDir, "llms-full.txt")),
    sitemap: existsSync(join(outDir, "sitemap.xml")),
    robots: existsSync(join(outDir, "robots.txt")),
    search_index: existsSync(join(outDir, "site-index.json")),
    routes_manifest: existsSync(join(outDir, "routes.json")),
    not_found: existsSync(join(outDir, "404.html")),
  };
  for (const [name, present] of Object.entries(checks)) {
    if (name !== "html" && name !== "markdownTwins" && !present) problems.push(`missing artifact: ${name}`);
  }
  try {
    JSON.parse(readFileSync(join(outDir, "site-index.json"), "utf-8"));
    JSON.parse(readFileSync(join(outDir, "routes.json"), "utf-8"));
  } catch (err) {
    problems.push(`unparseable JSON artifact: ${String(err.message ?? err)}`);
  }
  return { problems, checks, files: files.length };
}
