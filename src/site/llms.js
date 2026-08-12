// LLM-readable corpus + crawler surfaces:
//   llms.txt       — spec-style summary + links to every page's markdown twin
//   llms-full.txt  — the whole corpus concatenated (single-file ingestion)
//   sitemap.xml    — every physical route
//   robots.txt     — allow all, point at the sitemap

export function llmsTxt(data, pages) {
  const out = [];
  out.push(`# parasite-skill`);
  out.push(``);
  out.push(`> Bounded routing and ecosystem tooling for installed AI skills.`);
  out.push(`> Version ${data.version}. Generated ${data.generatedAt}.`);
  out.push(``);
  out.push(`parasite-skill routes any request to the right agent skills, scans and validates the skill ecosystem, generates refs/wikis with adaptive links, exposes skill scripts as callable AI tools, and ships a per-project config + MCP + parasite extension layer.`);
  out.push(``);
  out.push(`## Full corpus`);
  out.push(``);
  out.push(`- [llms-full.txt](${data.siteUrl}/llms-full.txt) — every page below, concatenated`);
  out.push(``);
  const bySection = new Map();
  for (const page of pages) {
    if (page.index === false) continue;
    const list = bySection.get(page.sectionLabel ?? page.section) ?? [];
    list.push(page);
    bySection.set(page.sectionLabel ?? page.section, list);
  }
  for (const [section, list] of [...bySection.entries()].sort()) {
    out.push(`## ${section}`);
    out.push(``);
    for (const page of list) {
      const mdHref = page.mdPath ? `${data.siteUrl}/${page.url}${page.mdPath}` : `${data.siteUrl}/${page.url}`;
      out.push(`- [${page.title}](${mdHref})`);
    }
    out.push(``);
  }
  return out.join("\n");
}

export function llmsFullTxt(pages) {
  const out = [];
  for (const page of pages) {
    if (page.index === false) continue;
    out.push(`<!-- ============================================================ -->`);
    out.push(`<!-- page: ${page.url} -->`);
    out.push(`<!-- title: ${page.title} -->`);
    out.push(`<!-- ============================================================ -->`);
    out.push(``);
    out.push(page.md ?? `# ${page.title}\n\n${page.plain ?? ""}`);
    out.push(``);
  }
  return out.join("\n");
}

export function sitemapXml(data, pages) {
  const urls = pages.map((p) => `  <url><loc>${data.siteUrl}/${p.url}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${data.siteUrl}/</loc></url>
${urls}
</urlset>
`;
}

export function robotsTxt(data) {
  return `User-agent: *
Allow: /
Disallow: /data/

Sitemap: ${data.siteUrl}/sitemap.xml
`;
}
