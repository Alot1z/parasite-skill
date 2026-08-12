// parasite-skill visual identity.
// Custom block wordmark ("PARASITE SKILL") with a per-character truecolor
// gradient — indigo → cyan → teal, multiple shades per letter. No vendor
// palette: deliberately unlike skills.sh (grey) and Claude Code (orange/red).
// Falls back to a flat cyan for terminals without 24-bit color.

const WORDMARK = [
  "█████   ████  █████   ████  ██████ ██████ ██████ ██████        ██████ ██  ██ ██████ ██     ██    ",
  "██  ██ ██  ██ ██  ██ ██  ██ ██       ██     ██   ██            ██     ██ ██    ██   ██     ██    ",
  "█████  ██████ █████  ██████ █████    ██     ██   █████         █████  ████     ██   ██     ██    ",
  "██     ██  ██ ██ ██  ██  ██     ██   ██     ██   ██                ██ ██ ██    ██   ██     ██    ",
  "██     ██  ██ ██  ██ ██  ██ ██████ ██████   ██   ██████        ██████ ██  ██ ██████ ██████ ██████"
];

const HUB = [
  "            ┌──────────┐",
  "            │ PARASITE │",
  "       ┌────┤  SKILL   ├────┐",
  "       │    └──────────┘    │",
  "       ▼          ▲          ▼",
  "    skills     ideas     clients"
];

const TAGLINE = "parasite-skill — inject, enhance, and route agent skills";

// Truecolor support: COLORTERM=truecolor or TERM contains 'truecolor'/'24bit'.
// FORCE_COLOR=1 forces color on (CI/tests); NO_COLOR (any value) disables it.
function supportsTruecolor() {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "0") return true;
  const ct = process.env.COLORTERM ?? "";
  const term = process.env.TERM ?? "";
  if (/truecolor|24bit/.test(ct) || /truecolor|24bit/.test(term)) return true;
  const program = (process.env.TERM_PROGRAM ?? "").toLowerCase();
  if (["vscode", "wezterm", "warp", "iterm.app", "hyper"].includes(program)) return true;
  if (process.env.WT_SESSION || process.env.KONSOLE_VERSION || process.env.VTE_VERSION) return true;
  // mintty/git-bash and modern VT consoles advertise 256color; legacy cmd.exe
  // conhost leaves TERM empty, so a bare win32 check would over-claim.
  return process.platform === "win32" && /256color/.test(term);
}

// Gradient stops: indigo (#6366f1) -> cyan (#22d3ee) -> teal (#2dd4bf).
const STOPS = [
  [99, 102, 241], // indigo-500
  [34, 211, 238], // cyan-400
  [45, 212, 191], // teal-400
];

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function shadeAt(t) {
  const n = STOPS.length - 1;
  const seg = Math.min(Math.max(t, 0), 1) * n;
  const i = Math.min(Math.floor(seg), n - 1);
  const f = seg - i;
  return [lerp(STOPS[i][0], STOPS[i + 1][0], f), lerp(STOPS[i][1], STOPS[i + 1][1], f), lerp(STOPS[i][2], STOPS[i + 1][2], f)];
}

function paintGradient(lines, totalChars) {
  const out = [];
  let idx = 0;
  for (const line of lines) {
    let rendered = "";
    for (const ch of line) {
      if (ch === " ") {
        rendered += ch;
        continue;
      }
      const [r, g, b] = shadeAt(idx / Math.max(totalChars, 1));
      rendered += `\x1b[38;2;${r};${g};${b}m${ch}\x1b[0m`;
      idx++;
    }
    out.push(rendered);
  }
  return out.join("\n");
}

function countChars(lines) {
  let n = 0;
  for (const line of lines) for (const ch of line) if (ch !== " ") n++;
  return n;
}

export const LOGO = supportsTruecolor()
  ? paintGradient(WORDMARK, countChars(WORDMARK)) + "\n\x1b[2m" + HUB.join("\n") + "\x1b[0m"
  : `\x1b[36m${WORDMARK.join("\n")}\x1b[0m\n\x1b[2m${HUB.join("\n")}\x1b[0m`;

const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

export function banner() {
  const logo = supportsTruecolor()
    ? paintGradient(WORDMARK, countChars(WORDMARK))
    : `\x1b[36m${WORDMARK.join("\n")}\x1b[0m`;
  return ["", BOLD + logo + RESET, "", DIM + HUB.join("\n") + RESET, "", `${TAGLINE}`, ""].join("\n");
}

export function smallLogo() {
  // Compact badge for progress lines (gradient on the brackets only).
  const badge = supportsTruecolor()
    ? `\x1b[38;2;99;102;241m[\x1b[0m\x1b[38;2;34;211;238mPARASITE-SKILL\x1b[0m\x1b[38;2;45;212;191m]\x1b[0m`
    : `${CYAN}[PARASITE-SKILL]${RESET}`;
  return badge;
}
