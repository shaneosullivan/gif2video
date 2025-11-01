/**
 * MP4 muxer for WebCodecs H.264 output
 * Takes multiple H.264 encoded frames and creates a valid MP4 container
 */

#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

#define MAX_FRAMES 10000
#define MAX_BUFFER_SIZE (100 * 1024 * 1024) // 100 MB max

typedef struct {
    uint8_t* data;
    size_t size;
    size_t capacity;
} Buffer;

typedef struct {
    uint8_t* data;
    uint32_t size;
    uint32_t timestamp; // in microseconds
    int is_keyframe;
} Frame;

typedef struct {
    Frame frames[MAX_FRAMES];
    int frame_count;
    uint32_t width;
    uint32_t height;
    Buffer output;
    uint8_t* decoder_config;
    uint32_t decoder_config_size;
} Muxer;

static Muxer* muxer = NULL;

// Buffer utilities
static void buffer_init(Buffer* buf, size_t capacity) {
    buf->data = (uint8_t*)malloc(capacity);
    buf->size = 0;
    buf->capacity = capacity;
}

static void buffer_ensure(Buffer* buf, size_t needed) {
    if (buf->size + needed > buf->capacity) {
        size_t new_cap = (buf->size + needed) * 2;
        uint8_t* new_data = (uint8_t*)realloc(buf->data, new_cap);
        if (new_data) {
            buf->data = new_data;
            buf->capacity = new_cap;
        }
    }
}

static void buffer_write_u32(Buffer* buf, uint32_t value) {
    buffer_ensure(buf, 4);
    buf->data[buf->size++] = (value >> 24) & 0xFF;
    buf->data[buf->size++] = (value >> 16) & 0xFF;
    buf->data[buf->size++] = (value >> 8) & 0xFF;
    buf->data[buf->size++] = value & 0xFF;
}

static void buffer_write_u16(Buffer* buf, uint16_t value) {
    buffer_ensure(buf, 2);
    buf->data[buf->size++] = (value >> 8) & 0xFF;
    buf->data[buf->size++] = value & 0xFF;
}

static void buffer_write_u8(Buffer* buf, uint8_t value) {
    buffer_ensure(buf, 1);
    buf->data[buf->size++] = value;
}

static void buffer_write_bytes(Buffer* buf, const void* data, size_t len) {
    buffer_ensure(buf, len);
    memcpy(buf->data + buf->size, data, len);
    buf->size += len;
}

static void buffer_write_fourcc(Buffer* buf, const char* fourcc) {
    buffer_write_bytes(buf, fourcc, 4);
}

static size_t box_start(Buffer* buf, const char* type) {
    size_t offset = buf->size;
    buffer_write_u32(buf, 0);
    buffer_write_fourcc(buf, type);
    return offset;
}

static void box_end(Buffer* buf, size_t offset) {
    uint32_t size = buf->size - offset;
    buf->data[offset] = (size >> 24) & 0xFF;
    buf->data[offset + 1] = (size >> 16) & 0xFF;
    buf->data[offset + 2] = (size >> 8) & 0xFF;
    buf->data[offset + 3] = size & 0xFF;
}

// Initialize muxer
int init_webcodecs_muxer(uint32_t width, uint32_t height) {
    if (muxer) {
        free(muxer);
    }

    muxer = (Muxer*)calloc(1, sizeof(Muxer));
    if (!muxer) return 0;

    muxer->width = width;
    muxer->height = height;
    muxer->frame_count = 0;
    muxer->decoder_config = NULL;
    muxer->decoder_config_size = 0;
    buffer_init(&muxer->output, 1024 * 1024); // Start with 1MB

    return 1;
}

// Set decoder configuration (avcC description record from WebCodecs)
int set_decoder_config(const uint8_t* config_data, uint32_t config_size) {
    if (!muxer) return 0;

    if (muxer->decoder_config) {
        free(muxer->decoder_config);
    }

    muxer->decoder_config = (uint8_t*)malloc(config_size);
    if (!muxer->decoder_config) return 0;

    memcpy(muxer->decoder_config, config_data, config_size);
    muxer->decoder_config_size = config_size;

    return 1;
}

// Add an H.264 encoded frame
int add_h264_frame(const uint8_t* data, uint32_t size, uint32_t timestamp, int is_keyframe) {
    if (!muxer || muxer->frame_count >= MAX_FRAMES) return 0;

    Frame* frame = &muxer->frames[muxer->frame_count];
    frame->data = (uint8_t*)malloc(size);
    if (!frame->data) return 0;

    memcpy(frame->data, data, size);
    frame->size = size;
    frame->timestamp = timestamp;
    frame->is_keyframe = is_keyframe;

    muxer->frame_count++;
    return 1;
}

