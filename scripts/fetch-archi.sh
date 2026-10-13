#!/usr/bin/env bash
# Download the Archi runtime and publicly available plugin binaries into vendor/.
#
#   vendor/archi/    extracted Archi Linux distribution (launcher + bundled JRE)
#   vendor/plugins/  plugin artifacts consumed by install-plugins.sh
#
# jArchi's binary is not publicly downloadable (Patreon/PayPal). Provide it as
# vendor/plugins/jarchi*.archiplugin, set JARCHI_URL, or build from source with
# scripts/build-plugins.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCHI_VERSION="${ARCHI_VERSION:-5.6.0}"
COARCHI_VERSION="${COARCHI_VERSION:-0.9.7}"

VENDOR="$ROOT/vendor"
CACHE="$VENDOR/cache"
ARCHI_DIR="$VENDOR/archi"
PLUGINS_DIR="$VENDOR/plugins"
mkdir -p "$CACHE" "$PLUGINS_DIR"

ARCHI_URL="${ARCHI_URL:-https://www.archimatetool.com/downloads/archi/archive/${ARCHI_VERSION}/Archi-Linux64-${ARCHI_VERSION}.tgz}"
COARCHI_URL="${COARCHI_URL:-https://www.archimatetool.com/downloads/coarchi/coArchi_${COARCHI_VERSION}.archiplugin}"

fetch() {
  local url="$1" dst="$2"
  if [ -s "$dst" ]; then
    echo "cached: $(basename "$dst")"
    return
  fi
  echo "downloading: $url"
  curl -fL --retry 3 --retry-delay 2 -o "$dst.part" "$url"
  mv "$dst.part" "$dst"
}

# --- Archi ---------------------------------------------------------------
if [ -x "$ARCHI_DIR/Archi" ]; then
  echo "Archi already present at $ARCHI_DIR"
else
  tgz="$CACHE/$(basename "$ARCHI_URL")"
  fetch "$ARCHI_URL" "$tgz"
  rm -rf "$ARCHI_DIR"
  mkdir -p "$ARCHI_DIR"
  tar -xzf "$tgz" -C "$ARCHI_DIR" --strip-components=1
  echo "Archi extracted to $ARCHI_DIR"
fi

# --- coArchi -------------------------------------------------------------
coarchi_file="$PLUGINS_DIR/coArchi_${COARCHI_VERSION}.archiplugin"
fetch "$COARCHI_URL" "$coarchi_file"

# --- jArchi --------------------------------------------------------------
if ls "$PLUGINS_DIR"/*jarchi* >/dev/null 2>&1 || ls "$PLUGINS_DIR"/com.archimatetool.script*.jar >/dev/null 2>&1; then
  echo "jArchi artifact already present in $PLUGINS_DIR"
elif [ -n "${JARCHI_URL:-}" ]; then
  fetch "$JARCHI_URL" "$PLUGINS_DIR/jarchi.archiplugin"
else
  cat <<'EOF'
WARNING: no jArchi artifact found in vendor/plugins.

Options:
  1. Copy the provided jArchi *.archiplugin into vendor/plugins/.
  2. Re-run with JARCHI_URL=<url> to download it.
  3. Build jArchi from source:  scripts/build-plugins.sh
     (produces vendor/plugins/com.archimatetool.script*.jar)
EOF
fi

echo
echo "vendor layout:"
echo "  $ARCHI_DIR"
ls -1 "$PLUGINS_DIR" || true
