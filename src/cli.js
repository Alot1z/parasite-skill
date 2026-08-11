// skill-router CLI — argument parsing, help, dispatch.
import { LOGO } from "./logo.js";
import { VERSION } from "./engine.js";
import * as commands from "./commands/index.js";
import { CLIENTS, runInstall, runList, runRemove } from "./clients.js";
import { runMcpAdd, runMcpRemove, runMcpList } from "./mcp-register.js";

const HELP = `skill-router v${VERSION}

Route any request to the right agent skills. One package, every AI client.

USAGE
  skill-router <command> [flags]
  npx skill-router <command> [flags]     (node)
  bunx skill-router <command> [flags]    (bun)

COMMANDS
  install   Install the skill-router skill into one or more AI clients
            (--copy | --link, --all | --agent <ids>, -g/--global | --project,
             --yes, --force)
  list      Show installed skill-router instances per client
  remove    Remove installed instances (--agent <ids>)
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
  mcp       MCP control: add|remove|list register/remove the skill-router MCP
            server in client configs (no manual config); bare mcp runs the server
  bundle    Build a tarball + install.json manifest for GitHub Pages distribution
  sync      Cloud-sync the skills tree to a git remote (--init URL | --push | --pull)
  agents    Generate AGENTS.md for the current project (--out PATH)
  graph     Emit a skill-relatedness graph (--dot | --mmd, --top N, --threshold X)
  --version | --help

GLOBAL FLAGS
  --registry DIR   Central registry dir (default ~/.agents/skills/.skill-router)
  --dirs a,b       Extra scan dirs
  --force          Force rescan / fresh load / replace existing installs
  --json           Machine-readable output

CLIENTS
  ${CLIENTS.map((c) => c.id).join(", ")}
`;

export { HELP };

export function parseFlags(argv) {
  const flags = { agents: [], _: [], badFlags: false };
  const num = (v) => parseInt(v, 10);
  const value = (i, name) => {
    const v = argv[i];
    if (v === undefined) {
      console.error(`missing value for ${name}`);
      flags.badFlags = true;
      return undefined;
    }
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--registry": { const v = value(++i, a); if (v !== undefined) flags.registry = v; break; }
      case "--dirs": { const v = value(++i, a); if (v !== undefined) flags.dirs = v; break; }
      case "--force": flags.force = true; break;
      case "--json": flags.json = true; break;
      case "--top": {
        const v = value(++i, a);
        if (v !== undefined) {
          flags.top = num(v);
          if (!Number.isFinite(flags.top) || flags.top <= 0) flags.top = undefined;
        }
        break;
      }
      case "--set": flags.set = true; break;
      case "--apply": { const v = value(++i, a); if (v !== undefined) flags.apply = v; break; }
      case "--new": { const v = value(++i, a); if (v !== undefined) flags.new = v; break; }
      case "--members": { const v = value(++i, a); if (v !== undefined) flags.members = v; break; }
      case "--desc": { const v = value(++i, a); if (v !== undefined) flags.desc = v; break; }
      case "--add": { const v = value(++i, a); if (v !== undefined) flags.add = v; break; }
      case "--remove": { const v = value(++i, a); if (v !== undefined) flags.remove = v; break; }
      case "--delete": { const v = value(++i, a); if (v !== undefined) flags.delete = v; break; }
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
      case "--repo": { const v = value(++i, a); if (v !== undefined) flags.repo = v; break; }
      case "--init": flags.init = true; break;
      case "--push": flags.push = true; break;
      case "--pull": flags.pull = true; break;
      case "--status": flags.status = true; break;
      case "--threshold": { const v = value(++i, a); if (v !== undefined) flags.threshold = v; break; }
      case "--dot": flags.dot = true; break;
      case "--mmd": flags.mmd = true; break;
      case "--out": { const v = value(++i, a); if (v !== undefined) flags.out = v; break; }
      case "--runtime": { const v = value(++i, a); if (v !== undefined) flags.runtime = v; break; }
      case "--clients": { const v = value(++i, a); if (v !== undefined) flags.clients = v.split(",").map((x) => x.trim()).filter(Boolean); break; }
      case "--agent": case "-a": {
        const v = value(++i, a);
        if (v !== undefined) flags.agents.push(...v.split(",").map((x) => x.trim()).filter(Boolean));
        break;
      }
      default:
        if (a.startsWith("-")) {
          console.error(`unknown flag: ${a}`);
          flags.badFlags = true;
        } else flags._.push(a);
    }
  }
  return flags;
}

export async function run(argv) {
  const flags = parseFlags(argv);
  if (flags.badFlags) return 2;
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
    case "bundle": return commands.cmdBundle(ctx);
    case "sync": return commands.cmdSync(ctx);
    case "agents": return commands.cmdAgents(ctx);
    case "graph": return commands.cmdGraph(ctx);
    case "mcp": {
      if (flags._[1] === "add") return runMcpAdd(ctx);
      if (flags._[1] === "remove") return runMcpRemove(ctx);
      if (flags._[1] === "list") return runMcpList();
      const { startMcpServer } = await import("./mcp-server.js");
      return await startMcpServer();
    }
    default:
      console.log(LOGO);
      console.error(`unknown command: ${cmd}`);
      console.error(HELP);
      return 2;
  }
}
