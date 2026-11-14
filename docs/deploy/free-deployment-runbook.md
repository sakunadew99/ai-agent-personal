# Free Deployment Runbook — Sakuna AI on Oracle Cloud Always Free

Step by step: from an empty Oracle account to `https://<your-domain>` with automatic deploys from GitHub,
nightly off-box backups, a tested restore, and the APK on your phone.

**Cost:** hosting, CI/CD, TLS and push are free. **AI model calls are not**: keep `OPENAI_API_KEY` empty to run
fully free (the app falls back to rules), or set a key and a provider spending limit. A domain costs about $10/year; a
free dynamic-DNS subdomain also works (not verified here, see step 4).

> Free-tier facts were last checked 12–14 Nov 2026 and change often. Recheck the Oracle, GitHub and Expo pricing
> pages before you rely on a number. Console menu names below may differ slightly from what you see.

| # | Step | Time | Done when |
|---|---|---|---|
| 0 | Put the code on GitHub, let CI build images | 20 min | `ghcr.io/<you>/sakuna-api:<sha>` exists |
| 1 | Oracle account + budget alert | 20 min | You can open the Oracle console |
| 2 | Create the Arm VM + reserved IP | 15–60 min | `ssh ubuntu@<ip>` works |
| 3 | Open ports 80/443 (cloud + VM firewall) | 10 min | Both layers allow 80/443 |
| 4 | Domain → VM IP | 10 min | `nslookup <domain>` returns your IP |
| 5 | Bootstrap the server | 10 min | `docker compose version` works for user `deploy` |
| 6 | Secrets + first manual deploy | 15 min | `https://<domain>/api/v1/health` → `ok` |
| 7 | GitHub auto-deploy | 15 min | Merging to `main` deploys by itself |
| 8 | Off-box backups + restore drill | 30 min | A restore into a scratch DB shows your rows |
| 9 | APK on your phone | 30 min | Phone logs in over HTTPS |
| 10 | Keep it alive (reclaim, monitoring) | 10 min | Heartbeat alerts set |

---

## 0. Code on GitHub, images in GHCR

The VM never builds anything. It pulls images that GitHub Actions builds for `linux/arm64`.

```bash
# inside WSL, in ~/code/sakuna-ai
git add -A && git commit -m "Phase 1: platform, CI/CD, deploy scripts"
gh repo create sakuna-ai --private --source . --push      # or create it on github.com and `git push -u origin main`
```
1. GitHub → repo → **Actions**: `CI` and `Release` start. `Release` builds the amd64 + arm64 images
   (the first arm64 web build under QEMU can take 15–25 minutes; later builds use the cache).
2. GitHub → your profile → **Packages**: you should see `sakuna-api`, `sakuna-mcp` and `sakuna-web`.
   Note the commit SHA of the release; you need it in step 6.
3. **Branch protection** (Settings → Branches → Add rule for `main`): require a pull request and require status
   check **`ci-ok`**; block force pushes.
4. Create a **read-only token for the server**: Settings → Developer settings → Personal access tokens → *Fine-grained*
   or *classic* with only `read:packages`. Save it in your password manager.

## 1. Oracle account

1. Sign up at oracle.com/cloud/free. A card is needed for verification.
2. **Home region is permanent.** Pick one close to you that offers Ampere A1 (for Sri Lanka, Singapore or Mumbai are
   common choices). Capacity varies by region and time.
3. Billing & Cost Management → **Budgets** → create a budget of **1 USD** with an alert email at 100%.
   You are told immediately if anything starts costing money.

## 2. Create the VM

Console → **Compute → Instances → Create instance**

| Setting | Value |
|---|---|
| Name | `sakuna` |
| Image | **Canonical Ubuntu 24.04** (the aarch64 build is selected automatically for Ampere) |
| Shape | Change shape → **Ampere → VM.Standard.A1.Flex**, **2 OCPU, 12 GB** (the 2026 Always Free allowance) |
| Networking | Create new VCN + public subnet (defaults are fine); *Assign a public IPv4 address* |
| SSH keys | Paste your public key (create one in WSL with `ssh-keygen -t ed25519`, then `cat ~/.ssh/id_ed25519.pub`) |
| Boot volume | 50–100 GB (stay inside the 200 GB free block-storage total) |

**"Out of capacity"?** Try another availability domain (AD-1/2/3) in the same form, try 1 OCPU / 6 GB and resize later,
or retry at another time of day for a few days. You cannot change region. The free-only last resort is two
`VM.Standard.E2.1.Micro` (x86, 1 GB) instances, which is tight for Postgres + API; a ~$4–6/month VPS is the realistic
fallback, and nothing in this runbook changes except the host.

**Reserved IP** (so the address survives a stop/start): Networking → **IP management → Reserved public IPs** → *Reserve*.
Then Instance → *Attached VNICs* → VNIC → *IPv4 addresses* → edit the primary IP → *Reserved public IP* → select it.

Test: `ssh ubuntu@<reserved-ip>`

## 3. Open ports 80 and 443 (two layers)

