#!/bin/bash
# Bundle src/ into the single self-contained index.html.
set -e
cd "$(dirname "$0")"
cat src/imports.js src/app.src.js > .build-app.js
npx esbuild .build-app.js --bundle --format=iife --minify --target=es2020 \
  --outfile=.build-bundle.js --log-level=warning
{
  cat src/shell_head.html
  printf '<script>\n'
  cat .build-bundle.js
  printf '</script>\n'
  cat src/shell_tail.html
} > index.html
rm -f .build-app.js .build-bundle.js
wc -c index.html
