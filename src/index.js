// skill-router CLI — entry point and dispatch.
import { LOGO } from "./logo.js";
import { VERSION } from "./engine.js";
import * as commands from "./commands.js";
import { runInstall, runList, runRemove } from "./clients.js";

const HELP = `skill-router v${VERSION}

Route any request to the right agent skills. One package, every AI client.

USAGE
  skill-router <command> [flags]
  npx skill-router <command> [flags]     (node)
  bunx skill-router <command> [flags]    (bun)

COMMANDS
  install   Install the skill-router skill into one or more AI clients
            (--copy | --link, --all | --agent claude-code,codex,opencode,...,
             -g/--global | --project, --yes, --force)
  list      Show installed skill-router instances per client
  remove    Remove installed instances (--agent a,b)
  scan      Re-analyze the whole skill ecosystem, rebuild registry
            (--dirs a,b)
  validate  Check every skill against the Agent Skills spec (exit 1 on issues)
  route     "<idea text>"   Score skills for an idea (--top N, --set, --json)
  sets      List skill-sets (--apply NAME to print a load order)
  refs      Generate ref pages (--per-skill)
  wikis     Generate the wiki + graph
  plan      "<request>"     Emit a routed execution plan
  trace     <file>          Count skill usage in a transcript
  link      Create/remove per-skill refs/wiki links (--unlink, --no-default)
  --version | --help

GLOBAL FLAGS
  --registry DIR   Central registry dir (default ~/.agents/skills/.skill-router)
  --dirs a,b       Extra scan dirs
  --force          Force rescan / fresh load
  --json           Machine-readable output

CLIENTS
  ${["claude-code", "codex", "opencode", "cline", "cursor", "windsurf", "gemini-cli", "warp", "github-copilot", "continue", "zed", "universal"].join(", ")}
`;

function parseFlags(argv) {
  const flags = { agents: [], _: [] };
  const num = (v) => parseInt(v, 10);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--registry": flags.registry = argv[++i]; break;
      case "--dirs": flags.dirs = argv[++i]; break;
      case "--force": flags.force = true; break;
      case "--json": flags.json = true; break;
      case "--top":
        flags.top = num(argv[++i]);
        if (!Number.isFinite(flags.top) || flags.top <= 0) flags.top = undefined;
        break;
      case "--set": flags.set = true; break;
      case "--apply": flags.apply = argv[++i]; break;
      case "--per-skill": flags.per_skill = true; break;
      case "--unlink": flags.unlink = true; break;
      case "--no-default": flags.no_default = true; break;
      case "--link": flags.mode = "link"; break;
      case "--copy": flags.mode = "copy"; break;
      case "--all": flags.all = true; break;
      case "--yes": case "-y": flags.yes = true; break;
      case "--global": case "-g": flags.scope = "user"; break;
      case "--project": flags.scope = "project"; break;
      case "--version": case "-v": flags.action = "version"; break;
      case "--help": case "-h": flags.action = "help"; break;
      case "--agent": case "-a": flags.agents.push(...argv[++i].split(",").map((x) => x.trim()).filter(Boolean)); break;
      default:
        if (a.startsWith("-")) {
          console.error(`unknown flag: ${a}`);
          process.exitCode = 2;
        } else flags._.push(a);
    }
  }
  return flags;
}

export async function run(argv) {
  const flags = parseFlags(argv);
  if (process.exitCode === 2) return 2;
  if (flags.action === "version") {
    console.log(`skill-router v${VERSION}`);
    return 0;
  }
  if (flags.action === "help") {
    console.log(LOGO);
    console.log(HELP);
    return 0;
  }
  const [cmd, ...rest] = flags._;
  const arg = rest.join(" ") || undefined;

  if (!cmd || cmd === "help") {
    console.log(LOGO);
    console.log(HELP);
    return 0;
  }

  const ctx = { ...flags, idea: arg, request: arg, file: rest[0] };

  switch (cmd) {
    case "install": return await runInstall(ctx);
    case "list": return runList();
    case "remove": return runRemove(ctx);
    case "scan": return commands.cmdScan(ctx);
    case "validate": return commands.cmdValidate(ctx);
    case "route": return commands.cmdRoute(ctx);
    case "sets": return commands.cmdSets(ctx);
    case "refs": return commands.cmdRefs(ctx);
    case "wikis": return commands.cmdWikis(ctx);
    case "plan": return commands.cmdPlan(ctx);
    case "trace": return commands.cmdTrace(ctx);
    case "link": return commands.cmdLink(ctx);
    default:
      console.log(LOGO);
      console.error(`unknown command: ${cmd}`);
      console.error(HELP);
      return 2;
  }
}
