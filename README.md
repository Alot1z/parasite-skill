# 🦠 Parasite Skill

**Enhance without modifying.** A runtime injection system for AI clients.

[![GitHub stars](https://img.shields.io/github/stars/Alot1z/skill-router?style=social)](https://github.com/Alot1z/skill-router)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-green.svg)](package.json)

---

## 🎯 What is Parasite Skill?

Parasite Skill is a non-invasive enhancement system that injects capabilities into AI clients **without modifying their source code**. It creates extension folders, provides build-time hooks, wraps servers, and protects traceability — all while being fully toggleable and removable.

### Key Features

- 🔌 **Runtime Injection** — Add enhancements that run at startup without touching originals
- 📁 **Extension Folders** — Each client gets a `.skill-router-extensions/` directory
- 🛠️ **Build-time Hooks** — Generate Vite/webpack plugins for build-time injection
- 🖥️ **Server Wrapping** — Wrap upstream servers with enhancement layers
- 🔒 **Traceability Protection** — Obfuscate extracted code to prevent tracing
- 🎛️ **Toggleable** — Enable/disable injections on the fly
- 🔒 **Privacy-First** — All data stays local, no external sharing

---

## 🚀 Quick Start

### Installation

```bash
# Using npm
npm install -g parasite-skill

# Using bun
bun add -g parasite-skill

# Using npx (no install)
npx parasite-skill --help
```

### First Steps

```bash
# Check installation status
parasite-skill list

# Install to a specific client
parasite-skill install --agent claude-code

# View injection status
parasite-skill parasite --status
```

---

## 📚 Documentation

| Section | Description |
|---------|-------------|
| [Getting Started](#-quick-start) | Installation and first steps |
| [Commands](#-commands) | Complete command reference |
| [Parasite System](#-parasite-extension-system) | Runtime injection guide |
| [Build Hooks](#-build-hooks) | Vite/webpack plugin generation |
| [Server Wrapping](#-server-wrapping) | Upstream server enhancement |
| [Traceability](#-traceability-protection) | Code obfuscation guide |
| [API Reference](docs/API.md) | Programmatic API |
| [Contributing](CONTRIBUTING.md) | How to contribute |

---

## 🛠️ Commands

### Core Commands

```bash
# Install the skill into AI clients
parasite-skill install
parasite-skill install --yes --all
parasite-skill install --agent claude-code,cursor

# List installed instances
parasite-skill list

# Remove installed instances
parasite-skill remove --agent claude-code

# Refresh all installed copies
parasite-skill refresh
```

### Routing Commands

```bash
# Scan the skill ecosystem
parasite-skill scan

# Route an idea to skills
parasite-skill route "build a REST API with authentication"

# Route within a specific skill-set
parasite-skill route "implement user auth" --set build

# Generate execution plan
parasite-skill plan "create a React dashboard"

# List available skill-sets
parasite-skill sets
```

### Parasite Commands

```bash
# View injection status
parasite-skill parasite --status

# Add a runtime injection
parasite-skill parasite --add --agent claude-code --type hook --code "console.log('active')"

# Toggle an injection
parasite-skill parasite --toggle injection-1234567890 --enable

# Remove an injection
parasite-skill parasite --remove injection-1234567890

# Generate build hooks
parasite-skill parasite --hook vite --out vite-plugin.js
parasite-skill parasite --hook webpack --out webpack-plugin.js

# Generate server wrapper
parasite-skill parasite --wrap --server ./upstream-server.js --out wrapped-server.js

# Protect code traceability
parasite-skill parasite --protect --file input.js --level medium --out protected.js
```

### Utility Commands

```bash
# Generate skill graph
parasite-skill graph --dot
parasite-skill graph --mmd

# Generate AGENTS.md
parasite-skill agents

# Sync skills to git
parasite-skill sync --init <repo-url>
parasite-skill sync --push

# Build distribution bundle
parasite-skill bundle
```

---

## 🔌 Parasite Extension System

The parasite system enables runtime injection without modifying source code.

### How It Works

1. **Extension folders** are created in each client's skills directory
2. **Injections** are stored as separate files, never modifying originals
3. **Manifests** track all injections and their state
4. **Build hooks** generate plugin code for Vite/webpack
5. **Server wrappers** create enhancement layers around upstream servers

### Injection Types

| Type | Description | Use Case |
|------|-------------|----------|
| `pre-init` | Runs before client initialization | Setup, configuration |
| `post-init` | Runs after client initialization | Cleanup, logging |
| `middleware` | Adds HTTP middleware | Auth, CORS, logging |
| `hook` | Wraps existing functions | Monitoring, caching |

### Traceability Protection Levels

| Level | Description | Use Case |
|-------|-------------|----------|
| `light` | Remove comments, minify whitespace | Quick obfuscation |
| `medium` | Rename variables, add dead code | Standard protection |
| `heavy` | Full obfuscation with control flow flattening | Maximum protection |

---

## 🛠️ Build Hooks

Generate plugins for build tools to inject code at build time.

### Vite Plugin

```bash
parasite-skill parasite --hook vite --out vite-plugin.js
```

```js
// vite.config.js
import { skillRouterParasite } from './vite-plugin.js';

export default {
  plugins: [
    skillRouterParasite({
      // Your configuration
    })
  ]
};
```

### Webpack Plugin

```bash
parasite-skill parasite --hook webpack --out webpack-plugin.js
```

```js
// webpack.config.js
const SkillRouterParasite = require('./webpack-plugin.js');

module.exports = {
  plugins: [
    new SkillRouterParasite({
      // Your configuration
    })
  ]
};
```

---

## 🖥️ Server Wrapping

Wrap upstream servers with enhancement layers without modifying their code.

```bash
parasite-skill parasite --wrap --server ./upstream-server.js --out wrapped-server.js
```

```js
// wrapped-server.js
import { createServer as createUpstreamServer } from './upstream-server.js';

const enhancements = [
  {
    type: 'middleware',
    code: 'console.log("Request:", req.url);',
    enabled: true
  }
];

export function createServer(options = {}) {
  const app = createUpstreamServer(options);
  // Apply enhancements
  return app;
}
```

---

## 🔒 Traceability Protection

Protect extracted code from being traced back to its source.

```bash
# Light protection (remove comments, minify)
parasite-skill parasite --protect --file input.js --level light --out protected.js

# Medium protection (rename variables, add dead code)
parasite-skill parasite --protect --file input.js --level medium --out protected.js

# Heavy protection (full obfuscation)
parasite-skill parasite --protect --file input.js --level heavy --out protected.js
```

---

## 🎨 Interactive Graph

Visualize skill relationships with an interactive graph.

```bash
# Generate DOT format
parasite-skill graph --dot > skills.dot

# Generate Mermaid format
parasite-skill graph --mmd > skills.mmd

# View in browser
open https://mermaid.live/edit
```

---

## 📊 Skill-Sets

Named bundles activated in one word:

| Set | Use For | Skills |
|-----|---------|--------|
| `thinking` | Decompose + reason + doubt | tractatus-thinking, sequential-thinking, debug-thinking |
| `research` | Verify against real sources | deepwiki, context7, find-docs |
| `planning` | Idea → spec → tasks | brainstorming, spec-driven-development |
| `build` | Implement in slices | incremental-implementation, tdd |
| `docs` | Write + keep docs honest | documentation-writer, readme-skill |
| `review` | Gate before merge | code-review-and-quality |
| `frontend` | UI that actually works | frontend-ui-engineering |
| `ops` | Ship safely | ci-cd-and-automation |
| `intelligence` | Understand codebase | ix, understand, code-review-graph |

### Custom Skill-Sets

```bash
# Create a custom set
parasite-skill sets --new my-project --members "brainstorming,spec-driven-development"

# Add a skill to a set
parasite-skill sets --add my-project:code-review-and-quality

# Remove a skill from a set
parasite-skill sets --remove my-project:code-review-and-quality
```

---

## ⚙️ Project Configuration

Each project can define its own defaults via `parasite-skill.json`:

```json
{
  "registry": "./.skill-router",
  "dirs": ["./skills", "./.agents/skills"],
  "defaultSet": "build",
  "force": false
}
```

---

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

### Development

```bash
# Clone the repository
git clone https://github.com/Alot1z/skill-router.git
cd skill-router

# Install dependencies
bun install

# Run tests
bun test

# Run in development mode
bun dev
```

---

## 📄 License

MIT © [Alot1z](https://github.com/Alot1z)

---

## 🙏 Acknowledgments

- [Agent Skills Specification](https://agentskills.io/specification)
- [Claude Code](https://claude.ai)
- [Codex CLI](https://github.com/openai/codex)
- All the amazing AI coding tools out there

---

<div align="center">

**[Documentation](docs/)** • **[API Reference](docs/API.md)** • **[Examples](examples/)** • **[Contributing](CONTRIBUTING.md)**

</div>
