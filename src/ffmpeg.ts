/**
 * FFmpeg utility module for video optimization
 * This module is automatically used in Node.js environments when available
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execAsync = promisify(exec);

export interface FFmpegInfo {
  available: boolean;
  version?: string;
  error?: string;
}

/**
 * Check if ffmpeg is available on the system
 */
export async function checkFFmpeg(): Promise<FFmpegInfo> {
  try {
    const { stdout } = await execAsync('ffmpeg -version');
    const versionMatch = stdout.match(/ffmpeg version ([^\s]+)/);
    return {
      available: true,
      version: versionMatch ? versionMatch[1] : 'unknown',
    };
  } catch (error) {
    return {
      available: false,
      error: (error as Error).message,
    };
  }
}

/**
 * Print compatibility information
 */
export async function printCompatInfo(): Promise<void> {
  console.log('gif2video - Compatibility Check\n');
  console.log('Base Functionality:');
  console.log('  ✓ WASM-based MP4 encoding (no dependencies required)');
  console.log('  ✓ Works in Node.js and browsers');
  console.log('  ✓ Generates uncompressed MP4 files\n');

  console.log('Optional Dependencies:\n');

  const ffmpegInfo = await checkFFmpeg();
  if (ffmpegInfo.available) {
    console.log(`  ✓ ffmpeg: AVAILABLE (version ${ffmpegInfo.version})`);
    console.log('    - Automatically used for H.264 compression');
    console.log('    - Typical size reduction: 70-99%');
    console.log('    - Best quality and smallest file sizes');
  } else {
    console.log('  ✗ ffmpeg: NOT FOUND');
    console.log('    - Install: brew install ffmpeg (macOS)');
    console.log('    - Install: apt-get install ffmpeg (Ubuntu/Debian)');
    console.log('    - Install: choco install ffmpeg (Windows)');
    console.log('    - Without ffmpeg, files will be larger (WASM fallback)');
  }

  console.log('\nRecommendation:');
  if (ffmpegInfo.available) {
    console.log('  All features are available! Automatic optimization enabled.');
  } else {
    console.log('  Install ffmpeg to enable automatic optimization.');
    console.log('  Basic conversion still works without it (larger files).');
  }
}

/**
 * Optimize an MP4 buffer using ffmpeg
 */
export async function optimizeMP4(
  inputBuffer: Buffer,
  options: {
    crf?: number; // Constant Rate Factor (0-51, lower = better quality, default: 23)
    preset?: string; // Encoding speed preset (default: 'medium')
  } = {},
): Promise<Buffer> {
  const { crf = 23, preset = 'medium' } = options;

  // Check if ffmpeg is available
  const ffmpegInfo = await checkFFmpeg();
  if (!ffmpegInfo.available) {
    throw new Error(
      'ffmpeg is not available. Install ffmpeg to enable automatic optimization.\n' +
        'See installation instructions: https://ffmpeg.org/download.html',
    );
  }

  // Create temporary files
  const tempDir = tmpdir();
  const inputPath = join(tempDir, `gif2video-input-${Date.now()}.mp4`);
  const outputPath = join(tempDir, `gif2video-output-${Date.now()}.mp4`);

  try {
    // Write input buffer to temp file
    await writeFile(inputPath, inputBuffer);

    // Run ffmpeg optimization
    // Using H.264 with appropriate settings for small file size and good quality
    // The scale filter ensures dimensions are divisible by 2 (required for H.264)
    const ffmpegCommand = [
      'ffmpeg',
      '-i', inputPath,
      '-vf "scale=trunc(iw/2)*2:trunc(ih/2)*2"', // Ensure even dimensions
      '-c:v libx264', // H.264 codec
      `-preset ${preset}`, // Encoding speed/compression tradeoff
      `-crf ${crf}`, // Quality level (lower = better)
      '-pix_fmt yuv420p', // Pixel format for compatibility
      '-movflags +faststart', // Enable streaming/fast start
      '-y', // Overwrite output file
      outputPath,
    ].join(' ');

    await execAsync(ffmpegCommand);

    // Read optimized file
    const { readFile } = await import('node:fs/promises');
    const optimizedBuffer = await readFile(outputPath);

    return optimizedBuffer;
  } finally {
    // Clean up temporary files
    try {
      await unlink(inputPath);
    } catch {
      // Ignore cleanup errors
    }
    try {
      await unlink(outputPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Get file size reduction percentage
 */
export function getSizeReduction(originalSize: number, optimizedSize: number): string {
  const reduction = ((originalSize - optimizedSize) / originalSize) * 100;
  return reduction.toFixed(1);
}
