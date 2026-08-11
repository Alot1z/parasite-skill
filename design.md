# Design

Design reference for parasite-skill.

## Principles

1. Non-invasive. Never modify original source files. Injections live in extension folders.
2. Universal. Works across clients, build tools, server frameworks.
3. Local. All state stays on the machine. No telemetry, no external calls.
4. Reversible. Every injection can be toggled or removed.

## Architecture

```
src/
  engine.js          # scanning, scoring, registry
  cli.js             # argument parsing, dispatch
  clients.js         # multi-client install paths
  parasite/index.js  # injection system
  commands/          # one file per CLI command
```

Injection flow:

1. `parasite --add` writes an injection file + manifest entry into the client's `.parasite-skill-extensions/`
2. At client startup, extension code runs from that folder
3. `parasite --toggle` flips `enabled` in the manifest
4. `parasite --remove` deletes the file and manifest entry

Nothing in the client's own files changes at any step.

## Data model

Manifest (`parasite-manifest.json`):

```json
{
  "version": "1.0.0",
  "created": "ISO timestamp",
  "injections": [
    {
      "id": "injection-1723",
      "type": "hook",
      "code": "console.log('x')",
      "target": "default",
      "position": "wrap",
      "created": "ISO timestamp",
      "enabled": true
    }
  ]
}
```

Injection types:

| type | runs |
|---|---|
| pre-init | before client initialization |
| post-init | after client initialization |
| middleware | as HTTP middleware |
| hook | wraps existing functions |

## Build hooks

Generated plugins inject pre-init code into the HTML build.

- `vite` -> a Vite plugin (transformIndexHtml + configResolved)
- `webpack` -> a webpack plugin (processAssets)

## Server wrapper

Generated module imports the upstream server, applies enhancement layers, re-exports.

Enhancement types: `middleware` (app.use), `route` (extra routes), `hook` (wrap functions).

## Traceability protection

Three levels:

- `light` — strip comments, collapse whitespace
- `medium` — rename common variable names, append dead code
- `heavy` — split into chunks, reorder, wrap in a decoder function

## Site

GitHub Pages site built by `.github/workflows/deploy-pages.yml`.

- Dark theme, single page
- Mermaid graph of the extension system
- Links to graph.dot / graph.mmd artifacts
- No JavaScript beyond Mermaid

## Performance targets

- CLI boots in under a second
- Scan of ~100 skills completes in ~100ms
- Site FCP under 1.5s (static, no framework)
