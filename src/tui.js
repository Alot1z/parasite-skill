// Zero-dependency TUI kit: raw-mode keyboard list picker, spinner, progress bar,
// and confirm prompt. Pure ANSI — no packages. Layout inspired by modern CLI
// installers (skills.sh, npm create, gh, volta) but written from scratch.

// ------------------------------------------------------------------ ANSI utils

export const ESC = "\x1b[";
export const hideCursor = () => process.stdout.write(ESC + "?25l");
export const showCursor = () => process.stdout.write(ESC + "?25h");
export const clearScreen = () => process.stdout.write(ESC + "2J" + ESC + "H");
export const color = (code, s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
export const c = {
  cyan: (s) => color(36, s),
  green: (s) => color(32, s),
  red: (s) => color(31, s),
  yellow: (s) => color(33, s),
  dim: (s) => color(2, s),
  bold: (s) => color(1, s),
};

// ------------------------------------------------------------------ raw mode

function enterRaw() {
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
}

function exitRaw() {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
}

// ------------------------------------------------------------------ keyboard list

/**
 * Interactive single/multi select with arrow keys.
 * @param {Array<{id:string,label:string,detail?:string,checked?:boolean,disabled?:boolean}>} items
 * @param {{multi?:boolean,title?:string,initial?:number}} opts
 * @returns {Promise<string[]|string|null>} ids (multi) or single id, null on cancel
 */
export async function pickList(items, opts = {}) {
  const { multi = true, title = "", initial = 0 } = opts;
  if (!process.stdin.isTTY) {
    // Non-interactive fallback: return all checked / enabled ids.
    return multi
      ? items.filter((i) => i.checked && !i.disabled).map((i) => i.id)
      : (items.find((i) => i.checked)?.id ?? items.find((i) => !i.disabled)?.id ?? null);
  }
  const checked = new Set(items.filter((i) => i.checked).map((i) => i.id));
  let cursor = Math.min(initial, Math.max(0, items.length - 1));

  const render = () => {
    clearScreen();
    if (title) console.log(color(1, title));
    items.forEach((item, idx) => {
      const marker = multi ? (checked.has(item.id) ? c.green("◉") : c.dim("○")) : cursor === idx ? c.cyan("▸") : " ";
      const sel = multi ? ` ${marker} ` : ` ${marker} `;
      const name = item.disabled ? c.dim(item.label) : idx === cursor ? c.bold(c.cyan(item.label)) : item.label;
      const detail = item.detail ? c.dim(`  ${item.detail}`) : "";
      console.log(`${sel}${name}${detail}`);
    });
    console.log("");
    console.log(c.dim(multi ? "↑/↓ move · space toggle · a all · n none · enter confirm · q cancel" : "↑/↓ move · enter confirm · q cancel"));
  };

  enterRaw();
  hideCursor();
  render();

  const keypress = (str, key) => {
    const { name, ctrl } = key;
    if (ctrl && name === "c") { exitRaw(); showCursor(); process.exit(130); }
    if (name === "up") { cursor = (cursor - 1 + items.length) % items.length; render(); }
    else if (name === "down") { cursor = (cursor + 1) % items.length; render(); }
    else if (multi && (name === "space" || str === " ")) {
      const it = items[cursor];
      if (!it.disabled) { checked.has(it.id) ? checked.delete(it.id) : checked.add(it.id); render(); }
    } else if (multi && (str === "a" || str === "A")) {
      items.forEach((it) => { if (!it.disabled) checked.add(it.id); });
      render();
    } else if (multi && (str === "n" || str === "N")) {
      checked.clear(); render();
    } else if (name === "return" || name === "enter") {
      exitRaw(); showCursor(); clearScreen();
      return done(multi ? [...checked] : items[cursor]?.id ?? null);
    } else if (name === "escape" || str === "q") {
      exitRaw(); showCursor(); clearScreen();
      return done(null);
    }
  };

  let resolve;
  const done = (val) => { cleanup(); resolve(val); };
  const onKey = (s, k) => { try { keypress(s, k); } catch { /* ignore */ } };
  process.stdin.on("data", (data) => {
    // Decode raw bytes into keypress-ish events (simple: escape sequences).
    const s = data.toString();
    if (s === "\x1b[A") return onKey(null, { name: "up" });
    if (s === "\x1b[B") return onKey(null, { name: "down" });
    if (s === "\r" || s === "\n") return onKey(null, { name: "enter" });
    if (s === "\x1b") return onKey(null, { name: "escape" });
    if (s === "\u0003") return onKey(null, { ctrl: true, name: "c" });
    onKey(s, { name: s });
  });
  const cleanup = () => { process.stdin.removeAllListeners("data"); };
  return await new Promise((res) => { resolve = res; });
}

// ------------------------------------------------------------------ spinner

const SPINNERS = {
  braille: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  dashes: ["|", "/", "-", "\\"],
};

/**
 * Run fn while showing a spinner. fn may be sync or async.
 * @returns {Promise<*>} fn's return value
 */
export async function spin(label, fn, frames = SPINNERS.braille) {
  const isTty = process.stdout.isTTY;
  let i = 0;
  const timer = isTty ? setInterval(() => {
    process.stdout.write(`\r${c.cyan(frames[i++ % frames.length])} ${label}`);
  }, 80) : null;
  try {
    const out = await fn();
    if (timer) { clearInterval(timer); process.stdout.write(`\r${c.green("✔")} ${label}\n`); }
    return out;
  } catch (e) {
    if (timer) { clearInterval(timer); process.stdout.write(`\r${c.red("✘")} ${label}\n`); }
    throw e;
  }
}

// ------------------------------------------------------------------ progress bar

export function progressBar(fraction, width = 24) {
  const filled = Math.round(fraction * width);
  const bar = c.cyan("█".repeat(filled)) + c.dim("░".repeat(Math.max(0, width - filled)));
  return `[${bar}] ${String(Math.round(fraction * 100)).padStart(3)}%`;
}

/** Stream progress updates; call fn(update) between 0..1. */
export async function progress(taskLabel, fn) {
  const isTty = process.stdout.isTTY;
  let last = "";
  const draw = (frac, note = "") => {
    if (!isTty) return;
    last = `\r${taskLabel} ${progressBar(frac)} ${note}`;
    process.stdout.write(last);
  };
  draw(0, "…");
  try {
    const out = await fn(draw);
    if (isTty) { process.stdout.write(`\r${taskLabel} ${progressBar(1)} ${c.green("done")}\n`); }
    return out;
  } catch (e) {
    if (isTty) { process.stdout.write(`\r${taskLabel} ${c.red("failed")}\n`); }
    throw e;
  }
}

// ------------------------------------------------------------------ confirm

export async function confirm(question, def = true) {
  if (!process.stdin.isTTY) return def;
  const suffix = def ? "(Y/n)" : "(y/N)";
  process.stdout.write(`${question} ${c.dim(suffix)} `);
  enterRaw();
  return await new Promise((res) => {
    const onData = (data) => {
      const s = data.toString().trim().toLowerCase();
      process.stdin.removeListener("data", onData);
      exitRaw();
      process.stdout.write("\n");
      if (s === "y" || s === "yes") return res(true);
      if (s === "n" || s === "no") return res(false);
      res(def);
    };
    process.stdin.on("data", onData);
  });
}
