#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <emscripten.h>

// Frame data structure
typedef struct {
    unsigned char* data;
    int width;
    int height;
    int delay_ms;
} Frame;

// MP4 Box writing utilities
typedef struct {
    uint8_t* data;
    size_t size;
    size_t capacity;
} Mp4Buffer;

static void buf_init(Mp4Buffer* buf, size_t cap) {
    buf->data = (uint8_t*)malloc(cap);
    buf->size = 0;
    buf->capacity = cap;
}

static void buf_ensure(Mp4Buffer* buf, size_t add) {
    if (buf->size + add > buf->capacity) {
        size_t new_cap = (buf->size + add) * 2;
        buf->data = (uint8_t*)realloc(buf->data, new_cap);
        buf->capacity = new_cap;
    }
}

static void buf_u32(Mp4Buffer* buf, uint32_t v) {
    buf_ensure(buf, 4);
    buf->data[buf->size++] = (v >> 24) & 0xFF;
    buf->data[buf->size++] = (v >> 16) & 0xFF;
    buf->data[buf->size++] = (v >> 8) & 0xFF;
    buf->data[buf->size++] = v & 0xFF;
}

static void buf_u16(Mp4Buffer* buf, uint16_t v) {
    buf_ensure(buf, 2);
    buf->data[buf->size++] = (v >> 8) & 0xFF;
    buf->data[buf->size++] = v & 0xFF;
}

static void buf_u8(Mp4Buffer* buf, uint8_t v) {
    buf_ensure(buf, 1);
    buf->data[buf->size++] = v;
}

static void buf_bytes(Mp4Buffer* buf, const void* data, size_t len) {
    buf_ensure(buf, len);
    memcpy(buf->data + buf->size, data, len);
    buf->size += len;
}

static void buf_fourcc(Mp4Buffer* buf, const char* fourcc) {
    buf_bytes(buf, fourcc, 4);
}

static size_t box_start(Mp4Buffer* buf, const char* type) {
    size_t off = buf->size;
    buf_u32(buf, 0);
    buf_fourcc(buf, type);
    return off;
}

static void box_end(Mp4Buffer* buf, size_t off) {
    uint32_t sz = buf->size - off;
    buf->data[off] = (sz >> 24) & 0xFF;
    buf->data[off + 1] = (sz >> 16) & 0xFF;
    buf->data[off + 2] = (sz >> 8) & 0xFF;
    buf->data[off + 3] = sz & 0xFF;
}

// Simple BMP writer for testing
void write_bmp(const char* filename, unsigned char* data, int width, int height) {
    FILE* f = fopen(filename, "wb");
    if (!f) return;

    int filesize = 54 + 3 * width * height;
    unsigned char bmpfileheader[14] = {'B','M', 0,0,0,0, 0,0, 0,0, 54,0,0,0};
    unsigned char bmpinfoheader[40] = {40,0,0,0, 0,0,0,0, 0,0,0,0, 1,0, 24,0};

    bmpfileheader[2] = (unsigned char)(filesize);
    bmpfileheader[3] = (unsigned char)(filesize >> 8);
    bmpfileheader[4] = (unsigned char)(filesize >> 16);
    bmpfileheader[5] = (unsigned char)(filesize >> 24);

    bmpinfoheader[4] = (unsigned char)(width);
    bmpinfoheader[5] = (unsigned char)(width >> 8);
    bmpinfoheader[6] = (unsigned char)(width >> 16);
    bmpinfoheader[7] = (unsigned char)(width >> 24);
    bmpinfoheader[8] = (unsigned char)(height);
    bmpinfoheader[9] = (unsigned char)(height >> 8);
    bmpinfoheader[10] = (unsigned char)(height >> 16);
    bmpinfoheader[11] = (unsigned char)(height >> 24);

    fwrite(bmpfileheader, 1, 14, f);
    fwrite(bmpinfoheader, 1, 40, f);

    for (int i = 0; i < height; i++) {
        fwrite(data + (width * (height - i - 1) * 3), 3, width, f);
    }

    fclose(f);
}

// Global state for video encoding
static unsigned char* video_buffer = NULL;
static int video_buffer_size = 0;
static int video_buffer_capacity = 0;

// Initialize video encoder
EMSCRIPTEN_KEEPALIVE
int init_encoder(int width, int height, int fps) {
    // Reset buffer
    if (video_buffer) {
        free(video_buffer);
    }
    video_buffer = NULL;
    video_buffer_size = 0;
    video_buffer_capacity = 0;

    // Allocate initial buffer (estimate)
    video_buffer_capacity = width * height * 4 * 10; // Initial capacity
    video_buffer = (unsigned char*)malloc(video_buffer_capacity);

    if (!video_buffer) {
        return 0;
    }

    return 1;
}

// Add a frame to the video
EMSCRIPTEN_KEEPALIVE
int add_frame(unsigned char* rgba_data, int width, int height, int frame_index) {
    // Simple concatenation for now - in production use proper video encoding
    int frame_size = width * height * 4;

    // Check if we need to resize buffer
    if (video_buffer_size + frame_size > video_buffer_capacity) {
        video_buffer_capacity *= 2;
        unsigned char* new_buffer = (unsigned char*)realloc(video_buffer, video_buffer_capacity);
        if (!new_buffer) {
            return 0;
        }
        video_buffer = new_buffer;
    }

    // Copy frame data
    memcpy(video_buffer + video_buffer_size, rgba_data, frame_size);
    video_buffer_size += frame_size;

    return 1;
}

// Finalize video encoding and return pointer to data
EMSCRIPTEN_KEEPALIVE
unsigned char* finalize_video(int* out_size) {
    *out_size = video_buffer_size;
    return video_buffer;
}

// Get pointer to video buffer
EMSCRIPTEN_KEEPALIVE
unsigned char* get_video_buffer() {
    return video_buffer;
}

// Get video buffer size
EMSCRIPTEN_KEEPALIVE
int get_video_size() {
    return video_buffer_size;
}

// Free resources
EMSCRIPTEN_KEEPALIVE
void cleanup() {
    if (video_buffer) {
        free(video_buffer);
        video_buffer = NULL;
    }
    video_buffer_size = 0;
    video_buffer_capacity = 0;
}

// Allocate memory in WASM heap
EMSCRIPTEN_KEEPALIVE
unsigned char* allocate_buffer(int size) {
    return (unsigned char*)malloc(size);
}

// Free memory in WASM heap
EMSCRIPTEN_KEEPALIVE
void free_buffer(unsigned char* buffer) {
    free(buffer);
}
