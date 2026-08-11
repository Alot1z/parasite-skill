// parasite-skill CLI — argument parsing, help, dispatch.
import { LOGO } from "./logo.js";
import { VERSION, loadProjectConfig, mergeConfig } from "./engine.js";
import * as commands from "./commands/index.js";
import { CLIENTS, runInstall, runRefresh, runList, runRemove } from "./clients.js";
import { runMcpAdd, runMcpRemove, runMcpList } from "./mcp-register.js";

const HELP = `parasite-skill v${VERSION}

Route any request to the right agent skills. One package, every AI client.

USAGE
  parasite-skill <command> [flags]
  npx parasite-skill <command> [flags]     (node)
  bunx parasite-skill <command> [flags]    (bun)

COMMANDS
  install   Install the parasite-skill skill into one or more AI clients
            (--copy | --link, --all | --agent <ids>, -g/--global | --project,
             --yes, --force)
  refresh   Update all installed copies with the latest SKILL.md
            (--all | --agent <ids>, --copy | --link)
  parasite  Manage runtime extensions without modifying source
            (--status, --add, --remove, --toggle, --hook, --wrap, --protect)
  list      Show installed parasite-skill instances per client
  remove    Remove installed instances (--agent <ids>)
  scan      Re-analyze the whole skill ecosystem, rebuild registry
            (--dirs a,b)
  validate  Check every skill against the Agent Skills spec (exit 1 on issues)
  route     "<idea text>"   Score skills for an idea (--top N, --set, --json)
  sets      List skill-sets (--apply NAME to print a load order,
            --template to print the new-set creation template)
  refs      Generate ref pages (--per-skill)
  wikis     Generate the wiki + graph
  export    Inventory the whole ecosystem (skills, sets, clients, extensions,
            MCP, rules) -> ECOSYSTEM.md + ecosystem.json (human + LLM ready)
  plan      "<request>"     Emit a routed execution plan using an adaptive payload
  compose   "<request>"     Select skills/assets and emit a compact runtime payload
  llm       "<request>"     Send bounded payload to an opt-in OpenAI-compatible endpoint
  history   discover|import Safely discover/import Freebuff transcripts
  trace     <file>          Count skill usage in a transcript
  link      Create/remove per-skill refs/wiki links (--unlink, --no-default)
  mcp       MCP control: add|remove|list register/remove the parasite-skill MCP
            server in client configs (no manual config); bare mcp runs the server
  bundle    Build a tarball + install.json manifest for GitHub Pages distribution (--out, --meta)
  sync      Cloud-sync the skills tree to a git remote (--init URL | --push | --pull)
  agents    Generate AGENTS.md for the current project (--out PATH)
  graph     Emit a skill or typed ecosystem graph (--ecosystem, --json | --dot | --mmd, --top N, --threshold X)
  --version | --help  GLOBAL FLAGS
  --registry DIR   Central registry dir (default ~/.agents/skills/.parasite-skill)
  --dirs a,b       Extra scan dirs
  --force          Force rescan / fresh load / replace existing installs
  --json           Machine-readable output
  --max-chars N    Bound composed excerpts or imported history
  --public         Remove filesystem paths from published graph output

LLM FLAGS
  --endpoint URL   OpenAI-compatible /chat/completions endpoint
  --allow-remote   Allow external HTTPS LLM endpoints (default: local-only)
  --model NAME     Model name
  --api-key KEY    Optional bearer key (prefer PARASITE_SKILL_LLM_API_KEY)
  --timeout MS     Request timeout
  --max-output-tokens N  Bound model output tokens (default 1200)
  --max-response-chars N Bound response text (default 200000)

HISTORY FLAGS
  --file PATH      Transcript file for history import or trace
  --history-dirs   Extra comma-separated discovery directories


PARASITE FLAGS
  --status         Show injection status for all clients
  --add            Add a runtime injection (--agent, --type, --code, --target)
  --remove ID      Remove an injection by ID
  --toggle ID      Toggle an injection on/off
  --hook FORMAT    Generate build hook (vite | webpack)
  --wrap PATH      Generate server wrapper for upstream
  --protect        Protect code traceability (--level light|medium|heavy)

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
      case "--set": {
        // --set [NAME]: bare keeps the legacy boolean toggle (print the
        // top-scoring set's load order); a name routes the idea within that set.
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          flags.set = next;
          i++;
        } else flags.set = true;
        break;
      }
      case "--apply": { const v = value(++i, a); if (v !== undefined) flags.apply = v; break; }
      case "--new": { const v = value(++i, a); if (v !== undefined) flags.new = v; break; }
      case "--members": { const v = value(++i, a); if (v !== undefined) flags.members = v; break; }
      case "--desc": { const v = value(++i, a); if (v !== undefined) flags.desc = v; break; }
      case "--add": { const v = value(++i, a); if (v !== undefined) flags.add = v; break; }
      case "--remove": { const v = value(++i, a); if (v !== undefined) flags.remove = v; break; }
      case "--delete": { const v = value(++i, a); if (v !== undefined) flags.delete = v; break; }
      case "--template": flags.template = true; break;
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
      case "--dest": { const v = value(++i, a); if (v !== undefined) flags.dest = v; break; }
      case "--repo": { const v = value(++i, a); if (v !== undefined) flags.repo = v; break; }
      case "--init": flags.init = true; break;
      case "--push": flags.push = true; break;
      case "--pull": flags.pull = true; break;
      case "--status": flags.status = true; break;
      case "--threshold": { const v = value(++i, a); if (v !== undefined) flags.threshold = v; break; }
      case "--ecosystem": flags.ecosystem = true; break;
      case "--public": flags.public = true; break;
      case "--dot": flags.dot = true; break;
      case "--mmd": flags.mmd = true; break;
      case "--out": { const v = value(++i, a); if (v !== undefined) flags.out = v; break; }
      case "--meta": { const v = value(++i, a); if (v !== undefined) flags.meta = v; break; }
      case "--runtime": { const v = value(++i, a); if (v !== undefined) flags.runtime = v; break; }
      case "--clients": { const v = value(++i, a); if (v !== undefined) flags.clients = v.split(",").map((x) => x.trim()).filter(Boolean); break; }
      case "--agent": case "-a": {
        const v = value(++i, a);
        if (v !== undefined) flags.agents.push(...v.split(",").map((x) => x.trim()).filter(Boolean));
        break;
      }
      case "--toggle": { const v = value(++i, a); if (v !== undefined) flags.toggle = v; break; }
      case "--enable": flags.enable = true; break;
      case "--disable": flags.enable = false; break;
      case "--hook": { const v = value(++i, a); if (v !== undefined) flags.hook = v; break; }
      case "--wrap": { const v = value(++i, a); if (v !== undefined) flags.wrap = v; break; }
      case "--protect": flags.protect = true; break;
      case "--type": { const v = value(++i, a); if (v !== undefined) flags.type = v; break; }
      case "--target": { const v = value(++i, a); if (v !== undefined) flags.target = v; break; }
      case "--position": { const v = value(++i, a); if (v !== undefined) flags.position = v; break; }
      case "--code": { const v = value(++i, a); if (v !== undefined) flags.code = v; break; }
      case "--file": { const v = value(++i, a); if (v !== undefined) flags.file = v; break; }
      case "--level": { const v = value(++i, a); if (v !== undefined) flags.level = v; break; }
      case "--format": { const v = value(++i, a); if (v !== undefined) flags.format = v; break; }
      case "--max-chars": { const v = value(++i, a); if (v !== undefined) flags.maxChars = num(v); break; }
      case "--endpoint": { const v = value(++i, a); if (v !== undefined) flags.endpoint = v; break; }
      case "--allow-remote": flags.allowRemote = true; break;
      case "--model": { const v = value(++i, a); if (v !== undefined) flags.model = v; break; }
      case "--api-key": { const v = value(++i, a); if (v !== undefined) flags.apiKey = v; break; }
      case "--timeout": { const v = value(++i, a); if (v !== undefined) flags.timeout = num(v); break; }
      case "--max-output-tokens": { const v = value(++i, a); if (v !== undefined) flags.maxOutputTokens = num(v); break; }
      case "--max-response-chars": { const v = value(++i, a); if (v !== undefined) flags.maxResponseChars = num(v); break; }
      case "--history-dirs": { const v = value(++i, a); if (v !== undefined) flags.historyDirs = v; break; }
      case "--server": { const v = value(++i, a); if (v !== undefined) flags.server = v; break; }
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
    console.log(`parasite-skill v${VERSION}`);
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

  // Load project config and merge with CLI flags
  const projectConfig = loadProjectConfig();
  const ctx = {
    ...mergeConfig(projectConfig, flags),
    idea: arg,
    request: arg,
    historyAction: cmd === "history" ? rest[0] : undefined,
    file: flags.file ?? (cmd === "trace" ? rest[0] : undefined),
  };

  // Log config source if verbose
  if (projectConfig && process.env.PARASITE_SKILL_VERBOSE) {
    console.error(`Using project config from: ${projectConfig._path}`);
  }

  switch (cmd) {
    case "install": return await runInstall(ctx);
    case "refresh": return await runRefresh(ctx);
    case "parasite": return commands.cmdParasite(ctx);
    case "list": return runList();
    case "remove": return runRemove(ctx);
    case "scan": return commands.cmdScan(ctx);
    case "validate": return commands.cmdValidate(ctx);
    case "route": return commands.cmdRoute(ctx);
    case "sets": return commands.cmdSets(ctx);
    case "refs": return commands.cmdRefs(ctx);
    case "wikis": return commands.cmdWikis(ctx);
    case "export": return commands.cmdExport(ctx);      case "plan": return commands.cmdPlan(ctx);
    case "compose": return commands.cmdCompose(ctx);
    case "llm": return await commands.cmdLlm(ctx);
    case "history": return commands.cmdHistory(ctx);

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
