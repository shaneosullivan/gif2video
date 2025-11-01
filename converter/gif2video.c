#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <emscripten.h>

// MP4 Buffer
typedef struct {
    uint8_t* data;
    size_t size;
    size_t capacity;
} Mp4Buf;

// Frame storage
typedef struct {
    uint8_t* rgb_data;  // RGB24 (3 bytes per pixel)
    size_t size;
    uint32_t delay_ms;  // Frame delay in milliseconds
} FrameData;

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
    wr_u32(b, 0);
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

// Convert RGBA to RGB24
static uint8_t* rgba_to_rgb24(const uint8_t* rgba, int width, int height, size_t* out_size) {
    size_t rgb_size = width * height * 3;
    uint8_t* rgb = malloc(rgb_size);

    for (int i = 0; i < width * height; i++) {
        rgb[i * 3 + 0] = rgba[i * 4 + 0]; // R
        rgb[i * 3 + 1] = rgba[i * 4 + 1]; // G
        rgb[i * 3 + 2] = rgba[i * 4 + 2]; // B
        // Skip A channel
    }

    *out_size = rgb_size;
    return rgb;
}

// MP4 Box writers
static void wr_ftyp(Mp4Buf* b) {
    size_t s = box_start(b, "ftyp");
    wr_bytes(b, "isom", 4);
    wr_u32(b, 512);
    wr_bytes(b, "isomiso2avc1mp41", 16);
    box_end(b, s);
}

static void wr_mdat(Mp4Buf* b, const uint8_t** frames, size_t* frame_sizes, int frame_count) {
    size_t s = box_start(b, "mdat");
    for (int i = 0; i < frame_count; i++) {
        wr_bytes(b, frames[i], frame_sizes[i]);
    }
    box_end(b, s);
}

static void wr_mvhd(Mp4Buf* b, uint32_t scale, uint32_t dur) {
    size_t s = box_start(b, "mvhd");
    wr_u8(b, 0);
    wr_u8(b, 0); wr_u8(b, 0); wr_u8(b, 0);
    wr_u32(b, 0); wr_u32(b, 0);
    wr_u32(b, scale);
    wr_u32(b, dur);
    wr_u32(b, 0x00010000);
    wr_u16(b, 0x0100);
    wr_u16(b, 0);
    wr_u32(b, 0); wr_u32(b, 0);
    uint32_t matrix[9] = {0x00010000,0,0,0,0x00010000,0,0,0,0x40000000};
    for(int i=0; i<9; i++) wr_u32(b, matrix[i]);
    for(int i=0; i<6; i++) wr_u32(b, 0);
    wr_u32(b, 2);
    box_end(b, s);
}

static void wr_tkhd(Mp4Buf* b, uint32_t dur, uint32_t w, uint32_t h) {
    size_t s = box_start(b, "tkhd");
    wr_u8(b, 0);
    wr_u8(b, 0); wr_u8(b, 0); wr_u8(b, 7);
    wr_u32(b, 0); wr_u32(b, 0);
    wr_u32(b, 1);
    wr_u32(b, 0);
    wr_u32(b, dur);
    wr_u32(b, 0); wr_u32(b, 0);
    wr_u16(b, 0); wr_u16(b, 0); wr_u16(b, 0); wr_u16(b, 0);
    uint32_t matrix[9] = {0x00010000,0,0,0,0x00010000,0,0,0,0x40000000};
    for(int i=0; i<9; i++) wr_u32(b, matrix[i]);
    wr_u32(b, w << 16);
    wr_u32(b, h << 16);
    box_end(b, s);
}

static void wr_mdhd(Mp4Buf* b, uint32_t scale, uint32_t dur) {
    size_t s = box_start(b, "mdhd");
    wr_u8(b, 0);
    wr_u8(b, 0); wr_u8(b, 0); wr_u8(b, 0);
    wr_u32(b, 0); wr_u32(b, 0);
    wr_u32(b, scale);
    wr_u32(b, dur);
    wr_u16(b, 0x55c4);
    wr_u16(b, 0);
    box_end(b, s);
}

