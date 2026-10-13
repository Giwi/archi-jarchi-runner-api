#!/usr/bin/env bash
# Install Archi plugin artifacts into a dropins folder.
#
# Supported inputs in <source dir>:
#   *.archiplugin / *.zip  -> unzipped, top-level entries copied
#   *.jar                  -> copied as-is (a directory bundle may also be given)
#   <directory>            -> copied as-is
#
# Usage: install-plugins.sh <source-dir> <dropins-dir>
set -euo pipefail

SRC="${1:?source directory required}"
DEST="${2:?destination directory required}"

mkdir -p "$DEST"
shopt -s nullglob

for entry in "$SRC"/*; do
  case "$entry" in
    *.archiplugin|*.zip)
      tmp="$(mktemp -d)"
      unzip -q -o "$entry" -d "$tmp"
      # The '.archiplugin' wrapper may contain an 'archi-plugin' marker we skip.
      find "$tmp" -mindepth 1 -maxdepth 1 ! -name 'archi-plugin' -exec cp -a {} "$DEST"/ \;
      rm -rf "$tmp"
      ;;
    *.jar)
      cp -a "$entry" "$DEST"/
      ;;
    *)
      if [ -d "$entry" ]; then
        cp -a "$entry" "$DEST"/
      fi
      ;;
  esac
done

echo "Installed plugins into $DEST:"
ls -1 "$DEST"
