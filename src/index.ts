import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { GifCodec } from 'gifwrap';
import { Jimp } from 'jimp';

// Import the WASM module
const wasmModulePath = join(
  import.meta.dirname,
  '../converter/wasm/gif2video.js',
);

interface WasmModule {
  _free: (ptr: number) => void;
  _malloc: (size: number) => number;
  cwrap: (
    name: string,
    returnType: string | null,
    argTypes: string[],
  ) => (...args: unknown[]) => unknown;
  getValue: (ptr: number, type: string) => number;
  HEAPU8: Uint8Array;
}

export interface ConversionOptions {
  fps?: number;
  height?: number;
  width?: number;
}

interface Frame {
  delay: number;
  image: {
    bitmap: {
      data: Buffer;
      height: number;
      width: number;
    };
  };
}

export interface FrameInput {
  data: ImageData;
  delayMs: number;
}

interface ImageData {
  data: Uint8Array | Uint8ClampedArray | Buffer;
  height: number;
  width: number;
}

/**
 * Resolve the output path, handling both file and directory destinations
 */
async function resolveOutputPath(
  inputPath: string,
  outputPath: string,
): Promise<string> {
  try {
    const stats = await stat(outputPath);
    if (stats.isDirectory()) {
      // If output is a directory, generate filename from input
      const inputBasename = basename(inputPath, extname(inputPath));
      return join(outputPath, `${inputBasename}.mp4`);
    }
    // If it's an existing file, check if it needs .mp4 extension
    if (!extname(outputPath)) {
      return `${outputPath}.mp4`;
    }
  } catch {
    // Path doesn't exist or is not accessible - treat as file path
  }

  // If output path has no extension, add .mp4
  if (!extname(outputPath)) {
    return `${outputPath}.mp4`;
  }

  return outputPath;
}

/**
 * Optimize MP4 buffer - uses ffmpeg in Node.js or WebCodecs in browser
 */
async function optimizeMP4Buffer(
  mp4Buffer: Buffer | Uint8Array,
  frames?: Array<{ data: Uint8Array; delay: number; height: number; width: number }>,
): Promise<Buffer | Uint8Array> {
  const inBrowser = typeof window !== 'undefined';

  if (inBrowser) {
    // Use WebCodecs in browser
    const { checkWebCodecs, encodeFramesWithWebCodecs } = await import('./webcodecs.js');
    const webCodecsInfo = checkWebCodecs();

    if (!webCodecsInfo.available) {
      throw new Error(
        'Optimization is not available in this browser. ' +
          'WebCodecs API requires Chrome 94+, Edge 94+, or Firefox 133+. ' +
          'Alternatively, use Node.js with ffmpeg for optimization.',
      );
    }

    if (!frames || frames.length === 0) {
      throw new Error(
        'Browser optimization requires raw frames. ' +
          'This is an internal error - please report this issue.',
      );
    }

    // Encode frames with WebCodecs
    return encodeFramesWithWebCodecs(frames);
  } else {
    // Use ffmpeg in Node.js
    const { optimizeMP4 } = await import('./ffmpeg.js');
    return optimizeMP4(mp4Buffer instanceof Uint8Array ? Buffer.from(mp4Buffer) : mp4Buffer);
  }
}

/**
 * Extract frames from a GIF file
 */
async function extractGifFrames(
  gifBuffer: Buffer,
): Promise<{ frames: Frame[]; height: number; width: number }> {
  const codec = new GifCodec();
  const gif = await codec.decodeGif(gifBuffer);
  const frames: Frame[] = [];

  // Extract all frames from the GIF
  for (const gifFrame of gif.frames) {
    // Convert GifFrame to Jimp
    const jimp = new Jimp({
      data: Buffer.from(gifFrame.bitmap.data),
      height: gifFrame.bitmap.height,
      width: gifFrame.bitmap.width,
    });

    frames.push({
      delay: gifFrame.delayCentisecs * 10, // Convert centiseconds to milliseconds
      image: jimp,
    });
  }

  return {
    frames,
    height: gif.height,
    width: gif.width,
  };
}

/**
 * Core function: Encode frames to MP4 buffer
 */