**Cloud firewall.** Networking → Virtual cloud networks → your VCN → *Security Lists* → *Default Security List* →
*Add Ingress Rules*:

| Source CIDR | Protocol | Destination port |
|---|---|---|
| `0.0.0.0/0` | TCP | 80 |
| `0.0.0.0/0` | TCP | 443 |
| `0.0.0.0/0` | UDP | 443 (HTTP/3, optional) |

Restrict the existing **TCP 22** rule to your home IP (`<your-ip>/32`) if it rarely changes, or install Tailscale later
and close 22 publicly.

**VM firewall.** Oracle's Ubuntu image has its own restrictive iptables rules. `bootstrap.sh` (step 5) opens 80/443
for you and saves the rules.

## 4. Domain → IP

Pick one:
- **A domain you own** (about $10/year): add an **A record** `sakuna` (or `@`) → `<reserved-ip>`.
- **Free dynamic DNS** such as DuckDNS: create a subdomain and set it to `<reserved-ip>`. (I have not verified current
  terms or reliability of free DNS providers; check them yourself.)

Test from WSL: `nslookup sakuna.example.com` returns your IP. Caddy can only get a TLS certificate once this works.

## 5. Bootstrap the server

Copy the `infra/` folder to the VM and run the bootstrap script once:

```bash
# from WSL, in the repo
scp -r infra ubuntu@<ip>:~/infra
ssh ubuntu@<ip> 'bash ~/infra/scripts/bootstrap.sh'
```

What it does (read it first: [infra/scripts/bootstrap.sh](../../infra/scripts/bootstrap.sh)):
Docker Engine + Compose from Docker's apt repo, json-file log limits, `fail2ban`, unattended security upgrades,
key-only SSH, a non-root `deploy` user in the `docker` group with your SSH key, iptables 80/443 opened and saved,
`/opt/sakuna` with the compose file, Caddyfile, `deploy.sh`, `scripts/backup.sh` and `scripts/restore.sh`, plus cron:
nightly backup at 02:30 UTC (weekly on Sunday) and weekly `docker system prune`.

Test: `ssh deploy@<ip> 'docker compose version'`

## 6. Secrets and the first deploy (by hand)

```bash
ssh deploy@<ip>
cd /opt/sakuna
nano .env          # created from infra/.env.prod.example
```

Fill at least:

| Variable | Value |
|---|---|
| `GHCR_OWNER` | your GitHub username, **lowercase** |
| `SITE_ADDRESS` | `sakuna.example.com` (no `https://`) |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` |
| `DATABASE_URL` | `postgresql+psycopg://sakuna:<same password>@db:5432/sakuna` |
| `JWT_SECRET` | `openssl rand -hex 32` (the API refuses to start in production with a weak one) |
| `SERVICE_TOKEN` | `openssl rand -hex 32` |
| `CORS_ORIGINS` | `https://sakuna.example.com` |
| `OPENAI_API_KEY` | empty = free mode; set it only with a provider spending limit |

```bash
chmod 600 .env
echo '<read-only GHCR token>' | docker login ghcr.io -u <github-user> --password-stdin
./deploy.sh <commit-sha-from-step-0>
```

`deploy.sh` backs up the database, pulls the images for that SHA, runs `alembic upgrade head`, starts everything,
waits for the API health check, records the release in `releases.log`, and checks `https://<domain>/api/v1/health`.

Test in your browser: `https://sakuna.example.com` shows the sign-in page with a valid padlock; register your account.
If TLS fails: `docker compose -f docker-compose.prod.yml logs caddy` (DNS not pointing at the VM, or port 80 closed,
are the usual causes).

## 7. Automatic deploys from GitHub

1. On the VM, allow the CI key to log in as `deploy`:
   ```bash
   # in WSL: a dedicated key, no passphrase, used only by GitHub Actions
   ssh-keygen -t ed25519 -f ~/.ssh/sakuna_deploy -N "" -C github-actions
   ssh-copy-id -i ~/.ssh/sakuna_deploy.pub deploy@<ip>
   ssh-keyscan <ip> > known_hosts_sakuna
   ```
2. GitHub → repo → Settings → **Secrets and variables → Actions**:
   - Secrets: `DEPLOY_SSH_KEY` = contents of `~/.ssh/sakuna_deploy`; `DEPLOY_HOST` = `<ip>`;
     `DEPLOY_KNOWN_HOSTS` = contents of `known_hosts_sakuna`.
   - Variables: `DEPLOY_ENABLED` = `true`.
3. Settings → **Environments → New environment `production`** → *Required reviewers*: yourself (optional manual gate).
4. Merge any PR to `main`. `Release` builds the images, waits for your approval if you set a reviewer, then runs
   `/opt/sakuna/deploy.sh <sha>` over SSH.

**Rollback:** `ssh deploy@<ip> 'cat /opt/sakuna/releases.log'` lists the good releases; run
`/opt/sakuna/deploy.sh <previous-sha>`. Because migrations are expand-only (see `backend/CLAUDE.md`), the previous image
works on the newer schema.

## 8. Backups off the box, and one restore

The VM is disposable; backups must live elsewhere.

