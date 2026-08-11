// Typed ecosystem graph. It contains relationships and metadata only; it never
// reads or embeds skill, rule, MCP, or chat contents.

function id(type, value) {
  return `${type}:${String(value).replace(/[^A-Za-z0-9_.-]+/g, "-")}`;
}

function addNode(nodes, type, value, extra = {}) {
  const nodeId = id(type, value);
  if (!nodes.has(nodeId)) nodes.set(nodeId, { id: nodeId, type, label: String(value), ...extra });
  return nodeId;
}

function addEdge(edges, from, to, relation, weight = 1) {
  edges.push({ from, to, relation, weight });
}

export function buildEcosystemGraph({ skills = [], sets = {}, clients = [], extensions = [], mcp = [], rules = {}, profiles = {} } = {}) {
  const nodes = new Map();
  const edges = [];
  const skillIds = new Map();

  for (const skill of skills) {
    const node = addNode(nodes, "skill", skill.name, {
      tags: skill.tags ?? [],
      spec_ok: skill.spec_ok !== false,
      path: String(skill.path ?? "").replace(/\\/g, "/"),
    });
    skillIds.set(skill.name, node);
    for (const asset of skill.assets ?? []) {
      const assetId = addNode(nodes, "asset", `${skill.name}/${asset.path}`, {
        group: asset.group,
        language: asset.language,
        bytes: asset.bytes,
        excerptable: asset.excerptable,
      });
      addEdge(edges, node, assetId, "contains");
    }
  }

  for (const [name, set] of Object.entries(sets)) {
    const setId = addNode(nodes, "set", name, { description: set.desc, project: !!set.project });
    for (const member of set.members ?? []) {
      const skillId = skillIds.get(member) ?? addNode(nodes, "skill", member, { unresolved: true });
      addEdge(edges, setId, skillId, "includes");
    }
  }

  for (const client of clients) {
    const clientId = addNode(nodes, "client", client.id ?? client.label, {
      installed: !!client.installed,
      mode: client.mode ?? null,
      path: String(client.path ?? "").replace(/\\/g, "/"),
    });
    const installedSkill = skillIds.get("parasite-skill");
    if (installedSkill && client.installed) addEdge(edges, clientId, installedSkill, "installs");
  }

  for (const extension of extensions) {
    const extId = addNode(nodes, "extension", extension.client ?? extension.label, {
      active: !!extension.active,
      injections: Number(extension.injections ?? 0),
      path: String(extension.path ?? "").replace(/\\/g, "/"),
    });
    const clientId = id("client", extension.client ?? extension.label);
    if (nodes.has(clientId)) addEdge(edges, clientId, extId, "owns");
  }

  for (const registration of mcp) {
    const mcpId = addNode(nodes, "mcp", registration.id ?? registration.label, {
      registered: !!registration.registered,
      path: String(registration.file ?? "").replace(/\\/g, "/"),
    });
    const skillId = skillIds.get("parasite-skill");
    if (skillId && registration.registered) addEdge(edges, mcpId, skillId, "registers");
  }

  for (const scope of ["global", "per_client"]) {
    for (const rulePath of rules[scope] ?? []) {
      const ruleId = addNode(nodes, "rule", rulePath, { scope });
      const skillId = skillIds.get("parasite-skill");
      if (skillId) addEdge(edges, ruleId, skillId, "guides");
    }
  }

  for (const [name, profile] of Object.entries(profiles)) {
    const profileId = addNode(nodes, "agent", name, { description: profile.desc, guardrails: profile.guardrails ?? [] });
    for (const skill of profile.skills ?? []) {
      const skillId = skillIds.get(skill) ?? addNode(nodes, "skill", skill, { unresolved: true });
      addEdge(edges, profileId, skillId, "uses");
    }
    for (const set of profile.sets ?? []) {
      const setId = addNode(nodes, "set", set, { unresolved: true });
      addEdge(edges, profileId, setId, "routes-through");
    }
    for (const tool of profile.mcpTools ?? []) {
      const toolId = addNode(nodes, "tool", tool);
      addEdge(edges, profileId, toolId, "may-call");
    }
  }

  return {
    kind: "parasite-skill-ecosystem-graph",
    version: 1,
    generated_at: new Date().toISOString(),
    node_types: ["skill", "set", "asset", "client", "extension", "mcp", "rule", "agent", "tool"],
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges,
    privacy: "names, counts, metadata, and redacted paths only; no contents, secrets, or user chat history",
  };
}

