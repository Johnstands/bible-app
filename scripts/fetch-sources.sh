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

# Strong's Hebrew and Greek dictionaries (James Strong, 1890/1894; JSON edition by Open Scriptures, CC BY-SA).
fetch_strongs() {
  local base="https://raw.githubusercontent.com/openscriptures/strongs/master" dest="data/sources/strongs"
  mkdir -p "$dest"
  for f in greek/strongs-greek-dictionary.js hebrew/strongs-hebrew-dictionary.js; do
    if [ -f "$dest/$(basename "$f")" ]; then echo "strongs/$(basename "$f"): already present"; continue; fi
    curl -fsSL "$base/$f" -o "$dest/$(basename "$f")"
    echo "strongs/$(basename "$f"): downloaded"
  done
}

# Cross-references: OpenBible.info (CC BY), mostly from the public-domain Treasury of Scripture Knowledge.
fetch_crossrefs() {
  local dest="data/sources/crossrefs"
  if [ -f "$dest/cross_references.txt" ]; then echo "crossrefs: already present"; return; fi
  mkdir -p "$dest"
  curl -fsSL "https://a.openbible.info/data/cross-references.zip" -o "$dest/src.zip"
  unzip -q -o "$dest/src.zip" -d "$dest"
  rm "$dest/src.zip"
  echo "crossrefs: downloaded"
}

fetch eng-kjv2006
fetch_strongs
fetch_crossrefs
# The modern World English Bible is only used to find archaic KJV words: `npm run data:fetch -- web`.
[ "${1:-}" = "web" ] && fetch eng-web
true
