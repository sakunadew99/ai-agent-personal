# Web rules (Next.js App Router, React 19, TypeScript)

- Single App Router shell (`app/page.tsx`) switches modules client-side. Add real routes only when deep links need them.
- API calls go through `lib/api.ts` with a RELATIVE base (`/api/v1`). Never bake a hostname into the build:
  in dev, `next.config.ts` rewrites to the API; in production Caddy routes `/api/*` on the same origin.
- AI proposals must look different from completed actions; the approval queue stays reachable; destructive actions confirm.
- Docker: `output: "standalone"`, runs as the `node` user. Check before PR: `npx tsc --noEmit` and `npm run build`.
- No secrets or AI keys in client code or `NEXT_PUBLIC_*` variables.
