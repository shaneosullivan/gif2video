# Gif 2 Video converter

This project uses a WASM tool from Node to convert a GIF image to a video.
The supported output formats are:

- mp4

## Installation

```bash
npm install gif2video
```

Or use directly with npx (no installation required):

```bash
npx gif2video input.gif output.mp4
```

## Usage

### Command Line Interface

You can use gif2video directly from the command line:

```bash
# Using npx (no installation required)
npx gif2video input.gif output.mp4

# Or install globally
npm install -g gif2video
gif2video input.gif output.mp4

# Convert to directory (auto-generates filename)
gif2video input.gif ./videos/

# Custom FPS
gif2video input.gif output.mp4 --fps 30

# Check compatibility and available features
gif2video --compat

# Show help
gif2video --help
```

#### Automatic Optimization

gif2video **automatically optimizes** output files using the best available method in your environment. This typically reduces file size by **70-99%** while maintaining visual quality.

**Optimization Methods:**

gif2video automatically selects the best optimization method based on your environment:

| Environment | Method | Requirements | Compression | Quality |
|-------------|--------|--------------|-------------|---------|
| **Node.js** | ffmpeg | Install ffmpeg binary | 70-99% reduction | ⭐⭐⭐ Best |
| **Browser (Chrome/Edge/Firefox)** | WebCodecs API | Chrome 94+, Edge 94+, Firefox 133+ | 70-95% reduction | ⭐⭐⭐ Excellent |
| **Browser (Safari)** | WebCodecs API | Safari 16.4+ (H.264 only) | 70-95% reduction | ⭐⭐ Good (some limitations) |
| **Fallback** | WASM only | No requirements (always works) | No compression | ⭐ Large files |

**Node.js - Install ffmpeg:**
```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt-get install ffmpeg

# Windows
choco install ffmpeg

# Check compatibility
gif2video --compat
```

**Browser - WebCodecs Support:**
- ✅ **Chrome/Edge 94+** - Full support, all codecs
- ✅ **Firefox 133+** - Full support (Desktop only, mobile not yet available)
- ⚠️ **Safari 16.4+** - Partial support with limitations:
  - ✅ H.264/AVC encoding works (used by this library)
  - ✅ VideoEncoder/VideoDecoder available
  - ⚠️ Audio encoding only in Safari 26+ (not needed for GIF conversion)
  - ⚠️ May have platform-specific issues on older iOS versions
  - **Recommendation**: Works for gif2video, but ffmpeg (Node.js) is more reliable
- ❌ **Firefox Mobile** - Not yet supported

**Size comparison example:**
- Unoptimized (WASM fallback): 5.5 MB
- Optimized (ffmpeg): 44 KB (99% reduction)
- Optimized (WebCodecs Chrome/Firefox): ~100-200 KB (95-98% reduction)
- Optimized (WebCodecs Safari): ~100-200 KB (95-98% reduction, may vary)

**Safari Users - Troubleshooting:**

If WebCodecs optimization fails in Safari, the library will automatically fall back to WASM encoding. You'll see a warning in the console:
```
Optimization failed, using unoptimized output: [error details]
```

This is normal and the conversion will still work, just with larger file sizes. For production use with Safari users, consider:
- Using Node.js server-side conversion with ffmpeg for best results
- Testing on your target Safari/iOS versions
- Checking browser console for WebCodecs availability

### Programmatic API

The library exports three functions for different use cases:

### 1. Convert File to File

Convert a GIF file directly to an MP4 file:

```typescript
import { convertFile } from 'gif2video';

// Convert a GIF to MP4 (returns the output file path)
const outputPath = await convertFile('./input.gif', './output.mp4');
console.log(`Created: ${outputPath}`);
```

#### Output Path Options

The converter intelligently handles different output path formats:

```typescript
// 1. Explicit file path
await convertFile('./input.gif', './output.mp4');
// Output: ./output.mp4

// 2. Directory path (auto-generates filename)
await convertFile('./input.gif', './videos/');
// Output: ./videos/input.mp4

// 3. Path without extension (adds .mp4)
await convertFile('./input.gif', './output');
// Output: ./output.mp4
```

### 2. Convert GIF Buffer to MP4 Buffer

Work with GIF data in memory and get MP4 data back:

```typescript
import { readFile, writeFile } from 'fs/promises';
import { convertGifBuffer } from 'gif2video';

// Read GIF from anywhere (file, network, database, etc.)
const gifBuffer = await readFile('./animation.gif');

// Convert to MP4 buffer
const mp4Buffer = await convertGifBuffer(gifBuffer);

// Do whatever you want with the MP4 buffer
await writeFile('./output.mp4', mp4Buffer);

// Or send it over HTTP
response.setHeader('Content-Type', 'video/mp4');
response.send(mp4Buffer);
```

