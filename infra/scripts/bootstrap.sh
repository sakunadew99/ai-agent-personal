#!/usr/bin/env bash
# Rebuild a fresh Ubuntu 24.04 (arm64 or amd64) VM for Sakuna in one go.
# Run as a sudo-capable user on the new VM:
#   curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/infra/scripts/bootstrap.sh | bash
#   (or scp the infra/ folder up and run: bash infra/scripts/bootstrap.sh)
# Then: put /opt/sakuna/.env in place, `docker login ghcr.io`, and run deploy.sh <sha>.
set -euo pipefail

APP_DIR=/opt/sakuna
DEPLOY_USER=deploy
REPO_RAW="${REPO_RAW:-}"   # e.g. https://raw.githubusercontent.com/owner/sakuna-ai/main

echo "==> packages + security updates"
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg fail2ban unattended-upgrades iptables-persistent age rclone
sudo dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> Docker Engine + Compose plugin (official repo)"
if ! command -v docker >/dev/null; then
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
sudo tee /etc/docker/daemon.json >/dev/null <<'JSON'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
JSON
sudo systemctl restart docker

echo "==> deploy user"
id "$DEPLOY_USER" >/dev/null 2>&1 || sudo adduser --disabled-password --gecos "" "$DEPLOY_USER"
sudo usermod -aG docker "$DEPLOY_USER"
sudo mkdir -p "/home/$DEPLOY_USER/.ssh"
[ -f "$HOME/.ssh/authorized_keys" ] && sudo cp "$HOME/.ssh/authorized_keys" "/home/$DEPLOY_USER/.ssh/"
sudo chown -R "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"; sudo chmod 700 "/home/$DEPLOY_USER/.ssh"

echo "==> SSH: keys only"
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl reload ssh || sudo systemctl reload sshd || true

echo "==> firewall: open 80/443 (Oracle images ship restrictive iptables rules)"
sudo iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 6 -p tcp --dport 80 -j ACCEPT
sudo iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT
sudo iptables -C INPUT -p udp --dport 443 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 6 -p udp --dport 443 -j ACCEPT
sudo netfilter-persistent save

echo "==> app directory $APP_DIR"
sudo mkdir -p "$APP_DIR/scripts" "$APP_DIR/backups"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo "")"
if [ -n "$HERE" ] && [ -f "$HERE/../docker-compose.prod.yml" ]; then
  sudo cp "$HERE/../docker-compose.prod.yml" "$APP_DIR/"
  sudo cp "$HERE/../caddy/Caddyfile" "$APP_DIR/Caddyfile"
  sudo cp "$HERE/deploy.sh" "$APP_DIR/deploy.sh"
  sudo cp "$HERE/backup.sh" "$HERE/restore.sh" "$APP_DIR/scripts/"
  [ -f "$APP_DIR/.env" ] || sudo cp "$HERE/../.env.prod.example" "$APP_DIR/.env"
elif [ -n "$REPO_RAW" ]; then
  sudo curl -fsSL "$REPO_RAW/infra/docker-compose.prod.yml" -o "$APP_DIR/docker-compose.prod.yml"
  sudo curl -fsSL "$REPO_RAW/infra/caddy/Caddyfile" -o "$APP_DIR/Caddyfile"
  sudo curl -fsSL "$REPO_RAW/infra/scripts/deploy.sh" -o "$APP_DIR/deploy.sh"
  sudo curl -fsSL "$REPO_RAW/infra/scripts/backup.sh" -o "$APP_DIR/scripts/backup.sh"
  sudo curl -fsSL "$REPO_RAW/infra/scripts/restore.sh" -o "$APP_DIR/scripts/restore.sh"
  [ -f "$APP_DIR/.env" ] || sudo curl -fsSL "$REPO_RAW/infra/.env.prod.example" -o "$APP_DIR/.env"
fi
sudo chmod +x "$APP_DIR/deploy.sh" "$APP_DIR"/scripts/*.sh 2>/dev/null || true
sudo chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"
sudo chmod 600 "$APP_DIR/.env" 2>/dev/null || true

echo "==> cron: nightly backup 02:30 UTC, weekly docker cleanup"
sudo tee /etc/cron.d/sakuna >/dev/null <<CRON
30 2 * * 1-6 $DEPLOY_USER $APP_DIR/scripts/backup.sh nightly >> $APP_DIR/backups/backup.log 2>&1
30 2 * * 0 $DEPLOY_USER $APP_DIR/scripts/backup.sh weekly >> $APP_DIR/backups/backup.log 2>&1
0 4 * * 0 $DEPLOY_USER docker system prune -f >/dev/null 2>&1
CRON

cat <<NEXT

Bootstrap done. Next steps (as $DEPLOY_USER):
  1. Edit $APP_DIR/.env  (GHCR_OWNER, SITE_ADDRESS, passwords, JWT_SECRET, SERVICE_TOKEN)
  2. echo <read-only GHCR token> | docker login ghcr.io -u <github-user> --password-stdin
  3. $APP_DIR/deploy.sh <git-sha>     # first deploy by hand; then GitHub Actions takes over
NEXT
