/**
 * Standalone Browser Bundle Builder for gif2video
 *
 * This script creates a self-contained, non-module browser bundle that can be
 * loaded with a simple <script> tag. This is different from the ES module build
 * (esbuild.browser.mjs) which requires a build tool to resolve imports.
 *
 * ## Why Two Browser Builds?
 *
 * 1. **ES Module Build** (lib/browser/index.js)
 *    - For developers using modern build tools (webpack, vite, rollup, etc.)
 *    - Requires separate loading of h264-mp4-encoder
 *    - Smaller file size, tree-shakeable
 *    - Usage: import { convertGifBuffer } from 'gif2video'
 *
 * 2. **Standalone Build** (lib/browser/gif2video.standalone.js) - THIS FILE
 *    - For simple HTML pages with no build step
 *    - Single file with ALL dependencies bundled (including h264-mp4-encoder)
 *    - Larger file size, but zero external dependencies
 *    - Usage: <script src="..."></script> then window.gif2video.convertGifBuffer()
 *
 * ## How This Build Works
 *
 * 1. **Bundle with IIFE format**: Creates a self-executing function that doesn't
 *    require ES module support. Sets globalName to 'gif2videoModule'.
 *
 * 2. **Stub Node.js imports**: Replaces node:path, node:fs, etc. with empty stubs
 *    since browser code doesn't need them.
 *
 * 3. **Embed h264-mp4-encoder**: Prepends the h264-mp4-encoder library code so
 *    developers don't need to load it separately. This library MUST be loaded as
 *    a non-module script because it sets window.HME (global variable).
 *
 * 4. **Handle import.meta.url**: The source code uses import.meta.url to calculate
 *    WASM file paths. Since IIFE format doesn't support import.meta, we:
 *    - Capture document.currentScript.src at load time
 *    - Replace all import.meta.url references with our captured URL
 *    - This allows the WASM loader to calculate the correct relative path
 *
 * 5. **Expose on window**: Makes the module globally accessible as window.gif2video
 *
 * ## Technical Challenges Solved
 *
 * - **import.meta in IIFE**: esbuild transforms import.meta to import_meta (and
 *   import_meta2, etc.) in the bundle, so we need regex replacements for all variants.
 *
 * - **document.currentScript timing**: Must capture the script URL immediately when
 *   the script loads, because document.currentScript becomes null after execution.
 *
 * - **h264-mp4-encoder compatibility**: This library expects to run in global scope
 *   and cannot be bundled as an ES module. It must be prepended as-is.
 *
 * ## Output Structure
 *
 * The final standalone bundle has this order:
 * 1. h264-mp4-encoder library code (sets window.HME)
 * 2. Script URL capture (var __gif2videoScriptUrl = ...)
 * 3. gif2video IIFE bundle (uses __gif2videoScriptUrl for WASM paths)
 * 4. Window exposure (window.gif2video = gif2videoModule)
 */

import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import * as esbuild from 'esbuild';

// Ensure the browser output directory exists
try {
  mkdirSync('lib/browser', { recursive: true });
} catch {}

// ============================================================================
// STEP 1: Bundle the gif2video code with IIFE format
// ============================================================================
// IIFE (Immediately Invoked Function Expression) creates a self-contained
// bundle that doesn't pollute the global scope and doesn't require ES modules.
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  platform: 'browser',
  globalName: 'gif2videoModule',
  outfile: 'lib/browser/gif2video.temp.js',
  plugins: [
    {
      name: 'ignore-node-modules',
      setup(build) {
        // Stub out node: imports for browser
        // These are only used in Node.js code paths that won't execute in browsers
        build.onResolve({ filter: /^node:/ }, (args) => {
          return { path: args.path, namespace: 'node-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'node-stub' }, () => {
          return {
            contents: `
            export default {};
            export const join = () => {};
            export const dirname = () => {};
            export const exec = () => {};
            export const promisify = () => {};
            export const writeFile = () => {};
            export const unlink = () => {};
            export const tmpdir = () => {};
          `,
            loader: 'js',
          };
        });
      },
    },
  ],
});

