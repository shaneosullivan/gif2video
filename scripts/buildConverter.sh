#!/bin/bash

# Build script for converting C code to WASM using Emscripten

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
CONVERTER_DIR="$PROJECT_ROOT/converter"
OUTPUT_DIR="$CONVERTER_DIR/wasm"

echo "Building GIF to Video converter WASM module..."
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

# Compile C to WASM
echo "Compiling C to WASM..."
emcc "$CONVERTER_DIR/gif2video.c" \
    -o "$OUTPUT_DIR/gif2video.js" \
    -s WASM=1 \
    -s EXPORTED_RUNTIME_METHODS='["cwrap","ccall","getValue","setValue","UTF8ToString","HEAPU8"]' \
    -s EXPORTED_FUNCTIONS='["_malloc","_free","_init_encoder","_add_frame","_finalize_video","_get_video_buffer","_get_video_size","_cleanup","_allocate_buffer","_free_buffer"]' \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s MODULARIZE=1 \
    -s EXPORT_ES6=1 \
    -s EXPORT_NAME="createGif2VideoModule" \
    -s ENVIRONMENT=node \
    -O3

echo "Build completed successfully!"
echo "Output files:"
echo "  - $OUTPUT_DIR/gif2video.js"
echo "  - $OUTPUT_DIR/gif2video.wasm"

# Format generated JavaScript file with Prettier
echo ""
echo "Formatting generated files with Prettier..."
cd "$PROJECT_ROOT"
npm run format:wasm

echo ""
echo "Done! WASM module built and formatted."
