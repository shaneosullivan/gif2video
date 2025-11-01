/**
 * WebCodecs utility module for browser-based video optimization
 * This module uses the WebCodecs API available in modern browsers
 *
 * NOTE: Chrome's WebCodecs H.264 encoder has a bug that generates incorrect
 * video dimensions. We now use h264-mp4-encoder (WASM) instead.
 */

export interface WebCodecsInfo {
  available: boolean;
  error?: string;
}

export interface WasmEncoderInfo {
  available: boolean;
  error?: string;
}

/**
 * Check if WebCodecs API is available in the browser
 */
export function checkWebCodecs(): WebCodecsInfo {
  if (typeof window === 'undefined') {
    return { available: false, error: 'Not in browser environment' };
  }

  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') {
    return { available: false, error: 'WebCodecs API not supported in this browser' };
  }

  return { available: true };
}

/**
 * Encode raw RGBA frames to optimized MP4 using WebCodecs API + WASM muxer
 */
export async function encodeFramesWithWebCodecs(
  frames: Array<{
    data: Uint8Array;
    width: number;
    height: number;
    delay: number;
  }>,
  options: {
    bitrate?: number; // Target bitrate in bits per second (default: 2000000)
  } = {},
): Promise<Uint8Array> {
  const { bitrate = 2000000 } = options;

  // Check if WebCodecs is available
  const webCodecsInfo = checkWebCodecs();
  if (!webCodecsInfo.available) {
    throw new Error(
      'WebCodecs API is not available. ' +
        'Please use a modern browser (Chrome 94+, Edge 94+, Firefox 133+) or use Node.js with ffmpeg.',
    );
  }

  if (frames.length === 0) {
    throw new Error('No frames provided');
  }

  const firstFrame = frames[0];
  let { width, height } = firstFrame;

  // Ensure dimensions are even (required for H.264)
  const evenWidth = Math.floor(width / 2) * 2;
  const evenHeight = Math.floor(height / 2) * 2;

  // Load WASM module for MP4 muxing
  const scriptUrl = new URL(import.meta.url);
  const wasmUrl = new URL('../converter/wasm/gif2video-web.js', scriptUrl).href;
  const wasmModule = await (await import(wasmUrl).then((m) => m.default))();

  // Initialize muxer with even dimensions
  const initMuxer = wasmModule.cwrap('init_webcodecs_muxer', 'number', ['number', 'number']);
  const setDecoderConfig = wasmModule.cwrap('set_decoder_config', 'number', [
    'number',
    'number',
  ]);
  const addH264Frame = wasmModule.cwrap('add_h264_frame', 'number', [
    'number',
    'number',
    'number',
    'number',
  ]);
  const finalizeMp4 = wasmModule.cwrap('finalize_webcodecs_mp4', 'number', ['number']);
  const cleanupMuxer = wasmModule.cwrap('cleanup_webcodecs_muxer', null, []);

  if (!initMuxer(evenWidth, evenHeight)) {
    throw new Error('Failed to initialize WebCodecs muxer');
  }

  try {
    return await new Promise((resolve, reject) => {
      let frameIndex = 0;
      let processedFrames = 0;

      // Initialize VideoEncoder with H.264 compression settings
      const encoder = new VideoEncoder({
        output: (chunk: EncodedVideoChunk, metadata?: EncodedVideoChunkMetadata) => {
          // SKIP decoder config - let the muxer build its own
          // The decoder config from VideoEncoder has incorrect SPS width information
          if (metadata?.decoderConfig?.description) {
            // DO NOT pass to muxer - let muxer use fallback
          }

          // Copy encoded chunk to WASM memory
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);

          const dataPtr = wasmModule._malloc(data.length);
          wasmModule.HEAPU8.set(data, dataPtr);

          // Add frame to muxer
          const isKeyframe = chunk.type === 'key' ? 1 : 0;
          const success = addH264Frame(dataPtr, data.length, chunk.timestamp, isKeyframe);
          wasmModule._free(dataPtr);

          if (!success) {
            reject(new Error('Failed to add H.264 frame to muxer'));
            return;
          }

          processedFrames++;

          // When all frames are processed, finalize MP4
          if (processedFrames === frames.length) {
            encoder.flush().then(() => {
              encoder.close();

              // Finalize MP4
              const outSizePtr = wasmModule._malloc(4);
              const mp4DataPtr = finalizeMp4(outSizePtr);

              if (!mp4DataPtr) {
                wasmModule._free(outSizePtr);
                reject(new Error('Failed to finalize MP4'));
                return;
              }

              const mp4Size = wasmModule.getValue(outSizePtr, 'i32');
              const mp4Data = new Uint8Array(
                wasmModule.HEAPU8.buffer,
                mp4DataPtr,
                mp4Size,
              );

              // Copy to a new buffer (WASM memory will be freed)
              const result = new Uint8Array(mp4Data);

              wasmModule._free(outSizePtr);
              cleanupMuxer();

              resolve(result);
            });
          }
        },
        error: (error: Error) => {
          cleanupMuxer();
          reject(new Error(`Encoder error: ${error.message}`));
        },
      });

      // Configure encoder with H.264 settings (use even dimensions)
      encoder.configure({
        codec: 'avc1.42001E', // H.264 Baseline Profile Level 3.0
        width: evenWidth,
        height: evenHeight,
        bitrate,
        framerate: 30,
        avc: { format: 'avc' }, // Explicitly request AVC format (not annexb)
        hardwareAcceleration: 'prefer-software', // Use software encoder to avoid HW bugs
      });

      // Encode all frames
      const encodeAllFrames = async () => {
        try {
          for (let i = 0; i < frames.length; i++) {
            const frame = frames[i];
            const timestamp = i * 33333; // ~30fps in microseconds

            // Crop frame data to even dimensions if needed
            let frameData = frame.data;

            if (frame.width !== evenWidth || frame.height !== evenHeight) {
              const croppedData = new Uint8Array(evenWidth * evenHeight * 4);
              for (let y = 0; y < evenHeight; y++) {
                const srcOffset = y * frame.width * 4;
                const dstOffset = y * evenWidth * 4;
                croppedData.set(
                  frameData.subarray(srcOffset, srcOffset + evenWidth * 4),
                  dstOffset,
                );
              }
              frameData = croppedData;
            }

            // Create VideoFrame from ImageBitmap for better compatibility
            const imageData = new ImageData(
              new Uint8ClampedArray(frameData),
              evenWidth,
              evenHeight
            );

            // Create ImageBitmap from ImageData
            const bitmap = await createImageBitmap(imageData, {
              resizeWidth: evenWidth,
              resizeHeight: evenHeight,
              resizeQuality: 'pixelated',
            });

            // Create VideoFrame from ImageBitmap with explicit dimensions
            const videoFrame = new VideoFrame(bitmap, {
              timestamp,
              duration: 33333, // ~30fps
            });

            // Close bitmap immediately after creating VideoFrame
            bitmap.close();

            // Encode the frame
            const keyFrame = i === 0 || i % 30 === 0; // Keyframe every 30 frames
            encoder.encode(videoFrame, { keyFrame });
            videoFrame.close();
          }
        } catch (error) {
          cleanupMuxer();
          reject(error);
        }
      };

      // Start encoding
      encodeAllFrames();
    });
  } catch (error) {
    cleanupMuxer();
    throw error;
  }
}

