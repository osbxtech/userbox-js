# Releasing

This is the public release procedure for `@userbox/react` and `@userbox/node`.
Each package is released on its own: one package, one version, one run.

> The release workflow described here is being set up. Until it is in place,
> no version of either package is published from this repository.

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

1. **Prepare the version in a pull request.** Changesets bump `package.json`
   and write `CHANGELOG.md`. The pull request is reviewed and merged like any
   other.
2. **Dry run.** A maintainer dispatches the `release` workflow on `main` with
   the package, the version, and `dry_run` left on. The run builds, lints,
   type-checks and tests the package, checks that the version agrees with
   `package.json` and `CHANGELOG.md` and is not already on the registry, checks
   the API contract, packs the tarball, checks its contents against
   `pack-allowlist.json`, installs it in a clean directory, and reports the
   file list and the tarball's sha256.
3. **Publish.** The same dispatch with `dry_run` off. The publish job waits for
   a maintainer's approval. It runs no project code: it publishes the exact
   tarball checked in step 2, after re-checking its sha256.
4. **Verify.** The workflow installs the published version from the registry
   in a clean directory, imports every entry point, type-checks a fixture, and
   checks the provenance attestation.
5. **Tag.** The workflow creates the `<folder>-v<version>` tag and a GitHub
   pre-release with the changelog section.

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
