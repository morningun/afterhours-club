#!/bin/bash
# Bundle src/app.src.js (ESM entry, resolves ./core/* + three) into single index.html.
set -e
cd "$(dirname "$0")"
npx esbuild src/app.src.js --bundle --format=iife --minify --target=es2020 \
  --outfile=.build-bundle.js --log-level=warning
node --check .build-bundle.js
{
  cat src/shell_head.html
  printf '<script>\n'
  cat .build-bundle.js
  printf '</script>\n'
  cat src/shell_tail.html
} > index.html
rm -f .build-bundle.js
wc -c index.html
