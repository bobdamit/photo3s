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
        contentType: params.ContentType
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
    expect(result.processingMetrics.originalSizeMB).toBeDefined();
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
    
    // Should have uploaded 6 files: original + 4 processed versions + 1 metadata JSON
    expect(putObjectCalls).toHaveLength(6);

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

    // Verify the metadata versions structure matches our expectation
    expect(result.processedFiles).toContain(`${photoFolder}${originalFilename}`);
    expect(result.processedFiles).toContain(`${photoFolder}large.webp`);
    expect(result.processedFiles).toContain(`${photoFolder}medium.webp`);
    expect(result.processedFiles).toContain(`${photoFolder}small.webp`);
    expect(result.processedFiles).toContain(`${photoFolder}thumb.webp`);
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
    expect(putObjectCalls).toHaveLength(6);
  });
});
