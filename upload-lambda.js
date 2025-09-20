const AWS = require("aws-sdk");
const S3 = new AWS.S3();
const sharp = require("sharp");
const ExifParser = require("exif-parser");

// Supported image formats
const SUPPORTED_FORMATS = ["jpg", "jpeg", "png", "tiff", "tif", "webp"];

// Configuration from environment variables
const CONFIG = {
  // Comma-separated list of allowed source buckets (optional - if not set, allows any bucket)
  ALLOWED_SOURCE_BUCKETS: process.env.ALLOWED_SOURCE_BUCKETS?.split(',').map(b => b.trim()),
  
  // Target bucket for processed files (if different from source)
  PROCESSED_BUCKET: process.env.PROCESSED_BUCKET || null, // null means use same bucket as source
  
  // Prefix for processed files
  PROCESSED_PREFIX: process.env.PROCESSED_PREFIX || 'processed/',
  
  // Whether to delete original file after processing
  DELETE_ORIGINAL: process.env.DELETE_ORIGINAL === 'true',
  
  // Skip processing if file already in processed folder
  SKIP_PROCESSED_FOLDER: process.env.SKIP_PROCESSED_FOLDER !== 'false' // default true
};

exports.handler = async (event) => {
	console.log(
		"Photo processing Lambda triggered:",
		JSON.stringify(event, null, 2)
	);
	console.log("Configuration:", CONFIG);

	try {
		// Validate event structure
		if (!event.Records || event.Records.length === 0) {
			throw new Error("No S3 records found in event");
		}

		const record = event.Records[0];
		if (!record.s3 || !record.s3.bucket || !record.s3.object) {
			throw new Error("Invalid S3 record structure");
		}

		const sourceBucket = record.s3.bucket.name;
		const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
		
		// Determine target bucket (same as source or specified processed bucket)
		const targetBucket = CONFIG.PROCESSED_BUCKET || sourceBucket;

		console.log(`Processing file: ${sourceBucket}/${key} → ${targetBucket}`);
		
		// Check if source bucket is allowed (if restriction is configured)
		if (CONFIG.ALLOWED_SOURCE_BUCKETS && !CONFIG.ALLOWED_SOURCE_BUCKETS.includes(sourceBucket)) {
			console.log(`Bucket ${sourceBucket} not in allowed list: ${CONFIG.ALLOWED_SOURCE_BUCKETS.join(', ')}`);
			return { status: "skipped", reason: "bucket_not_allowed", bucket: sourceBucket };
		}

		// Check if file is already in processed folder to avoid infinite loops
		if (CONFIG.SKIP_PROCESSED_FOLDER && key.startsWith(CONFIG.PROCESSED_PREFIX)) {
			console.log("File already in processed folder, skipping");
			return { status: "skipped", reason: "already_processed" };
		}

		// Validate file extension
		const ext = key.split(".").pop()?.toLowerCase();
		if (!ext || !SUPPORTED_FORMATS.includes(ext)) {
			console.log(`Unsupported file format: ${ext}`);
			return {
				status: "skipped",
				reason: "unsupported_format",
				extension: ext,
			};
		}

		// Download image
		console.log("Downloading original image from S3");
		const original = await S3.getObject({ Bucket: sourceBucket, Key: key }).promise();

		if (!original.Body) {
			throw new Error("Failed to download image from S3");
		}

		// Parse EXIF data with error handling
		let exif = null;
		let exifDate = null;
		let camera = "unknown";

		try {
			console.log("Parsing EXIF data");
			const parser = ExifParser.create(original.Body);
			exif = parser.parse();

			// Extract date with multiple fallback options
			if (exif.tags.DateTimeOriginal) {
				exifDate = new Date(exif.tags.DateTimeOriginal * 1000);
			} else if (exif.tags.DateTime) {
				exifDate = new Date(exif.tags.DateTime * 1000);
			} else if (exif.tags.CreateDate) {
				exifDate = new Date(exif.tags.CreateDate * 1000);
			}

			camera = exif.tags.Make || "unknown";
			console.log(`EXIF data parsed - Date: ${exifDate}, Camera: ${camera}`);
		} catch (exifError) {
			console.warn("Failed to parse EXIF data:", exifError.message);
		}

		// Use EXIF date or fall back to current timestamp
		const shotDate = exifDate || new Date();
		const timestamp = shotDate
			.toISOString()
			.replace(/[:.]/g, "-")
			.replace("T", "_")
			.split(".")[0];
		const baseName = `photo-${timestamp}-${camera.replace(/\s+/g, "_")}`;

		console.log(`Generated base name: ${baseName}`);

		// Create multiple sizes for different use cases
		console.log("Creating image variations");
		const [large, medium, small, thumb] = await Promise.all([
			sharp(original.Body)
				.resize(1920, 1920, { fit: "inside", withoutEnlargement: true })
				.jpeg({ quality: 85 })
				.toBuffer(),
			sharp(original.Body)
				.resize(800, 800, { fit: "inside", withoutEnlargement: true })
				.jpeg({ quality: 80 })
				.toBuffer(),
			sharp(original.Body)
				.resize(400, 400, { fit: "inside", withoutEnlargement: true })
				.jpeg({ quality: 75 })
				.toBuffer(),
			sharp(original.Body)
				.resize(100, 100, { fit: "inside", withoutEnlargement: true })
				.jpeg({ quality: 70 })
				.toBuffer(),
		]);

		console.log("Image variations created successfully");

		// Get original image metadata for the JSON file
		const imageMetadata = await sharp(original.Body).metadata();

		// Create comprehensive metadata object
		const metadata = {
			originalKey: key,
			newBaseName: baseName,
			timestamp: shotDate.toISOString(),
			camera,
			fileSize: original.ContentLength || original.Body.length,
			originalDimensions: {
				width: imageMetadata.width,
				height: imageMetadata.height,
				format: imageMetadata.format,
			},
			exifData: exif
				? {
					make: exif.tags.Make,
					model: exif.tags.Model,
					dateTimeOriginal: exif.tags.DateTimeOriginal
						? new Date(exif.tags.DateTimeOriginal * 1000).toISOString()
						: null,
					iso: exif.tags.ISO,
					fNumber: exif.tags.FNumber,
					exposureTime: exif.tags.ExposureTime,
					focalLength: exif.tags.FocalLength,
					gps:
						exif.tags.GPSLatitude && exif.tags.GPSLongitude
							? {
								latitude: exif.tags.GPSLatitude,
								longitude: exif.tags.GPSLongitude,
							}
							: null,
				}
				: null,
			processedAt: new Date().toISOString(),
			versions: {
				original: `processed/${baseName}.${ext}`,
				large: `processed/${baseName}_large.jpg`,
				medium: `processed/${baseName}_medium.jpg`,
				small: `processed/${baseName}_small.jpg`,
				thumb: `processed/${baseName}_thumb.jpg`,
			},
		};

		// Upload all files in parallel for better performance
		console.log("Uploading processed files to S3");
		const uploadPromises = [];

		// Upload original with new name
		uploadPromises.push(
			S3.putObject({
				Bucket: bucket,
				Key: `processed/${baseName}.${ext}`,
				Body: original.Body,
				ContentType: original.ContentType,
				CacheControl: "public, max-age=31536000", // 1 year cache
				Metadata: {
					"original-key": key,
					"processed-at": new Date().toISOString(),
				},
			}).promise()
		);

		// Upload resized versions
		uploadPromises.push(
			S3.putObject({
				Bucket: bucket,
				Key: `processed/${baseName}_large.jpg`,
				Body: large,
				ContentType: "image/jpeg",
				CacheControl: "public, max-age=31536000",
			}).promise()
		);

		uploadPromises.push(
			S3.putObject({
				Bucket: bucket,
				Key: `processed/${baseName}_medium.jpg`,
				Body: medium,
				ContentType: "image/jpeg",
				CacheControl: "public, max-age=31536000",
			}).promise()
		);

		uploadPromises.push(
			S3.putObject({
				Bucket: bucket,
				Key: `processed/${baseName}_small.jpg`,
				Body: small,
				ContentType: "image/jpeg",
				CacheControl: "public, max-age=31536000",
			}).promise()
		);

		uploadPromises.push(
			S3.putObject({
				Bucket: bucket,
				Key: `processed/${baseName}_thumb.jpg`,
				Body: thumb,
				ContentType: "image/jpeg",
				CacheControl: "public, max-age=31536000",
			}).promise()
		);

		// Upload metadata JSON
		uploadPromises.push(
			S3.putObject({
				Bucket: bucket,
				Key: `processed/${baseName}.json`,
				Body: JSON.stringify(metadata, null, 2),
				ContentType: "application/json",
				CacheControl: "public, max-age=3600", // 1 hour cache for metadata
			}).promise()
		);

		// Wait for all uploads to complete
		await Promise.all(uploadPromises);
		console.log("All files uploaded successfully");

		return {
			status: "success",
			baseName,
			originalKey: key,
			processedFiles: Object.values(metadata.versions),
			metadata: `processed/${baseName}.json`,
		};
	} catch (error) {
		console.error("Error processing photo:", error);

		// Return detailed error information
		return {
			status: "error",
			error: error.message,
			stack: error.stack,
			originalKey: key || "unknown",
		};
	}
};
