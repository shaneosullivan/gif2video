#!/usr/bin/env node

/**
 * CLI for gif2video
 *
 * Usage:
 *   gif2video input.gif output.mp4
 *   gif2video input.gif ./output-folder/
 *   gif2video input.gif output  # Will create output.mp4
 *   npx gif2video input.gif output.mp4
 */
import { resolve } from 'node:path';
import { convertFile } from './index.js';

const args = process.argv.slice(2);

if (args.length < 2 || args.includes('--help') || args.includes('-h')) {
  console.log('gif2video - Convert GIF animations to MP4 videos');
  console.log('');
  console.log('Usage:');
  console.log('  gif2video <input.gif> <output>');
  console.log('  npx gif2video <input.gif> <output>');
  console.log('');
  console.log('Examples:');
  console.log('  gif2video input.gif output.mp4');
  console.log('  gif2video input.gif ./output-folder/');
  console.log('  gif2video input.gif output  # Creates output.mp4');
  console.log('');
  console.log('Options:');
  console.log('  --fps <number>     Frames per second (default: 10)');
  console.log('  --help, -h         Show this help message');
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
  const outputFile = await convertFile(inputPath, outputPath, options);
  console.log('✓ Conversion successful!');
  console.log(`  Output file: ${outputFile}`);
} catch (error) {
  console.error('✗ Conversion failed:');
  console.error((error as Error).message);
  process.exit(1);
}
