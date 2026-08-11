// skill-router MCP server — dependency-free stdio transport (JSON-RPC 2.0).
// Speaks the Model Context Protocol subset: initialize, ping, tools/list, tools/call.
// Run:  bun src/mcp-server.js   (or:  node src/mcp-server.js)
import { createInterface } from "node:readline";
import { VERSION } from "./engine.js";
import {
  cmdPlan,
  cmdRefs,
  cmdRoute,
  cmdScan,
  cmdSets,
  cmdValidate,
  cmdWikis,
} from "./commands/index.js";
import { runList } from "./clients.js";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "skill-router", version: VERSION };

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
    description: "Emit a routed execution plan for a request with the always-on cadence phases.",
    inputSchema: { type: "object", properties: { request: { type: "string" } }, required: ["request"] },
  },
  {
    name: "refs",
    description: "Generate ref pages for all skills in the central registry.",
    inputSchema: { type: "object", properties: { per_skill: { type: "boolean" } } },
  },
  {
    name: "wikis",
    description: "Generate the wiki (Home, Categories, Skills, SkillSets, MultiplicativePairs, graph).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_installs",
    description: "List where the skill-router skill is currently installed across clients.",
    inputSchema: { type: "object", properties: {} },
  },
];

// ---------------------------------------------------------------- handlers

function toolResult(text) {
  return { content: [{ type: "text", text: String(text) }] };
}

// NOTE: command output is captured by swapping console.log for the duration of the
// call. All commands emit synchronously, so nothing can leak into the JSON-RPC stream;
// keep command handlers synchronous (no timers / deferred logs).
function runTool(name, params = {}) {
  const ctx = { ...params, idea: params.idea ?? params.request, request: params.request, top: params.top, apply: params.apply, dirs: params.dirs };
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
      case "refs": code = cmdRefs(ctx); break;
      case "wikis": code = cmdWikis(ctx); break;
      case "list_installs": code = runList(); break;
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
      const { text, code } = runTool(name, params?.arguments ?? {});
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