// Write ftyp box
static void write_ftyp(Buffer* buf) {
    size_t start = box_start(buf, "ftyp");
    buffer_write_fourcc(buf, "isom");
    buffer_write_u32(buf, 512);
    buffer_write_fourcc(buf, "isom");
    buffer_write_fourcc(buf, "iso2");
    buffer_write_fourcc(buf, "avc1");
    buffer_write_fourcc(buf, "mp41");
    box_end(buf, start);
}

// Write mdat box with all frame data
static void write_mdat(Buffer* buf) {
    size_t start = box_start(buf, "mdat");

    for (int i = 0; i < muxer->frame_count; i++) {
        Frame* frame = &muxer->frames[i];
        // Write frame size as 4-byte length prefix
        buffer_write_u32(buf, frame->size);
        buffer_write_bytes(buf, frame->data, frame->size);
    }

    box_end(buf, start);
}

// Write avc1 sample description
static void write_avc1(Buffer* buf) {
    size_t start = box_start(buf, "avc1");

    // Reserved (6 bytes)
    for (int i = 0; i < 6; i++) buffer_write_u8(buf, 0);
    buffer_write_u16(buf, 1); // Data reference index

    // Video sample description
    buffer_write_u16(buf, 0); // Pre-defined
    buffer_write_u16(buf, 0); // Reserved
    for (int i = 0; i < 3; i++) buffer_write_u32(buf, 0); // Pre-defined

    buffer_write_u16(buf, muxer->width);
    buffer_write_u16(buf, muxer->height);
    buffer_write_u32(buf, 0x00480000); // Horizontal resolution (72 dpi)
    buffer_write_u32(buf, 0x00480000); // Vertical resolution (72 dpi)
    buffer_write_u32(buf, 0); // Reserved
    buffer_write_u16(buf, 1); // Frame count

    // Compressor name (32 bytes, first byte is length)
    buffer_write_u8(buf, 0);
    for (int i = 0; i < 31; i++) buffer_write_u8(buf, 0);

    buffer_write_u16(buf, 0x0018); // Depth
    buffer_write_u16(buf, 0xFFFF); // Pre-defined

    // avcC box (decoder configuration from WebCodecs)
    size_t avcc_start = box_start(buf, "avcC");
    if (muxer->decoder_config && muxer->decoder_config_size > 0) {
        // Use the decoder config from WebCodecs (contains SPS/PPS)
        buffer_write_bytes(buf, muxer->decoder_config, muxer->decoder_config_size);
    } else {
        // Fallback: minimal avcC without SPS/PPS
        buffer_write_u8(buf, 1); // configurationVersion
        buffer_write_u8(buf, 0x42); // AVCProfileIndication (Baseline)
        buffer_write_u8(buf, 0x00); // profile_compatibility
        buffer_write_u8(buf, 0x1E); // AVCLevelIndication
        buffer_write_u8(buf, 0xFF); // lengthSizeMinusOne (4 bytes)
        buffer_write_u8(buf, 0xE0); // numOfSequenceParameterSets (0)
        buffer_write_u8(buf, 0x00); // numOfPictureParameterSets (0)
    }
    box_end(buf, avcc_start);

    box_end(buf, start);
}

// Write stsd box (sample descriptions)
static void write_stsd(Buffer* buf) {
    size_t start = box_start(buf, "stsd");
    buffer_write_u32(buf, 0); // version + flags
    buffer_write_u32(buf, 1); // entry count
    write_avc1(buf);
    box_end(buf, start);
}

// Write stts box (time-to-sample)
static void write_stts(Buffer* buf) {
    size_t start = box_start(buf, "stts");
    buffer_write_u32(buf, 0); // version + flags
    buffer_write_u32(buf, 1); // entry count
    buffer_write_u32(buf, muxer->frame_count); // sample count

    // Calculate average delta (in timescale units)
    uint32_t avg_delta = 1000; // Default to ~30fps (assuming timescale=30000)
    if (muxer->frame_count > 1) {
        uint32_t total_duration = muxer->frames[muxer->frame_count - 1].timestamp - muxer->frames[0].timestamp;
        avg_delta = (total_duration * 30) / (muxer->frame_count - 1) / 1000; // Convert microseconds to timescale units
    }

    buffer_write_u32(buf, avg_delta); // sample delta
    box_end(buf, start);
}

// Write stsc box (sample-to-chunk)
static void write_stsc(Buffer* buf) {
    size_t start = box_start(buf, "stsc");
    buffer_write_u32(buf, 0); // version + flags
    buffer_write_u32(buf, 1); // entry count
    buffer_write_u32(buf, 1); // first chunk
    buffer_write_u32(buf, muxer->frame_count); // samples per chunk
    buffer_write_u32(buf, 1); // sample description index
    box_end(buf, start);
}

