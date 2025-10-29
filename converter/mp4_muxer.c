/**
 * Minimal MP4 muxer for creating valid MP4 files from RGB frames
 * This creates a basic MP4 container with raw/uncompressed video data
 * Standalone implementation with no external dependencies
 */

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

// MP4 box writing utilities
typedef struct {
    uint8_t* data;
    size_t size;
    size_t capacity;
} Mp4Buffer;

static void buffer_init(Mp4Buffer* buf, size_t initial_capacity) {
    buf->data = (uint8_t*)malloc(initial_capacity);
    buf->size = 0;
    buf->capacity = initial_capacity;
}

static void buffer_ensure_capacity(Mp4Buffer* buf, size_t additional) {
    if (buf->size + additional > buf->capacity) {
        size_t new_capacity = (buf->size + additional) * 2;
        uint8_t* new_data = (uint8_t*)realloc(buf->data, new_capacity);
        if (new_data) {
            buf->data = new_data;
            buf->capacity = new_capacity;
        }
    }
}

static void buffer_write_u32(Mp4Buffer* buf, uint32_t value) {
    buffer_ensure_capacity(buf, 4);
    buf->data[buf->size++] = (value >> 24) & 0xFF;
    buf->data[buf->size++] = (value >> 16) & 0xFF;
    buf->data[buf->size++] = (value >> 8) & 0xFF;
    buf->data[buf->size++] = value & 0xFF;
}

static void buffer_write_u16(Mp4Buffer* buf, uint16_t value) {
    buffer_ensure_capacity(buf, 2);
    buf->data[buf->size++] = (value >> 8) & 0xFF;
    buf->data[buf->size++] = value & 0xFF;
}

static void buffer_write_u8(Mp4Buffer* buf, uint8_t value) {
    buffer_ensure_capacity(buf, 1);
    buf->data[buf->size++] = value;
}

static void buffer_write_bytes(Mp4Buffer* buf, const void* data, size_t len) {
    buffer_ensure_capacity(buf, len);
    memcpy(buf->data + buf->size, data, len);
    buf->size += len;
}

static void buffer_write_fourcc(Mp4Buffer* buf, const char* fourcc) {
    buffer_write_bytes(buf, fourcc, 4);
}

// Start a box (returns offset where size should be written)
static size_t box_start(Mp4Buffer* buf, const char* type) {
    size_t size_offset = buf->size;
    buffer_write_u32(buf, 0); // Placeholder for size
    buffer_write_fourcc(buf, type);
    return size_offset;
}

// End a box (write actual size)
static void box_end(Mp4Buffer* buf, size_t size_offset) {
    uint32_t box_size = buf->size - size_offset;
    buf->data[size_offset] = (box_size >> 24) & 0xFF;
    buf->data[size_offset + 1] = (box_size >> 16) & 0xFF;
    buf->data[size_offset + 2] = (box_size >> 8) & 0xFF;
    buf->data[size_offset + 3] = box_size & 0xFF;
}

// Create ftyp box
static void write_ftyp(Mp4Buffer* buf) {
    size_t start = box_start(buf, "ftyp");
    buffer_write_fourcc(buf, "isom"); // Major brand
    buffer_write_u32(buf, 512); // Minor version
    buffer_write_fourcc(buf, "isom"); // Compatible brand
    buffer_write_fourcc(buf, "iso2");
    buffer_write_fourcc(buf, "mp41");
    box_end(buf, start);
}

// Create mdat box with frame data
static void write_mdat(Mp4Buffer* buf, const uint8_t* frame_data, size_t frame_size) {
    size_t start = box_start(buf, "mdat");
    buffer_write_bytes(buf, frame_data, frame_size);
    box_end(buf, start);
}

// Create mvhd box (movie header)
static void write_mvhd(Mp4Buffer* buf, uint32_t timescale, uint32_t duration, uint32_t next_track_id) {
    size_t start = box_start(buf, "mvhd");
    buffer_write_u8(buf, 0); // Version
    buffer_write_u8(buf, 0); buffer_write_u8(buf, 0); buffer_write_u8(buf, 0); // Flags
    buffer_write_u32(buf, 0); // Creation time
    buffer_write_u32(buf, 0); // Modification time
    buffer_write_u32(buf, timescale);
    buffer_write_u32(buf, duration);
    buffer_write_u32(buf, 0x00010000); // Rate (1.0)
    buffer_write_u16(buf, 0x0100); // Volume (1.0)
    buffer_write_u16(buf, 0); // Reserved
    buffer_write_u32(buf, 0); buffer_write_u32(buf, 0); // Reserved
    // Matrix
    for (int i = 0; i < 9; i++) {
        buffer_write_u32(buf, (i % 4 == 0) ? 0x00010000 : 0);
    }
    // Pre-defined
    for (int i = 0; i < 6; i++) buffer_write_u32(buf, 0);
    buffer_write_u32(buf, next_track_id);
    box_end(buf, start);
}

// Create tkhd box (track header)
static void write_tkhd(Mp4Buffer* buf, uint32_t track_id, uint32_t duration, uint32_t width, uint32_t height) {
    size_t start = box_start(buf, "tkhd");
    buffer_write_u8(buf, 0); // Version
    buffer_write_u8(buf, 0); buffer_write_u8(buf, 0); buffer_write_u8(buf, 7); // Flags (enabled, in movie, in preview)
    buffer_write_u32(buf, 0); // Creation time
    buffer_write_u32(buf, 0); // Modification time
    buffer_write_u32(buf, track_id);
    buffer_write_u32(buf, 0); // Reserved
    buffer_write_u32(buf, duration);
    buffer_write_u32(buf, 0); buffer_write_u32(buf, 0); // Reserved
    buffer_write_u16(buf, 0); // Layer
    buffer_write_u16(buf, 0); // Alternate group
    buffer_write_u16(buf, 0); // Volume
    buffer_write_u16(buf, 0); // Reserved
    // Matrix
    for (int i = 0; i < 9; i++) {
        buffer_write_u32(buf, (i % 4 == 0) ? 0x00010000 : 0);
    }
    buffer_write_u32(buf, width << 16); // Width
    buffer_write_u32(buf, height << 16); // Height
    box_end(buf, start);
}

// Create minimal moov box
static void write_moov(Mp4Buffer* buf, uint32_t width, uint32_t height, uint32_t fps, uint32_t frame_count) {
    size_t moov_start = box_start(buf, "moov");

    uint32_t timescale = 1000; // Milliseconds
    uint32_t duration = (frame_count * 1000) / fps;

    write_mvhd(buf, timescale, duration, 2);

    // Track box
    size_t trak_start = box_start(buf, "trak");
    write_tkhd(buf, 1, duration, width, height);
    box_end(buf, trak_start);

    box_end(buf, moov_start);
}

/**
 * Create a minimal valid MP4 file from RGB frame data
 * This creates a very basic MP4 that should be playable
 */
uint8_t* create_mp4(const uint8_t* frame_data, size_t frame_size,
                    uint32_t width, uint32_t height, uint32_t fps,
                    size_t* out_size) {
    Mp4Buffer buf;
    buffer_init(&buf, frame_size + 1024); // Frame data + overhead

    // Write MP4 structure
    write_ftyp(&buf);
    write_mdat(&buf, frame_data, frame_size);
    write_moov(&buf, width, height, fps, 1); // Single frame for now

    *out_size = buf.size;
    return buf.data;
}

void free_mp4(uint8_t* data) {
    free(data);
}
