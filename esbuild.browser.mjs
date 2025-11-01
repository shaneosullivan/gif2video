import * as esbuild from 'esbuild';
import { rmSync, mkdirSync } from 'node:fs';

// Clean and recreate the browser output directory
try {
  rmSync('lib/browser', { recursive: true, force: true });
} catch {}
mkdirSync('lib/browser', { recursive: true });

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  platform: 'browser',
  outfile: 'lib/browser/index.js',
  // Mark Node.js built-in modules as external so they're replaced with empty modules
  plugins: [{
    name: 'ignore-node-modules',
    setup(build) {
      // Intercept node: imports and replace with empty modules
      build.onResolve({ filter: /^node:/ }, args => {
        return { path: args.path, namespace: 'node-stub' };
      });

      build.onLoad({ filter: /.*/, namespace: 'node-stub' }, () => {
        return {
          contents: 'export default {}; export const join = () => {}; export const stat = () => {}; export const readFile = () => {}; export const writeFile = () => {}; export const unlink = () => {}; export const exec = () => {}; export const promisify = () => {}; export const tmpdir = () => {};',
          loader: 'js',
        };
      });
    },
  }],
});

console.log('✓ Browser bundle created successfully');
