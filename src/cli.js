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
                            (exposes skill tools as native functions; --no-tools disables)
  history   discover|import Safely discover/import Freebuff transcripts
  trace     <file>          Count skill usage in a transcript
  doctor    One-shot health check: spec + tools verify + audit baseline + config
            (exit 1 on the first failing check; --json for the machine view)
  link      Create/remove per-skill refs/wiki links (--unlink, --no-default)
  mcp       MCP control: add|remove|list register/remove the parasite-skill MCP
            server in client configs (no manual config); bare mcp runs the server
  bundle    Build a tarball + install.json manifest for GitHub Pages distribution (--out, --meta)
  sync      Cloud-sync the skills tree to a git remote (--init URL | --push | --pull | --status; --dry-run previews push/pull)
  agents    Generate AGENTS.md (default), list/show the agent profiles, or
            run <profile>/--all with a request
  graph     Emit a skill or typed ecosystem graph (--ecosystem, --json | --dot | --mmd, --top N, --threshold X)
  tools     list|describe|run|run-batch|dry-run|audit|verify|docs|policy|history|gc
            Callable AI-tools: skill scripts/hooks/tools as bounded, explicit,
            captured tools for the host LLM (--json)
  --version | --help  GLOBAL FLAGS
  --registry DIR   Central registry dir (default ~/.agents/skills/.parasite-skill)
  --dirs a,b       Extra scan dirs
  --force          Force rescan / fresh load / replace existing installs
  --json           Machine-readable output
  --max-chars N    Bound composed excerpts or imported history
  --public         Remove filesystem paths from published graph output
  --auto           Auto-max routing: pin the always-on cadence around the
                   routed skills in plan/compose execution order

TOOLS FLAGS
  --args STR       Space-separated arguments appended to a tools run command
  --json-args JSON Structured args validated against the tool's declared argsSchema
  --name NAME      Tool name for tools describe/run
  --names a,b,c    Tool names for tools run-batch
  --continue       tools run-batch: keep going after a failed tool
  --tool-env K=V,K=V  Inline env overrides for one tool run
  --dry-run        Preview without executing (tools policy, agents run)
  --timeout-ms N   Tool execution timeout (default 30000, cap 300000;
                   project tools.timeoutMs is the fallback)
  --policy-allow a,b   tools policy: set allow list
  --policy-deny a,b    tools policy: set deny list
  --policy-env a,b     tools policy: set env key allowlist
  --policy-timeout-ms N  tools policy: set timeoutMs
  --scoped NAME        tools policy: target a scoped key (profile:<name> | sets:<set>)
  --scoped-allow/--scoped-deny/--scoped-env  scoped sub-lists
  --clear-scoped       tools policy: remove the --scoped key
  --drop-policy        tools policy: remove the whole tools block
  --policy-file PATH   tools policy: target a specific config file
  --skill G        tools list: filter tools by skill name glob
  --risk X         tools list: only tools at/above low|medium|high audit risk
  --public         export: strip filesystem paths (names/metadata only)
  --max-tools N    agents run: cap the number of script tools executed
  --profiles a,b   agents run --all: run only these profiles
  --min-tools N    agents run: exit 1 when fewer than N tools succeeded
  --threshold X    tools audit: gate on low|medium|high risk
  --clear          tools history: clear the run ledger
  --limit N        tools history: how many ledger entries to show
  --history-name G tools history: filter by tool name glob
  --history-skill G  tools history: filter by skill name glob
  --history-status S  tools history: filter by status (ok|fail)
  --history-since ISO  tools history: only entries at/after this timestamp
  --history-until ISO  tools history: only entries at/before this timestamp
  --age N          tools gc: prune agent reports/ledger entries older than N days
  --keep N         tools gc: keep only the N most recent agent reports/ledger entries
  --strict         agents run: exit 2 if any selected tool is policy-blocked
  --baseline       tools audit: diff against the persisted risk baseline
  --write-baseline tools audit: seed the risk baseline file
  --env-filter a,b Tool env allowlist (only these env keys reach tool processes)
  --no-tools       llm: do not expose skill tools as functions
  --tool-dry-run   llm: preview the model's tool calls, never execute them
  --max-tool-calls N  llm: max tool-calling loop iterations (default 8)

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

