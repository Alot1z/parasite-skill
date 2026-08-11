# Contributing to parasite-skill

## Scope

Keep changes local, reviewable, and evidence-driven. The package routes metadata and generates opt-in adapters; it must not claim access that a client or MCP server does not expose.

## Attribution

This repository does not accept `Co-authored-by:` trailers. Commits should use the configured author identity only. CI checks commit messages on pushes and pull requests and rejects that trailer.

This policy applies to this repository's CI and does not control commits made in other repositories, clients, or Git identities.

## Safety boundaries

- Do not commit credentials, tokens, private keys, chat history, or personal project content.
- Keep private ecosystem exports metadata-only: names, counts, relationships, and normalized paths; use `--public` before publishing graph/wiki artifacts.
- Treat skill assets and imported transcripts as untrusted input.
- Keep remote LLM use opt-in, bounded, and explicit.
- Preserve backups and refuse to overwrite malformed client configuration.
- Do not describe file-based extensions as universal injection into closed-source software.

## Before opening a pull request

```bash
npm run check
npm test -- --runInBand
npm run pack:smoke
npm pack --dry-run --json
npm run scan -- --force
```

Review the package file list and `git diff --check`. If the change affects graph relationships or routing, add a focused regression test and regenerate the relevant isolated artifacts locally.

## Release checklist

1. Run the complete verification commands above.
2. Confirm no generated registry, history, payload, wiki, refs, or bundle artifacts are accidentally tracked.
3. Confirm the Pages workflow uses an isolated temporary registry.
4. Confirm the commit has no `Co-authored-by:` trailer.
5. Push only after the final diff and tests have been reviewed.
