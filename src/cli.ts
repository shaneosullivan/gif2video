#!/usr/bin/env node

/**
 * CLI for gif2vid
 *
 * Usage:
 *   gif2vid input.gif output.mp4
 *   gif2vid input.gif ./output-folder/
 *   gif2vid input.gif output  # Will create output.mp4
 *   npx gif2vid input.gif output.mp4
 */
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { printCompatInfo } from './ffmpeg.js';
import { convertFile } from './index.js';

const args = process.argv.slice(2);

// Handle --compat flag
if (args.includes('--compat')) {
  await printCompatInfo();
  process.exit(0);
}

// Handle --help flag
if (args.length < 2 || args.includes('--help') || args.includes('-h')) {
  console.log('gif2vid - Convert GIF animations to MP4 videos');
  console.log('');
  console.log('Usage:');
  console.log('  gif2vid <input.gif> <output> [options]');
  console.log('  npx gif2vid <input.gif> <output> [options]');
  console.log('');
  console.log('Examples:');
  console.log('  gif2vid input.gif output.mp4');
  console.log('  gif2vid input.gif ./output-folder/');
  console.log('  gif2vid input.gif output  # Creates output.mp4');
  console.log('  gif2vid input.gif output.mp4 --fps 30  # Custom FPS');
  console.log('');
  console.log('Options:');
  console.log('  --fps <number>     Frames per second (default: 10)');
  console.log(
    '  --compat           Check compatibility and available features',
  );
  console.log('  --help, -h         Show this help message');
  console.log('');
  console.log('Note:');
  console.log(
    '  Output is automatically optimized with the best available method:',
  );
  console.log('  - Node.js: Uses ffmpeg (if installed)');
  console.log('  - Browser: Uses WebCodecs API (if supported)');
  console.log('  - Fallback: WASM-based encoding (always works)');
  console.log(
    '  Use --compat to check which optimization methods are available.',
  );
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

const inputPath = resolve(args[0]);
const outputPath = resolve(args[1]);

// Parse optional flags
const options: { fps?: number } = {};
const fpsIndex = args.indexOf('--fps');
if (fpsIndex !== -1 && args[fpsIndex + 1]) {
  options.fps = parseInt(args[fpsIndex + 1], 10);
}

console.log('Converting GIF to MP4...');
console.log(`Input:  ${inputPath}`);
console.log(`Output: ${outputPath}`);
if (options.fps) {
  console.log(`FPS:    ${options.fps}`);
}
console.log('');

try {
  const startTime = Date.now();
  const outputFile = await convertFile(inputPath, outputPath, options);
  const duration = Date.now() - startTime;

  // Get file size
  const stats = await stat(outputFile);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

  console.log('✓ Conversion successful!');
  console.log(`  Output file: ${outputFile}`);
  console.log(`  File size: ${sizeMB} MB`);
  console.log(`  Duration: ${(duration / 1000).toFixed(2)}s`);
} catch (error) {
  console.error('✗ Conversion failed:');
  console.error((error as Error).message);
  process.exit(1);
}