const COMMAND_HELP = {
  llm: `parasite-skill llm "<request>" [flags]

Send a bounded compose payload to an explicitly selected OpenAI-compatible endpoint.

FLAGS
  --endpoint URL          Endpoint base or /chat/completions URL
  --model NAME            Model identifier
  --timeout MS            Request timeout
  --max-output-tokens N   Bound model output (default 1200)
  --max-response-chars N Bound returned text
  --api-key KEY           Prefer PARASITE_SKILL_LLM_API_KEY instead
  --allow-remote          Permit external HTTPS endpoints; local-only by default
  --no-tools              Do not expose skill tools as functions
  --tool-dry-run          Preview tool calls: the model's tool requests are
                          resolved and reported as would-run commands, but
                          nothing is ever executed or recorded
  --max-tool-calls N      Max tool-calling loop iterations (default 8)

SAFETY
  No model call occurs unless this command is explicitly invoked. Full skill files,
  credentials, environment values, and unselected assets are not sent in the payload.
  Never place API keys in source control or shell history.`,
  history: `parasite-skill history discover|import [flags]

Discover candidate Freebuff transcript files or import one file selected by you.

FLAGS
  --history-dirs a,b  Extra directories to inspect for candidate metadata
  --file PATH          Required for import; the original is never modified
  --max-chars N        Bound imported text
  --json               Emit machine-readable metadata

SAFETY
  Discovery reports names, sizes, and modified times only. Import is explicit,
  bounded, and sanitizes common credentials, paths, and email addresses.`,
  parasite: `parasite-skill parasite [flags]

Manage opt-in extension manifests without modifying upstream client source files.

FLAGS
  --status             Show actual local injection state
  --add --agent ID     Add an explicit injection to a supported client
  --toggle ID          Enable/disable an injection
  --remove ID          Remove an injection
  --hook vite|webpack  Generate a build hook
  --wrap PATH          Generate a wrapper around an explicit upstream server
  --protect            Transform explicitly supplied code

SAFETY
  Extensions are reversible and project client allowlists are enforced. This does
  not bypass permissions, rewrite arbitrary closed-source clients, or imply support
  for targets without an explicit adapter.`,
  mcp: `parasite-skill mcp add|remove|list [flags]

Register, remove, or inspect the parasite-skill MCP server in supported client configs.
A bare parasite-skill mcp starts the stdio server.

FLAGS
  --clients a,b  Restrict changes to named supported targets
  --runtime node|bun  Select the server runtime where supported

SAFETY
  Existing configs are backed up before writes. Malformed configs are skipped rather
  than overwritten. Registration is opt-in and never grants access to other servers.`,
  tools: `parasite-skill tools list|describe|run [flags]

Turn skill scripts, hooks, and tools into callable AI tools so the main LLM
(or a CLI/MCP caller) can execute them instead of only reading their metadata.

COMMANDS
  list                 Inventory every callable skill tool
  describe <name>      Print a schema-style description for LLM use
  run <name> [args]    Execute one tool explicitly
  run-batch a,b,c      Execute several tools sequentially (shared ledger)
  dry-run <name> [args] Preview the exact command without executing
  audit                Static risk audit of discovered tools
  verify               Readiness check: scripts exist, policy, schema shape
  docs                 Generate a TOOLS.md reference of the tool surface
  policy               Read or edit the project tools policy (see below)
  history              Show the local execution ledger (--clear to reset)
  gc                   Prune stale registry artifacts (agent reports + ledger)

FLAGS
  --args STR       Space-separated arguments appended to the tool command
  --json-args JSON Structured args validated against the tool's argsSchema
  --names a,b,c    Tool names for run-batch
  --continue       run-batch: continue after a failed tool
  --skill G        list: filter by skill name glob
  --risk X         list: only tools at/above low|medium|high audit risk
  --tool-env K=V,K=V  Inline env overrides for this run
  --dry-run        Preview without executing (policy); run-batch: preview the batch
  --timeout-ms N   Execution timeout (default 30000, cap 300000)
  --threshold X    audit gate on low|medium|high
  --baseline       audit: diff against the persisted risk baseline
  --write-baseline  audit: seed the risk baseline file
  --history-name G history: filter by tool name glob
  --history-skill G  history: filter by skill name glob
  --history-status S  history: filter by status (ok|fail)
  --history-since ISO  history: only entries at/after this timestamp
  --history-until ISO  history: only entries at/before this timestamp
  --limit N        history entries to show
  --age N          gc: prune artifacts older than N days
  --keep N         gc: keep only the N most recent artifacts
  --strict         agents run: exit 2 on policy-blocked tools
  --out PATH       docs: write TOOLS.md elsewhere (default registry/TOOLS.md)
  --json           Machine-readable output

POLICY
  parasite-skill.json "tools": { "allow": [...], "deny": [...], "env": [...],
  "timeoutMs": N, "scoped": { "profile:<name>": {...}, "sets:<set>": {...} } }
  restricts which tools run, which env keys reach them, and the timeout.
  Deny wins; a non-empty allow list must match. Tool names support * globs.
  Skills can declare per-tool description/argsSchema/timeoutMs via a "tools":
  JSON block in their SKILL.md frontmatter (an explicit --timeout-ms or project
  tools.timeoutMs still wins over a declared per-tool timeout).

  Edit it from the CLI (writes parasite-skill.json, --dry-run to preview):
    tools policy --allow "a__*" --deny "b__*" --env PATH --policy-timeout-ms 60000
    tools policy --scoped profile:security-auditor --scoped-deny "*__deploy*"
    tools policy --drop-policy

SAFETY
  Tools are discovered from local skill assets only and run only when this
  command is explicitly invoked. Execution is time-bounded, output-captured,
  redacted, and recorded to the audit ledger. Routing or planning alone never
  executes tools.`,
  graph: `parasite-skill graph [flags]

Emit either the legacy skill vocabulary graph or the typed ecosystem graph.

FLAGS
  --ecosystem       Include skills, sets, assets, clients, extensions, MCP, rules,
                    declarative agents, and tools as metadata-only nodes
  --json             JSON output
  --dot              Graphviz DOT output
  --mmd              Mermaid output
  --public           Remove filesystem paths and sanitize public text
  --top N            Limit legacy relatedness edges
  --threshold X      Legacy similarity threshold

SAFETY
  Graphs contain metadata and relationships only. They do not include file contents,
  chat history, credentials, or environment values.`,
};

