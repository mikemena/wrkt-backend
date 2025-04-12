const express = require("express");
const router = express.Router();
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { Readable } = require("stream");

// Configure R2 client
const r2Client = new S3Client({
  region: "auto",
  endpoint: process.env.R2_URL,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.JWT_SECRET,
  },
});

// Cache configuration - store image responses in memory for a short time
const imageCache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour in milliseconds

/**
 * Endpoint to proxy images from Cloudflare R2
 * GET /api/exercise-images/:imageName
 * Example: /api/exercise-images/ab-wheel.gif
 */
router.get("/exercise-images/:imageName", async (req, res) => {
  try {
    const imageName = req.params.imageName;
    const bucketName = process.env.R2_BUCKET_NAME; // e.g., 'pow'

    // Check cache first
    const cacheKey = `${bucketName}/${imageName}`;
    const cachedImage = imageCache.get(cacheKey);

    if (cachedImage && Date.now() < cachedImage.expiresAt) {
      // Set appropriate headers from cached data
      res.set("Content-Type", cachedImage.contentType);
      res.set("Content-Length", cachedImage.contentLength);
      res.set("Cache-Control", "public, max-age=86400"); // 24 hours browser caching
      return res.send(cachedImage.data);
    }

    // If not in cache, fetch from R2
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: imageName,
    });

    const r2Response = await r2Client.send(command);

    // Set content type based on file extension
    const contentType =
      r2Response.ContentType || getContentTypeFromFileName(imageName);
    res.set("Content-Type", contentType);

    // Set content length if available
    if (r2Response.ContentLength) {
      res.set("Content-Length", r2Response.ContentLength);
    }

    // Set cache control headers
    res.set("Cache-Control", "public, max-age=86400"); // 24 hours browser caching

    // Stream response to client
    if (r2Response.Body instanceof Readable) {
      // For Node.js 16+, we can just pipe the stream
      const chunks = [];
      for await (const chunk of r2Response.Body) {
        chunks.push(chunk);
        res.write(chunk);
      }
      res.end();

      // Cache the image in memory
      const buffer = Buffer.concat(chunks);
      imageCache.set(cacheKey, {
        data: buffer,
        contentType,
        contentLength: r2Response.ContentLength,
        expiresAt: Date.now() + CACHE_TTL,
      });
    } else {
      // Fallback for other types
      const buffer = await r2Response.Body.transformToByteArray();

      // Cache the image in memory
      imageCache.set(cacheKey, {
        data: buffer,
        contentType,
        contentLength: buffer.length,
        expiresAt: Date.now() + CACHE_TTL,
      });

      res.send(Buffer.from(buffer));
    }

    // Clean up expired cache entries periodically
    if (Math.random() < 0.1) {
      // 10% chance to run cleanup on each request
      cleanupCache();
    }
  } catch (error) {
    console.error("Error fetching image from R2:", error);

    // Return appropriate error response
    if (error.name === "NoSuchKey") {
      return res.status(404).send("Image not found");
    }

    res.status(500).send("Error fetching image");
  }
});

/**
 * Helper function to determine content type from filename
 */
function getContentTypeFromFileName(filename) {
  const extension = filename.split(".").pop().toLowerCase();
  const contentTypes = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
  };

  return contentTypes[extension] || "application/octet-stream";
}

/**
 * Clean up expired cache entries
 */
function cleanupCache() {
  const now = Date.now();
  for (const [key, value] of imageCache.entries()) {
    if (now > value.expiresAt) {
      imageCache.delete(key);
    }
  }
}

module.exports = router;