// Write stsz box (sample sizes)
static void write_stsz(Buffer* buf) {
    size_t start = box_start(buf, "stsz");
    buffer_write_u32(buf, 0); // version + flags
    buffer_write_u32(buf, 0); // sample size (0 = variable)
    buffer_write_u32(buf, muxer->frame_count); // sample count

    for (int i = 0; i < muxer->frame_count; i++) {
        buffer_write_u32(buf, muxer->frames[i].size + 4); // +4 for length prefix
    }

    box_end(buf, start);
}

// Write stco box (chunk offsets)
static void write_stco(Buffer* buf, uint32_t mdat_offset) {
    size_t start = box_start(buf, "stco");
    buffer_write_u32(buf, 0); // version + flags
    buffer_write_u32(buf, 1); // entry count
    buffer_write_u32(buf, mdat_offset + 8); // chunk offset (mdat start + box header)
    box_end(buf, start);
}

// Write stss box (sync samples / keyframes)
static void write_stss(Buffer* buf) {
    // Count keyframes
    int keyframe_count = 0;
    for (int i = 0; i < muxer->frame_count; i++) {
        if (muxer->frames[i].is_keyframe) keyframe_count++;
    }

    if (keyframe_count == 0) return; // No keyframes, skip this box

    size_t start = box_start(buf, "stss");
    buffer_write_u32(buf, 0); // version + flags
    buffer_write_u32(buf, keyframe_count); // entry count

    for (int i = 0; i < muxer->frame_count; i++) {
        if (muxer->frames[i].is_keyframe) {
            buffer_write_u32(buf, i + 1); // sample number (1-indexed)
        }
    }

    box_end(buf, start);
}

// Write stbl box (sample table)
static void write_stbl(Buffer* buf, uint32_t mdat_offset) {
    size_t start = box_start(buf, "stbl");
    write_stsd(buf);
    write_stts(buf);
    write_stsc(buf);
    write_stsz(buf);
    write_stco(buf, mdat_offset);
    write_stss(buf);
    box_end(buf, start);
}

// Write minf box (media information)
static void write_minf(Buffer* buf, uint32_t mdat_offset) {
    size_t start = box_start(buf, "minf");

    // vmhd (video media header)
    size_t vmhd_start = box_start(buf, "vmhd");
    buffer_write_u32(buf, 1); // version + flags (flags = 1)
    buffer_write_u16(buf, 0); // graphicsmode
    buffer_write_u16(buf, 0); // opcolor[0]
    buffer_write_u16(buf, 0); // opcolor[1]
    buffer_write_u16(buf, 0); // opcolor[2]
    box_end(buf, vmhd_start);

    // dinf (data information)
    size_t dinf_start = box_start(buf, "dinf");
    size_t dref_start = box_start(buf, "dref");
    buffer_write_u32(buf, 0); // version + flags
    buffer_write_u32(buf, 1); // entry count
    size_t url_start = box_start(buf, "url ");
    buffer_write_u32(buf, 1); // version + flags (flags = 1, self-contained)
    box_end(buf, url_start);
    box_end(buf, dref_start);
    box_end(buf, dinf_start);

    write_stbl(buf, mdat_offset);

    box_end(buf, start);
}

// Write mdia box (media)
static void write_mdia(Buffer* buf, uint32_t mdat_offset) {
    size_t start = box_start(buf, "mdia");

    // mdhd (media header)
    size_t mdhd_start = box_start(buf, "mdhd");
    buffer_write_u32(buf, 0); // version + flags
    buffer_write_u32(buf, 0); // creation time
    buffer_write_u32(buf, 0); // modification time
    buffer_write_u32(buf, 30000); // timescale (30000 units per second)

    // Calculate duration
    uint32_t duration = 30000; // default
    if (muxer->frame_count > 0) {
        uint32_t last_timestamp = muxer->frames[muxer->frame_count - 1].timestamp;
        duration = (last_timestamp * 30) / 1000; // Convert microseconds to timescale units
    }
    buffer_write_u32(buf, duration); // duration

    buffer_write_u16(buf, 0x55C4); // language (und = undetermined)
    buffer_write_u16(buf, 0); // pre-defined
    box_end(buf, mdhd_start);

    // hdlr (handler)
    size_t hdlr_start = box_start(buf, "hdlr");
    buffer_write_u32(buf, 0); // version + flags
    buffer_write_u32(buf, 0); // pre-defined
    buffer_write_fourcc(buf, "vide"); // handler type
    buffer_write_u32(buf, 0); // reserved
    buffer_write_u32(buf, 0); // reserved
    buffer_write_u32(buf, 0); // reserved
    buffer_write_u8(buf, 0); // name (empty string)
    box_end(buf, hdlr_start);

    write_minf(buf, mdat_offset);

    box_end(buf, start);
}