static void wr_hdlr(Mp4Buf* b) {
    size_t s = box_start(b, "hdlr");
    wr_u8(b, 0);
    wr_u8(b, 0); wr_u8(b, 0); wr_u8(b, 0);
    wr_u32(b, 0);
    wr_bytes(b, "vide", 4);
    wr_u32(b, 0); wr_u32(b, 0); wr_u32(b, 0);
    wr_bytes(b, "VideoHandler", 13);
    box_end(b, s);
}

static void wr_vmhd(Mp4Buf* b) {
    size_t s = box_start(b, "vmhd");
    wr_u8(b, 0);
    wr_u8(b, 0); wr_u8(b, 0); wr_u8(b, 1);
    wr_u16(b, 0);
    wr_u16(b, 0); wr_u16(b, 0); wr_u16(b, 0);
    box_end(b, s);
}

static void wr_dref(Mp4Buf* b) {
    size_t s = box_start(b, "dref");
    wr_u8(b, 0);
    wr_u8(b, 0); wr_u8(b, 0); wr_u8(b, 0);
    wr_u32(b, 1);
    size_t url_s = box_start(b, "url ");
    wr_u8(b, 0);
    wr_u8(b, 0); wr_u8(b, 0); wr_u8(b, 1);
    box_end(b, url_s);
    box_end(b, s);
}

static void wr_stsd(Mp4Buf* b, uint32_t w, uint32_t h) {
    size_t s = box_start(b, "stsd");
    wr_u8(b, 0);
    wr_u8(b, 0); wr_u8(b, 0); wr_u8(b, 0);
    wr_u32(b, 1);
    size_t raw_s = box_start(b, "raw ");
    wr_u16(b, 0); wr_u16(b, 0); wr_u16(b, 0);
    wr_u16(b, 1);
    wr_u16(b, 0); wr_u16(b, 0);
    wr_u32(b, 0); wr_u32(b, 0); wr_u32(b, 0);
    wr_u16(b, w);
    wr_u16(b, h);
    wr_u32(b, 0x00480000);
    wr_u32(b, 0x00480000);
    wr_u32(b, 0);
    wr_u16(b, 1);
    for(int i=0; i<32; i++) wr_u8(b, 0);
    wr_u16(b, 0x0018); // 24-bit depth
    wr_u16(b, 0xFFFF);
    box_end(b, raw_s);
    box_end(b, s);
}

static void wr_stts(Mp4Buf* b, uint32_t* deltas, uint32_t count) {
    size_t s = box_start(b, "stts");
    wr_u8(b, 0);
    wr_u8(b, 0); wr_u8(b, 0); wr_u8(b, 0);

    // Write entries (compress consecutive frames with same delay)
    uint32_t entry_count = 0;
    for (uint32_t i = 0; i < count; ) {
        uint32_t sample_count = 1;
        uint32_t sample_delta = deltas[i];

        // Count consecutive frames with same delay
        while (i + sample_count < count && deltas[i + sample_count] == sample_delta) {
            sample_count++;
        }
        entry_count++;
        i += sample_count;
    }

    wr_u32(b, entry_count);

    // Write compressed entries
    for (uint32_t i = 0; i < count; ) {
        uint32_t sample_count = 1;
        uint32_t sample_delta = deltas[i];

        while (i + sample_count < count && deltas[i + sample_count] == sample_delta) {
            sample_count++;
        }

        wr_u32(b, sample_count);
        wr_u32(b, sample_delta);
        i += sample_count;
    }

    box_end(b, s);
}

