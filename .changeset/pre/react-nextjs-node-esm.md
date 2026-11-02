---
"@userbox/react": patch
---

`@userbox/react/nextjs` imports `next/server.js` and `next/headers.js` instead of
the extensionless `next/server` and `next/headers`. `next` has no `exports` map,
so the extensionless imports failed in plain Node ESM (`ERR_MODULE_NOT_FOUND`)
and under TypeScript `moduleResolution: nodenext` without `skipLibCheck`.
Next.js apps were not affected: the Next bundler resolves both forms.
