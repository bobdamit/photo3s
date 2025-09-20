const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command, CopyObjectCommand } = require("@aws-sdk/client-s3");
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
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
	DELETE_ORIGINAL: process.env.DELETE_ORIGINAL !== 'false',

	// Whether to check for duplicates before processing
	CHECK_DUPLICATES: process.env.CHECK_DUPLICATES !== 'false', // default true

	// What to do with duplicate originals: 'delete', 'move', 'keep'
	DUPLICATE_ACTION: process.env.DUPLICATE_ACTION || 'move',

	// Prefix for duplicate files (when DUPLICATE_ACTION is 'move')
	DUPLICATES_PREFIX: process.env.DUPLICATES_PREFIX || 'duplicates/',

	// Skip processing if file already in processed folder
	SKIP_PROCESSED_FOLDER: process.env.SKIP_PROCESSED_FOLDER !== 'false' // default true
};

/**
 * Check for potential duplicates by searching existing processed files
 * Uses date-based prefix searching for efficiency
 */
async function checkForDuplicates(targetBucket, shotDate, camera, fileSize, exif, processedPrefix) {
	try {
		const dateStr = shotDate.toISOString().split('T')[0]; // YYYY-MM-DD
		const searchPrefix = `${processedPrefix}photo-${dateStr.replace(/[:.]/g, "-")}`;
		
		console.info(`Searching for duplicates with prefix: ${searchPrefix}`);
		
		// List objects with date-based prefix to narrow search
		const listCommand = new ListObjectsV2Command({
			Bucket: targetBucket,
			Prefix: searchPrefix,
			MaxKeys: 100 // Reasonable limit for same-day photos
		});
		
		const response = await s3Client.send(listCommand);
		
		if (!response.Contents || response.Contents.length === 0) {
			return { isDuplicate: false, filesChecked: 0 };
		}
		
		console.info(`Found ${response.Contents.length} existing files from same date`);
		
		// Look for JSON metadata files to compare
		const jsonFiles = response.Contents.filter(obj => obj.Key.endsWith('.json'));
		
		for (const jsonFile of jsonFiles) {
			try {
				// Download and parse the metadata
				const metadataCommand = new GetObjectCommand({
					Bucket: targetBucket,
					Key: jsonFile.Key
				});
				const metadataResponse = await s3Client.send(metadataCommand);
				
				const chunks = [];
				for await (const chunk of metadataResponse.Body) {
					chunks.push(chunk);
				}
				const metadataStr = Buffer.concat(chunks).toString();
				const existingMetadata = JSON.parse(metadataStr);
				
				// Compare file size first (fastest check)
				if (Math.abs(existingMetadata.fileSize - fileSize) < 1024) { // Within 1KB
					console.info(`Size match found: ${existingMetadata.fileSize} vs ${fileSize}`);
					
					// Compare timestamps if both have EXIF data
					if (exif && existingMetadata.exifData) {
						const existingTimestamp = existingMetadata.exifData.dateTimeOriginal;
						const currentTimestamp = exif.tags.DateTimeOriginal ? 
							new Date(exif.tags.DateTimeOriginal * 1000).toISOString() : null;
							
						if (existingTimestamp && currentTimestamp && existingTimestamp === currentTimestamp) {
							// Compare camera info
							const existingCamera = existingMetadata.exifData.make || 'unknown';
							const currentCamera = exif.tags.Make || 'unknown';
							
							if (existingCamera.toLowerCase() === currentCamera.toLowerCase()) {
								// Compare dimensions if available
								if (existingMetadata.originalDimensions && exif.imageSize) {
									const widthMatch = existingMetadata.originalDimensions.width === exif.imageSize.width;
									const heightMatch = existingMetadata.originalDimensions.height === exif.imageSize.height;
									
									if (widthMatch && heightMatch) {
										return {
											isDuplicate: true,
											reason: "exact_match_exif_timestamp_camera_dimensions",
											existingFile: jsonFile.Key.replace('.json', ''),
											confidence: "high",
											filesChecked: jsonFiles.length
										};
									}
								}
								
								return {
									isDuplicate: true,
									reason: "exact_match_exif_timestamp_camera",
									existingFile: jsonFile.Key.replace('.json', ''),
									confidence: "high",
									filesChecked: jsonFiles.length
								};
							}
						}
					}
					
					// If no EXIF comparison possible, use file size + camera as lower confidence match
					if (existingMetadata.camera.toLowerCase() === camera.toLowerCase()) {
						return {
							isDuplicate: true,
							reason: "size_camera_match_no_exif_comparison",
							existingFile: jsonFile.Key.replace('.json', ''),
							confidence: "medium",
							filesChecked: jsonFiles.length
						};
					}
				}
			} catch (parseError) {
				console.warn(`Failed to parse metadata for ${jsonFile.Key}:`, parseError.message);
				continue;
			}
		}
		
		return { 
			isDuplicate: false, 
			filesChecked: jsonFiles.length,
			searchPrefix
		};
		
	} catch (error) {
		console.warn("Duplicate check failed:", error.message);
		// Don't fail processing if duplicate check fails
		return { isDuplicate: false, error: error.message, filesChecked: 0 };
	}
}