/**
 * Encode raw RGBA frames to MP4 using h264-mp4-encoder WASM library
 * This is a replacement for WebCodecs which has bugs in Chrome
 */
export async function encodeFramesWithWasmEncoder(
  frames: Array<{
    data: Uint8Array;
    width: number;
    height: number;
    delay: number;
  }>,
  options: {
    bitrate?: number; // Target bitrate in kbps (default: 2000)
    quantizationParameter?: number; // Quality [10..51], lower = better (default: 23)
  } = {},
): Promise<Uint8Array> {
  const { bitrate = 2000, quantizationParameter = 23 } = options;

  if (frames.length === 0) {
    throw new Error('No frames provided');
  }

  const firstFrame = frames[0];
  let { width, height } = firstFrame;

  // Calculate average frame rate from GIF delays
  // Frame delay is already in milliseconds (converted by gif-decoder)
  const totalDelay = frames.reduce((sum, frame) => sum + frame.delay, 0);
  const avgDelayMs = totalDelay / frames.length; // Average delay in milliseconds
  const frameRate = avgDelayMs > 0 ? Math.round(1000 / avgDelayMs) : 30;

  // Ensure dimensions are even (required for H.264)
  const evenWidth = Math.floor(width / 2) * 2;
  const evenHeight = Math.floor(height / 2) * 2;

  // Access h264-mp4-encoder from global window.HME (loaded as script tag)
  // The library is loaded as a script tag in test-browser.html
  if (typeof window === 'undefined' || !(window as any).HME) {
    throw new Error(
      'h264-mp4-encoder not loaded. ' +
        'Make sure to include the script tag: ' +
        '<script src="path/to/h264-mp4-encoder.web.js"></script>',
    );
  }

  const HME = (window as any).HME;
  const encoder = await HME.createH264MP4Encoder();

  try {
    // Configure encoder
    encoder.width = evenWidth;
    encoder.height = evenHeight;
    encoder.frameRate = frameRate; // Use calculated frame rate from GIF delays
    encoder.kbps = bitrate;
    encoder.quantizationParameter = quantizationParameter;
    encoder.speed = 5; // Balance between quality and speed
    encoder.groupOfPictures = Math.max(1, Math.floor(frameRate)); // Keyframe based on frame rate
    encoder.outputFilename = 'output.mp4';
    encoder.debug = false;

    encoder.initialize();

    // Encode frames with proper timing
    // h264-mp4-encoder doesn't support variable frame timing, so we need to
    // duplicate frames to match the GIF delays
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      let frameData = frame.data;

      // Crop frame data to even dimensions if needed
      if (frame.width !== evenWidth || frame.height !== evenHeight) {
        const croppedData = new Uint8Array(evenWidth * evenHeight * 4);
        for (let y = 0; y < evenHeight; y++) {
          const srcOffset = y * frame.width * 4;
          const dstOffset = y * evenWidth * 4;
          croppedData.set(
            frameData.subarray(srcOffset, srcOffset + evenWidth * 4),
            dstOffset,
          );
        }
        frameData = croppedData;
      }

      // Calculate how many times to repeat this frame based on its delay
      // delay is already in milliseconds, frameRate is fps
      const frameDelayMs = frame.delay;
      const msPerFrame = 1000 / frameRate;
      const repeatCount = Math.max(1, Math.round(frameDelayMs / msPerFrame));

      // Add frame multiple times to achieve the correct timing
      for (let repeat = 0; repeat < repeatCount; repeat++) {
        encoder.addFrameRgba(frameData);
      }
    }

    // Finalize encoding
    encoder.finalize();

    // Read the output MP4 file
    const uint8Array = encoder.FS.readFile(encoder.outputFilename);

    return uint8Array;
  } finally {
    // Clean up encoder resources
    encoder.delete();
  }
}

/**
 * Check if optimization is available in current environment
 */
export function isOptimizationAvailable(): {
  ffmpeg: boolean;
  webcodecs: boolean;
  wasmEncoder: boolean;
  method: 'ffmpeg' | 'wasm-encoder' | 'webcodecs' | 'none';
} {
  const inBrowser = typeof window !== 'undefined';
  const webcodecs = checkWebCodecs().available;
  const wasmEncoder = inBrowser; // WASM encoder available in browser
  const ffmpeg = !inBrowser; // ffmpeg only available in Node.js

  let method: 'ffmpeg' | 'wasm-encoder' | 'webcodecs' | 'none' = 'none';
  if (ffmpeg) {
    method = 'ffmpeg';
  } else if (wasmEncoder) {
    method = 'wasm-encoder'; // Prefer WASM encoder over buggy WebCodecs
  } else if (webcodecs) {
    method = 'webcodecs';
  }

  return { ffmpeg, webcodecs, wasmEncoder, method };
}