### 3. Convert Custom Frames to MP4 Buffer

Create MP4 videos from any image data source:

```typescript
import { convertFrames, type FrameInput } from 'gif2video';

// Create frames from any source (canvas, image processing, generated graphics, etc.)
const frames: FrameInput[] = [
  {
    data: {
      data: rgbaPixelData1, // Uint8Array, Uint8ClampedArray, or Buffer (RGBA format)
      width: 400,
      height: 300,
    },
    delayMs: 100, // Display for 100ms
  },
  {
    data: {
      data: rgbaPixelData2,
      width: 400,
      height: 300,
    },
    delayMs: 150, // Display for 150ms
  },
  // ... more frames
];

const mp4Buffer = await convertFrames(frames);
await writeFile('./custom.mp4', mp4Buffer);
```

### Custom Options

All three functions accept an options object:

```typescript
// Custom frames per second
await convertFile('./input.gif', './output.mp4', {
  fps: 30, // Higher FPS for smoother video (default: 10)
});

// Custom dimensions (will resize frames)
await convertGifBuffer(gifBuffer, {
  width: 640,
  height: 480,
});

// Combine options
await convertFrames(frames, {
  fps: 24,
  width: 1920,
  height: 1080,
});
```

**Note:** Optimization is automatic - all outputs are automatically compressed using the best available method (ffmpeg, WebCodecs, or WASM fallback).

### CLI Usage

You can also use the example CLI script:

```bash
# Convert with specific output file
node examples/convert.js input.gif output.mp4

# Convert to directory (auto-generates filename)
node examples/convert.js input.gif ./videos/

# Convert with custom FPS
node examples/convert.js input.gif output.mp4 --fps 30
```

### Real-World Examples

#### Example 1: Browser - Convert GIF to Optimized MP4

```html
<!DOCTYPE html>
<html>
<head>
    <title>GIF to MP4 Converter</title>
</head>
<body>
    <input type="file" id="gifInput" accept="image/gif">
    <button onclick="convert()">Convert to MP4</button>
    <video id="output" controls></video>

    <script type="module">
        import { convertGifBuffer } from 'https://unpkg.com/gif2video/lib/index.js';

        window.convert = async function() {
            const file = document.getElementById('gifInput').files[0];
            if (!file) return;

            // Read GIF file
            const arrayBuffer = await file.arrayBuffer();
            const gifBuffer = new Uint8Array(arrayBuffer);

            // Convert (automatically optimized with WebCodecs in browser)
            const mp4Buffer = await convertGifBuffer(gifBuffer);

            // Display result
            const blob = new Blob([mp4Buffer], { type: 'video/mp4' });
            const url = URL.createObjectURL(blob);
            document.getElementById('output').src = url;
        };
    </script>
</body>
</html>
```

#### Example 2: Batch Processing Multiple GIFs (Node.js)

```typescript
import { readdir } from 'fs/promises';
import { convertFile } from 'gif2video';

// Convert all GIFs in a directory
const gifFiles = await readdir('./gifs');

for (const file of gifFiles) {
  if (file.endsWith('.gif')) {
    const output = await convertFile(`./gifs/${file}`, './videos/');
    console.log(`✓ Converted: ${output}`);
  }
}
```

#### Example 3: HTTP API Endpoint

```typescript
import express from 'express';
import { convertGifBuffer } from 'gif2video';

const app = express();

app.post(
  '/convert',
  express.raw({ type: 'image/gif', limit: '10mb' }),
  async (req, res) => {
    try {
      const mp4Buffer = await convertGifBuffer(req.body);
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="converted.mp4"',
      );
      res.send(mp4Buffer);
    } catch (error) {
      res.status(500).json({ error: 'Conversion failed' });
    }
  },
);
```

#### Example 4: Generate Video from Canvas Frames

```typescript
import { createCanvas } from 'canvas';
import { convertFrames, type FrameInput } from 'gif2video';

const width = 400;
const height = 300;
const canvas = createCanvas(width, height);
const ctx = canvas.getContext('2d');

const frames: FrameInput[] = [];

// Generate 60 frames of animation
for (let i = 0; i < 60; i++) {
  // Draw animation frame
  ctx.fillStyle = `hsl(${i * 6}, 70%, 50%)`;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'white';
  ctx.font = '48px Arial';
  ctx.fillText(`Frame ${i}`, 150, 150);

  // Get pixel data
  const imageData = ctx.getImageData(0, 0, width, height);

  frames.push({
    data: {
      data: imageData.data, // Uint8ClampedArray
      width,
      height,
    },
    delayMs: 33, // ~30fps
  });
}

const mp4Buffer = await convertFrames(frames);
await writeFile('./generated.mp4', mp4Buffer);
```

