#!/bin/bash

# Nuclear S3 bucket deletion script
# This script will delete ALL versions, delete markers, and the bucket itself
# Use with extreme caution!

set -e

if [ $# -eq 0 ]; then
    echo "Usage: $0 <bucket-name> [bucket-name2] ..."
    exit 1
fi

for bucket in "$@"; do
    echo "🗑️  Nuking bucket: $bucket"
    
    # Check if bucket exists
    if ! aws s3api head-bucket --bucket "$bucket" 2>/dev/null; then
        echo "   ℹ️  Bucket $bucket does not exist, skipping"
        continue
    fi
    
    echo "   🧨 Deleting all object versions and delete markers..."
    
    # Get all versions and delete markers in a format suitable for batch delete
    versions=$(aws s3api list-object-versions --bucket "$bucket" --output json --max-items 1000)
    
    # Extract object identifiers for all versions
    if echo "$versions" | grep -q '"Versions"'; then
        echo "$versions" | \
        grep -A 1000 '"Versions"' | \
        grep -B 1000 '"DeleteMarkers"' | \
        sed -n '/"Key":/,/"VersionId":/p' | \
        sed 's/.*"Key": *"\([^"]*\)".*/Key=\1/' | \
        sed 's/.*"VersionId": *"\([^"]*\)".*/VersionId=\1/' | \
        paste - - | \
        sed 's/\t/\&/' | \
        head -1000 > /tmp/delete_batch_$$
        
        # Delete in batches
        if [ -s /tmp/delete_batch_$$ ]; then
            echo "   ⚡ Deleting $(wc -l < /tmp/delete_batch_$$) object versions..."
            while IFS='&' read -r key version; do
                aws s3api delete-object --bucket "$bucket" --key "${key#Key=}" --version-id "${version#VersionId=}" >/dev/null 2>&1 || true
            done < /tmp/delete_batch_$$
            rm -f /tmp/delete_batch_$$
        fi
    fi
    
    # Extract delete markers
    if echo "$versions" | grep -q '"DeleteMarkers"'; then
        echo "$versions" | \
        grep -A 1000 '"DeleteMarkers"' | \
        sed -n '/"Key":/,/"VersionId":/p' | \
        sed 's/.*"Key": *"\([^"]*\)".*/Key=\1/' | \
        sed 's/.*"VersionId": *"\([^"]*\)".*/VersionId=\1/' | \
        paste - - | \
        sed 's/\t/\&/' | \
        head -1000 > /tmp/delete_markers_$$
        
        # Delete delete markers
        if [ -s /tmp/delete_markers_$$ ]; then
            echo "   🎯 Deleting $(wc -l < /tmp/delete_markers_$$) delete markers..."
            while IFS='&' read -r key version; do
                aws s3api delete-object --bucket "$bucket" --key "${key#Key=}" --version-id "${version#VersionId=}" >/dev/null 2>&1 || true
            done < /tmp/delete_markers_$$
            rm -f /tmp/delete_markers_$$
        fi
    fi
    
    # Delete any remaining current objects
    echo "   🧹 Final cleanup of current objects..."
    aws s3 rm "s3://$bucket" --recursive --quiet 2>/dev/null || true
    
    # Delete the bucket itself
    echo "   💥 Deleting bucket..."
    if aws s3api delete-bucket --bucket "$bucket" 2>/dev/null; then
        echo "   ✅ Successfully deleted bucket: $bucket"
    else
        echo "   ❌ Failed to delete bucket: $bucket"
    fi
    
    echo ""
done

echo "🎉 Bucket deletion complete!"