const DOT_STYLE = {
  skill: ["box", "#e8f0ff"], set: ["hexagon", "#fff2cc"], asset: ["note", "#eaf7ea"],
  client: ["component", "#f3e8ff"], extension: ["tab", "#ffe4e6"], mcp: ["cylinder", "#dff7f5"],
  rule: ["folder", "#f1f5f9"], agent: ["doublecircle", "#fed7aa"], tool: ["oval", "#ede9fe"],
};

function dotQuote(value) {
  return String(value).replaceAll("\\", "/").replaceAll('"', '\\"');
}

// Public projection used by GitHub Pages. It removes filesystem path fields,
// remaps path-derived IDs, and recursively redacts string metadata.
export function sanitizePublicText(value) {
  let text = String(value);
  text = text.replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/gi, "<private-key-redacted>");
  text = text.replace(/\bBearer\s+[^\s,;]+/gi, "Bearer <redacted>");
  text = text.replace(/\b(?:authorization|api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, (match) => `${match.split(/[:=]/, 1)[0]}=<redacted>`);
  return text.split(/\s+/).map((token) => {
    if (token.includes("@") && token.includes(".")) return "<email-redacted>";
    if (/^[A-Za-z]:/.test(token) || token.startsWith("/")) return "<path-redacted>";
    return token;
  }).join(" ");
}

function publicValue(value) {
  if (Array.isArray(value)) return value.map(publicValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, publicValue(child)]));
  return typeof value === "string" ? sanitizePublicText(value) : value;
}

export function publicGraph(graph) {
  const remap = new Map();
  const usedIds = new Map();
  const nodes = graph.nodes.map((node) => {
    const { path, ...publicNode } = node;
    const rawLabel = publicNode.type === "rule" || publicNode.type === "mcp"
      ? String(publicNode.label).replace(/\\/g, "/").split("/").pop()
      : publicNode.label;
    const label = sanitizePublicText(rawLabel);
    const baseId = `${publicNode.type}:${String(label).replace(/[^A-Za-z0-9_.-]+/g, "-")}`;
    const count = usedIds.get(baseId) ?? 0;
    usedIds.set(baseId, count + 1);
    const publicId = count === 0 ? baseId : `${baseId}-${count + 1}`;
    remap.set(node.id, publicId);
    return publicValue({ ...publicNode, id: publicId, label });
  });
  return {
    ...publicValue(graph),
    nodes,
    edges: graph.edges.map((edge) => ({ ...edge, from: remap.get(edge.from) ?? edge.from, to: remap.get(edge.to) ?? edge.to })),
    privacy: "public metadata only; filesystem paths, contents, secrets, environment values, and chat history removed",
  };
}

export function ecosystemToDot(graph) {
  const lines = ["digraph ecosystem {", "  rankdir=LR;", "  graph [pad=0.2, nodesep=0.25, ranksep=0.55];"];
  for (const node of graph.nodes) {
    const [shape, fill] = DOT_STYLE[node.type] ?? ["box", "#ffffff"];
    const label = node.type === "skill" || node.type === "set" || node.type === "agent" ? node.label : `${node.type}: ${node.label}`;
    lines.push(`  "${dotQuote(node.id)}" [label="${dotQuote(label)}", shape=${shape}, style="rounded,filled", fillcolor="${fill}"];`);
  }
  for (const edge of graph.edges) lines.push(`  "${dotQuote(edge.from)}" -> "${dotQuote(edge.to)}" [label="${dotQuote(edge.relation)}"];`);
  lines.push("}");
  return lines.join("\n");
}

export function ecosystemToMermaid(graph) {
  const lines = ["flowchart LR"];
  const emitted = new Set();
  for (const node of graph.nodes) {
    const safe = node.id.replace(/[^A-Za-z0-9_]/g, "_");
    const label = `${node.type}: ${node.label}`.replaceAll('"', "'");
    const shape = node.type === "agent" ? `((\"${label}\"))` : node.type === "set" ? `{{\"${label}\"}}` : `[\"${label}\"]`;
    lines.push(`  ${safe}${shape}`);
    emitted.add(safe);
  }
  for (const edge of graph.edges) {
    const from = edge.from.replace(/[^A-Za-z0-9_]/g, "_");
    const to = edge.to.replace(/[^A-Za-z0-9_]/g, "_");
    if (emitted.has(from) && emitted.has(to)) lines.push(`  ${from} -->|${edge.relation}| ${to}`);
  }
  return lines.join("\n");
}