static void wr_stsc(Mp4Buf* b, uint32_t count) {
    size_t s = box_start(b, "stsc");
    wr_u8(b, 0);
    wr_u8(b, 0); wr_u8(b, 0); wr_u8(b, 0);
    wr_u32(b, 1);
    wr_u32(b, 1);
    wr_u32(b, count);
    wr_u32(b, 1);
    box_end(b, s);
}

static void wr_stsz(Mp4Buf* b, size_t* sample_sizes, uint32_t count) {
    size_t s = box_start(b, "stsz");
    wr_u8(b, 0);
    wr_u8(b, 0); wr_u8(b, 0); wr_u8(b, 0);
    // Check if all samples are same size
    int all_same = 1;
    for (uint32_t i = 1; i < count; i++) {
        if (sample_sizes[i] != sample_sizes[0]) {
            all_same = 0;
            break;
        }
    }

    if (all_same) {
        wr_u32(b, sample_sizes[0]);
        wr_u32(b, count);
    } else {
        wr_u32(b, 0);
        wr_u32(b, count);
        for (uint32_t i = 0; i < count; i++) {
            wr_u32(b, sample_sizes[i]);
        }
    }
    box_end(b, s);
}

static void wr_stco(Mp4Buf* b, uint32_t offset) {
    size_t s = box_start(b, "stco");
    wr_u8(b, 0);
    wr_u8(b, 0); wr_u8(b, 0); wr_u8(b, 0);
    wr_u32(b, 1);
    wr_u32(b, offset);
    box_end(b, s);
}

static void wr_stbl(Mp4Buf* b, uint32_t w, uint32_t h, size_t* sample_sizes, uint32_t* deltas, uint32_t count, uint32_t offset) {
    size_t s = box_start(b, "stbl");
    wr_stsd(b, w, h);
    wr_stts(b, deltas, count);
    wr_stsc(b, count);
    wr_stsz(b, sample_sizes, count);
    wr_stco(b, offset);
    box_end(b, s);
}

static void create_mp4(Mp4Buf* b, const uint8_t** frames, size_t* frame_sizes, uint32_t* frame_delays,
                       int frame_count, uint32_t w, uint32_t h) {
    uint32_t timescale = 1000; // milliseconds

    // Calculate total duration from all frame delays
    uint32_t total_duration = 0;
    for (int i = 0; i < frame_count; i++) {
        total_duration += frame_delays[i];
    }

    // Calculate mdat size first (header + all frame data)
    size_t mdat_data_size = 0;
    for (int i = 0; i < frame_count; i++) {
        mdat_data_size += frame_sizes[i];
    }

    // Write ftyp first
    wr_ftyp(b);

    // Create a temporary buffer to write moov
    Mp4Buf moov_buf;
    buf_init(&moov_buf, 4096);

    size_t moov_s = box_start(&moov_buf, "moov");
    wr_mvhd(&moov_buf, timescale, total_duration);

    size_t trak_s = box_start(&moov_buf, "trak");
    wr_tkhd(&moov_buf, total_duration, w, h);

    size_t mdia_s = box_start(&moov_buf, "mdia");
    wr_mdhd(&moov_buf, timescale, total_duration);
    wr_hdlr(&moov_buf);

    size_t minf_s = box_start(&moov_buf, "minf");
    wr_vmhd(&moov_buf);

    size_t dinf_s = box_start(&moov_buf, "dinf");
    wr_dref(&moov_buf);
    box_end(&moov_buf, dinf_s);

    // Calculate mdat offset: current buffer (ftyp) + moov size + 8 (mdat header)
    uint32_t mdat_offset = b->size + moov_buf.size + 8;

    wr_stbl(&moov_buf, w, h, frame_sizes, frame_delays, frame_count, mdat_offset);

    box_end(&moov_buf, minf_s);
    box_end(&moov_buf, mdia_s);
    box_end(&moov_buf, trak_s);
    box_end(&moov_buf, moov_s);

    // Write moov to main buffer
    buf_ensure(b, moov_buf.size);
    memcpy(b->data + b->size, moov_buf.data, moov_buf.size);
    b->size += moov_buf.size;
    free(moov_buf.data);

    // Now write mdat
    wr_mdat(b, frames, frame_sizes, frame_count);
}

