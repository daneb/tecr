#!/usr/bin/env bash
# Usage: pnpm release [patch|minor|major]  (default: patch)
set -euo pipefail

BUMP="${1:-patch}"

if [[ "$BUMP" != "patch" && "$BUMP" != "minor" && "$BUMP" != "major" ]]; then
  echo "Usage: $0 [patch|minor|major]" >&2
  exit 1
fi

# ── 1. Ensure clean working tree ──────────────────────────────────────────────
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is dirty. Commit or stash changes before releasing." >&2
  exit 1
fi

# ── 2. Bump all package versions ─────────────────────────────────────────────
pnpm -r exec npm version "$BUMP" --no-git-tag-version

# Derive the new version from the root package (all packages stay in sync)
NEW_VERSION=$(node -p "require('./packages/tecr-core/package.json').version")

# Bump root package.json to match
npm version "$NEW_VERSION" --no-git-tag-version --allow-same-version 2>/dev/null || true

# ── 3. Build ──────────────────────────────────────────────────────────────────
echo "Building v${NEW_VERSION}…"
pnpm build

# ── 4. Run conformance gate ───────────────────────────────────────────────────
echo "Running conformance gate…"
TECR_NO_TELEMETRY=1 tsx scripts/conformance-gate.ts

# ── 5. Commit + tag ───────────────────────────────────────────────────────────
git add package.json packages/tecr-core/package.json packages/tecr-mcp/package.json packages/tecr-vscode/package.json
git commit -m "chore: release v${NEW_VERSION}"
git tag "v${NEW_VERSION}"

# ── 6. Package VS Code extension ─────────────────────────────────────────────
echo "Packaging VS Code extension…"
pnpm --filter tecr-vscode package

VSIX_PATH="packages/tecr-vscode/tecr-vscode-${NEW_VERSION}.vsix"

echo ""
echo "✓ Tagged v${NEW_VERSION}. Next steps:"
echo "  pnpm --filter @tecr/core publish --access public"
echo "  pnpm --filter @tecr/mcp  publish --access public"
echo "  Upload ${VSIX_PATH} to https://marketplace.visualstudio.com/manage"
echo ""
echo "  git push && git push --tags"
