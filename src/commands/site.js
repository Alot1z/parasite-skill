// `parasite-skill site` — static docs site generator.
//   site build [--out DIR] [--base URL]   generate the full multi-page site
//   site validate [--out DIR]             verify routes + links of a build
import { buildSite } from "../site/index.js";
import { validateSite } from "../site/validate.js";

export async function cmdSite(args = {}) {
  const sub = String(args.idea ?? "build").trim().toLowerCase();
  const out = args.out || "public";

  if (sub === "validate") {
    const res = validateSite(out);
    for (const problem of res.problems) console.error(`  x ${problem}`);
    console.log(
      `site validate: ${res.checks.html} pages · ${res.checks.markdownTwins} markdown twins · ` +
        `${res.problems.length} problem(s) · llms.txt ${res.checks.llms_txt ? "ok" : "missing"} · ` +
        `sitemap ${res.checks.sitemap ? "ok" : "missing"} · search index ${res.checks.search_index ? "ok" : "missing"}`,
    );
    return res.problems.length ? 1 : 0;
  }

  if (sub !== "build") {
    console.error(`unknown site action: ${sub} (use build or validate)`);
    return 2;
  }

  const result = await buildSite(args);
  for (const problem of result.validation.problems) console.error(`  x ${problem}`);
  console.log(`site built: ${result.pages} pages -> ${out.replace(/\\/g, "/")}`);
  console.log(
    `  routes: ${result.validation.checks.html} html · ${result.validation.checks.markdownTwins} markdown twins · ` +
      `${result.validation.checks.llms_txt ? "llms.txt ok" : "llms.txt MISSING"} · ` +
      `${result.validation.checks.sitemap ? "sitemap ok" : "sitemap MISSING"} · ` +
      `${result.validation.checks.search_index ? "search index ok" : "search index MISSING"}`,
  );
  return result.validation.problems.length ? 1 : 0;
}
