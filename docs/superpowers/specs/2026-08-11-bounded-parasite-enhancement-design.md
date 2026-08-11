# Bounded Parasite Enhancement Design

## Goal

Finish the parasite-skill enhancement surface without dumping the entire scanned ecosystem into chat or making unsupported claims about arbitrary client and MCP injection.

## Decisions

1. **Deterministic discovery remains the base.** Scan, validate, route, compose, graph, export, and plan are auditable local operations. Scores are candidates; the host LLM makes semantic decisions from the bounded payload.
2. **LLM use is explicit.** The provider-neutral adapter is invoked only through `llm`, is local-only by default, requires explicit remote opt-in, bounds request/response size, and receives selected context rather than every installed file.
3. **History recovery is explicit.** Freebuff history is discovered as candidate metadata and imported only from a user-selected file. Originals are not modified; imported text is bounded and sanitized.
4. **Integrations are adapter-bound.** Client configs, MCP registrations, build hooks, server wrappers, and extension manifests are opt-in, reversible, and backed up where applicable. Unsupported closed-source targets are reported as unsupported rather than rewritten.
5. **Public artifacts are metadata-only.** Pages/wiki/graph outputs remove contents, credentials, environment values, chat history, and filesystem paths. Private local exports may retain paths for local usability.
6. **Quality gates are mandatory.** Syntax/compile checks, tests, package hygiene, packed smoke tests, public-artifact privacy checks, and adversarial review must pass before release claims.

## Implementation slice

- Add useful subcommand-aware help for `llm`, `history`, `parasite`, `mcp`, and `graph` while preserving the existing global help output.
- Add tests proving each help surface explains its safety-relevant options and does not print secrets or full ecosystem contents.
- Keep the current graph, profiles, sets, MCP parity, history boundaries, Pages workflow, and no-coauthor CI policy intact.

## Explicit non-goals

- No universal injection into arbitrary closed-source clients.
- No bypass of client permissions or sandboxing.
- No automatic scraping or importing of Freebuff histories.
- No remote LLM call unless explicitly requested and permitted.
- No use, storage, or printing of the exposed GitHub token.

## Verification

Run JavaScript syntax checks, Python compilation, the full Bun test suite, npm package hygiene, packed-package smoke tests, `git diff --check`, and targeted CLI help assertions. Review the resulting diff before any commit or push.
