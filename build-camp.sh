#!/bin/bash
# Bundle EMBERS camp prototype into single self-contained camp.html.
set -e
cd "$(dirname "$0")"
npx esbuild src/worlds/camp.js --bundle --format=iife --minify --target=es2020 \
  --outfile=.build-camp-bundle.js --log-level=warning
node --check .build-camp-bundle.js
{
  cat src/worlds/camp_head.html
  printf '<script>\n'
  cat .build-camp-bundle.js
  printf '</script>\n'
  cat src/worlds/camp_tail.html
} > camp.html
rm -f .build-camp-bundle.js
wc -c camp.html
echo "OK: camp.html ready"