#### Example 5: Process GIF from URL

```typescript
import { writeFile } from 'fs/promises';
import { convertGifBuffer } from 'gif2video';

// Fetch GIF from URL
const response = await fetch('https://example.com/animation.gif');
const arrayBuffer = await response.arrayBuffer();
const gifBuffer = Buffer.from(arrayBuffer);

// Convert to MP4
const mp4Buffer = await convertGifBuffer(gifBuffer);

// Save locally
await writeFile('./downloaded.mp4', mp4Buffer);
```

#### Example 6: Stream Processing with Progress

```typescript
import { readdir } from 'fs/promises';
import path from 'path';
import { convertFile } from 'gif2video';

async function convertWithProgress(inputDir: string, outputDir: string) {
  const files = await readdir(inputDir);
  const gifFiles = files.filter((f) => f.endsWith('.gif'));

  console.log(`Found ${gifFiles.length} GIF files to convert`);

  for (let i = 0; i < gifFiles.length; i++) {
    const file = gifFiles[i];
    const inputPath = path.join(inputDir, file);
    const outputPath = path.join(outputDir, file.replace('.gif', '.mp4'));

    try {
      await convertFile(inputPath, outputPath);
      console.log(`[${i + 1}/${gifFiles.length}] ✓ ${file}`);
    } catch (error) {
      console.error(`[${i + 1}/${gifFiles.length}] ✗ ${file}:`, error.message);
    }
  }
}

await convertWithProgress('./input-gifs', './output-videos');
```

### API Reference

#### `convertFile(inputPath, outputPath, options?)`

**Parameters:**

- `inputPath` (string) - Path to the input GIF file
- `outputPath` (string) - Output path (file, directory, or path without extension)
- `options` (object, optional):
  - `fps` (number) - Frames per second for the output video (default: 10)
  - `width` (number) - Output video width (optional, defaults to GIF width)
  - `height` (number) - Output video height (optional, defaults to GIF height)

**Returns:** `Promise<string>` - The path to the created MP4 file

**Note:** Output is automatically optimized using the best available method.

#### `convertGifBuffer(gifBuffer, options?)`

**Parameters:**

- `gifBuffer` (Buffer) - Buffer containing GIF image data
- `options` (object, optional):
  - `fps` (number) - Frames per second for the output video (default: 10)
  - `width` (number) - Output video width (optional, defaults to GIF width)
  - `height` (number) - Output video height (optional, defaults to GIF height)

**Returns:** `Promise<Buffer>` - Buffer containing MP4 video data

**Note:** Output is automatically optimized using the best available method.

#### `convertFrames(frames, options?)`

**Parameters:**

- `frames` (FrameInput[]) - Array of frame objects:
  - `data` (ImageData):
    - `data` (Uint8Array | Uint8ClampedArray | Buffer) - RGBA pixel data
    - `width` (number) - Frame width
    - `height` (number) - Frame height
  - `delayMs` (number) - Frame duration in milliseconds
- `options` (object, optional):
  - `fps` (number) - Frames per second (default: 10)
  - `width` (number) - Output video width (optional, defaults to first frame width)
  - `height` (number) - Output video height (optional, defaults to first frame height)

**Returns:** `Promise<Buffer>` - Buffer containing MP4 video data

**Note:** Output is automatically optimized using the best available method.

## Development

### Building the Project

1. **Build the WASM converter:**

   ```bash
   ./scripts/buildConverter.sh
   ```

   This compiles the C source code in `/converter` to WebAssembly.

2. **Build the TypeScript library:**
   ```bash
   npm run build
   ```
   This compiles the TypeScript source in `/src` to JavaScript in `/lib`.

### Project Structure

- `/converter` - C source code for video encoding
  - `gif2video.c` - Main C implementation
  - `/wasm` - Compiled WASM output
- `/scripts` - Build scripts
  - `buildConverter.sh` - Compiles C to WASM using Emscripten
- `/src` - TypeScript source code
  - `index.ts` - Main library implementation
- `/lib` - Compiled JavaScript output (generated)

### Dependencies

- **Emscripten** - Required for building the WASM module
  ```bash
  brew install emscripten  # macOS
  ```
- **Jimp** - Used for GIF decoding in the Node.js layer
