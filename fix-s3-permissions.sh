#!/bin/bash
# Quick fix for Lambda S3 permissions
# Run this manually if the GitHub Action isn't working

echo "🔧 Quick Fix: Setting S3 permissions for Lambda"
echo "=============================================="

ROLE_NAME="lambda-execution-role"
BUCKET_NAME="rs-photos-mics"  # Change this to your bucket name if different

echo "📝 Creating S3 policy for bucket: $BUCKET_NAME"

cat > temp-s3-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:GetObjectMetadata",
        "s3:GetObjectAttributes"
      ],
      "Resource": [
        "arn:aws:s3:::${BUCKET_NAME}/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::${BUCKET_NAME}"
      ]
    }
  ]
}
EOF

echo "📄 Policy content:"
cat temp-s3-policy.json

echo ""
echo "🔗 Applying policy to role: $ROLE_NAME"
aws iam put-role-policy \
  --role-name $ROLE_NAME \
  --policy-name S3PhotoProcessingPolicy \
  --policy-document file://temp-s3-policy.json

if [ $? -eq 0 ]; then
  echo "✅ SUCCESS: S3 permissions updated"
  echo ""
  echo "🔍 Verifying policy:"
  aws iam get-role-policy \
    --role-name $ROLE_NAME \
    --policy-name S3PhotoProcessingPolicy \
    --query 'PolicyDocument' \
    --output json
  
  echo ""
  echo "🎉 Your Lambda should now have s3:PutObject permissions!"
  echo "Try uploading a photo to test."
else
  echo "❌ FAILED: Could not update policy"
  echo "Please check your AWS credentials and permissions"
fi

# Cleanup
rm -f temp-s3-policy.json