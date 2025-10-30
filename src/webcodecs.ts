/**
 * WebCodecs utility module for browser-based video optimization
 * This module uses the WebCodecs API available in modern browsers
 */

export interface WebCodecsInfo {
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
 * Encode raw RGBA frames to optimized MP4 using WebCodecs API
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
  const { width, height } = firstFrame;

  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let frameIndex = 0;
    let processedFrames = 0;

    // Initialize VideoEncoder with H.264 compression settings
    const encoder = new VideoEncoder({
      output: (chunk: EncodedVideoChunk, metadata?: EncodedVideoChunkMetadata) => {
        // Collect encoded chunks
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        chunks.push(data);

        processedFrames++;

        // When all frames are processed, finish encoding
        if (processedFrames === frames.length) {
          encoder.flush().then(() => {
            encoder.close();

            // Concatenate all chunks into a single buffer
            const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const result = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
              result.set(chunk, offset);
              offset += chunk.length;
            }

            resolve(result);
          });
        }
      },
      error: (error: Error) => {
        reject(new Error(`Encoder error: ${error.message}`));
      },
    });

    // Configure encoder with H.264 settings
    encoder.configure({
      codec: 'avc1.42001E', // H.264 Baseline Profile
      width,
      height,
      bitrate,
      framerate: 30,
      // Ensure dimensions are even (required for H.264)
      displayWidth: Math.floor(width / 2) * 2,
      displayHeight: Math.floor(height / 2) * 2,
    });

    // Encode each frame
    const encodeNextFrame = async () => {
      if (frameIndex >= frames.length) {
        return;
      }

      const frame = frames[frameIndex];
      const timestamp = frameIndex * 33333; // ~30fps in microseconds

      try {
        // Create VideoFrame from RGBA data
        const videoFrame = new VideoFrame(frame.data, {
          format: 'RGBA',
          codedWidth: frame.width,
          codedHeight: frame.height,
          timestamp,
        });

        // Encode the frame
        const keyFrame = frameIndex === 0 || frameIndex % 30 === 0; // Keyframe every 30 frames
        encoder.encode(videoFrame, { keyFrame });
        videoFrame.close();

        frameIndex++;
        encodeNextFrame();
      } catch (error) {
        reject(error);
      }
    };

    // Start encoding
    encodeNextFrame();
  });
}

/**
 * Check if optimization is available in current environment
 */
export function isOptimizationAvailable(): {
  ffmpeg: boolean;
  webcodecs: boolean;
  method: 'ffmpeg' | 'webcodecs' | 'none';
} {
  const inBrowser = typeof window !== 'undefined';
  const webcodecs = checkWebCodecs().available;
  const ffmpeg = !inBrowser; // ffmpeg only available in Node.js

  let method: 'ffmpeg' | 'webcodecs' | 'none' = 'none';
  if (ffmpeg) {
    method = 'ffmpeg';
  } else if (webcodecs) {
    method = 'webcodecs';
  }

  return { ffmpeg, webcodecs, method };
}
