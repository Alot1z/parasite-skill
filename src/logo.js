// skill-router visual identity.
// Custom wordmark (SKILL ROUTER) drawn with block characters + a router-hub motif,
// styled with the cyan/white family. Renders on any terminal (pure ASCII + box chars).

const WORDMARK = [
  "  ███████╗██╗  ██╗██╗██╗     ██╗      ██████╗  ██████╗ ██╗   ██╗████████╗███████╗██████╗ ",
  "  ██╔════╝██║ ██╔╝██║██║     ██║      ██╔══██╗██╔═══██╗██║   ██║╚══██╔══╝██╔════╝██╔══██╗",
  "  ███████╗█████╔╝ ██║██║     ██║      ██████╔╝██║   ██║██║   ██║   ██║   █████╗  ██████╔╝",
  "  ╚════██║██╔═██╗ ██║██║     ██║      ██╔══██╗██║   ██║██║   ██║   ██║   ██╔══╝  ██╔══██╗",
  "  ███████║██║  ██╗██║███████╗███████╗ ██║  ██║╚██████╔╝╚██████╔╝   ██║   ███████╗██║  ██║",
  "  ╚══════╝╚═╝  ╚═╝╚═╝╚══════╝╚══════╝ ╚═╝  ╚═╝ ╚═════╝  ╚═════╝    ╚═╝   ╚══════╝╚═╝  ╚═╝",
];

const HUB = [
  "        ┌─────────┐",
  "        │  SKILL  │",
  "   ┌────┤  ROUTER ├────┐",
  "   │    └─────────┘    │",
  "   ▼         ▲         ▼",
  " skills   ideas   clients",
];

const TAGLINE = "route any request to the right agent skills";

const CYAN = "\x1b[36m";
const WHITE = "\x1b[37m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

export const LOGO = `${CYAN}${WORDMARK.join("\n")}${RESET}\n${DIM}${HUB.join("\n")}${RESET}`;

export function banner() {
  return [
    "",
    `${CYAN}${BOLD}${WORDMARK.join("\n")}${RESET}`,
    `${DIM}${HUB.join("\n")}${RESET}`,
    "",
    `${WHITE}${TAGLINE}${RESET}`,
    "",
  ].join("\n");
}

export function smallLogo() {
  // Compact single-line badge for progress lines.
  return `${CYAN}[SKILL-ROUTER]${RESET}`;
}
