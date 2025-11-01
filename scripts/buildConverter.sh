#!/bin/bash

# Build script for converting C code to WASM using Emscripten
# Builds separate WASM modules for browser and Node.js environments

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
CONVERTER_DIR="$PROJECT_ROOT/converter"
OUTPUT_DIR="$CONVERTER_DIR/wasm"

echo "Building gif2vid converter WASM modules..."
echo "Project root: $PROJECT_ROOT"
echo "Converter source: $CONVERTER_DIR"
echo "Output directory: $OUTPUT_DIR"

# Check if emcc is available
if ! command -v emcc &> /dev/null; then
    echo "Error: emcc (Emscripten compiler) not found!"
    echo "Please install Emscripten: https://emscripten.org/docs/getting_started/downloads.html"
    echo "Or run: brew install emscripten"
    exit 1
fi

# Create output directory if it doesn't exist
mkdir -p "$OUTPUT_DIR"

# Build for web (browser)
echo ""
echo "Building web version (browser-only)..."
emcc "$CONVERTER_DIR/gif2vid.c" "$CONVERTER_DIR/webcodecs_muxer.c" \
    -o "$OUTPUT_DIR/gif2vid-web.js" \
    -s WASM=1 \
    -s EXPORTED_RUNTIME_METHODS='["cwrap","ccall","getValue","setValue","UTF8ToString","HEAPU8"]' \
    -s EXPORTED_FUNCTIONS='["_malloc","_free","_init_encoder","_add_frame","_finalize_video","_get_video_buffer","_get_video_size","_cleanup","_allocate_buffer","_free_buffer","_init_webcodecs_muxer","_set_decoder_config","_add_h264_frame","_finalize_webcodecs_mp4","_cleanup_webcodecs_muxer"]' \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s MODULARIZE=1 \
    -s EXPORT_ES6=1 \
    -s EXPORT_NAME="createGif2VidModule" \
    -s ENVIRONMENT='web' \
    -O3

echo "✓ Web version built: $OUTPUT_DIR/gif2vid-web.js"

# Build for Node.js
echo ""
echo "Building Node.js version..."
emcc "$CONVERTER_DIR/gif2vid.c" \
    -o "$OUTPUT_DIR/gif2vid-node.js" \
    -s WASM=1 \
    -s EXPORTED_RUNTIME_METHODS='["cwrap","ccall","getValue","setValue","UTF8ToString","HEAPU8"]' \
    -s EXPORTED_FUNCTIONS='["_malloc","_free","_init_encoder","_add_frame","_finalize_video","_get_video_buffer","_get_video_size","_cleanup","_allocate_buffer","_free_buffer"]' \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s MODULARIZE=1 \
    -s EXPORT_ES6=1 \
    -s EXPORT_NAME="createGif2VidModule" \
    -s ENVIRONMENT='node' \
    -O3

echo "✓ Node.js version built: $OUTPUT_DIR/gif2vid-node.js"

echo ""
echo "Build completed successfully!"
echo "Output files:"
echo "  Web:    $OUTPUT_DIR/gif2vid-web.js + gif2vid-web.wasm"
echo "  Node.js: $OUTPUT_DIR/gif2vid-node.js + gif2vid-node.wasm"

# Format generated JavaScript files with Prettier
echo ""
echo "Formatting generated files with Prettier..."
cd "$PROJECT_ROOT"
npm run format:wasm

echo ""
echo "Done! WASM modules built and formatted."
