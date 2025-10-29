#!/usr/bin/env node

/**
 * Example CLI script to convert GIF to MP4
 *
 * Usage:
 *   node examples/convert.js input.gif output.mp4
 *   node examples/convert.js input.gif ./output-folder/
 *   node examples/convert.js input.gif output  # Will create output.mp4
 */
import { resolve } from 'node:path';
import { convertFile } from '../lib/index.js';

const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage: node convert.js <input.gif> <output>');
  console.error('');
  console.error('Examples:');
  console.error('  node convert.js input.gif output.mp4');
  console.error('  node convert.js input.gif ./output-folder/');
  console.error('  node convert.js input.gif output  # Creates output.mp4');
  console.error('');
  console.error('Options:');
  console.error('  --fps <number>     Frames per second (default: 10)');
  process.exit(1);
}

const inputPath = resolve(args[0]);
const outputPath = resolve(args[1]);

// Parse optional flags
const options = {};
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
  const outputFile = await convertFile(inputPath, outputPath, options);
  console.log('✓ Conversion successful!');
  console.log(`  Output file: ${outputFile}`);
} catch (error) {
  console.error('✗ Conversion failed:');
  console.error(error.message);
  process.exit(1);
}
