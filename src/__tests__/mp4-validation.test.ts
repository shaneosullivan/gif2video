import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileTypeFromBuffer } from 'file-type';
import { describe, expect, it } from 'vitest';

describe('MP4 Validation', () => {
  it('should generate a valid MP4 file', async () => {
    const testFile = './tests/images/test-animated.mp4';

    // Check file exists
    expect(existsSync(testFile)).toBe(true);

    // Read file and check type
    const buffer = await readFile(testFile);
    const fileType = await fileTypeFromBuffer(buffer);

    // Validate it's a valid video file
    expect(fileType).toBeDefined();
    expect(fileType?.ext).toMatch(/^(mp4|webm|avi|mov)$/);
    expect(fileType?.mime).toContain('video/');
  });

  it('should have valid MP4 header', async () => {
    const testFile = './tests/images/test-animated.mp4';
    const buffer = await readFile(testFile);

    // MP4 files should start with ftyp box
    // Valid MP4 files typically have 'ftyp' at offset 4
    const ftypOffset = buffer.indexOf('ftyp', 0, 'utf8');
    expect(ftypOffset).toBeGreaterThanOrEqual(0);
    expect(ftypOffset).toBeLessThan(20); // Should be near the start
  });

  it('should not be just raw frame data', async () => {
    const testFile = './tests/images/test-animated.mp4';
    const buffer = await readFile(testFile);

    // Check that it's not just 0xFF bytes (raw RGBA data)
    const first100Bytes = buffer.subarray(0, 100);
    const allFF = first100Bytes.every((byte) => byte === 0xff);
    expect(allFF).toBe(false);

    // Check for some variation in the data
    const uniqueBytes = new Set(buffer.subarray(0, 1000));
    expect(uniqueBytes.size).toBeGreaterThan(10); // Should have variety
  });
});
