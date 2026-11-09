---
"@userbox/react": minor
---

`UserboxProvider` takes an optional `environment` prop: the slug of the tenant environment the app signs in against, for example `development`. `useSignIn()` and `useSignUp()` add it to the hosted sign-in and sign-up URLs as `environment=<slug>`, and hosted sign-in then checks the return address against that environment's allowed redirect domains, so `localhost` can stay out of production's list. An empty string counts as omitted; an invalid slug throws `misconfigured("environment")`. Without the prop, URLs are unchanged. Needs a Userbox platform with environment-aware redirects; an older platform ignores the parameter.