```bash
# in WSL (your machine): create an encryption key pair. The private key never goes to the server.
sudo apt install -y age && age-keygen -o ~/sakuna-backup-key.txt     # prints "Public key: age1..."
```
On the VM:
```bash
rclone config        # add a remote you control, e.g. "gdrive" (Google Drive) or any S3-compatible storage
nano /opt/sakuna/.env
#   BACKUP_AGE_RECIPIENT=age1...            (the public key)
#   BACKUP_RCLONE_REMOTE=gdrive:sakuna-backups
#   BACKUP_HEARTBEAT_URL=https://hc-ping.com/<uuid>   (optional, step 10)
/opt/sakuna/scripts/backup.sh manual        # prints OK and the file name; check it appears in the remote
```
Keeps 7 nightly + 4 weekly + 5 pre-deploy dumps on the VM, encrypted copies off-box.

**Restore drill** (do it now, then monthly):
```bash
# copy the encrypted dump and your private key to the VM temporarily, or run the drill locally (see below)
AGE_IDENTITY=~/sakuna-backup-key.txt /opt/sakuna/scripts/restore.sh backups/<file>.dump.age --prod --into sakuna_restore_test
# shows row counts for the biggest tables; then remove the key from the VM:  shred -u ~/sakuna-backup-key.txt
docker compose -f /opt/sakuna/docker-compose.prod.yml exec db dropdb -U sakuna sakuna_restore_test
```
Safer variant: download the `.dump.age` to your PC and restore into your local Docker DB
(`AGE_IDENTITY=~/sakuna-backup-key.txt ./infra/scripts/restore.sh <file> --into sakuna_restore_test`). Write down the
date and how long it took.

## 9. APK on your phone

The release build must call `https://<your-domain>` (Android blocks plain HTTP; `localhost` on the phone is the phone).

- **Option A, EAS (free quota):** set `EXPO_PUBLIC_API_URL` in `apps/mobile/eas.json` → `preview` to
  `https://sakuna.example.com` (no `/api/v1`; the app adds it), then `cd apps/mobile && npx eas build --profile preview --platform android`.
- **Option B, GitHub Actions (no quota):** Actions → **Android APK** → *Run workflow* → enter the HTTPS URL.
  Add the keystore secrets first (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
  `ANDROID_KEY_PASSWORD`) so every future APK installs over the old one. Create the keystore once:
  `keytool -genkeypair -v -keystore sakuna.keystore -alias sakuna -keyalg RSA -keysize 2048 -validity 10000`,
  then `base64 -w0 sakuna.keystore`. **Back up the keystore and passwords outside the repo.** Losing them means
  uninstalling and losing local app data.

Install: download the APK on the phone (or `adb install app.apk`), allow *Install unknown apps* for that one app,
choose *Install anyway* if Play Protect warns. Then do the Health Connect checklist in `docs/mobile-health-connect.md`.

## 10. Keep it alive

**Idle reclaim.** Oracle may reclaim an Always Free VM that stays under ~20% CPU, network and memory for 7 days. A
personal app idles that low. I did **not** find a confirmed fix. Reports say upgrading the account to pay-as-you-go
(while staying inside free limits, with the 1 USD budget alert in place) avoids reclamation; verify this in Oracle's
current docs before relying on it. Burning CPU on purpose to look busy is wasteful and may break the terms. Treat
the VM as replaceable: steps 5–6 plus a restore rebuild it in under an hour.

**Account suspension.** An account with no sign-in for 30+ days may be suspended. Log into the Oracle console once a
month (put it in your calendar, or have Sakuna remind you).

**Monitoring (free tiers exist, check current terms):**
- A heartbeat service (e.g. healthchecks.io): one check for the nightly backup (`BACKUP_HEARTBEAT_URL`), so you hear when backups stop.
- An uptime monitor on `https://<domain>/api/v1/health` every 5 minutes.

**Monthly 15-minute check:** `df -h` (disk under 70%), `docker system df`, `cat /opt/sakuna/releases.log`,
latest backup present off-box, restore drill (step 8), Oracle login.

## If something breaks

| Symptom | Look at | Usual fix |
|---|---|---|
| Browser: TLS/certificate error | `docker compose -f docker-compose.prod.yml logs caddy` | DNS not pointing at the IP yet, or port 80 blocked at one of the two firewall layers |
| `deploy.sh` health check failed | `docker compose -f docker-compose.prod.yml logs --tail 100 api` | Bad `.env` value (weak `JWT_SECRET` stops the API in production); roll back with the previous SHA |
| `pull access denied` | `docker login ghcr.io` | Token missing `read:packages`, or `GHCR_OWNER` not lowercase |
| Images are amd64 only | Release workflow logs | `platforms: linux/amd64,linux/arm64` must stay in `release.yml` |
| Phone can't connect | App profile / API URL | Must be `https://<domain>`, not an IP or `http://` |
| Disk full | `docker system df` | `docker system prune -f`; check `backups/` retention |
| VM gone (reclaimed) | Oracle console | New VM (step 2), steps 3–6, restore the newest off-box backup (step 8) |
