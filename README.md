# Gif 2 Video converter

This project uses a WASM tool from Node to convert a GIF image to a video.
The supported output formats are:

- mp4

## Installation

```bash
npm install gif2video
```

## Usage

### Basic Example

```typescript
import gif2video from 'gif2video';

// Convert a GIF to MP4 (returns the output file path)
const outputPath = await gif2video('./input.gif', './output.mp4');
console.log(`Created: ${outputPath}`);
```

### Output Path Options

The converter intelligently handles different output path formats:

```typescript
// 1. Explicit file path
await gif2video('./input.gif', './output.mp4');
// Output: ./output.mp4

// 2. Directory path (auto-generates filename)
await gif2video('./input.gif', './videos/');
// Output: ./videos/input.mp4

// 3. Path without extension (adds .mp4)
await gif2video('./input.gif', './output');
// Output: ./output.mp4
```

### Custom Options

```typescript
// Custom frames per second
await gif2video('./input.gif', './output.mp4', {
  fps: 30, // Higher FPS for smoother video
});
```

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

### Batch Processing

```typescript
import gif2video from 'gif2video';

const gifFiles = ['anim1.gif', 'anim2.gif', 'anim3.gif'];

for (const gif of gifFiles) {
  const output = await gif2video(`./gifs/${gif}`, './videos/');
  console.log(`Converted: ${output}`);
}
```

### API Reference

#### `gif2video(inputPath, outputPath, options?)`

**Parameters:**

- `inputPath` (string) - Path to the input GIF file
- `outputPath` (string) - Output path (file, directory, or path without extension)
- `options` (object, optional):
  - `fps` (number) - Frames per second for the output video (default: 10)
  - `width` (number) - Output video width (optional, defaults to GIF width)
  - `height` (number) - Output video height (optional, defaults to GIF height)

**Returns:** `Promise<string>` - The path to the created MP4 file

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
