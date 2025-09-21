/**
 * This AWS Lambda function processes images uploaded to S3:
 * - File is converted to multiple sizes (large, medium, small, thumbnail)
 * - EXIF data is extracted for metadata
 * - Duplicate detection allows keeping, moving, deleting, or replacing duplicates
 * - All images and metadata are uploaded back to a companion S3 bucket
 * - Buckets are arranged in ingress/processed pairs for organized workflows
 */

const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command, CopyObjectCommand } = require("@aws-sdk/client-s3");
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const sharp = require("sharp");
const ExifParser = require("exif-parser");

// Supported image formats
const SUPPORTED_FORMATS = ["jpg", "jpeg", "png", "tiff", "tif", "webp"];

// Retry utility function
const retryWithBackoff = async (fn, maxRetries = 3, baseDelay = 1000) => {
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			if (attempt === maxRetries) {
				throw error;
			}

			// Exponential backoff with jitter
			const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
			console.warn(`Attempt ${attempt} failed: ${error.message}. Retrying in ${Math.round(delay)}ms...`);
			await new Promise(resolve => setTimeout(resolve, delay));
		}
	}
};

// Memory monitoring utility
const logMemoryUsage = (phase) => {
	const used = process.memoryUsage();
	const mb = (bytes) => Math.round(bytes / 1024 / 1024 * 100) / 100;
	console.info(`Memory usage [${phase}]: RSS: ${mb(used.rss)}MB, Heap: ${mb(used.heapUsed)}/${mb(used.heapTotal)}MB, External: ${mb(used.external)}MB`);
};

// Configuration from environment variables
const CONFIG = {
	// Comma-separated list of allowed source buckets (optional - if not set, allows any bucket)
	ALLOWED_SOURCE_BUCKETS: process.env.ALLOWED_SOURCE_BUCKETS?.split(',').map(b => b.trim()),

	// Bucket mappings: ingress bucket → processed bucket (JSON object)
	BUCKET_MAPPINGS: process.env.BUCKET_MAPPINGS ? JSON.parse(process.env.BUCKET_MAPPINGS) : {},

	// Whether to check for duplicates before processing
	CHECK_DUPLICATES: process.env.CHECK_DUPLICATES !== 'false', // default true

	// What to do with duplicate originals: 'delete', 'move', 'keep', 'replace'
	DUPLICATE_ACTION: process.env.DUPLICATE_ACTION || 'replace',

	// Prefix for duplicate files (when DUPLICATE_ACTION is 'move')
	DUPLICATES_PREFIX: process.env.DUPLICATES_PREFIX || 'duplicates/',

	// Maximum file size to process (in bytes, default 100MB)
	MAX_FILE_SIZE: parseInt(process.env.MAX_FILE_SIZE) || 100 * 1024 * 1024,

	// Timeout for individual operations (milliseconds)
	OPERATION_TIMEOUT: parseInt(process.env.OPERATION_TIMEOUT) || 30000,

	// Enable detailed logging
	DETAILED_LOGGING: process.env.DETAILED_LOGGING === 'true'
};

// Log configuration at startup for debugging
console.info('Lambda Configuration:');
console.info('- Allowed source buckets:', CONFIG.ALLOWED_SOURCE_BUCKETS || 'any');
console.info('- Bucket mappings:', JSON.stringify(CONFIG.BUCKET_MAPPINGS, null, 2));


/**
 * Check for potential duplicates by searching existing processed files
 * Uses date-based prefix searching for efficiency
 */