/**
 * Handle duplicate file cleanup based on configuration
 */
async function handleDuplicateFile(sourceBucket, key, targetBucket, duplicateCheck, duplicateAction, duplicatesPrefix, originalContentType) {
	try {
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").split(".")[0];
		const originalFilename = key.split('/').pop(); // Get just the filename, not the full path
		
		switch (duplicateAction.toLowerCase()) {
			case 'delete':
				console.info(`Deleting duplicate file: ${key}`);
				await s3Client.send(new DeleteObjectCommand({
					Bucket: sourceBucket,
					Key: key
				}));
				console.info(`✅ Duplicate file deleted: ${key}`);
				return { action: 'deleted', location: null };
				
			case 'move':
				// Preserve original filename with processing timestamp: duplicates/2025-09-20_03-23-33-DSCF8545.jpg
				const duplicateKey = `${duplicatesPrefix}${timestamp}-${originalFilename}`;
				console.info(`Moving duplicate file to: ${duplicateKey}`);
				
				// Copy to duplicates folder with metadata about why it's a duplicate
				const copyCommand = new CopyObjectCommand({
					Bucket: targetBucket,
					Key: duplicateKey,
					CopySource: `${sourceBucket}/${encodeURIComponent(key)}`,
					ContentType: originalContentType || 'image/jpeg', // Ensure proper content type
					ContentDisposition: 'inline', // Allow browser viewing instead of forcing download
					CacheControl: 'public, max-age=86400', // 24 hour cache for duplicates
					Metadata: {
						'original-key': key,
						'original-bucket': sourceBucket,
						'duplicate-reason': duplicateCheck.reason,
						'duplicate-confidence': duplicateCheck.confidence,
						'existing-file': duplicateCheck.existingFile,
						'detected-at': new Date().toISOString()
					},
					MetadataDirective: 'REPLACE'
				});
				
				await s3Client.send(copyCommand);
				
				// Delete original after successful copy
				await s3Client.send(new DeleteObjectCommand({
					Bucket: sourceBucket,
					Key: key
				}));
				
				console.info(`✅ Duplicate file moved to: ${duplicateKey}`);
				return { action: 'moved', location: duplicateKey };
				
			case 'keep':
			default:
				console.info(`ℹ️ Keeping duplicate file in place: ${key}`);
				return { action: 'kept', location: key };
		}
	} catch (error) {
		console.warn(`⚠️ Failed to handle duplicate file: ${error.message}`);
		// Don't fail the entire operation if duplicate handling fails
		return { action: 'error', error: error.message };
	}
}

