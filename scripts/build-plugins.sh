#!/usr/bin/env bash
# Build the jArchi plug-in from source against the locally downloaded Archi 5.6.
#
# The publicly available jArchi artifact targets a newer Archi (>= 5.8), so for
# Archi 5.6 we build tag v1.11.0 ourselves. Requires: git, maven, network.
#
# Output: vendor/plugins/com.archimatetool.script*.jar
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JARCHI_VERSION="${JARCHI_VERSION:-v1.11.0}"
JARCHI_REPO="${JARCHI_REPO:-https://github.com/archimatetool/archi-scripting-plugin.git}"

VENDOR="$ROOT/vendor"
ARCHI_DIR="$VENDOR/archi"
PLUGINS_DIR="$VENDOR/plugins"
BUILD_DIR="$ROOT/build/plugins"
WORK="$BUILD_DIR/.work"
P2REPO="$WORK/archi-p2repo"
JARCHI_SRC="$WORK/jarchi-src"

if [ ! -x "$ARCHI_DIR/Archi" ]; then
  echo "Archi not found at $ARCHI_DIR. Run scripts/fetch-archi.sh first." >&2
  exit 1
fi
command -v mvn >/dev/null 2>&1 || { echo "maven (mvn) is required" >&2; exit 1; }

mkdir -p "$PLUGINS_DIR" "$WORK"

# 1. Publish the Archi install as a p2 repository (used as Tycho target platform).
echo "==> publishing Archi p2 repository"
launcher="$(ls "$ARCHI_DIR"/plugins/org.eclipse.equinox.launcher_*.jar | head -1)"
rm -rf "$P2REPO"
"$ARCHI_DIR/jre/bin/java" -jar "$launcher" \
  -application org.eclipse.equinox.p2.publisher.FeaturesAndBundlesPublisher \
  -metadataRepository "file:$P2REPO" \
  -artifactRepository "file:$P2REPO" \
  -source "$ARCHI_DIR" \
  -publishArtifacts -compress

# 2. Fetch jArchi sources.
echo "==> cloning jArchi $JARCHI_VERSION"
rm -rf "$JARCHI_SRC"
git clone --depth 1 --branch "$JARCHI_VERSION" "$JARCHI_REPO" "$JARCHI_SRC"

# 3. Stage modules with our Tycho poms.
rm -rf "$BUILD_DIR/jarchi"
mkdir -p "$BUILD_DIR/jarchi"
for module in com.archimatetool.script com.archimatetool.script.commandline; do
  cp -a "$JARCHI_SRC/$module" "$BUILD_DIR/jarchi/$module"
  rm -rf "$BUILD_DIR/jarchi/$module/.git"
  cp "$BUILD_DIR/poms/$module.pom.xml" "$BUILD_DIR/jarchi/$module/pom.xml"
done

# 4. Build.
echo "==> maven/tycho build"
mvn -B -f "$BUILD_DIR/pom.xml" clean package -DskipTests -Darchi.p2repo="$P2REPO"

# 5. Publish artifacts.
find "$BUILD_DIR/jarchi" -path '*/target/*.jar' ! -name '*sources*' -exec cp -f {} "$PLUGINS_DIR"/ \;
echo "==> jArchi artifacts:"
ls -1 "$PLUGINS_DIR" | grep com.archimatetool.script || true