async function checkForDuplicates(targetBucket, shotDate, camera, fileSize, exif) {
	try {
		const dateStr = shotDate.toISOString().split('T')[0]; // YYYY-MM-DD
		const searchPrefix = `photo-${dateStr.replace(/[:.]/g, "-")}`;

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
			case 'replace':
				console.info(`🔄 Replacing existing processed file for duplicate: ${key}`);
				// Delete the original duplicate - processing will continue and replace the existing processed file
				await s3Client.send(new DeleteObjectCommand({
					Bucket: sourceBucket,
					Key: key
				}));
				console.info(`✅ Original duplicate deleted, will replace processed file: ${duplicateCheck.existingFile}`);
				return { action: 'replace', location: duplicateCheck.existingFile };

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

/**
 * Lambda function handler
 *	This is responding to S3 upload events, processing images into multiple sizes,
 *	extracting metadata, checking for duplicates, and uploading results to the target bucket.
 * @param {*} event 
 * @returns 
 */
exports.handler = async (event) => {
	const startTime = Date.now();
	let key = 'unknown';
	let processingPhase = 'initialization';

	logMemoryUsage('start');
	logInitialInfo(event);

	try {
		// 1. Validate and extract event info
		const { sourceBucket, key: objectKey, fileSize, ext } = validateEvent(event);
		key = objectKey;
		processingPhase = 'validation';

		const { targetBucket, isUsingSeparateBucket } = resolveBucketMapping(sourceBucket, key, fileSize);

		// 2. Download the image
		processingPhase = 'download';
		const { imageBuffer, original, downloadTime, actualFileSize } =
			await downloadImage(sourceBucket, key);

		// 3. Parse EXIF metadata
		processingPhase = 'exif_parsing';
		const { exif, exifDate, camera } = await parseExif(imageBuffer);

		// 4. Generate base name and handle duplicates
		const { baseName, shotDate } = generateBaseName(exifDate, camera);
		await handleDuplicatesIfNeeded(
			sourceBucket, key, targetBucket, isUsingSeparateBucket,
			shotDate, camera, actualFileSize, exif, original
		);

		// 5. Process images into multiple sizes
		processingPhase = 'image_processing';
		const { large, medium, small, thumb, processingTime } =
			await processImageVariants(imageBuffer);

		// 6. Collect metadata
		const metadata = await buildMetadata({
			key, baseName, shotDate, camera, original, imageBuffer, exif, ext, isUsingSeparateBucket
		});

		// 7. Upload processed images + metadata
		processingPhase = 'upload';
		const uploadTime = await uploadAllFiles({
			imageBuffer, original, targetBucket, photoFolder: metadata.photoFolder,
			baseName, ext, large, medium, small, thumb, metadata, sourceBucket, key
		});


		// Done
		const totalTime = Date.now() - startTime;
		return buildSuccessResponse({
			baseName, key, metadata, downloadTime, processingTime, uploadTime, totalTime, actualFileSize
		});
	} catch (error) {
		return handleError(error, startTime, processingPhase, key);
	}
};

/* ---------------- HELPER FUNCTIONS ---------------- */

function logInitialInfo(event) {
	if (CONFIG.DETAILED_LOGGING) {
		console.info("Photo processing Lambda triggered:", JSON.stringify(event, null, 2));
	} else {
		console.info("Photo processing Lambda triggered");
	}
	console.info("Configuration:", CONFIG);
	console.info(
		`Lambda memory: ${process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE}MB, Node.js: ${process.version}`
	);
}

function validateEvent(event) {
	if (!event.Records || event.Records.length === 0) {
		throw new Error("No S3 records found in event");
	}

	const record = event.Records[0];
	if (!record.s3 || !record.s3.bucket || !record.s3.object) {
		throw new Error("Invalid S3 record structure");
	}

	const sourceBucket = record.s3.bucket.name;
	const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
	const fileSize = record.s3.object.size || 'unknown';
	const ext = key.split(".").pop()?.toLowerCase();

	if (!ext || !SUPPORTED_FORMATS.includes(ext)) {
		throw new Error(`Unsupported file format: ${ext}`);
	}

	return { sourceBucket, key, fileSize, ext };
}

function resolveBucketMapping(sourceBucket, key, fileSize) {
	// File size limits
	if (typeof fileSize === 'number' && fileSize > CONFIG.MAX_FILE_SIZE) {
		const sizeMB = (fileSize / 1024 / 1024).toFixed(2);
		const maxSizeMB = (CONFIG.MAX_FILE_SIZE / 1024 / 1024).toFixed(2);
		throw new Error(`File size ${sizeMB}MB exceeds maximum ${maxSizeMB}MB`);
	}

	// Allowed buckets
	if (CONFIG.ALLOWED_SOURCE_BUCKETS &&
		!CONFIG.ALLOWED_SOURCE_BUCKETS.includes(sourceBucket)) {
		throw new Error(`Bucket ${sourceBucket} not allowed`);
	}

	if (key.startsWith(CONFIG.DUPLICATES_PREFIX)) {
		throw new Error("already_in_duplicates");
	}

	const bucketMapping = CONFIG.BUCKET_MAPPINGS[sourceBucket];
	const targetBucket = bucketMapping?.processed || sourceBucket;
	const isUsingSeparateBucket = bucketMapping?.processed && bucketMapping.processed !== sourceBucket;

	console.info(`Processing file: ${sourceBucket}/${key} → ${targetBucket}`);
	return { targetBucket, isUsingSeparateBucket };
}

async function downloadImage(sourceBucket, key) {
	const downloadStart = Date.now();
	console.info("Downloading original image from S3");

	const original = await retryWithBackoff(async () => {
		const cmd = new GetObjectCommand({ Bucket: sourceBucket, Key: key });
		return await s3Client.send(cmd);
	}, 3, 1000);

	if (!original.Body) throw new Error("Empty S3 body");

	const chunks = [];
	for await (const chunk of original.Body) chunks.push(chunk);
	const imageBuffer = Buffer.concat(chunks);

	const downloadTime = Date.now() - downloadStart;
	const actualFileSize = original.ContentLength || imageBuffer.length;
	return { imageBuffer, original, downloadTime, actualFileSize };
}

async function parseExif(imageBuffer) {
	let exif = null, exifDate = null, camera = "unknown";

	try {
		const exifPromise = new Promise((resolve, reject) => {
			try {
				const parser = ExifParser.create(imageBuffer);
				resolve(parser.parse());
			} catch (err) {
				reject(err);
			}
		});
		const timeout = new Promise((_, reject) =>
			setTimeout(() => reject(new Error('EXIF parsing timeout')), CONFIG.OPERATION_TIMEOUT)
		);
		exif = await Promise.race([exifPromise, timeout]);

		if (exif.tags.DateTimeOriginal) exifDate = new Date(exif.tags.DateTimeOriginal * 1000);
		camera = exif.tags.Make || "unknown";
	} catch (err) {
		console.warn("Failed to parse EXIF:", err.message);
	}
	return { exif, exifDate, camera };
}

function generateBaseName(exifDate, camera) {
	const shotDate = exifDate || new Date();
	const timestamp = shotDate.toISOString().replace(/[:.]/g, "-").replace("T", "_").split(".")[0];
	const baseName = `photo-${timestamp}-${camera.replace(/\s+/g, "_")}`;
	return { baseName, shotDate };
}

async function handleDuplicatesIfNeeded(sourceBucket, key, targetBucket, isUsingSeparateBucket, shotDate, camera, actualFileSize, exif, original) {
	if (!CONFIG.CHECK_DUPLICATES) return;

	console.info("Checking for potential duplicates");
	const duplicateCheck = await checkForDuplicates(targetBucket, shotDate, camera, actualFileSize, exif);

	if (duplicateCheck.isDuplicate) {
		await handleDuplicateFile(sourceBucket, key, targetBucket, duplicateCheck,
			CONFIG.DUPLICATE_ACTION, CONFIG.DUPLICATES_PREFIX, original.ContentType);
		if (CONFIG.DUPLICATE_ACTION !== 'replace') {
			throw new Error("duplicate_detected");
		}
	}
}

async function processImageVariants(imageBuffer) {
	const start = Date.now();
	const tasks = [
		sharp(imageBuffer).resize(1920, 1920, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer(),
		sharp(imageBuffer).resize(800, 800, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer(),
		sharp(imageBuffer).resize(400, 400, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer(),
		sharp(imageBuffer).resize(150, 150, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer()
	];
	const timeout = new Promise((_, reject) =>
		setTimeout(() => reject(new Error('Image processing timeout')), CONFIG.OPERATION_TIMEOUT)
	);
	const [large, medium, small, thumb] = await Promise.race([Promise.all(tasks), timeout]);
	const processingTime = Date.now() - start;
	return { large, medium, small, thumb, processingTime };
}

async function buildMetadata({ key, baseName, shotDate, camera, original, imageBuffer, exif, ext, isUsingSeparateBucket }) {
	const imageMetadata = await sharp(imageBuffer).metadata();
	const photoFolder = `${baseName}/`;
	return {
		photoFolder : photoFolder,
		originalKey: key,
		newBaseName: baseName,
		timestamp: shotDate.toISOString(),
		camera : camera,
		fileSize: original.ContentLength || imageBuffer.length,
		originalDimensions: { width: imageMetadata.width, height: imageMetadata.height, format: ext },
		exifData: exif ? { make: exif.tags.Make, model: exif.tags.Model } : null,
		processedAt: new Date().toISOString(),
		versions: {
			original: buildPhotoPath(photoFolder, baseName, 'original'),
			large: buildPhotoPath(photoFolder, baseName, 'large'),
			medium: buildPhotoPath(photoFolder, baseName, 'medium'),
			small: buildPhotoPath(photoFolder, baseName, 'small'),
			thumb: buildPhotoPath(photoFolder, baseName, 'thumb'),
		}
	};
}

async function uploadAllFiles({ imageBuffer, original, targetBucket, photoFolder, baseName, ext, large, medium, small, thumb, metadata, sourceBucket, key }) {
	const start = Date.now();
	const uploadWithRetry = (cmd) => retryWithBackoff(() => s3Client.send(cmd), 3, 1000);

	const uploads = [
		uploadWithRetry(new PutObjectCommand({
			Bucket: targetBucket, Key: `${photoFolder}${baseName}.${ext}`, Body: imageBuffer,
			ContentType: original.ContentType
		})),
		uploadWithRetry(new PutObjectCommand({ Bucket: targetBucket, Key: buildPhotoPath(photoFolder, baseName, 'large'), Body: large, ContentType: 'image/jpeg' })),
		uploadWithRetry(new PutObjectCommand({ Bucket: targetBucket, Key: buildPhotoPath(photoFolder, baseName, 'medium'), Body: medium, ContentType: 'image/jpeg' })),
		uploadWithRetry(new PutObjectCommand({ Bucket: targetBucket, Key: buildPhotoPath(photoFolder, baseName, 'small'), Body: small, ContentType: 'image/jpeg' })),
		uploadWithRetry(new PutObjectCommand({ Bucket: targetBucket, Key: buildPhotoPath(photoFolder, baseName, 'thumb'), Body: thumb, ContentType: 'image/jpeg' })),
		uploadWithRetry(new PutObjectCommand({
			Bucket: targetBucket, Key: `${photoFolder}${baseName}.json`, Body: JSON.stringify(metadata, null, 2),
			ContentType: 'application/json'
		}))
	];
	await Promise.all(uploads);
	return Date.now() - start;
}
	
/**
 * Consistently build photo path for different sizes
 * @param  photoFolder 
 * @param {*} baseName 
 * @param {*} sizeLabel 
 * @returns 
 */
function buildPhotoPath(photoFolder, baseName, sizeLabel) {
	const sizeSuffix = sizeLabel === 'original' ? '' : `_${sizeLabel}`;
	const extension = sizeLabel === 'original' ? '' : '.jpg';
	return `${photoFolder}${sizeSuffix}${extension}`;
}

function buildSuccessResponse({ baseName, key, metadata, downloadTime, processingTime, uploadTime, totalTime, actualFileSize }) {
	return {
		status: "success",
		baseName,
		originalKey: key,
		processedFiles: Object.values(metadata.versions),
		metadata: `${metadata.photoFolder}${baseName}.json`,
		processingMetrics: {
			totalTimeMs: totalTime,
			downloadTimeMs: downloadTime,
			processingTimeMs: processingTime,
			uploadTimeMs: uploadTime,
			originalSizeMB: (actualFileSize / 1024 / 1024).toFixed(2)
		}
	};
}

function handleError(error, startTime, processingPhase, key) {
	const totalTime = Date.now() - startTime;
	console.error(`Error in phase '${processingPhase}':`, error.message);

	let errorCategory = 'unknown';
	if (/getObject|download/.test(error.message)) errorCategory = 's3_download';
	else if (/Sharp|resize|image/.test(error.message)) errorCategory = 'image_processing';
	else if (/putObject|upload/.test(error.message)) errorCategory = 's3_upload';
	else if (/EXIF/.test(error.message)) errorCategory = 'exif_parsing';
	else if (/timeout/.test(error.message)) errorCategory = 'timeout';
	else if (/memory|size/.test(error.message)) errorCategory = 'resource_limit';

	return {
		status: "error",
		error: error.message,
		errorCode: error.code || 'UNKNOWN',
		errorCategory,
		processingPhase,
		stack: CONFIG.DETAILED_LOGGING ? error.stack : undefined,
		originalKey: key || "unknown",
		processingTimeMs: totalTime,
		awsRequestId: error.$metadata?.requestId
	};
}