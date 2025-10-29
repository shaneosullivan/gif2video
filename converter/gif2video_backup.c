#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <emscripten.h>

// MP4 Buffer for building file
typedef struct {
    uint8_t* data;
    size_t size;
    size_t capacity;
} Mp4Buf;

static void buf_init(Mp4Buf* b, size_t cap) {
    b->data = malloc(cap);
    b->size = 0;
    b->capacity = cap;
}

static void buf_ensure(Mp4Buf* b, size_t add) {
    if (b->size + add > b->capacity) {
        b->capacity = (b->size + add) * 2;
        b->data = realloc(b->data, b->capacity);
    }
}

static void wr_u32(Mp4Buf* b, uint32_t v) {
    buf_ensure(b, 4);
    b->data[b->size++] = (v >> 24);
    b->data[b->size++] = (v >> 16);
    b->data[b->size++] = (v >> 8);
    b->data[b->size++] = v;
}

static void wr_u16(Mp4Buf* b, uint16_t v) {
    buf_ensure(b, 2);
    b->data[b->size++] = (v >> 8);
    b->data[b->size++] = v;
}

static void wr_u8(Mp4Buf* b, uint8_t v) {
    buf_ensure(b, 1);
    b->data[b->size++] = v;
}

static void wr_bytes(Mp4Buf* b, const void* d, size_t len) {
    buf_ensure(b, len);
    memcpy(b->data + b->size, d, len);
    b->size += len;
}

static size_t box_start(Mp4Buf* b, const char* type) {
    size_t off = b->size;
    wr_u32(b, 0); // Size placeholder
    wr_bytes(b, type, 4);
    return off;
}

static void box_end(Mp4Buf* b, size_t off) {
    uint32_t sz = b->size - off;
    b->data[off] = sz >> 24;
    b->data[off+1] = sz >> 16;
    b->data[off+2] = sz >> 8;
    b->data[off+3] = sz;
}

// Write ftyp box
static void wr_ftyp(Mp4Buf* b) {
    size_t s = box_start(b, "ftyp");
    wr_bytes(b, "isom", 4); // Brand
    wr_u32(b, 512); // Version
    wr_bytes(b, "isomiso2avc1mp41", 16); // Compatible brands
    box_end(b, s);
}

// Write mdat box
static void wr_mdat(Mp4Buf* b, const uint8_t* data, size_t len) {
    size_t s = box_start(b, "mdat");
    wr_bytes(b, data, len);
    box_end(b, s);
}

// Write mvhd box
static void wr_mvhd(Mp4Buf* b, uint32_t scale, uint32_t dur) {
    size_t s = box_start(b, "mvhd");
    wr_u8(b, 0); // Version
    wr_u8(b, 0); wr_u8(b, 0); wr_u8(b, 0); // Flags
    wr_u32(b, 0); // Creation time
    wr_u32(b, 0); // Modification time
    wr_u32(b, scale); // Timescale
    wr_u32(b, dur); // Duration
    wr_u32(b, 0x00010000); // Rate 1.0
    wr_u16(b, 0x0100); // Volume 1.0
    wr_u16(b, 0); // Reserved
    wr_u32(b, 0); wr_u32(b, 0); // Reserved
    // Identity matrix
    uint32_t matrix[9] = {0x00010000,0,0,0,0x00010000,0,0,0,0x40000000};
    for(int i=0; i<9; i++) wr_u32(b, matrix[i]);
    for(int i=0; i<6; i++) wr_u32(b, 0); // Pre-defined
    wr_u32(b, 2); // Next track ID
    box_end(b, s);
}

// Write tkhd box
static void wr_tkhd(Mp4Buf* b, uint32_t dur, uint32_t w, uint32_t h) {
    size_t s = box_start(b, "tkhd");
    wr_u8(b, 0); // Version
    wr_u8(b, 0); wr_u8(b, 0); wr_u8(b, 7); // Flags
    wr_u32(b, 0); // Creation time
    wr_u32(b, 0); // Modification time
    wr_u32(b, 1); // Track ID
    wr_u32(b, 0); // Reserved
    wr_u32(b, dur); // Duration
    wr_u32(b, 0); wr_u32(b, 0); // Reserved
    wr_u16(b, 0); // Layer
    wr_u16(b, 0); // Alternate group
    wr_u16(b, 0); // Volume
    wr_u16(b, 0); // Reserved
    // Identity matrix
    uint32_t matrix[9] = {0x00010000,0,0,0,0x00010000,0,0,0,0x40000000};
    for(int i=0; i<9; i++) wr_u32(b, matrix[i]);
    wr_u32(b, w << 16); // Width
    wr_u32(b, h << 16); // Height
    box_end(b, s);
}

