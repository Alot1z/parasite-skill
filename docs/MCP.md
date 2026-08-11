# parasite-skill as an MCP server

parasite-skill exposes its routing engine as a dependency-free MCP server over
stdio (JSON-RPC 2.0). Any MCP-compatible host can call `scan`, `validate`,
`route`, `sets`, `plan`, `refs`, `wikis`, and `list_installs` as tools —
mirroring the MCP-first, token-efficient approach of tools like
`get-shit-indexed`.

## Run it

```bash
bun src/mcp-server.js
# or
node src/mcp-server.js
```

## Register it with a host

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "parasite-skill": {
      "command": "bun",
      "args": ["E:/E-github-repos/parasite-skill/src/mcp-server.js"]
    }
  }
}
```

**Claude Code** (project `.mcp.json` or `claude mcp add`):

```bash
claude mcp add parasite-skill -- bun E:/E-github-repos/parasite-skill/src/mcp-server.js
```

**Any MCP host**: point it at the same command/args. Because the server is
plain ESM JS with zero dependencies, both `bun` and `node` can host it.

## Tools

| Tool | Input | Returns |
|---|---|---|
| `scan` | `dirs?` | re-analyze ecosystem, rebuild registry |
| `validate` | — | spec check; exit 1 if any skill non-conforming |
| `route` | `idea` (required), `top?` | top skills + best skill-sets |
| `sets` | `apply?` | list sets or load order |
| `plan` | `request` (required) | routed execution plan with cadence phases |
| `refs` | `per_skill?` | generate ref pages |
| `wikis` | — | generate the wiki + graphs |
| `list_installs` | — | where the skill is installed |

## Test it

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"route","arguments":{"idea":"write api docs for a new rest endpoint"}}}\n' | bun src/mcp-server.js
```
