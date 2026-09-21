#!/usr/bin/env bash
# Downloads the public-domain USFX sources from eBible.org into data/sources/.
set -euo pipefail
cd "$(dirname "$0")/.."

fetch() {
  local id="$1" dest="data/sources/$1"
  if [ -f "$dest/$1_usfx.xml" ]; then echo "$id: already present"; return; fi
  mkdir -p "$dest"
  curl -fsSL "https://ebible.org/Scriptures/${id}_usfx.zip" -o "$dest/src.zip"
  unzip -q -o "$dest/src.zip" -d "$dest"
  rm "$dest/src.zip"
  echo "$id: downloaded"
}

fetch eng-kjv2006
# The modern World English Bible is only used to find archaic KJV words: `npm run data:fetch -- web`.
[ "${1:-}" = "web" ] && fetch eng-web
true