// Write mdhd box
static void wr_mdhd(Mp4Buf* b, uint32_t scale, uint32_t dur) {
    size_t s = box_start(b, "mdhd");
    wr_u8(b, 0); // Version
    wr_u8(b, 0); wr_u8(b, 0); wr_u8(b, 0); // Flags
    wr_u32(b, 0); // Creation time
    wr_u32(b, 0); // Modification time
    wr_u32(b, scale); // Timescale
    wr_u32(b, dur); // Duration
    wr_u16(b, 0x55c4); // Language (und)
    wr_u16(b, 0); // Reserved
    box_end(b, s);
}

// Write hdlr box
static void wr_hdlr(Mp4Buf* b) {
    size_t s = box_start(b, "hdlr");
    wr_u8(b, 0); // Version
    wr_u8(b, 0); wr_u8(b, 0); wr_u8(b, 0); // Flags
    wr_u32(b, 0); // Pre-defined
    wr_bytes(b, "vide", 4); // Handler type
    wr_u32(b, 0); wr_u32(b, 0); wr_u32(b, 0); // Reserved
    wr_bytes(b, "VideoHandler", 13); // Name (null-terminated)
    box_end(b, s);
}

// Write vmhd box
static void wr_vmhd(Mp4Buf* b) {
    size_t s = box_start(b, "vmhd");
    wr_u8(b, 0); // Version
    wr_u8(b, 0); wr_u8(b, 0); wr_u8(b, 1); // Flags
    wr_u16(b, 0); // Graphics mode
    wr_u16(b, 0); wr_u16(b, 0); wr_u16(b, 0); // Opcolor
    box_end(b, s);
}

// Write dref box
static void wr_dref(Mp4Buf* b) {
    size_t s = box_start(b, "dref");
    wr_u8(b, 0); // Version
    wr_u8(b, 0); wr_u8(b, 0); wr_u8(b, 0); // Flags
    wr_u32(b, 1); // Entry count
    // url entry
    size_t url_s = box_start(b, "url ");
    wr_u8(b, 0); // Version
    wr_u8(b, 0); wr_u8(b, 0); wr_u8(b, 1); // Flags (self-contained)
    box_end(b, url_s);
    box_end(b, s);
}

// Write stsd box (sample description) - uncompressed RGB
static void wr_stsd(Mp4Buf* b, uint32_t w, uint32_t h) {
    size_t s = box_start(b, "stsd");
    wr_u8(b, 0); // Version
    wr_u8(b, 0); wr_u8(b, 0); wr_u8(b, 0); // Flags
    wr_u32(b, 1); // Entry count

    // Raw visual sample entry
    size_t raw_s = box_start(b, "raw "); // Uncompressed RGB
    wr_u16(b, 0); wr_u16(b, 0); wr_u16(b, 0); // Reserved
    wr_u16(b, 1); // Data reference index
    wr_u16(b, 0); wr_u16(b, 0); // Pre-defined, Reserved
    wr_u32(b, 0); wr_u32(b, 0); wr_u32(b, 0); // Pre-defined
    wr_u16(b, w); // Width
    wr_u16(b, h); // Height
    wr_u32(b, 0x00480000); // Horizontal resolution 72dpi
    wr_u32(b, 0x00480000); // Vertical resolution 72dpi
    wr_u32(b, 0); // Reserved
    wr_u16(b, 1); // Frame count
    // Compressor name (32 bytes)
    for(int i=0; i<32; i++) wr_u8(b, 0);
    wr_u16(b, 0x0018); // Depth = 24-bit
    wr_u16(b, 0xFFFF); // Pre-defined
    box_end(b, raw_s);
    box_end(b, s);
}

// Write stts box (time-to-sample)
static void wr_stts(Mp4Buf* b, uint32_t count, uint32_t delta) {
    size_t s = box_start(b, "stts");
    wr_u8(b, 0); // Version
    wr_u8(b, 0); wr_u8(b, 0); wr_u8(b, 0); // Flags
    wr_u32(b, 1); // Entry count
    wr_u32(b, count); // Sample count
    wr_u32(b, delta); // Sample delta
    box_end(b, s);
}

// Write stsc box (sample-to-chunk)
static void wr_stsc(Mp4Buf* b) {
    size_t s = box_start(b, "stsc");
    wr_u8(b, 0); // Version
    wr_u8(b, 0); wr_u8(b, 0); wr_u8(b, 0); // Flags
    wr_u32(b, 1); // Entry count
    wr_u32(b, 1); // First chunk
    wr_u32(b, 1); // Samples per chunk
    wr_u32(b, 1); // Sample description index
    box_end(b, s);
}

// Write stsz box (sample sizes)
static void wr_stsz(Mp4Buf* b, uint32_t sample_size, uint32_t count) {
    size_t s = box_start(b, "stsz");
    wr_u8(b, 0); // Version
    wr_u8(b, 0); wr_u8(b, 0); wr_u8(b, 0); // Flags
    wr_u32(b, sample_size); // Sample size (or 0 if variable)
    wr_u32(b, count); // Sample count
    box_end(b, s);
}

