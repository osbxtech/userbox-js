# Changesets

Every pull request that changes a published package adds a changeset: a small
Markdown file in this folder that names the package, the bump type and a line
for the changelog. CI fails a pull request that changes `react/src/` or
`node/src/` without one.

```bash
pnpm changeset            # pick the package(s), the bump type, write the summary
pnpm changeset --empty    # a pull request that changes no package (docs, CI)
```

The packages are versioned independently: a changeset bumps only the packages
it names.

## Versions

The repository is in **pre-release mode** (`pre.json`, tag `alpha`). Every
version is `X.Y.Z-alpha.N`, which is the only kind the release workflow accepts.

To prepare a release, a maintainer runs `pnpm changeset version` on a branch,
reviews the bumped `package.json` and `CHANGELOG.md`, and opens a pull request.
Publishing is done only by the `release` workflow, never by
`changeset publish` (see [docs/releasing.md](../docs/releasing.md)).
