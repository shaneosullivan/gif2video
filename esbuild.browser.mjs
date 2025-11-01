/**
 * ES Module Browser Bundle Builder for gif2vid
 *
 * This script creates an ES module browser bundle that can be imported by
 * modern build tools (webpack, vite, rollup, etc.) or used directly in browsers
 * that support ES modules.
 *
 * ## Why Two Browser Builds?
 *
 * 1. **ES Module Build** (lib/browser/index.js) - THIS FILE
 *    - For developers using modern build tools (webpack, vite, rollup, etc.)
 *    - Supports tree-shaking for smaller final bundles
 *    - Requires build step or native ES module support
 *    - Usage: import { convertGifBuffer } from 'gif2vid'
 *    - Note: h264-mp4-encoder must be loaded separately
 *
 * 2. **Standalone Build** (lib/browser/gif2vid.standalone.js)
 *    - For simple HTML pages with no build step
 *    - Single file with ALL dependencies bundled
 *    - Usage: <script> tag then window.gif2vid.convertGifBuffer()
 *    - See: esbuild.browser.standalone.mjs
 *
 * ## How This Build Works
 *
 * 1. **Bundle with ESM format**: Creates an ES module that can be imported
 *    by other modules. Uses import/export syntax.
 *
 * 2. **Stub Node.js imports**: Replaces node:path, node:fs, etc. with empty
 *    stubs since browser code doesn't need them. The source code checks for
 *    the browser environment and only uses these in Node.js.
 *
 * 3. **Preserve import.meta**: Unlike the standalone build, ES modules support
 *    import.meta.url natively, so no special handling is needed. The browser
 *    will automatically provide the correct URL for WASM path resolution.
 *
 * 4. **External dependencies**: h264-mp4-encoder is NOT bundled here. Developers
 *    must load it separately because it requires global scope to set window.HME.
 *
 * ## Usage Examples
 *
 * ### With a build tool (webpack, vite, etc.)
 * ```javascript
 * import { convertGifBuffer } from 'gif2vid';
 *
 * // Note: You'll need to ensure h264-mp4-encoder is loaded
 * const mp4Buffer = await convertGifBuffer(gifBuffer);
 * ```
 *
 * ### Direct in browser (modern browsers with ES module support)
 * ```html
 * <!-- Load h264-mp4-encoder first (required for optimization) -->
 * <script src="node_modules/h264-mp4-encoder/embuild/dist/h264-mp4-encoder.web.js"></script>
 *
 * <!-- Import and use the module -->
 * <script type="module">
 *   import { convertGifBuffer } from './lib/browser/index.js';
 *   const mp4Buffer = await convertGifBuffer(gifBuffer);
 * </script>
 * ```
 *
 * ## Differences from Standalone Build
 *
 * | Feature                  | ES Module Build (this) | Standalone Build          |
 * |--------------------------|------------------------|---------------------------|
 * | Format                   | ESM                    | IIFE                      |
 * | Import style             | import/export          | window.gif2vid            |
 * | Build tool required      | Recommended            | No                        |
 * | h264-mp4-encoder bundled | No (external)          | Yes (embedded)            |
 * | File size                | Smaller                | Larger                    |
 * | Tree-shaking support     | Yes                    | No                        |
 * | import.meta support      | Native                 | Polyfilled                |
 */

import { mkdirSync, rmSync } from 'node:fs';
import * as esbuild from 'esbuild';

// ============================================================================
// STEP 1: Clean and recreate the browser output directory
// ============================================================================
// This ensures a clean build with no leftover files from previous builds
try {
  rmSync('lib/browser', { recursive: true, force: true });
} catch {}
mkdirSync('lib/browser', { recursive: true });

// ============================================================================
// STEP 2: Bundle the TypeScript source into an ES module
// ============================================================================
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  platform: 'browser',
  outfile: 'lib/browser/index.js',

  // Plugin to stub out Node.js built-in modules
  // The source code uses these imports but checks for the browser environment
  // before calling them, so it's safe to replace them with empty stubs
  plugins: [
    {
      name: 'ignore-node-modules',
      setup(build) {
        // Intercept node: imports and replace with empty modules
        // This prevents esbuild from trying to bundle Node.js built-ins
        build.onResolve({ filter: /^node:/ }, (args) => {
          return { path: args.path, namespace: 'node-stub' };
        });

        // Provide empty stub implementations for Node.js modules
        // These functions will never be called in browser environments
        // because the source code checks `typeof window` first
        build.onLoad({ filter: /.*/, namespace: 'node-stub' }, () => {
          return {
            contents:
              'export default {}; export const join = () => {}; export const stat = () => {}; export const readFile = () => {}; export const writeFile = () => {}; export const unlink = () => {}; export const exec = () => {}; export const promisify = () => {}; export const tmpdir = () => {};',
            loader: 'js',
          };
        });
      },
    },
  ],
});

// ============================================================================
// Build complete!
// ============================================================================
console.log('✓ ES module browser bundle created successfully');
console.log('  Output: lib/browser/index.js');
console.log('');
console.log('  Usage with build tools:');
console.log('    import { convertGifBuffer } from "gif2vid";');
console.log('');
console.log('  Usage in browser (native ES modules):');
console.log('    <script type="module">');
console.log('      import { convertGifBuffer } from "./lib/browser/index.js";');
console.log('    </script>');
console.log('');
console.log('  ⚠️  Important: h264-mp4-encoder must be loaded separately');
console.log(
  '    <script src="node_modules/h264-mp4-encoder/embuild/dist/h264-mp4-encoder.web.js"></script>',
);
console.log('');
console.log(
  '  💡 For a single-file solution, use: npm run build:browser:standalone',
);
