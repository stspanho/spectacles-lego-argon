#!/bin/sh
# Copy the Lens Studio project into lens/ (no caches, locks or per-machine folders) and scrub the backend
# ACCESS_TOKEN that the Inspector stores in the scene file. Runs automatically from the pre-commit hook.
set -e
cd "$(dirname "$0")/.."
SRC="${LENS_SRC:-$HOME/lens-studio/spectacles-lego-argon/spectacles-lego-argon}"
[ -d "$SRC/Assets" ] || { echo "lens project not found at $SRC (set LENS_SRC)"; exit 1; }
rsync -a --delete \
  --exclude Cache/ --exclude '*.lock' --exclude Support/ --exclude PluginsUserPreferences/ \
  --exclude Workspaces/ --exclude .virtual-scene.json --exclude .DS_Store \
  "$SRC/" lens/
sed -E 's/^([[:space:]]*accessToken: ).*$/\1""/' lens/Assets/Scene.scene > lens/Assets/Scene.scene.tmp
mv lens/Assets/Scene.scene.tmp lens/Assets/Scene.scene
echo "lens/ synced from $SRC (accessToken scrubbed)"
