// parasite-skill MCP server — dependency-free stdio transport (JSON-RPC 2.0).
// Speaks the Model Context Protocol subset: initialize, ping, tools/list, tools/call.
// Run:  bun src/mcp-server.js   (or:  node src/mcp-server.js)
import { createInterface } from "node:readline";
import { VERSION, loadRegistry, registryDir } from "./engine.js";
import { auditSkillTools, filterToolsByPolicy, listSkillTools, renderToolsDocs, runSkillTool } from "./ai-tools.js";
import { cmdTools } from "./commands/tools.js";
import {
  cmdDoctor,
  cmdExport,
  cmdLlm,
  cmdPlan,
  cmdCompose,
  cmdRefs,
  cmdRoute,
  cmdScan,
  cmdSets,
  cmdValidate,
  cmdWikis,
  cmdGraph,
} from "./commands/index.js";
import { runList } from "./clients.js";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "parasite-skill", version: VERSION };

const TOOLS = [
  {
    name: "scan",
    description: "Re-analyze the whole skill ecosystem and rebuild the registry.",
    inputSchema: { type: "object", properties: { dirs: { type: "string", description: "extra scan dirs, comma-separated" } } },
  },
  {
    name: "validate",
    description: "Check every skill against the Agent Skills spec. Errors if any skill is non-conforming.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "route",
    description: "Score every skill against an idea text and return the top skills plus best skill-sets.",
    inputSchema: {
      type: "object",
      properties: {
        idea: { type: "string", description: "the idea / request text to route" },
        top: { type: "number", description: "how many skills to return (default 8)" },
        set: { type: "string", description: "optional skill-set name to route within (thinking, docs, debug-squad, ...)" },
      },
      required: ["idea"],
    },
  },
  {
    name: "sets",
    description: "List skill-sets, or print the load order for one set.",
    inputSchema: { type: "object", properties: { apply: { type: "string", description: "set name (thinking, research, planning, build, docs, review, frontend, ops, intelligence)" } } },
  },
  {
    name: "plan",
    description: "Emit a concise routed execution plan backed by selected skills and on-demand assets.",
    inputSchema: {
      type: "object",
      properties: {
        request: { type: "string" },
        top: { type: "number" },
        maxChars: { type: "number" },
        enabledSets: { type: "array", items: { type: "string" } },
        excludeSkills: { type: "array", items: { type: "string" } },
      },
      required: ["request"],
    },
  },
  {
    name: "compose",
    description: "Select relevant skills, references, templates, scripts, hooks, and tools; emit a bounded runtime payload without dumping the ecosystem.",
    inputSchema: { type: "object",      properties: {
        idea: { type: "string" },
        top: { type: "number" },
        maxChars: { type: "number" },
        enabledSets: { type: "array", items: { type: "string" } },
        excludeSkills: { type: "array", items: { type: "string" } },
      },
      required: ["idea"],
    },
  },
  {
    name: "refs",
    description: "Generate ref pages for all skills in the central registry.",
    inputSchema: { type: "object", properties: { per_skill: { type: "boolean" } } },
  },
  {
    name: "wikis",
    description: "Generate the wiki, typed ecosystem graph, and declarative agent profile pages.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "graph",
    description: "Emit a typed ecosystem graph of skills, sets, assets, clients, extensions, MCP targets, rules, agents, and tools.",
    inputSchema: { type: "object", properties: { format: { type: "string", enum: ["json", "dot", "mmd"] } } },
  },
  {
    name: "list_installs",
    description: "List where the parasite-skill skill is currently installed across clients.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "skill_tools_list",
    description: "Inventory every callable skill AI-tool (scripts, hooks, tools) so the host can invoke them via skill_tools_run.",
    inputSchema: {
      type: "object",
      properties: {
        dirs: { type: "string", description: "extra scan dirs, comma-separated" },
        allow: { type: "array", items: { type: "string" }, description: "tool-name glob allowlist" },
        deny: { type: "array", items: { type: "string" }, description: "tool-name glob denylist" },
      },
    },
  },
  {
    name: "skill_tools_audit",
    description: "Static risk audit of discovered skill AI-tools (eval/subprocess/network/secrets patterns). Never executes anything.",
    inputSchema: {
      type: "object",
      properties: {
        dirs: { type: "string", description: "extra scan dirs, comma-separated" },
        threshold: { type: "string", description: "gate on low|medium|high (default medium)" },
      },
    },
  },
  {
    name: "doctor",
    description: "One-shot health check: spec validation + tool readiness + audit baseline diff + project config parse. Exits 1 on the first failing check.",
    inputSchema: {
      type: "object",
      properties: {
        dirs: { type: "string", description: "extra scan dirs, comma-separated" },
        json: { type: "boolean", description: "machine-readable report (default true over MCP)" },
      },
    },
  },
  {
    name: "skill_tools_docs",
    description: "Return the TOOLS.md reference of the callable skill AI-tool surface (same content as `tools docs`).",
    inputSchema: {
      type: "object",
      properties: {
        dirs: { type: "string", description: "extra scan dirs, comma-separated" },
        allow: { type: "array", items: { type: "string" } },
        deny: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "skill_tools_history",
    description: "Read the tool-run audit ledger (tool-runs.jsonl) with filters: name/skill globs, status (ok|fail), since/until ISO timestamps, limit. Parity with the JS twin's `tools history`.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        skill: { type: "string" },
        status: { type: "string" },
        since: { type: "string" },
        until: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "skill_tools_gc",
    description: "Prune stale registry artifacts (agent reports + audit ledger) by age/keep, or with status: true report the gc posture (policy, last/next sweep, throttle, stale dry-run) without pruning. Parity with the JS twin's `tools gc` / `tools gc --status`.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "boolean" },
        age_days: { type: "number" },
        keep: { type: "number" },
        dry_run: { type: "boolean" },
      },
    },
  },
  {
    name: "skill_tools_ledger",
    description: "Audit-ledger lifecycle (tool-runs.jsonl): stats reports integrity (valid/corrupt/out-of-order) + aggregates (ok/fail, avg duration, per-skill/per-tool; exits 2 on corrupt), export dumps the full ledger as a JSON array to a file, purge clears it. Parity with the JS twin's `tools ledger`.",
    inputSchema: {
      type: "object",
      properties: {
        stats: { type: "boolean" },
        export: { type: "string" },
        purge: { type: "boolean" },
      },
    },
  },
  {
    name: "skill_tools_run",
    description: "Explicitly execute one skill AI-tool. Bounded, captured, and redacted; never runs automatically.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        args: { type: "string", description: "space-separated arguments" },
        json_args: { type: "object", description: "structured args validated against the tool's declared argsSchema" },
        timeout_ms: { type: "number" },
        dirs: { type: "string" },
        allow: { type: "array", items: { type: "string" }, description: "tool-name glob allowlist" },
        deny: { type: "array", items: { type: "string" }, description: "tool-name glob denylist" },
        env: { type: "array", items: { type: "string" }, description: "env keys visible to the tool process" },
      },
      required: ["name"],
    },
  },
  {
    name: "export",
    description: "Inventory the whole ecosystem (skills, sets, clients, extensions, MCP, rules, tools, gc policy, sync posture) as LLM-ready JSON. Never exports file contents or secrets; --public strips filesystem paths.",
    inputSchema: {
      type: "object",
      properties: {
        dirs: { type: "string", description: "extra scan dirs, comma-separated" },
        public: { type: "boolean", description: "strip filesystem paths for sharing" },
      },
    },
  },
  {
    name: "llm",
    description: "Send a bounded compose payload to an explicitly configured OpenAI-compatible endpoint and return the model's answer. Skill tools are exposed as native functions with risk annotations and executed in a bounded loop unless tool_dry_run is set. Local-only by default; set allow_remote for HTTPS.",
    inputSchema: {
      type: "object",
      properties: {
        request: { type: "string", description: "the request text" },
        endpoint: { type: "string", description: "OpenAI-compatible /chat/completions URL" },
        model: { type: "string" },
        allow_remote: { type: "boolean" },
        max_output_tokens: { type: "number" },
        max_response_chars: { type: "number" },
        max_tool_calls: { type: "number" },
        tool_dry_run: { type: "boolean" },
        no_tools: { type: "boolean" },
        dirs: { type: "string" },
      },
      required: ["request"],
    },
  },
];

