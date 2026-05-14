# Releasing TECR

## Prerequisites

- npm account with access to the `@tecr` org
- Azure DevOps PAT with **Marketplace → Manage** scope
  - Create at: https://go.microsoft.com/fwlink/?LinkId=307137
  - Organization: All accessible organizations

## One-time setup

```bash
npm login                        # authenticates npm publish
pnpm exec vsce login danebalia   # caches the marketplace PAT
```

## Release

```bash
pnpm release          # patch: x.y.Z → x.y.(Z+1)
pnpm release minor    # x.Y.z → x.(Y+1).0
pnpm release major    # X.y.z → (X+1).0.0
```

The script:
1. Refuses to run on a dirty working tree
2. Bumps all three packages to the same version
3. Builds everything
4. Runs the TECR-L4 conformance gate (blocks on regression)
5. Creates one git commit + one tag (`vX.Y.Z`)
6. Packages the VS Code extension (`.vsix`)

## Publish

After the script completes, run these three commands:

```bash
pnpm --filter @tecr/core publish --access public
pnpm --filter @tecr/mcp  publish --access public
pnpm exec vsce publish --no-dependencies --pat <token>
```

Then push:

```bash
git push && git push --tags
```

## Packages

| Package | Registry | ID |
|---|---|---|
| `@tecr/core` | npm | npmjs.com/package/@tecr/core |
| `@tecr/mcp` | npm | npmjs.com/package/@tecr/mcp |
| `tecr-mcp` (VS Code) | Marketplace | marketplace.visualstudio.com/items?itemName=danebalia.tecr-mcp |