// Global state
static Mp4Buf* mp4_output = NULL;
static FrameData* frames = NULL;
static int frame_count = 0;
static int frame_capacity = 0;
static uint32_t video_width = 0;
static uint32_t video_height = 0;
static uint32_t video_fps = 10;

EMSCRIPTEN_KEEPALIVE
int init_encoder(int width, int height, int fps) {
    // Cleanup previous
    if (mp4_output) {
        free(mp4_output->data);
        free(mp4_output);
        mp4_output = NULL;
    }
    if (frames) {
        for (int i = 0; i < frame_count; i++) {
            free(frames[i].rgb_data);
        }
        free(frames);
        frames = NULL;
    }

    video_width = width;
    video_height = height;
    video_fps = fps;
    frame_count = 0;
    frame_capacity = 10;

    frames = malloc(sizeof(FrameData) * frame_capacity);
    if (!frames) return 0;

    return 1;
}

EMSCRIPTEN_KEEPALIVE
int add_frame(unsigned char* rgba_data, int width, int height, int delay_ms) {
    if (!frames || width != video_width || height != video_height) {
        return 0;
    }

    // Expand capacity if needed
    if (frame_count >= frame_capacity) {
        frame_capacity *= 2;
        frames = realloc(frames, sizeof(FrameData) * frame_capacity);
        if (!frames) return 0;
    }

    // Convert RGBA to RGB24
    size_t rgb_size;
    uint8_t* rgb = rgba_to_rgb24(rgba_data, width, height, &rgb_size);
    if (!rgb) return 0;

    frames[frame_count].rgb_data = rgb;
    frames[frame_count].size = rgb_size;
    frames[frame_count].delay_ms = delay_ms > 0 ? delay_ms : 100; // Default 100ms if 0
    frame_count++;

    return 1;
}

EMSCRIPTEN_KEEPALIVE
unsigned char* get_video_buffer() {
    if (!mp4_output && frames && frame_count > 0) {
        // Prepare frame pointers, sizes, and delays
        uint8_t** frame_ptrs = malloc(sizeof(uint8_t*) * frame_count);
        size_t* frame_sizes = malloc(sizeof(size_t) * frame_count);
        uint32_t* frame_delays = malloc(sizeof(uint32_t) * frame_count);

        for (int i = 0; i < frame_count; i++) {
            frame_ptrs[i] = frames[i].rgb_data;
            frame_sizes[i] = frames[i].size;
            frame_delays[i] = frames[i].delay_ms;
        }

        // Generate MP4
        mp4_output = malloc(sizeof(Mp4Buf));
        size_t total_size = 0;
        for (int i = 0; i < frame_count; i++) {
            total_size += frame_sizes[i];
        }
        buf_init(mp4_output, total_size + 8192);

        create_mp4(mp4_output, (const uint8_t**)frame_ptrs, frame_sizes, frame_delays,
                   frame_count, video_width, video_height);

        free(frame_ptrs);
        free(frame_sizes);
        free(frame_delays);
    }
    return mp4_output ? mp4_output->data : NULL;
}

EMSCRIPTEN_KEEPALIVE
int get_video_size() {
    if (!mp4_output && frames && frame_count > 0) {
        get_video_buffer();
    }
    return mp4_output ? mp4_output->size : 0;
}

EMSCRIPTEN_KEEPALIVE
void cleanup() {
    if (mp4_output) {
        free(mp4_output->data);
        free(mp4_output);
        mp4_output = NULL;
    }
    if (frames) {
        for (int i = 0; i < frame_count; i++) {
            free(frames[i].rgb_data);
        }
        free(frames);
        frames = NULL;
    }
    frame_count = 0;
}

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
