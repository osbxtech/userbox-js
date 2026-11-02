# Releasing

This is the public release procedure for `@userbox/react` and `@userbox/node`.
Each package is released on its own: one package, one version, one run.

## Rules

- **Versions**: semver. Until `1.0.0`, every version is a pre-release
  `X.Y.Z-alpha.N`, published under the `alpha` dist-tag. The dist-tag is
  derived from the version, never chosen by hand.
- **Tags**: `<folder>-v<version>`, e.g. `react-v1.0.0-alpha.1` or
  `node-v1.0.0-alpha.0`. A tag is created only after the published version has
  been verified on the registry.
- **The registry is the source of truth.** A published version is never
  overwritten or re-published. A broken version is fixed by publishing a new
  version and deprecating the broken one.
- **Provenance**: every version is published from GitHub Actions through npm
  trusted publishing (OIDC). No long-lived registry token exists. Check a
  package with `npm audit signatures`.
- **Nothing is ever published from a laptop**, and a merge to `main` never
  publishes on its own.

## Steps

1. **Prepare the version in a pull request.** `pnpm changeset version` bumps
   `package.json` and writes `CHANGELOG.md` from the pending changesets (the
   repository is in `alpha` pre-release mode, so versions are `X.Y.Z-alpha.N`).
   The pull request is reviewed and merged like any other.
2. **Dry run.** A maintainer dispatches the `release` workflow
   (`.github/workflows/release.yml`) on `main` with the package, the version,
   and `dry_run` left on. The run builds, lints,
   type-checks and tests the package, checks that the version agrees with
   `package.json` and `CHANGELOG.md` and is not already on the registry, checks
   the API contract against the deployed tenant API description, packs the
   tarball, checks its contents against `pack-allowlist.json`, installs it in a
   clean directory, and reports the file list and the tarball's sha256. It then
   runs the integration suite against the test tenant.
3. **Publish.** The same dispatch with `dry_run` off. The publish job waits for
   a maintainer's approval (the `npm-publish` environment). It runs no project code: it publishes the exact
   tarball checked in step 2, after re-checking its sha256.
4. **Verify.** The workflow installs the published version from the registry
   in a clean directory, imports every entry point, type-checks a fixture, and
   checks the provenance attestation.
5. **Tag.** The workflow creates the annotated `<folder>-v<version>` tag on the
   released commit and a GitHub pre-release with the changelog section. Release
   tags cannot be moved or deleted once created (repository ruleset).

## When something fails

| Situation | What happens |
|-----------|--------------|
| A check fails before publishing | Nothing is published. The run summary names the failing check. |
| Publishing fails | Nothing reached the registry. Re-run with the same version. |
| Verification fails after publishing | The version is not tagged. If it is broken, a new version is published and the broken one is deprecated. |
| Tagging fails after verification | A maintainer creates the tag by hand on the released commit. Nothing is re-published. |

## Deprecation

A version is deprecated with a message that names the version to use instead.
Unpublishing is reserved for a leaked secret or a legal requirement.

## Who can do what

| Action | Who |
|--------|-----|
| Dispatch `release` | maintainers with write access, on `main` only |
| Approve the publish job | the `npm-publish` environment's reviewers |
| Mint the npm publish credential | only `release.yml`'s publish job, in the `npm-publish` environment (npm trusted publishing) |
| Create a `*-v*` tag | maintainers with write access, and `release.yml`'s tag job: no other workflow has `contents: write` (`scripts/workflows.test.mjs`) |
| Move or delete a `*-v*` tag | nobody |

A release refuses a version whose tag already exists, so a tag created by
hand cannot be "adopted" by a release; it blocks that version instead.

## The first release of a package

npm can attach a trusted publisher only to a package that already exists. The
first time, a maintainer publishes a content-free placeholder
(`0.0.0-bootstrap.0`, no code) from a clean directory, attaches the trusted
publisher, and then runs the steps above for the real first version, which
therefore carries provenance. The placeholder is deprecated, and `latest` is
moved to the real version; the tag job's summary prints that command while
`latest` still points to the placeholder.
