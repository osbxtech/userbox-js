## What changes

<!-- One or two sentences. Link the issue if there is one. -->

## Checklist

- [ ] A changeset is included (`pnpm changeset`), or this PR changes no package.
- [ ] Every new or changed HTTP call is listed in `contract/calls.json`.
- [ ] The SDK author contract still holds (`docs/sdk-author-contract.md`).
- [ ] No new runtime dependency, or it is discussed in the linked issue.
- [ ] `pnpm build && pnpm lint && pnpm typecheck && pnpm test && pnpm check:pack` pass locally.
- [ ] `pnpm check:contract && pnpm test:scripts` pass locally.
