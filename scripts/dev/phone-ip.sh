#!/usr/bin/env bash
# Print the address your phone should use for EXPO_PUBLIC_API_URL in development.
# With networkingMode=mirrored in %UserProfile%\.wslconfig, the Windows LAN IP reaches WSL directly.
set -euo pipefail
WIN_IP=$(powershell.exe -NoProfile -Command \
  "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { \$_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL' -and \$_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1).IPAddress" \
  2>/dev/null | tr -d '\r' || true)
echo "Windows LAN IP : ${WIN_IP:-unknown}"
echo "WSL IP         : $(hostname -I | awk '{print $1}')"
echo
echo "Set in apps/mobile/.env:  EXPO_PUBLIC_API_URL=http://${WIN_IP:-<your-pc-ip>}:8000"