export function commandHelp(command) {
  return COMMAND_HELP[command] ?? null;
}

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
      case "--auto": flags.auto = true; break;
      case "--args": { const v = value(++i, a); if (v !== undefined) flags.args = v; break; }
      case "--name": { const v = value(++i, a); if (v !== undefined) flags.name = v; break; }
      case "--timeout-ms": { const v = value(++i, a); if (v !== undefined) flags.timeoutMs = num(v); break; }
      case "--max-tools": { const v = value(++i, a); if (v !== undefined) flags.maxTools = num(v); break; }
      case "--clear": flags.clear = true; break;
      case "--continue": flags.continue = true; break;
      case "--strict": flags.strict = true; break;
      case "--baseline": flags.baseline = true; break;
      case "--write-baseline": flags.writeBaseline = true; break;
      case "--skill": { const v = value(++i, a); if (v !== undefined) flags.listSkill = v; break; }
      case "--risk": { const v = value(++i, a); if (v !== undefined) flags.listRisk = v; break; }
      case "--profiles": { const v = value(++i, a); if (v !== undefined) flags.profiles = v; break; }
      case "--min-tools": { const v = value(++i, a); if (v !== undefined) flags.minTools = num(v); break; }
      case "--tool-dry-run": flags.toolDryRun = true; break;
      case "--history-name": { const v = value(++i, a); if (v !== undefined) flags.historyName = v; break; }
      case "--history-skill": { const v = value(++i, a); if (v !== undefined) flags.historySkill = v; break; }
      case "--history-status": { const v = value(++i, a); if (v !== undefined) flags.historyStatus = v; break; }
      case "--history-since": { const v = value(++i, a); if (v !== undefined) flags.historySince = v; break; }
      case "--history-until": { const v = value(++i, a); if (v !== undefined) flags.historyUntil = v; break; }
      case "--names": { const v = value(++i, a); if (v !== undefined) flags.names = v; break; }
      case "--limit": { const v = value(++i, a); if (v !== undefined) flags.limit = num(v); break; }
      case "--age": { const v = value(++i, a); if (v !== undefined) flags.age = num(v); break; }
      case "--keep": { const v = value(++i, a); if (v !== undefined) flags.keep = num(v); break; }
      case "--env-filter": { const v = value(++i, a); if (v !== undefined) flags.envFilter = v; break; }
      case "--no-tools": flags.noTools = true; break;
      case "--max-tool-calls": { const v = value(++i, a); if (v !== undefined) flags.maxToolCalls = num(v); break; }
      case "--json-args": { const v = value(++i, a); if (v !== undefined) flags.jsonArgs = v; break; }
      case "--tool-env": { const v = value(++i, a); if (v !== undefined) flags.toolEnv = v; break; }
      case "--dry-run": flags.dryRun = true; break;
      case "--policy-allow": { const v = value(++i, a); if (v !== undefined) flags.policyAllow = v; break; }
      case "--policy-deny": { const v = value(++i, a); if (v !== undefined) flags.policyDeny = v; break; }
      case "--policy-env": { const v = value(++i, a); if (v !== undefined) flags.policyEnv = v; break; }
      case "--policy-timeout-ms": { const v = value(++i, a); if (v !== undefined) flags.policyTimeoutMs = v; break; }
      case "--scoped": { const v = value(++i, a); if (v !== undefined) flags.scoped = v; break; }
      case "--scoped-allow": { const v = value(++i, a); if (v !== undefined) flags.scopedAllow = v; break; }
      case "--scoped-deny": { const v = value(++i, a); if (v !== undefined) flags.scopedDeny = v; break; }
      case "--scoped-env": { const v = value(++i, a); if (v !== undefined) flags.scopedEnv = v; break; }
      case "--clear-scoped": flags.clearScoped = true; break;
      case "--drop-policy": flags.dropPolicy = true; break;
      case "--policy-file": { const v = value(++i, a); if (v !== undefined) flags.policyFile = v; break; }
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
  const [requestedCommand] = flags._;
  if (flags.badFlags) return 2;
  if (flags.action === "help" && requestedCommand && commandHelp(requestedCommand)) {
    console.log(commandHelp(requestedCommand));
    return 0;
  }
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
    toolsAction: cmd === "tools" ? rest[0] : undefined,
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
    case "doctor": return commands.cmdDoctor(ctx);
    case "link": return commands.cmdLink(ctx);
    case "bundle": return commands.cmdBundle(ctx);
    case "sync": return commands.cmdSync(ctx);
    case "agents": {
      const sub = flags._[1];
      if (sub === "run") return commands.cmdAgentsRun(ctx);
      if (sub === "list" || sub === "show") return commands.cmdAgentsList(ctx);
      return commands.cmdAgents(ctx);
    }
    case "tools": return commands.cmdTools(ctx);
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