async function encodeFramesToMp4(
  frames: Array<{ data: Uint8Array; delay: number; height: number; width: number }>,
  width: number,
  height: number,
  fps: number = 10,
): Promise<Buffer> {
  // Load WASM module
  const createModule = await import(wasmModulePath).then((m) => m.default);
  const Module = (await createModule()) as WasmModule;

  // Initialize encoder
  const initEncoder = Module.cwrap('init_encoder', 'number', [
    'number',
    'number',
    'number',
  ]) as (width: number, height: number, fps: number) => number;
  const addFrame = Module.cwrap('add_frame', 'number', [
    'number',
    'number',
    'number',
    'number',
  ]) as (ptr: number, width: number, height: number, delay: number) => number;
  const getVideoSize = Module.cwrap(
    'get_video_size',
    'number',
    [],
  ) as () => number;
  const getVideoBuffer = Module.cwrap(
    'get_video_buffer',
    'number',
    [],
  ) as () => number;
  const cleanup = Module.cwrap('cleanup', null, []) as () => void;

  try {
    // Initialize the encoder
    const result = initEncoder(width, height, fps);
    if (!result) {
      throw new Error('Failed to initialize video encoder');
    }

    // Add each frame to the video
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const frameData = frame.data;

      // Allocate memory in WASM heap
      const dataPtr = Module._malloc(frameData.length);
      Module.HEAPU8.set(frameData, dataPtr);

      // Add frame to encoder with its delay
      const addResult = addFrame(dataPtr, frame.width, frame.height, frame.delay);
      Module._free(dataPtr);

      if (!addResult) {
        throw new Error(`Failed to add frame ${i}`);
      }
    }

    // Get the encoded video data
    const videoSize = getVideoSize();
    const videoBufferPtr = getVideoBuffer();

    // Copy video data from WASM memory
    const videoData = new Uint8Array(
      Module.HEAPU8.buffer,
      videoBufferPtr as number,
      videoSize as number,
    );

    return Buffer.from(videoData);
  } finally {
    // Clean up
    cleanup();
  }
}

/**
 * Convert an array of frames with ImageData to MP4 buffer
 */
export async function convertFrames(
  frames: FrameInput[],
  options: ConversionOptions = {},
): Promise<Buffer> {
  if (!frames || frames.length === 0) {
    throw new Error('No frames provided');
  }

  const { fps = 10 } = options;
  const firstFrame = frames[0];
  const width = options.width || firstFrame.data.width;
  const height = options.height || firstFrame.data.height;

  // Convert FrameInput to internal frame format
  const internalFrames = frames.map((frame) => ({
    data: frame.data.data instanceof Buffer
      ? new Uint8Array(frame.data.data)
      : new Uint8Array(frame.data.data),
    delay: frame.delayMs,
    height: frame.data.height,
    width: frame.data.width,
  }));

  let mp4Buffer = await encodeFramesToMp4(internalFrames, width, height, fps);

  // Always optimize with best available method
  try {
    const optimized = await optimizeMP4Buffer(mp4Buffer, internalFrames);
    mp4Buffer = optimized instanceof Buffer ? optimized : Buffer.from(optimized);
  } catch (error) {
    // If optimization fails, continue with unoptimized buffer
    console.warn('Optimization failed, using unoptimized output:', (error as Error).message);
  }

  return mp4Buffer;
}

/**
 * Convert a GIF buffer to MP4 buffer
 */
export async function convertGifBuffer(
  gifBuffer: Buffer,
  options: ConversionOptions = {},
): Promise<Buffer> {
  const { fps = 10 } = options;

  // Extract frames from GIF
  const { frames, height, width } = await extractGifFrames(gifBuffer);

  // Convert to internal frame format
  const internalFrames = frames.map((frame) => ({
    data: new Uint8Array(frame.image.bitmap.data),
    delay: frame.delay,
    height: frame.image.bitmap.height,
    width: frame.image.bitmap.width,
  }));

  let mp4Buffer = await encodeFramesToMp4(internalFrames, width, height, fps);

  // Always optimize with best available method
  try {
    const optimized = await optimizeMP4Buffer(mp4Buffer, internalFrames);
    mp4Buffer = optimized instanceof Buffer ? optimized : Buffer.from(optimized);
  } catch (error) {
    // If optimization fails, continue with unoptimized buffer
    console.warn('Optimization failed, using unoptimized output:', (error as Error).message);
  }

  return mp4Buffer;
}

/**
 * Convert a GIF file to MP4 file
 */
export async function convertFile(
  inputPath: string,
  outputPath: string,
  options: ConversionOptions = {},
): Promise<string> {
  // Resolve the output path (handle directories and missing extensions)
  const resolvedOutputPath = await resolveOutputPath(inputPath, outputPath);

  // Read the GIF file
  const gifBuffer = await readFile(inputPath);

  // Convert GIF buffer to MP4 buffer
  const mp4Buffer = await convertGifBuffer(gifBuffer, options);

  // Write video to output file
  await writeFile(resolvedOutputPath, mp4Buffer);

  return resolvedOutputPath;
}