// Write stco box (chunk offsets)
static void wr_stco(Mp4Buf* b, uint32_t offset) {
    size_t s = box_start(b, "stco");
    wr_u8(b, 0); // Version
    wr_u8(b, 0); wr_u8(b, 0); wr_u8(b, 0); // Flags
    wr_u32(b, 1); // Entry count
    wr_u32(b, offset); // Chunk offset
    box_end(b, s);
}

// Write stbl box (sample table)
static void wr_stbl(Mp4Buf* b, uint32_t w, uint32_t h, uint32_t sample_size, uint32_t delta, uint32_t offset) {
    size_t s = box_start(b, "stbl");
    wr_stsd(b, w, h);
    wr_stts(b, 1, delta);
    wr_stsc(b);
    wr_stsz(b, sample_size, 1);
    wr_stco(b, offset);
    box_end(b, s);
}

// Create complete MP4 file
static void create_mp4(Mp4Buf* b, const uint8_t* frame, size_t frame_sz,
                       uint32_t w, uint32_t h, uint32_t fps) {
    uint32_t timescale = 1000;
    uint32_t duration = 1000 / fps;
    uint32_t mdat_offset;

    // Write ftyp
    wr_ftyp(b);

    // Reserve space for mdat offset calculation
    mdat_offset = b->size + 8; // After mdat size+type

    // Write mdat
    wr_mdat(b, frame, frame_sz);

    // Write moov
    size_t moov_s = box_start(b, "moov");
    wr_mvhd(b, timescale, duration);

    // Write trak
    size_t trak_s = box_start(b, "trak");
    wr_tkhd(b, duration, w, h);

    // Write mdia
    size_t mdia_s = box_start(b, "mdia");
    wr_mdhd(b, timescale, duration);
    wr_hdlr(b);

    // Write minf
    size_t minf_s = box_start(b, "minf");
    wr_vmhd(b);

    // Write dinf
    size_t dinf_s = box_start(b, "dinf");
    wr_dref(b);
    box_end(b, dinf_s);

    // Write stbl
    wr_stbl(b, w, h, frame_sz, duration, mdat_offset);

    box_end(b, minf_s);
    box_end(b, mdia_s);
    box_end(b, trak_s);
    box_end(b, moov_s);
}

// Global state
static Mp4Buf* mp4_output = NULL;
static uint8_t* frame_data = NULL;
static uint32_t frame_width = 0;
static uint32_t frame_height = 0;
static uint32_t frame_fps = 10;

// Initialize encoder
EMSCRIPTEN_KEEPALIVE
int init_encoder(int width, int height, int fps) {
    if (mp4_output) {
        free(mp4_output->data);
        free(mp4_output);
    }
    if (frame_data) {
        free(frame_data);
    }

    frame_width = width;
    frame_height = height;
    frame_fps = fps;

    size_t frame_sz = width * height * 4; // RGBA
    frame_data = malloc(frame_sz);
    if (!frame_data) return 0;

    return 1;
}

// Add frame
EMSCRIPTEN_KEEPALIVE
int add_frame(unsigned char* rgba_data, int width, int height, int frame_index) {
    if (!frame_data || width != frame_width || height != frame_height) {
        return 0;
    }

    // Store latest frame (for multiple frames, we'd accumulate)
    size_t sz = width * height * 4;
    memcpy(frame_data, rgba_data, sz);
    return 1;
}

// Get video buffer
EMSCRIPTEN_KEEPALIVE
unsigned char* get_video_buffer() {
    if (!mp4_output && frame_data) {
        // Generate MP4
        mp4_output = malloc(sizeof(Mp4Buf));
        size_t frame_sz = frame_width * frame_height * 4;
        buf_init(mp4_output, frame_sz + 4096);
        create_mp4(mp4_output, frame_data, frame_sz, frame_width, frame_height, frame_fps);
    }
    return mp4_output ? mp4_output->data : NULL;
}

// Get video size
EMSCRIPTEN_KEEPALIVE
int get_video_size() {
    if (!mp4_output && frame_data) {
        get_video_buffer(); // Auto-generate
    }
    return mp4_output ? mp4_output->size : 0;
}

// Cleanup
EMSCRIPTEN_KEEPALIVE
void cleanup() {
    if (mp4_output) {
        free(mp4_output->data);
        free(mp4_output);
        mp4_output = NULL;
    }
    if (frame_data) {
        free(frame_data);
        frame_data = NULL;
    }
}

// Memory management exports
EMSCRIPTEN_KEEPALIVE
unsigned char* allocate_buffer(int size) {
    return malloc(size);
}

EMSCRIPTEN_KEEPALIVE
void free_buffer(unsigned char* buffer) {
    free(buffer);
}

EMSCRIPTEN_KEEPALIVE
unsigned char* finalize_video(int* out_size) {
    *out_size = get_video_size();
    return get_video_buffer();
}
