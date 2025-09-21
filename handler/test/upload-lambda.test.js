// handler/test/upload-lambda.test.js
const { handler } = require('../src/upload-lambda');
const { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { mockClient } = require('aws-sdk-client-mock');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const s3Mock = mockClient(S3Client);

describe('Lambda handler', () => {
  beforeAll(() => {
    const sampleImageBuffer = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'sample.jpg')
    );

    s3Mock.on(GetObjectCommand).resolves({ Body: Readable.from([sampleImageBuffer]) });
    s3Mock.on(PutObjectCommand).resolves({});
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] }); // avoid duplicate errors
  });

  afterAll(() => {
    s3Mock.reset();
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
});
