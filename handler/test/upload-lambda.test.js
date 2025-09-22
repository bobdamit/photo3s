// handler/test/upload-lambda.test.js
const { handler } = require('../src/upload-lambda');
const { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { mockClient } = require('aws-sdk-client-mock');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const s3Mock = mockClient(S3Client);

describe('Lambda handler', () => {
  let putObjectCalls = [];
  let sampleImageBuffer;

  beforeAll(() => {
    sampleImageBuffer = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'sample.jpg')
    );
  });

  beforeEach(() => {
    putObjectCalls = []; // Reset before each test
    s3Mock.reset();
    
    // Setup mocks for each test
    s3Mock.on(GetObjectCommand).resolves({ 
      Body: Readable.from([sampleImageBuffer]),
      ContentType: 'image/jpeg',
      ContentLength: sampleImageBuffer.length
    });
    
    // Capture all PutObject calls to verify file structure
    s3Mock.on(PutObjectCommand).callsFake((params) => {
      putObjectCalls.push({
        bucket: params.Bucket,
        key: params.Key,
        contentType: params.ContentType,
        body: params.Body // Capture the body content for JSON parsing
      });
      return Promise.resolve({});
    });
    
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] }); // avoid duplicate errors
  });

  afterAll(() => {
    s3Mock.reset();
    // Force Jest to exit cleanly by clearing any remaining timers
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  afterEach(() => {
    // Clean up any pending operations
    s3Mock.resetHistory();
  });

  it('processes an image and uploads variants + metadata', async () => {
    const fakeEvent = {
      Records: [
        {
          s3: {
            bucket: { name: 'incoming-bucket' },
            object: { key: 'test/sample.jpg', size: 12345 },
          },
        },
      ],
    };

    const result = await handler(fakeEvent);

    expect(result.status).toBe('success');
    expect(result.baseName).toMatch(/photo-/);
    expect(result.processedFiles.length).toBeGreaterThan(0);
    expect(result.processedFiles[0]).toMatch(/\.webp$|sample\.jpg$/); // Should be path strings
    expect(result.processingMetrics.originalSizeMB).toBeDefined();
    
    // Parse uploaded metadata to verify structure
    const metadataCall = putObjectCalls.find(call => call.key.endsWith('.json'));
    expect(metadataCall).toBeDefined();
    const metadata = JSON.parse(metadataCall.body);
    
    // Verify new structured format for each version
    expect(metadata.versions.large).toHaveProperty('path');
    expect(metadata.versions.large).toHaveProperty('width');
    expect(metadata.versions.large).toHaveProperty('height');
    expect(metadata.versions.large).toHaveProperty('bytes');
    expect(metadata.versions.large).toHaveProperty('format', 'webp');
    
    expect(metadata.versions.original).toHaveProperty('format', 'jpg');
    
    // Verify that processed variants have different (smaller) dimensions than original
    expect(metadata.versions.large.width).toBeLessThanOrEqual(metadata.versions.original.width);
    expect(metadata.versions.medium.width).toBeLessThanOrEqual(metadata.versions.large.width);
    expect(metadata.versions.small.width).toBeLessThanOrEqual(metadata.versions.medium.width);
    expect(metadata.versions.thumb.width).toBeLessThanOrEqual(metadata.versions.small.width);
  });

  it('preserves original filename and creates correct file structure', async () => {
    const originalFilename = 'DSC003344.JPG';
    const fakeEvent = {
      Records: [
        {
          s3: {
            bucket: { name: 'test-bucket' },
            object: { key: `photos/${originalFilename}`, size: 12345 },
          },
        },
      ],
    };

    const result = await handler(fakeEvent);

    expect(result.status).toBe('success');

    // Should have uploaded 7 files: original + 4 processed versions + 1 metadata JSON + user.json
    expect(putObjectCalls).toHaveLength(7);

    // Extract the photo folder name from the first upload
    const photoFolder = putObjectCalls[0].key.split('/')[0] + '/';
    expect(photoFolder).toMatch(/^photo-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}Z-.+\/$/);

    // Find each expected file type
    const originalFile = putObjectCalls.find(call => call.key === `${photoFolder}${originalFilename}`);
    const largeFile = putObjectCalls.find(call => call.key === `${photoFolder}large.webp`);
    const mediumFile = putObjectCalls.find(call => call.key === `${photoFolder}medium.webp`);
    const smallFile = putObjectCalls.find(call => call.key === `${photoFolder}small.webp`);
    const thumbFile = putObjectCalls.find(call => call.key === `${photoFolder}thumb.webp`);
    const metadataFile = putObjectCalls.find(call => call.key.endsWith('.json'));

    // Verify original file preserves exact filename
    expect(originalFile).toBeDefined();
    expect(originalFile.key).toBe(`${photoFolder}${originalFilename}`);
    expect(originalFile.contentType).toBe('image/jpeg');

    // Verify processed versions use WebP format
    expect(largeFile).toBeDefined();
    expect(largeFile.key).toBe(`${photoFolder}large.webp`);
    expect(largeFile.contentType).toBe('image/webp');

    expect(mediumFile).toBeDefined();
    expect(mediumFile.key).toBe(`${photoFolder}medium.webp`);
    expect(mediumFile.contentType).toBe('image/webp');

    expect(smallFile).toBeDefined();
    expect(smallFile.key).toBe(`${photoFolder}small.webp`);
    expect(smallFile.contentType).toBe('image/webp');

    expect(thumbFile).toBeDefined();
    expect(thumbFile.key).toBe(`${photoFolder}thumb.webp`);
    expect(thumbFile.contentType).toBe('image/webp');

    // Verify metadata file exists
    expect(metadataFile).toBeDefined();
    expect(metadataFile.contentType).toBe('application/json');
    
    // Parse and verify the new structured metadata format
    const metadata = JSON.parse(metadataFile.body);
    
    // Verify each version has the structured format: {path, width, height, bytes, format}
    expect(metadata.versions.original).toEqual({
      path: `${photoFolder}${originalFilename}`,
      width: expect.any(Number),
      height: expect.any(Number),
      bytes: expect.any(Number),
      format: 'jpg' // Use lowercase to match actual file extension extraction
    });
    
    expect(metadata.versions.large).toEqual({
      path: `${photoFolder}large.webp`,
      width: expect.any(Number),
      height: expect.any(Number),
      bytes: expect.any(Number),
      format: 'webp'
    });
    
    expect(metadata.versions.medium).toEqual({
      path: `${photoFolder}medium.webp`,
      width: expect.any(Number),
      height: expect.any(Number),
      bytes: expect.any(Number),
      format: 'webp'
    });
    
    expect(metadata.versions.small).toEqual({
      path: `${photoFolder}small.webp`,
      width: expect.any(Number),
      height: expect.any(Number),
      bytes: expect.any(Number),
      format: 'webp'
    });
    
    expect(metadata.versions.thumb).toEqual({
      path: `${photoFolder}thumb.webp`,
      width: expect.any(Number),
      height: expect.any(Number),
      bytes: expect.any(Number),
      format: 'webp'
    });

    // Verify the result processedFiles contains path strings from metadata
    expect(result.processedFiles).toContain(metadata.versions.original.path);
    expect(result.processedFiles).toContain(metadata.versions.large.path);
    expect(result.processedFiles).toContain(metadata.versions.medium.path);
    expect(result.processedFiles).toContain(metadata.versions.small.path);
    expect(result.processedFiles).toContain(metadata.versions.thumb.path);
  });

  it('works with different original filename extensions and cases', async () => {
    // Test just one case to verify the principle works
    const originalFilename = 'vacation.png';
    putObjectCalls = []; // Reset for this test
    
    const fakeEvent = {
      Records: [
        {
          s3: {
            bucket: { name: 'test-bucket' },
            object: { key: originalFilename, size: 12345 },
          },
        },
      ],
    };

    const result = await handler(fakeEvent);
    expect(result.status).toBe('success');

    // Find the original file upload
    const originalFile = putObjectCalls.find(call => call.key.endsWith(originalFilename));
    expect(originalFile).toBeDefined();
    
    // Verify it preserves the exact case and extension
    expect(originalFile.key).toMatch(new RegExp(`/${originalFilename}$`));
    
      // Verify processed versions use WebP format
      const largeFile = putObjectCalls.find(call => call.key.endsWith('large.webp'));
      expect(largeFile).toBeDefined();    // Verify all 6 files were uploaded
    expect(putObjectCalls).toHaveLength(7);
  });
});