// ---------------------------------------------------------------- handlers

function toolResult(text) {
  return { content: [{ type: "text", text: String(text) }] };
}

// NOTE: command output is captured by swapping console.log for the duration of the
// call. All commands emit synchronously except `llm` (which awaits the bounded
// model request); the swap stays active across the await, so nothing leaks into
// the JSON-RPC stream. Keep other handlers synchronous (no timers / deferred logs).
async function runTool(name, params = {}) {
  const ctx = {
    ...params,
    idea: params.idea ?? params.request,
    request: params.request,
    top: params.top,
    maxChars: params.maxChars,
    enabledSets: params.enabledSets,
    excludeSkills: params.excludeSkills,
    apply: params.apply,
    dirs: params.dirs,
    chatSafe: name === "plan",
  };
  const out = [];
  const origLog = console.log;
  console.log = (...a) => out.push(a.map(String).join(" "));
  let code = 0;
  try {
    switch (name) {
      case "scan": code = cmdScan(ctx); break;
      case "validate": code = cmdValidate(ctx); break;
      case "route": code = cmdRoute(ctx); break;
      case "sets": code = cmdSets(ctx); break;
      case "plan": code = cmdPlan(ctx); break;
      case "compose": code = cmdCompose({ ...ctx, json: true }); break;
      case "refs": code = cmdRefs(ctx); break;
      case "wikis": code = cmdWikis(ctx); break;
      case "graph": code = cmdGraph({ ...ctx, ecosystem: true, json: params.format === "json", dot: params.format === "dot", mmd: params.format === "mmd" }); break;
      case "list_installs": code = runList(); break;
      case "skill_tools_list": {
        const payload = loadRegistry(registryDir(ctx.registry), ctx.dirs, ctx.force);
        const policy = { allow: params.allow, deny: params.deny };
        console.log(JSON.stringify(filterToolsByPolicy(listSkillTools(payload), policy), null, 2));
        break;
      }
      case "skill_tools_audit": {
        const payload = loadRegistry(registryDir(ctx.registry), ctx.dirs, ctx.force);
        const audits = auditSkillTools(payload);
        const threshold = String(params.threshold ?? "medium");
        const levels = ["low", "medium", "high"];
        const minIndex = Math.max(0, levels.indexOf(threshold));
        console.log(JSON.stringify({ threshold, tools: audits, flagged: audits.filter((entry) => levels.indexOf(entry.risk) >= minIndex).length }, null, 2));
        break;
      }
      case "doctor": code = cmdDoctor({ ...ctx, json: params.json !== false }); break;
      case "export": code = cmdExport({ ...ctx, json: true, public: params.public === true }); break;
      case "llm": code = await cmdLlm({ ...ctx, json: true, ...(params.endpoint ? { endpoint: params.endpoint } : {}), ...(params.model ? { model: params.model } : {}), allowRemote: params.allow_remote === true, maxOutputTokens: params.max_output_tokens, maxResponseChars: params.max_response_chars, maxToolCalls: params.max_tool_calls, toolDryRun: params.tool_dry_run === true, noTools: params.no_tools === true }); break;
      case "skill_tools_docs": {
        const payload = loadRegistry(registryDir(ctx.registry), ctx.dirs, ctx.force);
        console.log(renderToolsDocs(payload, { allow: params.allow, deny: params.deny }));
        break;
      }
      case "skill_tools_run": {
        const payload = loadRegistry(registryDir(ctx.registry), ctx.dirs, ctx.force);
        try {
          const result = runSkillTool(payload, params.name, params.args, {
            timeoutMs: params.timeout_ms,
            policy: { allow: params.allow, deny: params.deny, env: params.env },
            registry: registryDir(ctx.registry),
            ...(params.json_args !== undefined ? { jsonArgs: params.json_args } : {}),
          });
          console.log(JSON.stringify(result, null, 2));
        } catch (err) {
          console.log(JSON.stringify({ ok: false, name: params.name, error: String(err.message ?? err) }, null, 2));
          code = 1;
        }
        break;
      }
      case "skill_tools_history": {
        code = cmdTools({
          ...ctx,
          toolsAction: "history",
          json: params.json !== false,
          limit: params.limit,
          historyName: params.name,
          historySkill: params.skill,
          historyStatus: params.status,
          historySince: params.since,
          historyUntil: params.until,
        });
        break;
      }
      case "skill_tools_gc": {
        code = cmdTools({
          ...ctx,
          toolsAction: "gc",
          json: params.json !== false,
          status: params.status === true,
          age: params.age_days,
          keep: params.keep,
          dryRun: params.dry_run === true,
        });
        break;
      }
      case "skill_tools_ledger": {
        code = cmdTools({
          ...ctx,
          toolsAction: "ledger",
          json: params.json !== false,
          ledgerStats: params.stats === true,
          ledgerExport: params.export,
          ledgerPurge: params.purge === true,
        });
        break;
      }
      default: throw new Error(`unknown tool: ${name}`);
    }
  } finally {
    console.log = origLog;
  }
  return { text: out.join("\n"), code };
}

