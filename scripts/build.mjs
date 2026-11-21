// Bundles the AI module (with the Anthropic SDK) and copies KaTeX into extension/.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

await build({
  entryPoints: ['src/ai.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome110',
  outfile: 'extension/lib/ai.bundle.js',
  legalComments: 'eof',
  minify: true,
});

const katex = 'node_modules/katex/dist';
const out = 'extension/vendor/katex';
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/contrib`, { recursive: true });
cpSync(`${katex}/katex.min.js`, `${out}/katex.min.js`);
cpSync(`${katex}/katex.min.css`, `${out}/katex.min.css`);
cpSync(`${katex}/contrib/auto-render.min.js`, `${out}/contrib/auto-render.min.js`);
cpSync(`${katex}/fonts`, `${out}/fonts`, { recursive: true });
cpSync('node_modules/katex/LICENSE', `${out}/LICENSE`);
console.log('Built extension/lib/ai.bundle.js and copied KaTeX.');
