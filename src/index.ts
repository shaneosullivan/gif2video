import { decodeGif } from './gif-decoder.js';

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
 * Get WASM module path for current environment
 */
async function getWasmModulePath(): Promise<string> {
  if (typeof window === 'undefined') {
    // Node.js environment - use node-specific build
    const { join } = await import('node:path');
    return join(import.meta.dirname, '../converter/wasm/gif2video-node.js');
  } else {
    // Browser environment - use web-specific build
    const scriptUrl = new URL(import.meta.url);
    return new URL('../../converter/wasm/gif2video-web.js', scriptUrl).href;
  }
}

/**
 * Resolve the output path, handling both file and directory destinations
 * Only available in Node.js
 */
async function resolveOutputPath(
  inputPath: string,
  outputPath: string,
): Promise<string> {
  const { stat } = await import('node:fs/promises');
  const { basename, extname, join } = await import('node:path');

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
 * Optimize MP4 buffer - uses ffmpeg in Node.js or WASM H.264 encoder in browser
 */
async function optimizeMP4Buffer(
  mp4Buffer: Buffer | Uint8Array,
  frames?: Array<{ data: Uint8Array; delay: number; height: number; width: number }>,
): Promise<Buffer | Uint8Array> {
  const inBrowser = typeof window !== 'undefined';

  if (inBrowser) {
    // Use WASM H.264 encoder in browser (replaces buggy WebCodecs)
    const { encodeFramesWithWasmEncoder } = await import('./webcodecs.js');

    if (!frames || frames.length === 0) {
      throw new Error(
        'Browser optimization requires raw frames. ' +
          'This is an internal error - please report this issue.',
      );
    }

    // Encode frames with WASM H.264 encoder
    return encodeFramesWithWasmEncoder(frames);
  } else {
    // Use ffmpeg in Node.js
    const { optimizeMP4 } = await import('./ffmpeg.js');
    return optimizeMP4(mp4Buffer instanceof Uint8Array ? Buffer.from(mp4Buffer) : mp4Buffer);
  }
}

/**
 * Core function: Encode frames to MP4 buffer
 */
async function encodeFramesToMp4(
  frames: Array<{ data: Uint8Array; delay: number; height: number; width: number }>,
  width: number,
  height: number,
  fps: number = 10,
): Promise<Buffer | Uint8Array> {
  // Load WASM module
  const wasmPath = await getWasmModulePath();
  const createModule = await import(wasmPath).then((m) => m.default);
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

    // Return Buffer in Node.js, Uint8Array in browser
    if (typeof Buffer !== 'undefined' && typeof window === 'undefined') {
      return Buffer.from(videoData);
    }
    return new Uint8Array(videoData);
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
): Promise<Buffer | Uint8Array> {
  if (!frames || frames.length === 0) {
    throw new Error('No frames provided');
  }

  const { fps = 10 } = options;
  const firstFrame = frames[0];
  const width = options.width || firstFrame.data.width;
  const height = options.height || firstFrame.data.height;

  // Convert FrameInput to internal frame format
  const internalFrames = frames.map((frame) => {
    let data: Uint8Array;
    if (frame.data.data instanceof Uint8Array) {
      data = frame.data.data;
    } else if (typeof Buffer !== 'undefined' && frame.data.data instanceof Buffer) {
      data = new Uint8Array(frame.data.data);
    } else {
      data = new Uint8Array(frame.data.data);
    }

    return {
      data,
      delay: frame.delayMs,
      height: frame.data.height,
      width: frame.data.width,
    };
  });

  let mp4Buffer = await encodeFramesToMp4(internalFrames, width, height, fps);

  // Always optimize with best available method
  try {
    const optimized = await optimizeMP4Buffer(mp4Buffer, internalFrames);
    mp4Buffer = optimized;
  } catch (error) {
    // If optimization fails, continue with unoptimized buffer
    console.warn('Optimization failed, using unoptimized output:', (error as Error).message);
  }

  // Return appropriate type based on environment
  if (typeof Buffer !== 'undefined' && typeof window === 'undefined') {
    return mp4Buffer instanceof Buffer ? mp4Buffer : Buffer.from(mp4Buffer);
  }
  return mp4Buffer instanceof Uint8Array ? mp4Buffer : new Uint8Array(mp4Buffer);
}

/**
 * Convert a GIF buffer to MP4 buffer
 */
export async function convertGifBuffer(
  gifBuffer: Buffer | Uint8Array,
  options: ConversionOptions = {},
): Promise<Buffer | Uint8Array> {
  const { fps = 10 } = options;

  // Decode GIF using browser-compatible decoder
  const { frames, height, width } = decodeGif(gifBuffer);

  // Convert to internal frame format
  const internalFrames = frames.map((frame) => ({
    data: frame.data,
    delay: frame.delay,
    height: frame.height,
    width: frame.width,
  }));

  let mp4Buffer = await encodeFramesToMp4(internalFrames, width, height, fps);

  // Always optimize with best available method
  try {
    const optimized = await optimizeMP4Buffer(mp4Buffer, internalFrames);
    mp4Buffer = optimized;
  } catch (error) {
    // If optimization fails, continue with unoptimized buffer
    console.warn('Optimization failed, using unoptimized output:', (error as Error).message);
  }

  // Return appropriate type based on environment
  if (typeof Buffer !== 'undefined' && typeof window === 'undefined') {
    return mp4Buffer instanceof Buffer ? mp4Buffer : Buffer.from(mp4Buffer);
  }
  return mp4Buffer instanceof Uint8Array ? mp4Buffer : new Uint8Array(mp4Buffer);
}

/**
 * Convert a GIF file to MP4 file
 * Only available in Node.js
 */
export async function convertFile(
  inputPath: string,
  outputPath: string,
  options: ConversionOptions = {},
): Promise<string> {
  if (typeof window !== 'undefined') {
    throw new Error('convertFile() is only available in Node.js. Use convertGifBuffer() in the browser.');
  }

  const { readFile, writeFile } = await import('node:fs/promises');

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
