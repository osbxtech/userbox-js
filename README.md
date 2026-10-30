# Userbox JavaScript SDKs

[Userbox](https://docs.userbox.dev) is an identity and authorization platform:
users, workspaces, memberships and workspace-scoped permissions, behind one API.
This repository holds its official JavaScript SDKs.

| Package | Folder | For |
|---------|--------|-----|
| [`@userbox/react`](react/) | `react/` | Browser and Next.js apps: session handling, permission-aware UI hooks, App Router middleware |
| [`@userbox/node`](node/) | `node/` | Server code: permission checks and reads with an API key, zero runtime dependencies |

> **Alpha.** Both packages are pre-1.0 and their APIs may change. Install the
> alpha channel explicitly:
>
>     npm install @userbox/react@alpha
>     npm install @userbox/node@alpha

Documentation: https://docs.userbox.dev

## Working on the SDKs

```bash
nvm use            # Node 24, from .nvmrc
corepack enable    # pnpm, pinned in package.json
pnpm install
pnpm build && pnpm lint && pnpm typecheck && pnpm test && pnpm check:pack
pnpm check:contract && pnpm test:scripts
```

`pnpm test` runs after `pnpm build`: some architectural tests inspect the built
`dist/` output.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the rules every change follows, and
[docs/sdk-author-contract.md](docs/sdk-author-contract.md) for the contract
every Userbox SDK implements.

## Security

Please report vulnerabilities privately. See [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE) © 2026 OsbxTech