exports.handler = async (event) => {
	const startTime = Date.now();
	let key = 'unknown'; // Initialize key for error handling scope
	
	console.info(
		"Photo processing Lambda triggered:",
		JSON.stringify(event, null, 2)
	);
	console.info("Configuration:", CONFIG);
	console.info(`Lambda memory: ${process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE}MB, Node.js: ${process.version}`);

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
		key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
		const fileSize = record.s3.object.size || 'unknown';

		// Determine target bucket (same as source or specified processed bucket)
		const targetBucket = CONFIG.PROCESSED_BUCKET || sourceBucket;

		console.info(`Processing file: ${sourceBucket}/${key} → ${targetBucket}`);
		console.info(`Original file size: ${typeof fileSize === 'number' ? (fileSize / 1024 / 1024).toFixed(2) + 'MB' : fileSize}`);

		// Check if source bucket is allowed (if restriction is configured)
		if (CONFIG.ALLOWED_SOURCE_BUCKETS && !CONFIG.ALLOWED_SOURCE_BUCKETS.includes(sourceBucket)) {
			console.warn(`Bucket ${sourceBucket} not in allowed list: ${CONFIG.ALLOWED_SOURCE_BUCKETS.join(', ')}`);
			return { status: "skipped", reason: "bucket_not_allowed", bucket: sourceBucket };
		}

		// Check if file is already in processed folder to avoid infinite loops
		if (CONFIG.SKIP_PROCESSED_FOLDER && key.startsWith(CONFIG.PROCESSED_PREFIX)) {
			console.info("File already in processed folder, skipping");
			return { status: "skipped", reason: "already_processed" };
		}

		// Check if file is already in duplicates folder to avoid infinite loops
		if (key.startsWith(CONFIG.DUPLICATES_PREFIX)) {
			console.info("File already in duplicates folder, skipping");
			return { status: "skipped", reason: "already_in_duplicates" };
		}

		// Validate file extension
		const ext = key.split(".").pop()?.toLowerCase();
		if (!ext || !SUPPORTED_FORMATS.includes(ext)) {
			console.info(`Unsupported file format: ${ext}`);
			return {
				status: "skipped",
				reason: "unsupported_format",
				extension: ext,
			};
		}

		// Download image
		const downloadStart = Date.now();
		console.info("Downloading original image from S3");
		const getObjectCommand = new GetObjectCommand({ Bucket: sourceBucket, Key: key });
		const original = await s3Client.send(getObjectCommand);
		const downloadTime = Date.now() - downloadStart;

		if (!original.Body) {
			throw new Error("Failed to download image from S3");
		}

		// Convert stream to buffer for Sharp processing
		const chunks = [];
		for await (const chunk of original.Body) {
			chunks.push(chunk);
		}
		const imageBuffer = Buffer.concat(chunks);

		const actualFileSize = original.ContentLength || imageBuffer.length;
		console.info(`Download completed in ${downloadTime}ms, actual size: ${(actualFileSize / 1024 / 1024).toFixed(2)}MB`);
		console.info(`Content-Type: ${original.ContentType || 'unknown'}, Last-Modified: ${original.LastModified || 'unknown'}`);

		// Parse EXIF data with error handling
		let exif = null;
		let exifDate = null;
		let camera = "unknown";

		try {
			console.info("Parsing EXIF data");
			const parser = ExifParser.create(imageBuffer);
			exif = parser.parse();

			// Extract date with multiple fallback options
			let dateSource = 'none';
			if (exif.tags.DateTimeOriginal) {
				exifDate = new Date(exif.tags.DateTimeOriginal * 1000);
				dateSource = 'DateTimeOriginal';
			} else if (exif.tags.DateTime) {
				exifDate = new Date(exif.tags.DateTime * 1000);
				dateSource = 'DateTime';
			} else if (exif.tags.CreateDate) {
				exifDate = new Date(exif.tags.CreateDate * 1000);
				dateSource = 'CreateDate';
			}

			camera = exif.tags.Make || "unknown";
			const gpsAvailable = exif.tags.GPSLatitude && exif.tags.GPSLongitude;
			console.info(`EXIF data parsed - Date: ${exifDate} (from ${dateSource}), Camera: ${camera}, GPS: ${gpsAvailable ? 'yes' : 'no'}`);
			if (exif.tags.Make || exif.tags.Model) {
				console.info(`Camera details: ${exif.tags.Make || 'unknown'} ${exif.tags.Model || 'unknown'}`);
			}
		} catch (exifError) {
			console.warn("Failed to parse EXIF data:", exifError.message);
			console.warn("Will use current timestamp for file naming");
		}

		// Use EXIF date or fall back to current timestamp
		const shotDate = exifDate || new Date();
		const timestamp = shotDate
			.toISOString()
			.replace(/[:.]/g, "-")
			.replace("T", "_")
			.split(".")[0];
		const baseName = `photo-${timestamp}-${camera.replace(/\s+/g, "_")}`;

		console.info(`Generated base name: ${baseName}`);

		// Check for duplicates if enabled
		if (CONFIG.CHECK_DUPLICATES) {
			console.info("Checking for potential duplicates");
			const duplicateCheck = await checkForDuplicates(
				targetBucket, 
				shotDate, 
				camera, 
				actualFileSize,
				exif,
				CONFIG.PROCESSED_PREFIX
			);
			
			if (duplicateCheck.isDuplicate) {
				console.warn(`Potential duplicate found: ${duplicateCheck.reason}`);
				console.warn(`Existing file: ${duplicateCheck.existingFile}`);
				
				// Handle the duplicate original file
				const duplicateHandling = await handleDuplicateFile(
					sourceBucket,
					key,
					targetBucket,
					duplicateCheck,
					CONFIG.DUPLICATE_ACTION,
					CONFIG.DUPLICATES_PREFIX,
					original.ContentType
				);
				
				return {
					status: "skipped",
					reason: "duplicate_detected",
					duplicateInfo: duplicateCheck,
					duplicateHandling,
					originalKey: key
				};
			} else {
				console.info(`No duplicates found (checked ${duplicateCheck.filesChecked} files)`);
			}
		}

		// Create multiple sizes for different use cases
		const processingStart = Date.now();
		console.info("Creating image variations");
		const [large, medium, small, thumb] = await Promise.all([
			sharp(imageBuffer)
				.resize(1920, 1920, { fit: "inside", withoutEnlargement: true })
				.jpeg({ quality: 85 })
				.toBuffer(),
			sharp(imageBuffer)
				.resize(800, 800, { fit: "inside", withoutEnlargement: true })
				.jpeg({ quality: 80 })
				.toBuffer(),
			sharp(imageBuffer)
				.resize(400, 400, { fit: "inside", withoutEnlargement: true })
				.jpeg({ quality: 75 })
				.toBuffer(),
			sharp(imageBuffer)
				.resize(150, 150, { fit: "inside", withoutEnlargement: true })
				.jpeg({ quality: 70 })
				.toBuffer(),
		]);
		const processingTime = Date.now() - processingStart;

		console.info(`Image variations created in ${processingTime}ms`);
		console.info(`Generated sizes - Large: ${(large.length/1024).toFixed(1)}KB, Medium: ${(medium.length/1024).toFixed(1)}KB, Small: ${(small.length/1024).toFixed(1)}KB, Thumb: ${(thumb.length/1024).toFixed(1)}KB`);

		// Get original image metadata for the JSON file
		const imageMetadata = await sharp(imageBuffer).metadata();
		console.info(`Original image: ${imageMetadata.width}x${imageMetadata.height} ${imageMetadata.format?.toUpperCase()}, ${imageMetadata.channels} channels, ${imageMetadata.density || 'unknown'} DPI`);
		if (imageMetadata.space) {
			console.info(`Color space: ${imageMetadata.space}, hasProfile: ${!!imageMetadata.icc}`);
		}

		// Create comprehensive metadata object
		const photoFolder = `${CONFIG.PROCESSED_PREFIX}${baseName}/`;
		const metadata = {
			originalKey: key,
			newBaseName: baseName,
			timestamp: shotDate.toISOString(),
			camera,
			fileSize: original.ContentLength || imageBuffer.length,
			originalDimensions: {
				width: imageMetadata.width,
				height: imageMetadata.height,
				format: imageMetadata.format,
			},
			status: 'processed', // Track processing stage: processed -> enhanced -> published
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
				original: `${photoFolder}${baseName}.${ext}`,
				large: `${photoFolder}${baseName}_large.jpg`,
				medium: `${photoFolder}${baseName}_medium.jpg`,
				small: `${photoFolder}${baseName}_small.jpg`,
				thumb: `${photoFolder}${baseName}_thumb.jpg`,
			},
		};

		// Upload all files in parallel for better performance
		const uploadStart = Date.now();
		const uploadPromises = [];
		console.info(`Uploading processed files to S3`);

		// Upload original with new name
		uploadPromises.push(
			s3Client.send(new PutObjectCommand({
				Bucket: targetBucket,
				Key: `${photoFolder}${baseName}.${ext}`,
				Body: imageBuffer,
				ContentType: original.ContentType,
				CacheControl: 'public, max-age=31536000', // 1 year cache
				Metadata: {
					'original-key': key,
					'original-bucket': sourceBucket,
					'processed-at': new Date().toISOString()
				}
			}))
		);

		// Upload resized versions
		uploadPromises.push(
			s3Client.send(new PutObjectCommand({
				Bucket: targetBucket,
				Key: `${photoFolder}${baseName}_large.jpg`,
				Body: large,
				ContentType: 'image/jpeg',
				CacheControl: 'public, max-age=31536000'
			}))
		);

		uploadPromises.push(
			s3Client.send(new PutObjectCommand({
				Bucket: targetBucket,
				Key: `${photoFolder}${baseName}_medium.jpg`,
				Body: medium,
				ContentType: 'image/jpeg',
				CacheControl: 'public, max-age=31536000'
			}))
		);

		uploadPromises.push(
			s3Client.send(new PutObjectCommand({
				Bucket: targetBucket,
				Key: `${photoFolder}${baseName}_small.jpg`,
				Body: small,
				ContentType: 'image/jpeg',
				CacheControl: 'public, max-age=31536000'
			}))
		);

		uploadPromises.push(
			s3Client.send(new PutObjectCommand({
				Bucket: targetBucket,
				Key: `${photoFolder}${baseName}_thumb.jpg`,
				Body: thumb,
				ContentType: 'image/jpeg',
				CacheControl: 'public, max-age=31536000'
			}))
		);

		// Upload metadata JSON
		uploadPromises.push(
			s3Client.send(new PutObjectCommand({
				Bucket: targetBucket,
				Key: `${photoFolder}${baseName}.json`,
				Body: JSON.stringify(metadata, null, 2),
				ContentType: 'application/json',
				CacheControl: 'public, max-age=3600' // 1 hour cache for metadata
			}))
		);

		// Wait for all uploads to complete
		await Promise.all(uploadPromises);
		const uploadTime = Date.now() - uploadStart;
		console.info(`All files uploaded successfully in ${uploadTime}ms`);

		// Delete original file if configured to do so
		if (CONFIG.DELETE_ORIGINAL) {
			console.info(`Deleting original file: ${key}`);
			try {
				await s3Client.send(new DeleteObjectCommand({
					Bucket: sourceBucket,
					Key: key
				}));
				console.info(`✅ Original file deleted: ${key}`);
			} catch (deleteError) {
				console.warn(`⚠️ Failed to delete original file: ${deleteError.message}`);
				// Don't fail the entire operation if delete fails
			}
		} else {
			console.info(`ℹ️ Keeping original file (DELETE_ORIGINAL=false)`);
		}

		const totalTime = Date.now() - startTime;
		console.info(`Total processing time: ${totalTime}ms (Download: ${downloadTime}ms, Processing: ${processingTime}ms, Upload: ${uploadTime}ms)`);

		return {
			status: "success",
			baseName,
			originalKey: key,
			processedFiles: Object.values(metadata.versions),
			metadata: `processed/${baseName}.json`,
			processingMetrics: {
				totalTimeMs: totalTime,
				downloadTimeMs: downloadTime,
				processingTimeMs: processingTime,
				uploadTimeMs: uploadTime,
				originalSizeMB: (actualFileSize / 1024 / 1024).toFixed(2)
			}
		};
	} catch (error) {
		const totalTime = Date.now() - startTime;
		console.error(`Error processing photo after ${totalTime}ms:`, error.message);
		console.error("Error stack:", error.stack);
		
		// Add context about where the error occurred
		if (error.message.includes('getObject')) {
			console.error("Error occurred during S3 download phase");
		} else if (error.message.includes('Sharp') || error.message.includes('resize')) {
			console.error("Error occurred during image processing phase");
		} else if (error.message.includes('putObject') || error.message.includes('upload')) {
			console.error("Error occurred during S3 upload phase");
		} else if (error.message.includes('EXIF')) {
			console.error("Error occurred during EXIF parsing phase");
		}

		// Return detailed error information
		return {
			status: "error",
			error: error.message,
			errorCode: error.code || 'UNKNOWN',
			stack: error.stack,
			originalKey: key || "unknown",
			processingTimeMs: totalTime
		};
	}
};
