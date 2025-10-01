// lambda-handler.js
import { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { parse } from "path";

const REGION = process.env.AWS_REGION || "us-east-1";
const INGRESS_BUCKET = process.env.INGRESS_BUCKET;
const PROCESSED_BUCKET = process.env.PROCESSED_BUCKET;

const s3 = new S3Client({ region: REGION });

// Utility: stream S3 object to string
async function streamToString(stream) {
	return await new Promise((resolve, reject) => {
		const chunks = [];
		stream.on("data", (chunk) => chunks.push(chunk));
		stream.on("error", reject);
		stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
	});
}


/**
 * Main entry point for the Lambda actions
 * @param {*} event 
 * @returns 
 */
export const handler = async (event) => {
	console.info("EVENT:", JSON.stringify(event));

	const method = event.httpMethod;
	const path = event.resource; // e.g. "/upload", "/photos", "/photos/{folder}/user"

	try {
		if (method === "POST" && path === "/upload") {
			return await handleUpload(event);
		}

		if (method === "GET" && path === "/photos") {
			return await handleBrowse(event);
		}

		if (method === "PUT" && path === "/photos/{folder}/user-data") {
			return await handleUpdateUserData(event);
		}

		return { statusCode: 404, body: JSON.stringify({ message: "Not found" }) };
	} catch (err) {
		console.error("Error:", err);
		return { statusCode: 500, body: JSON.stringify({ message: err.message }) };
	}
};

// ---------------------------------------------------------
// 1. Upload: return a pre-signed URL for ingress bucket
// ---------------------------------------------------------
async function handleUpload(event) {
	const body = JSON.parse(event.body || "{}");
	const filename = body.filename;
	if (!filename) {
		return { statusCode: 400, body: JSON.stringify({ message: "Missing filename" }) };
	}

	// Object key could include a timestamp or UUID for uniqueness
	const objectKey = `${Date.now()}_${filename}`;

	const command = new PutObjectCommand({
		Bucket: INGRESS_BUCKET,
		Key: objectKey,
	});

	const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 }); // 5 min

	return {
		statusCode: 200,
		body: JSON.stringify({ uploadUrl, objectKey }),
	};
}

// ---------------------------------------------------------
// 2. Browse: list processed photos with metadata + user.json
// ---------------------------------------------------------
async function handleBrowse(event) {
	const query = event.queryStringParameters || {};
	const startDate = query.startDate ? new Date(query.startDate) : null;
	const endDate = query.endDate ? new Date(query.endDate) : null;
	const titleFilter = query.title?.toLowerCase();
	const tagsFilter = query.tags ? query.tags.split(",") : [];

	const listCmd = new ListObjectsV2Command({
		Bucket: PROCESSED_BUCKET,
		Delimiter: "/", // list by folders
	});
	const data = await s3.send(listCmd);

	const results = [];

	if (data.CommonPrefixes) {
		for (const prefixObj of data.CommonPrefixes) {
			const folder = prefixObj.Prefix.replace(/\/$/, "");

			// Quick filter by date (folder name starts with YYYY-MM-DD)
			const folderDateStr = folder.split("_")[0];
			const folderDate = new Date(folderDateStr);
			if (startDate && folderDate < startDate) continue;
			if (endDate && folderDate > endDate) continue;

			// Load metadata.json
			const metaObj = await s3.send(new GetObjectCommand({
				Bucket: PROCESSED_BUCKET,
				Key: `${folder}/metadata.json`
			}));
			const metadata = JSON.parse(await streamToString(metaObj.Body));

			// Load user.json (may or may not exist)
			let user = {};
			try {
				const userObj = await s3.send(new GetObjectCommand({
					Bucket: PROCESSED_BUCKET,
					Key: `${folder}/user.json`
				}));
				user = JSON.parse(await streamToString(userObj.Body));
			} catch (_) {
				user = {};
			}

			// Apply filters
			if (titleFilter && !((user.title || "").toLowerCase().includes(titleFilter))) continue;
			if (tagsFilter.length && !tagsFilter.every(tag => (user.tags || []).includes(tag))) continue;

			results.push({ folder, metadata, user });
		}
	}

	return {
		statusCode: 200,
		body: JSON.stringify(results),
	};
}

// ---------------------------------------------------------
// 3. Update user.json
// ---------------------------------------------------------
async function handleUpdateUserData(event) {
	const folder = event.pathParameters.folder;
	if (!folder) {
		return { statusCode: 400, body: JSON.stringify({ message: "Missing folder" }) };
	}

	const body = JSON.parse(event.body || "{}");

	const command = new PutObjectCommand({
		Bucket: PROCESSED_BUCKET,
		Key: `${folder}/user.json`,
		Body: JSON.stringify(body),
		ContentType: "application/json"
	});

	await s3.send(command);

	return { statusCode: 200, body: JSON.stringify({ message: "User metadata updated" }) };
}
