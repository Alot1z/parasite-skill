#!/usr/bin/env bash
# skill-router — no-npm install from GitHub Pages.
# Fetches the latest bundle + manifest from the Pages site and installs the
# skill payload into ~/.agents/skills (universal dir), then offers to register
# the MCP server. No node/npm/bun required for the download path itself.
#
# Usage:
#   curl -fsSL https://<GH_USER>.github.io/skill-router/install.sh | bash
#   SKILL_ROUTER_PAGES_URL=https://<GH_USER>.github.io/skill-router bash gh-install.sh
#
set -euo pipefail

BASE_URL="${SKILL_ROUTER_PAGES_URL:-https://<GH_USER>.github.io/skill-router}"
DEST="${SKILL_ROUTER_DEST:-$HOME/.agents/skills/skill-router}"
STAGING="${SKILL_ROUTER_STAGING:-$HOME/.agents/skills/.skill-router-staging}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "skill-router install (from GitHub Pages)"
echo "  source : $BASE_URL"
echo "  dest   : $DEST"

# 1. Fetch manifest + bundle.
echo "==> fetching manifest"
curl -fsSL "$BASE_URL/install.json" -o "$TMP/install.json"
VERSION="$(python3 -c "import json;print(json.load(open('$TMP/install.json'))['version'])" 2>/dev/null || echo unknown)"
echo "==> fetching bundle v$VERSION"
curl -fsSL "$BASE_URL/skill-router-bundle.tar.gz" -o "$TMP/bundle.tar.gz"

# 2. Extract into a *persistent* staging dir (survives the TMP cleanup trap).
echo "==> extracting to persistent staging"
rm -rf "$STAGING"
mkdir -p "$STAGING"
tar -xzf "$TMP/bundle.tar.gz" -C "$STAGING"
PAYLOAD="$STAGING/skill"

# 3. Install (copy mode by default; SKILL_ROUTER_LINK=1 uses a symlink).
mkdir -p "$(dirname "$DEST")"
if [ "${SKILL_ROUTER_LINK:-0}" = "1" ]; then
  rm -rf "$DEST"
  ln -s "$PAYLOAD" "$DEST"
  echo "==> linked (symlink) -> $DEST  (payload: $PAYLOAD)"
else
  rm -rf "$DEST"
  cp -r "$PAYLOAD" "$DEST"
  echo "==> copied -> $DEST"
fi

# 4. Verify.
if [ -f "$DEST/SKILL.md" ]; then
  echo "==> ok: SKILL.md present"
else
  echo "==> FAIL: SKILL.md missing" >&2
  exit 1
fi

echo
echo "Installed. Next steps:"
echo "  ls $DEST"
echo "  Register the MCP server in your client configs (no manual editing):"
echo "    skill-router mcp add     (from the full CLI)"
echo "  Or for Claude Code only:"
echo "    claude mcp add skill-router -- node <absolute-path>/src/mcp-server.js"
