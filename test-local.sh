#!/bin/bash

# Test script for photo processing Lambda
# This creates a sample S3 event for local testing

echo "🧪 Testing Photo Processing Lambda Locally"
echo "=========================================="

# Check if we have a test image
if [ ! -f "test-photo.jpg" ]; then
    echo "❌ No test-photo.jpg found in current directory"
    echo "Please add a test image file named 'test-photo.jpg' to test locally"
    exit 1
fi

# Create a mock S3 event
cat > test-event.json << EOF
{
  "Records": [
    {
      "eventVersion": "2.1",
      "eventSource": "aws:s3",
      "awsRegion": "us-east-1",
      "eventTime": "2023-09-19T12:00:00.000Z",
      "eventName": "ObjectCreated:Put",
      "s3": {
        "s3SchemaVersion": "1.0",
        "configurationId": "test",
        "bucket": {
          "name": "test-bucket",
          "arn": "arn:aws:s3:::test-bucket"
        },
        "object": {
          "key": "test-photo.jpg",
          "size": 1024000,
          "eTag": "d41d8cd98f00b204e9800998ecf8427e"
        }
      }
    }
  ]
}
EOF

echo "✅ Created test event file: test-event.json"
echo ""
echo "To test locally, you can:"
echo "1. Use AWS SAM CLI:"
echo "   sam local invoke -e test-event.json"
echo ""
echo "2. Or create a simple Node.js test file:"
echo "   node -e \"const lambda = require('./upload-lambda'); lambda.handler($(cat test-event.json))\""
echo ""
echo "Note: Local testing requires AWS credentials and the actual S3 bucket to exist."