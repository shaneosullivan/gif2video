/**
 * Browser-compatible GIF decoder using omggif
 * This module works in both Node.js and browser environments
 */
import * as omggif from 'omggif';

const GifReader = omggif.GifReader;

export interface GifFrame {
  data: Uint8Array; // RGBA pixel data
  delay: number; // milliseconds
  width: number;
  height: number;
}

export interface DecodedGif {
  frames: GifFrame[];
  width: number;
  height: number;
}

/**
 * Decode a GIF buffer into frames
 */
export function decodeGif(
  gifBuffer: Uint8Array | ArrayBuffer | any,
): DecodedGif {
  // Convert to Uint8Array if needed
  let uint8Array: Uint8Array;
  if (gifBuffer instanceof Uint8Array) {
    uint8Array = gifBuffer;
  } else if (gifBuffer instanceof ArrayBuffer) {
    uint8Array = new Uint8Array(gifBuffer);
  } else if (typeof Buffer !== 'undefined' && gifBuffer instanceof Buffer) {
    uint8Array = new Uint8Array(gifBuffer);
  } else if (gifBuffer.buffer instanceof ArrayBuffer) {
    // Handle TypedArray views
    uint8Array = new Uint8Array(
      gifBuffer.buffer,
      gifBuffer.byteOffset,
      gifBuffer.byteLength,
    );
  } else {
    uint8Array = gifBuffer;
  }

  // Parse GIF
  const reader = new GifReader(uint8Array);
  const frames: GifFrame[] = [];

  const width = reader.width;
  const height = reader.height;
  const numFrames = reader.numFrames();

  // Decode each frame
  for (let i = 0; i < numFrames; i++) {
    const frameInfo = reader.frameInfo(i);

    // Allocate RGBA buffer for the frame
    const pixelData = new Uint8Array(width * height * 4);

    // Decode frame into RGBA buffer
    reader.decodeAndBlitFrameRGBA(i, pixelData);

    frames.push({
      data: pixelData,
      delay: (frameInfo.delay || 10) * 10, // Convert centiseconds to milliseconds
      height,
      width,
    });
  }

  return {
    frames,
    height,
    width,
  };
}
