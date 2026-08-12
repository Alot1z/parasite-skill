// Minimal dependency-free markdown renderer for the static site generator.
// Covers the subset the docs actually use: ATX headings, fenced code, inline
// code, bold/italic, links, images, lists (2 levels), tables, blockquotes, hr,
// autolinks. Everything is escaped — raw HTML in markdown is rendered as text.
// `rewriteHref(href)` lets the caller map .md links onto generated .html files.

const escapeHtml = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "section";
}

// Inline parser: code spans first (protected), then the rest.
function inline(text, rewriteHref) {
  const parts = [];
  let rest = String(text);
  while (rest.length) {
    const code = rest.indexOf("`");
    if (code === -1) {
      parts.push(inlineRich(rest, rewriteHref));
      break;
    }
    parts.push(inlineRich(rest.slice(0, code), rewriteHref));
    const close = rest.indexOf("`", code + 1);
    if (close === -1) {
      parts.push(inlineRich(rest.slice(code), rewriteHref));
      break;
    }
    parts.push(`<code>${escapeHtml(rest.slice(code + 1, close))}</code>`);
    rest = rest.slice(close + 1);
  }
  return parts.join("");
}

function inlineRich(text, rewriteHref) {
  let s = escapeHtml(text);
  // images ![alt](url)
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, url) => {
    const href = rewriteHref ? rewriteHref(url) : url;
    return `<img src="${href}" alt="${alt}" loading="lazy">`;
  });
  // links [text](url) — url may contain a title in quotes; keep it simple
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, url) => {
    const href = rewriteHref ? rewriteHref(url) : url;
    return `<a href="${href}">${inline(label, rewriteHref)}</a>`;
  });
  // autolinks <https://...> — the text is escaped first, so match the escaped
  // angle brackets and rebuild the href from the escaped URL (entities decode
  // in the browser).
  s = s.replace(/&lt;(https?:\/\/[^&gt;]+)&gt;/g, '<a href="$1">$1</a>');
  // bold then italic (italic pattern must not eat ** pairs)
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  return s;
}

const heading = /^(#{1,6})\s+(.*)$/;
const fenceStart = /^```(\w*)\s*$/;
const fenceEnd = /^```\s*$/;
const tableRow = /^\s*\|/;
const listItem = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const hr = /^\s*(-{3,}|\*{3,})\s*$/;
const quote = /^>\s?(.*)$/;

export function renderMarkdown(md, { rewriteHref } = {}) {
  const lines = String(md).replace(/\r\n/g, "\n").split("\n");
  const out = [];
  const usedIds = new Map();
  let para = [];
  let list = null; // { ordered, items: [{indent, html}], open: bool }
  let table = null; // { header: [], rows: [] }

  const flushPara = () => {
    if (!para.length) return;
    out.push(`<p>${inline(para.join(" "), rewriteHref)}</p>`);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const tag = list.ordered ? "ol" : "ul";
    const body = list.items
      .map((item) => (item.indent > list.base ? `<ul><li>${item.html}</li></ul>` : `<li>${item.html}</li>`))
      .join("");
    out.push(`<${tag}>${body}</${tag}>`);
    list = null;
  };
  const flushTable = () => {
    if (!table) return;
    const head = `<thead><tr>${table.header.map((h) => `<th>${inline(h, rewriteHref)}</th>`).join("")}</tr></thead>`;
    const body = table.rows.map((row) => `<tr>${row.map((c) => `<td>${inline(c, rewriteHref)}</td>`).join("")}</tr>`).join("");
    out.push(`<table>${head}<tbody>${body}</tbody></table>`);
    table = null;
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushTable();
  };

  let inFence = null;
  let fenceBuf = [];
  let quoteBuf = [];

  const flushQuote = () => {
    if (!quoteBuf.length) return;
    out.push(`<blockquote>${quoteBuf.map((q) => `<p>${inline(q, rewriteHref)}</p>`).join("")}</blockquote>`);
    quoteBuf = [];
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (inFence !== null) {
      if (fenceEnd.test(line)) {
        out.push(`<pre><code${inFence ? ` class="lang-${escapeHtml(inFence)}"` : ""}>${escapeHtml(fenceBuf.join("\n"))}</code></pre>`);
        inFence = null;
        fenceBuf = [];
      } else fenceBuf.push(line);
      continue;
    }
    const fence = fenceStart.exec(line);
    if (fence) {
      flushAll();
      flushQuote();
      inFence = fence[1];
      continue;
    }
    if (line.startsWith("```")) {
      flushAll();
      flushQuote();
      inFence = "";
      continue;
    }
    if (line.trim() === "") {
      flushAll();
      flushQuote();
      continue;
    }
    const h = heading.exec(line);
    if (h) {
      flushAll();
      flushQuote();
      const level = h[1].length;
      let id = slugify(h[2]);
      const seen = usedIds.get(id) ?? 0;
      usedIds.set(id, seen + 1);
      if (seen) id = `${id}-${seen}`;
      out.push(`<h${level} id="${id}">${inline(h[2], rewriteHref)}</h${level}>`);
      continue;
    }
    if (hr.test(line)) {
      flushAll();
      flushQuote();
      out.push("<hr>");
      continue;
    }
    const q = quote.exec(line);
    if (q) {
      flushAll();
      quoteBuf.push(q[1]);
      continue;
    }
    const t = tableRow.test(line);
    if (t) {
      const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      if (!table) {
        table = { header: cells, rows: [] };
        continue;
      }
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // separator row
      table.rows.push(cells);
      continue;
    }
    if (table) {
      flushTable();
    }
    const li = listItem.exec(line);
    if (li) {
      flushPara();
      flushQuote();
      const indent = li[1].length;
      const ordered = /^\d+\.$/.test(li[2]);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [], base: indent, open: true };
      }
      list.items.push({ indent, html: inline(li[3], rewriteHref) });
      continue;
    }
    if (list) flushList();
    para.push(line);
  }
  flushAll();
  flushQuote();
  return out.join("\n");
}

// Strip tags/entities to plain text for search indexing.
export function markdownToPlain(md) {
  const html = renderMarkdown(md);
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
