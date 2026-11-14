# Home server: run Sakuna on your PC with a public HTTPS URL (free)

Uses the same containers as production, in production mode, behind Caddy, published through a
**Cloudflare quick tunnel**. No cloud account, no domain, no router changes.

```bash
./scripts/home/up.sh     # first run creates .env.home (strong secrets), starts everything, prints the URL
./scripts/home/url.sh    # print the current URL
./scripts/home/down.sh   # stop (data kept)
```
(Git Bash or WSL. On this PC run the first `up.sh` as `DB_PORT=5433 EDGE_PORT=8088 ./scripts/home/up.sh`;
the ports are then saved in `.env.home`.)

## What is different from local development
- `ENVIRONMENT=production`: the API refuses weak secrets; the schema comes only from Alembic migrations.
- `REGISTRATION_OPEN=false`: nobody can sign up through the public URL. Existing accounts sign in normally.
  To add an account later, stop, set `REGISTRATION_OPEN: "true"` in `docker-compose.home.yml`, start, register, and switch it back.
- New `JWT_SECRET`: everyone has to sign in again once.

## Limits (be aware)
- **Only online while this PC is on and Docker Desktop is running.** Sleep or shutdown = site down, and
  reminders from the worker pause. Set Windows power to never sleep while plugged in, and enable
  Docker Desktop → Settings → General → *Start Docker Desktop when you sign in*. Containers restart by themselves.
- **The quick-tunnel URL changes** whenever the tunnel restarts (reboot, `down.sh`/`up.sh`). Quick tunnels are meant
  for testing and have no uptime guarantee.
- The Android APK has the API URL **built in**, so with a changing URL you would need a new APK each time.
  Before building the APK, switch to a fixed URL (below).

## Fixed URL (recommended before building the APK)
Needs a free Cloudflare account and a domain whose DNS is on Cloudflare (a cheap domain is fine).
1. Cloudflare dashboard → Zero Trust → Networks → **Tunnels** → *Create a tunnel* (type *Cloudflared*), name it `sakuna`.
2. Copy the **tunnel token** it shows. Add a *Public hostname*: `sakuna.yourdomain.com` → Service `HTTP` → `caddy:80`.
3. Put `TUNNEL_TOKEN=<token>` in `.env.home`, and in `docker-compose.home.yml` change the cloudflared command to
   `["tunnel", "--no-autoupdate", "run"]` with `environment: { TUNNEL_TOKEN: ${TUNNEL_TOKEN} }`.
4. `./scripts/home/down.sh && ./scripts/home/up.sh`, then open `https://sakuna.yourdomain.com`.
(Cloudflare menu names change from time to time; check their current tunnel docs.)

## Moving to a VPS later
Back up here (`make backup`), follow `free-deployment-runbook.md` from step 3 on any Ubuntu VPS, and restore the dump there.