// Write trak box (track)
static void write_trak(Buffer* buf, uint32_t mdat_offset) {
    size_t start = box_start(buf, "trak");

    // tkhd (track header)
    size_t tkhd_start = box_start(buf, "tkhd");
    buffer_write_u32(buf, 0x00000007); // version + flags (enabled, in movie, in preview)
    buffer_write_u32(buf, 0); // creation time
    buffer_write_u32(buf, 0); // modification time
    buffer_write_u32(buf, 1); // track ID
    buffer_write_u32(buf, 0); // reserved

    // Calculate duration
    uint32_t duration = 1000; // default
    if (muxer->frame_count > 0) {
        uint32_t last_timestamp = muxer->frames[muxer->frame_count - 1].timestamp;
        duration = last_timestamp / 1000; // Convert microseconds to milliseconds
    }
    buffer_write_u32(buf, duration); // duration (in movie timescale)

    buffer_write_u32(buf, 0); // reserved
    buffer_write_u32(buf, 0); // reserved
    buffer_write_u16(buf, 0); // layer
    buffer_write_u16(buf, 0); // alternate group
    buffer_write_u16(buf, 0); // volume
    buffer_write_u16(buf, 0); // reserved

    // Matrix
    buffer_write_u32(buf, 0x00010000); buffer_write_u32(buf, 0);
    buffer_write_u32(buf, 0); buffer_write_u32(buf, 0);
    buffer_write_u32(buf, 0); buffer_write_u32(buf, 0x00010000);
    buffer_write_u32(buf, 0); buffer_write_u32(buf, 0);
    buffer_write_u32(buf, 0); buffer_write_u32(buf, 0x40000000);

    buffer_write_u32(buf, muxer->width << 16); // width
    buffer_write_u32(buf, muxer->height << 16); // height
    box_end(buf, tkhd_start);

    write_mdia(buf, mdat_offset);

    box_end(buf, start);
}

// Write moov box (movie)
static void write_moov(Buffer* buf, uint32_t mdat_offset) {
    size_t start = box_start(buf, "moov");

    // mvhd (movie header)
    size_t mvhd_start = box_start(buf, "mvhd");
    buffer_write_u32(buf, 0); // version + flags
    buffer_write_u32(buf, 0); // creation time
    buffer_write_u32(buf, 0); // modification time
    buffer_write_u32(buf, 1000); // timescale (1000 = 1ms)

    // Calculate duration
    uint32_t duration = 1000; // default
    if (muxer->frame_count > 0) {
        uint32_t last_timestamp = muxer->frames[muxer->frame_count - 1].timestamp;
        duration = last_timestamp / 1000; // Convert microseconds to milliseconds
    }
    buffer_write_u32(buf, duration); // duration

    buffer_write_u32(buf, 0x00010000); // rate (1.0)
    buffer_write_u16(buf, 0x0100); // volume (1.0)
    buffer_write_u16(buf, 0); // reserved
    buffer_write_u32(buf, 0); buffer_write_u32(buf, 0); // reserved

    // Matrix
    buffer_write_u32(buf, 0x00010000); buffer_write_u32(buf, 0);
    buffer_write_u32(buf, 0); buffer_write_u32(buf, 0);
    buffer_write_u32(buf, 0); buffer_write_u32(buf, 0x00010000);
    buffer_write_u32(buf, 0); buffer_write_u32(buf, 0);
    buffer_write_u32(buf, 0); buffer_write_u32(buf, 0x40000000);

    // Pre-defined
    for (int i = 0; i < 6; i++) buffer_write_u32(buf, 0);

    buffer_write_u32(buf, 2); // next track ID
    box_end(buf, mvhd_start);

    write_trak(buf, mdat_offset);

    box_end(buf, start);
}

// Finalize and get MP4 data
const uint8_t* finalize_webcodecs_mp4(uint32_t* out_size) {
    if (!muxer || muxer->frame_count == 0) {
        *out_size = 0;
        return NULL;
    }

    // Build MP4 structure
    write_ftyp(&muxer->output);

    // Remember where mdat will be
    uint32_t mdat_offset = muxer->output.size;
    write_mdat(&muxer->output);

    // Write moov with correct mdat offset
    write_moov(&muxer->output, mdat_offset);

    *out_size = muxer->output.size;
    return muxer->output.data;
}

// Cleanup
void cleanup_webcodecs_muxer() {
    if (!muxer) return;

    for (int i = 0; i < muxer->frame_count; i++) {
        if (muxer->frames[i].data) {
            free(muxer->frames[i].data);
        }
    }

    if (muxer->output.data) {
        free(muxer->output.data);
    }

    if (muxer->decoder_config) {
        free(muxer->decoder_config);
    }

    free(muxer);
    muxer = NULL;
}