export async function handleMessage(msg) {
  if (!msg || typeof msg !== "object" || typeof msg.method !== "string") {
    return { jsonrpc: "2.0", id: msg?.id ?? null, error: { code: -32600, message: "invalid request" } };
  }
  const { id, method, params } = msg;
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      },
    };
  }
  if (method === "notifications/initialized" || method === "initialized") return null;
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  }
  if (method === "tools/call") {
    const name = params?.name;
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) {
      return { jsonrpc: "2.0", id, error: { code: -32602, message: `unknown tool: ${name}` } };
    }
    try {
      const { text, code } = await runTool(name, params?.arguments ?? {});
      return { jsonrpc: "2.0", id, result: toolResult(text + (code !== 0 ? `\n(exit ${code})` : "")) };
    } catch (err) {
      return { jsonrpc: "2.0", id, error: { code: -32000, message: String(err.message ?? err) } };
    }
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } };
}

// ---------------------------------------------------------------- stdio loop

export async function startMcpServer() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }) + "\n");
      continue;
    }
    const res = await handleMessage(msg);
    if (res) process.stdout.write(JSON.stringify(res) + "\n");
  }
  return 0;
}

// Direct execution: bun src/mcp-server.js / node src/mcp-server.js
const isMain = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("mcp-server.js");
if (isMain) {
  startMcpServer().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
