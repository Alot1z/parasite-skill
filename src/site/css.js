// Design system for the generated site. Dark terminal-meets-docs aesthetic:
// slate surfaces, one indigo accent, mono code, sticky header with live search,
// responsive off-canvas sidebar. Zero external assets, zero JS framework.

export const SITE_CSS = `:root {
  --bg: #0b0e14;
  --bg-soft: #0f131c;
  --surface: #141a26;
  --surface-2: #1a2231;
  --border: #232c3d;
  --border-soft: #1b2332;
  --text: #d8dee9;
  --text-bright: #f2f5fa;
  --muted: #8b95a9;
  --muted-2: #677085;
  --accent: #7aa2ff;
  --accent-2: #9eceff;
  --green: #7ee0a3;
  --amber: #e5c07b;
  --red: #f07178;
  --mono: ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, monospace;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  --radius: 10px;
  --radius-sm: 6px;
  --sidebar-w: 248px;
  --max-w: 960px;
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 15.5px/1.7 var(--sans);
  -webkit-font-smoothing: antialiased;
}
a { color: var(--accent); text-decoration: none; }
a:hover { color: var(--accent-2); text-decoration: underline; }
code, pre { font-family: var(--mono); }
code {
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  padding: .1em .35em;
  border-radius: var(--radius-sm);
  font-size: .88em;
  color: var(--accent-2);
}
pre {
  background: var(--bg-soft);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  padding: 14px 16px;
  overflow-x: auto;
  line-height: 1.55;
  font-size: 13px;
}
pre code { background: none; border: 0; padding: 0; color: var(--text); }
img { max-width: 100%; border-radius: var(--radius-sm); }

/* ---------- header ---------- */
.top {
  position: sticky; top: 0; z-index: 50;
  display: flex; align-items: center; gap: 14px;
  padding: 10px 22px;
  background: rgba(11, 14, 20, .92);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--border-soft);
}
.brand {
  font-weight: 700; font-size: 15px; letter-spacing: .2px;
  color: var(--text-bright); white-space: nowrap;
}
.brand:hover { color: var(--accent-2); text-decoration: none; }
.brand .dot { color: var(--accent); }
.brand .ver { color: var(--muted-2); font-weight: 500; font-size: 12px; margin-left: 6px; }
.search { position: relative; flex: 1; max-width: 420px; margin-left: auto; }
.search input {
  width: 100%;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 8px;
  padding: 8px 12px 8px 32px;
  font: 14px var(--sans);
  outline: none;
  transition: border-color .15s, box-shadow .15s;
}
.search input::placeholder { color: var(--muted-2); }
.search input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(122,162,255,.15); }
.search .icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--muted-2); pointer-events: none; font-size: 13px; }
.search-results {
  position: absolute; top: calc(100% + 6px); left: 0; right: 0;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); box-shadow: 0 12px 32px rgba(0,0,0,.45);
  overflow: hidden; z-index: 60;
}
.search-results a {
  display: block; padding: 9px 12px; color: var(--text);
  border-bottom: 1px solid var(--border-soft);
}
.search-results a:last-child { border-bottom: 0; }
.search-results a:hover { background: var(--surface-2); color: var(--text-bright); text-decoration: none; }
.search-results .r-title { font-weight: 600; font-size: 13.5px; }
.search-results .r-section { color: var(--muted-2); font-size: 11.5px; }
.search-results .r-none { padding: 10px 12px; color: var(--muted); font-size: 13px; }
.nav-toggle {
  display: none; background: var(--surface); color: var(--text);
  border: 1px solid var(--border); border-radius: 8px;
  padding: 6px 10px; cursor: pointer; font-size: 15px;
}

/* ---------- layout ---------- */
.wrap { display: grid; grid-template-columns: var(--sidebar-w) 1fr; gap: 0; max-width: 1280px; margin: 0 auto; }
.sidebar {
  border-right: 1px solid var(--border-soft);
  padding: 22px 14px 40px;
  position: sticky; top: 57px; height: calc(100vh - 57px);
  overflow-y: auto;
}
.sidebar .sec { margin-bottom: 18px; }
.sidebar .sec-head {
  display: block; font-size: 11px; font-weight: 700; letter-spacing: .12em;
  text-transform: uppercase; color: var(--muted-2);
  padding: 2px 8px; margin-bottom: 4px;
}
.sidebar a {
  display: block; padding: 5px 8px; border-radius: var(--radius-sm);
  color: var(--muted); font-size: 13.5px;
}
.sidebar a:hover { color: var(--text-bright); background: var(--surface); text-decoration: none; }
.sidebar a.active { color: var(--accent); background: rgba(122,162,255,.08); font-weight: 600; }
.sidebar .child { padding-left: 20px; font-size: 13px; }
.sidebar .corpus {
  margin-top: 6px; padding-top: 12px; border-top: 1px solid var(--border-soft);
}

main { padding: 30px 38px 70px; min-width: 0; max-width: var(--max-w); }

/* ---------- breadcrumbs + pager ---------- */
.crumbs { font-size: 12.5px; color: var(--muted-2); margin-bottom: 18px; }
.crumbs ol { list-style: none; display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; }
.crumbs li + li::before { content: "/"; color: var(--muted-2); margin-right: 6px; }
.crumbs a { color: var(--muted); }
.crumbs a:hover { color: var(--accent); }
.pager {
  display: flex; justify-content: space-between; gap: 12px;
  margin-top: 44px; padding-top: 18px; border-top: 1px solid var(--border-soft);
}
.pager a {
  display: block; max-width: 46%; padding: 10px 14px;
  background: var(--surface); border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm); color: var(--text);
  font-size: 13px; transition: border-color .15s;
}
.pager a:hover { border-color: var(--accent); text-decoration: none; }
.pager .dir { display: block; font-size: 11px; color: var(--muted-2); text-transform: uppercase; letter-spacing: .08em; margin-bottom: 2px; }
.pager .next { text-align: right; margin-left: auto; }

/* ---------- typography ---------- */
article h1, article h2, article h3, article h4 {
  color: var(--text-bright); line-height: 1.25; letter-spacing: -.01em;
}
article h1 { font-size: 30px; margin: 0 0 8px; }
article h2 { font-size: 21px; margin: 36px 0 10px; padding-bottom: 6px; border-bottom: 1px solid var(--border-soft); }
article h3 { font-size: 17px; margin: 26px 0 8px; }
article h4 { font-size: 15px; margin: 20px 0 6px; }
article p { margin: 12px 0; }
article ul, article ol { margin: 10px 0; padding-left: 24px; }
article li { margin: 4px 0; }
article blockquote {
  margin: 16px 0; padding: 2px 16px;
  border-left: 3px solid var(--accent);
  background: rgba(122,162,255,.05); border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  color: var(--muted);
}
article table {
  width: 100%; border-collapse: collapse; margin: 16px 0;
  font-size: 13.5px; display: block; overflow-x: auto;
}
article th, article td {
  border: 1px solid var(--border-soft); padding: 7px 11px; text-align: left; vertical-align: top;
}
article th { background: var(--surface); color: var(--text-bright); font-weight: 600; white-space: nowrap; }
article tr:nth-child(even) td { background: rgba(255,255,255,.015); }
article hr { border: 0; border-top: 1px solid var(--border-soft); margin: 28px 0; }

/* ---------- components ---------- */
.hero { padding: 26px 0 10px; }
.hero .kicker {
  display: inline-block; font-size: 12px; letter-spacing: .14em; text-transform: uppercase;
  color: var(--accent); background: rgba(122,162,255,.09);
  border: 1px solid rgba(122,162,255,.2); padding: 3px 10px; border-radius: 999px; margin-bottom: 14px;
}
.hero .lede { font-size: 17px; color: var(--muted); max-width: 62ch; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 14px; margin: 24px 0; }
.card {
  display: block; background: var(--surface); border: 1px solid var(--border-soft);
  border-radius: var(--radius); padding: 16px 18px;
  color: var(--text); transition: border-color .15s, transform .15s;
}
.card:hover { border-color: var(--accent); transform: translateY(-2px); text-decoration: none; color: var(--text-bright); }
.card h3 { margin: 0 0 6px; font-size: 15px; color: var(--text-bright); }
.card p { margin: 0; font-size: 13px; color: var(--muted); }
.card .count { float: right; color: var(--muted-2); font-size: 12px; }

.badge {
  display: inline-block; font-size: 11px; font-weight: 600; letter-spacing: .05em;
  padding: 1px 8px; border-radius: 999px; border: 1px solid transparent; white-space: nowrap;
}
.badge.ok { color: var(--green); border-color: rgba(126,224,163,.35); background: rgba(126,224,163,.08); }
.badge.issue { color: var(--red); border-color: rgba(240,113,120,.35); background: rgba(240,113,120,.08); }
.badge.low { color: var(--green); border-color: rgba(126,224,163,.35); background: rgba(126,224,163,.08); }
.badge.medium { color: var(--amber); border-color: rgba(229,192,123,.35); background: rgba(229,192,123,.08); }
.badge.high { color: var(--red); border-color: rgba(240,113,120,.35); background: rgba(240,113,120,.08); }
.badge.neutral { color: var(--muted); border-color: var(--border); background: var(--surface-2); }

.stat-row { display: flex; flex-wrap: wrap; gap: 12px; margin: 18px 0; }
.stat {
  flex: 1 1 140px; background: var(--surface); border: 1px solid var(--border-soft);
  border-radius: var(--radius); padding: 12px 16px;
}
.stat .n { font-size: 24px; font-weight: 700; color: var(--accent-2); font-family: var(--mono); }
.stat .l { font-size: 12px; color: var(--muted-2); letter-spacing: .06em; text-transform: uppercase; }

.kv { display: grid; grid-template-columns: 140px 1fr; gap: 6px 14px; font-size: 14px; margin: 14px 0; }
.kv dt { color: var(--muted-2); font-weight: 600; }
.kv dd { margin: 0; }
.tag {
  display: inline-block; font-size: 12px; color: var(--accent-2);
  background: var(--surface-2); border: 1px solid var(--border-soft);
  padding: 1px 8px; border-radius: 999px; margin: 0 4px 4px 0;
}
.tag:hover { border-color: var(--accent); text-decoration: none; }

.cmd-block {
  background: var(--bg-soft); border: 1px solid var(--border-soft);
  border-radius: var(--radius); padding: 14px 16px; overflow-x: auto;
  font-family: var(--mono); font-size: 13px; line-height: 1.55; white-space: pre;
}
.page-source { margin-top: 34px; font-size: 12px; color: var(--muted-2); }
.page-source a { color: var(--muted); }
.page-source a:hover { color: var(--accent); }

/* ---------- footer ---------- */
footer {
  border-top: 1px solid var(--border-soft);
  padding: 20px 22px 28px; text-align: center;
  color: var(--muted-2); font-size: 12.5px;
}
footer a { color: var(--muted); }
footer a:hover { color: var(--accent); }

/* ---------- responsive ---------- */
@media (max-width: 900px) {
  .wrap { grid-template-columns: 1fr; }
  .sidebar {
    position: fixed; inset: 57px 0 0 auto; width: 264px; z-index: 40;
    background: var(--bg-soft); transform: translateX(100%); transition: transform .18s ease;
    height: calc(100vh - 57px);
  }
  .sidebar.open { transform: translateX(0); box-shadow: -16px 0 40px rgba(0,0,0,.4); }
  .nav-toggle { display: inline-block; }
  main { padding: 22px 18px 60px; }
  .search { max-width: none; }
  article h1 { font-size: 25px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; scroll-behavior: auto !important; }
}
`;
