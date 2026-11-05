// Cross-platform build (Windows/macOS/Linux, no bash needed).
// usage: node build.mjs        -> index.html (club)
//        node build.mjs camp   -> camp.html  (EMBERS)
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const T = {
  club: { entry: 'src/app.src.js', head: 'src/shell_head.html', tail: 'src/shell_tail.html', out: 'index.html' },
  camp: { entry: 'src/worlds/camp.js', head: 'src/worlds/camp_head.html', tail: 'src/worlds/camp_tail.html', out: 'camp.html' },
};
const t = T[process.argv[2] || 'club'];
if (!t) { console.error('unknown target'); process.exit(1); }

const r = await build({
  entryPoints: [join(root, t.entry)], bundle: true, format: 'iife', minify: true,
  target: 'es2020', write: false, logLevel: 'warning',
});
const js = r.outputFiles[0].text;
new Function(js); // syntax check
const rd = p => readFileSync(join(root, p), 'utf8');
const html = rd(t.head) + '<script>\n' + js + '</script>\n' + rd(t.tail);
writeFileSync(join(root, t.out), html);
console.log(`OK: ${t.out} ${Buffer.byteLength(html)} bytes`);