// ============================================================================
// STEP 2: Read and embed the h264-mp4-encoder library
// ============================================================================
// This library provides H.264 video encoding via WebCodecs API.
// It MUST be loaded as a non-module script because it sets window.HME.
const h264Encoder = readFileSync(
  'node_modules/h264-mp4-encoder/embuild/dist/h264-mp4-encoder.web.js',
  'utf-8',
);

// ============================================================================
// STEP 3: Process the bundled code to fix import.meta references
// ============================================================================
// Since IIFE format doesn't support import.meta, we need to replace these
// references with runtime-captured values.

let gif2videoBundle = readFileSync('lib/browser/gif2video.temp.js', 'utf-8');

// Replace import.meta.dirname with empty string (not used in browser)
// Note: esbuild transforms import.meta to import_meta, so we handle both patterns
gif2videoBundle = gif2videoBundle.replace(/import\.meta\.dirname/g, '""');
gif2videoBundle = gif2videoBundle.replace(/import_meta\.dirname/g, '""');

// Replace import.meta.url with __gif2videoScriptUrl variable
// This variable will be defined at runtime to capture the actual script location
// Note: esbuild may create import_meta, import_meta2, etc. for different scopes
gif2videoBundle = gif2videoBundle.replace(
  /import\.meta\.url/g,
  '__gif2videoScriptUrl',
);
gif2videoBundle = gif2videoBundle.replace(
  /import_meta\.url/g,
  '__gif2videoScriptUrl',
);
gif2videoBundle = gif2videoBundle.replace(
  /import_meta2\.url/g,
  '__gif2videoScriptUrl',
);

// ============================================================================
// STEP 4: Create wrapper code for runtime initialization
// ============================================================================
// Wrapper #1: Capture the script URL at load time
// This MUST come before the bundle because the bundle needs this variable
// document.currentScript is only available synchronously during script execution
const scriptUrlCapture = `
// Capture the script URL immediately while document.currentScript is still available
// This is used by the WASM loader to calculate relative paths to wasm files
var __gif2videoScriptUrl = (document.currentScript && document.currentScript.src) || location.href;
`;

// Wrapper #2: Expose the module to window
// This comes AFTER the bundle because gif2videoModule is defined by the IIFE
const moduleExposer = `
// Expose the IIFE module directly on window for global access
// Developers can now use: window.gif2video.convertGifBuffer()
window.gif2video = gif2videoModule;
`;

// ============================================================================
// STEP 5: Combine everything into the final standalone bundle
// ============================================================================
// The order is critical:
//   1. h264-encoder: Sets up window.HME for video encoding
//   2. scriptUrlCapture: Defines __gif2videoScriptUrl variable
//   3. gif2videoBundle: The IIFE that uses __gif2videoScriptUrl
//   4. moduleExposer: Exposes gif2videoModule as window.gif2video
const standaloneBundle = `${h264Encoder}

${scriptUrlCapture}

${gif2videoBundle}

${moduleExposer}
`;

// ============================================================================
// STEP 6: Write the final bundle and clean up
// ============================================================================
writeFileSync('lib/browser/gif2video.standalone.js', standaloneBundle);

// Clean up the temporary bundle file
try {
  unlinkSync('lib/browser/gif2video.temp.js');
} catch {}

// Success! Print usage instructions
console.log('✓ Standalone browser bundle created successfully');
console.log('  Output: lib/browser/gif2video.standalone.js');
console.log('');
console.log('  Usage in HTML:');
console.log('    <script src="lib/browser/gif2video.standalone.js"></script>');
console.log('    <script>');
console.log('      const { convertGifBuffer } = window.gif2video;');
console.log('      // Use convertGifBuffer, convertFile, or convertFrames');
console.log('    </script>');
console.log('');
console.log('  Features:');
console.log('    • Self-contained: No external dependencies required');
console.log('    • H.264 encoding: Includes h264-mp4-encoder for optimization');
console.log('    • WebCodecs support: Automatically uses browser optimization when available');
console.log('    • WASM fallback: Works even without WebCodecs support');
