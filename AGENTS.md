# AGENTS.md

Guidance for coding agents working **on** these SDKs. Agents that only **use**
the SDKs should read the package READMEs instead.

## Layout

- `react/`: `@userbox/react` (browser + Next.js App Router).
- `node/`: `@userbox/node` (server-side client, zero runtime dependencies).
- `tooling/`: shared `tsconfig.base.json` and `eslint.base.mjs`, extended by relative path.
- `contract/calls.json`: every HTTP call each SDK makes.
- `contract/tenant-openapi.json`: the vendored tenant API description the calls are checked against. Change it only with `pnpm contract:sync`.
- `scripts/`: repository checks and release tooling, each with a `node --test` file: `check-pack`, `check-contract`, `check-changeset`, `check-release`, `verify-published`, `sync-contract`; `workflows.test.mjs` holds the workflow policy.
- `.changeset/`: pending changesets; the repository is in `alpha` pre-release mode.
- `docs/`: the SDK author contract and the release procedure.
- `cli/`: reserved for a future `@userbox/cli`. Not a workspace member.

## Commands

Run `nvm use` first (Node 24), then:

```bash
pnpm install
pnpm build && pnpm lint && pnpm typecheck && pnpm test && pnpm check:pack
pnpm check:contract && pnpm test:scripts
```

Build before test: some architectural tests read `dist/`.

## Rules (checklist)

- [ ] Access tokens stay in memory. Never `localStorage`, `sessionStorage`, IndexedDB, `document.cookie` or disk.
- [ ] In cookie mode the refresh token lives in an `httpOnly` cookie set by the tenant backend. Browser code never sets it.
- [ ] JWT verification, where it exists, hard-codes `RS256`. Never read the algorithm from the token header.
- [ ] Refresh is single-flight: concurrent refreshes coalesce into one outbound call.
- [ ] Errors use the shared taxonomy. Credentials never appear in errors, logs or warnings.
- [ ] Every `/v1/...` call in `src/` appears in `contract/calls.json` (an architectural test enforces this), and `pnpm check:contract` passes.
- [ ] A change under `react/src/` or `node/src/` comes with a changeset.
- [ ] Workflow inputs reach `run:` scripts only through `env:`, never as `${{ }}` inside a script (`scripts/workflows.test.mjs`).
- [ ] No new runtime dependency without discussion.
- [ ] Never add a `pull_request_target` workflow.
- [ ] Never publish from a laptop or add a registry token anywhere. Releases go through the release workflow only.
- [ ] Test fixtures use obviously fake credentials that do not look like real Userbox keys.

The full contract is [docs/sdk-author-contract.md](docs/sdk-author-contract.md).
