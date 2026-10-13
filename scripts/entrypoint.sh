#!/usr/bin/env bash
# Container entrypoint: configure Archi heap, mount points and X display,
# then hand off to the Node server.
set -euo pipefail

ARCHI_HOME="${ARCHI_HOME:-/opt/archi}"
ARCHI_XMS="${ARCHI_XMS:-256m}"
ARCHI_XMX="${ARCHI_XMX:-2g}"
ARCHI_SCRIPTS_DIR="${ARCHI_SCRIPTS_DIR:-/scripts}"
export DISPLAY="${DISPLAY:-:99}"

# 1. Inject heap settings into Archi.ini (idempotent: replaces existing -Xms/-Xmx).
ini="$ARCHI_HOME/Archi.ini"
if [ -f "$ini" ]; then
  tmp="$(mktemp)"
  awk -v xms="-Xms${ARCHI_XMS}" -v xmx="-Xmx${ARCHI_XMX}" '
    /^[[:space:]]*-Xms/ || /^[[:space:]]*-Xmx/ { next }
    { print }
    /^-vmargs$/ && !done { print xms; print xmx; done = 1 }
  ' "$ini" > "$tmp"
  mv "$tmp" "$ini"
  echo "archi-server: heap set to -Xms${ARCHI_XMS} -Xmx${ARCHI_XMX}"
fi

# 2. jArchi resolves its user scripts folder to <data.location>/scripts.
#    Point that path at the mounted scripts volume.
mkdir -p "${HOME}/Documents/Archi"
if [ ! -e "${HOME}/Documents/Archi/scripts" ]; then
  ln -s "$ARCHI_SCRIPTS_DIR" "${HOME}/Documents/Archi/scripts"
fi

# 3. Headless SWT still needs an X display.
if ! command -v xdpyinfo >/dev/null 2>&1 || ! xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
  Xvfb "$DISPLAY" -screen 0 1600x1200x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
  for _ in $(seq 1 50); do
    if command -v xdpyinfo >/dev/null 2>&1 && xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
      break
    fi
    sleep 0.1
  done
  echo "archi-server: Xvfb running on ${DISPLAY}"
fi

# 4. git: repositories live on bind mounts, so relax the ownership check.
git config --global --add safe.directory '*' 2>/dev/null || true

exec node /app/dist/index.js
