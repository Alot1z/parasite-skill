// Search: build the client-side index (site-index.json) and emit the zero-dep
// search script (search.js) that filters it live in the header dropdown.

export function buildSearchIndex(pages) {
  return pages
    .filter((p) => p.index !== false)
    .map((p) => ({
      url: p.url,
      title: p.title,
      section: p.sectionLabel ?? p.section,
      text: String(p.plain ?? "").slice(0, 600),
    }));
}

export function searchJs() {
  return `// Zero-dependency client-side search for the parasite-skill docs site.
(function () {
  "use strict";
  var root = document.body.getAttribute("data-root") || "";
  var input = document.getElementById("site-search");
  var box = document.getElementById("search-results");
  var index = [];
  if (!input || !box) return;
  var norm = function (s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ");
  };
  var open = function () { box.hidden = false; };
  var close = function () { box.hidden = true; };
  input.addEventListener("focus", function () { if (box.children.length) open(); });
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".search")) close();
  });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Escape") close();
    if (e.key === "Enter") { var first = box.querySelector("a"); if (first) window.location = first.href; }
  });
  // Browsers block fetch() under the file:// protocol (local previews). The
  // deployed site is served over http(s), where same-origin fetch works; under
  // file:// we just leave search off instead of logging console noise.
  var isFile = window.location.protocol === "file:";
  var ready = isFile
    ? Promise.resolve(index)
    : fetch(root + "site-index.json")
        .then(function (r) { return r.json(); })
        .then(function (data) { index = data; })
        .catch(function () { index = []; });
  input.addEventListener("input", function () {
    ready.then(function () {
      var q = norm(input.value);
      box.innerHTML = "";
      if (q.length < 2) { close(); return; }
      var hits = [];
      var words = q.split(" ");
      for (var i = 0; i < index.length && hits.length < 8; i++) {
        var page = index[i];
        var hay = norm(page.title + " " + page.section + " " + page.text);
        var ok = true;
        for (var w = 0; w < words.length; w++) {
          if (words[w] && hay.indexOf(words[w]) === -1) { ok = false; break; }
        }
        if (ok) hits.push(page);
      }
      if (!hits.length) {
        var none = document.createElement("div");
        none.className = "r-none";
        none.textContent = "No matches for \\"" + input.value + "\\"";
        box.appendChild(none);
      } else {
        hits.forEach(function (page) {
          var a = document.createElement("a");
          a.href = root + page.url;
          var t = document.createElement("span");
          t.className = "r-title";
          t.textContent = page.title;
          var s = document.createElement("span");
          s.className = "r-section";
          s.textContent = " · " + page.section;
          a.appendChild(t);
          a.appendChild(s);
          box.appendChild(a);
        });
      }
      open();
    });
  });
})();
`;
}
