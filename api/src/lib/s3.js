import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const region = process.env.AWS_REGION;
const bucket = process.env.S3_BUCKET;

export function s3Enabled() {
  return Boolean(region && bucket);
}

export function getS3Client() {
  if (!s3Enabled()) {
    throw new Error("S3 is not configured");
  }
  return new S3Client({ region });
}

export async function createUploadUrl({ key, contentType }) {
  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });

  const url = await getSignedUrl(client, command, { expiresIn: 60 * 5 });
  return { url, bucket, key };
}

export async function createDownloadUrl({ key }) {
  const client = getS3Client();
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const url = await getSignedUrl(client, command, { expiresIn: 60 * 5 });
  return url;
}
