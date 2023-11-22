import {
  GetObjectCommand,
  GetObjectCommandOutput,
  PutObjectCommand,
  PutObjectCommandInput,
  PutObjectCommandOutput,
  S3Client,
} from "@aws-sdk/client-s3";
import { CloudFrontResponseEvent, CloudFrontResponseResult } from "aws-lambda";
import sharp from "sharp";

const client = new S3Client({
  logger: {
    error: console.error,
    debug: () => {},
    warn: console.warn,
    info: console.log,
  },
  // Change at build time
  region: "ap-northeast-1",
});

const MAX_AGE = 31536000; // 1year

async function getObject(
  key: string,
  bucket: string
): Promise<GetObjectCommandOutput> {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });

  return client.send(command);
}

function uploadObject(
  key: string,
  body: Required<PutObjectCommandInput["Body"]>,
  bucket: string,
  type?: string
): Promise<PutObjectCommandOutput> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    Metadata: {},
    ContentType: type,
    CacheControl: `max-age=${MAX_AGE}`,
  });

  return client.send(command);
}

function removeLeadingSlash(uri: string): string {
  return uri.startsWith("/") ? uri.substring(1) : uri;
}

function getCacheKey(uri: string): string {
  return removeLeadingSlash(uri);
}

function getOriginalKey(uri: string): string {
  return removeLeadingSlash(uri).split("/").slice(0, -1).join("/");
}

function getImageContentType(format: string): string {
  if (format === "svg") format = "svg+xml";

  return `image/${format}`;
}

interface Params {
  width?: number;
  height?: number;
  quality?: number;
  format?: string;
}

function findMatch(payload: string, pattern: RegExp): string | null {
  const matchIndex = 1;
  const result = payload.match(pattern);

  if (result === null || typeof result[matchIndex] !== "string") return null;

  return result[matchIndex];
}

function getParamsFromUri(uri: string): Params {
  const params: Params = {};
  const paramStr = uri.split("/").pop();

  if (typeof paramStr === "undefined") return params;

  const quality = findMatch(paramStr, /quality\((\d+)\)/);
  const width = findMatch(paramStr, /w\((\d+)\)/);
  const height = findMatch(paramStr, /h\((\d+)\)/);
  const format = findMatch(paramStr, /format\(([a-z0-9]+)\)/i);

  params.quality = quality === null ? 100 : parseInt(quality, 10);
  params.width = width === null ? undefined : parseInt(width, 10);
  params.height = height === null ? undefined : parseInt(height, 10);
  params.format = format === null ? undefined : format;

  return params;
}

exports.handler = async (
  event: CloudFrontResponseEvent
): Promise<CloudFrontResponseResult> => {
  const originResponse = event.Records[0].cf.response;
  // Change at build time
  const Bucket = "fos-api-local";
  const request = event.Records[0].cf.request;
  const response: CloudFrontResponseResult = { ...originResponse };
  const NOT_FOUND_STATUSES = ["404", "403"];

  console.log("new");
  console.log(JSON.stringify({ event }));

  response.headers!["x-lae-region"] = [
    { key: "x-lae-region", value: process.env.AWS_REGION! },
  ];

  if (NOT_FOUND_STATUSES.includes(originResponse.status) === false) {
    return response;
  }

  try {
    const params = getParamsFromUri(request.uri);
    const origKey = getOriginalKey(request.uri);
    const cacheKey = "_cf/" + getCacheKey(request.uri);

    if (origKey.trim().length === 0) throw new Error(`Invalid key ${origKey}`);

    const object = await getObject(origKey, Bucket);
    const imageBuffer = await object.Body!.transformToByteArray();

    const metadata = await sharp(imageBuffer).metadata();

    const width = params.width;
    const height = params.height;
    const quality = params.quality;
    const format =
      typeof params.format === "undefined"
        ? metadata.format!
        : (params.format as keyof sharp.FormatEnum);
    const contentType = getImageContentType(format);

    console.log({ width, height, quality, format, contentType });

    const processedImage = sharp(imageBuffer)
      .resize({ width, height })
      .toFormat(format, { quality });

    const outputBuffer = await processedImage.toBuffer();

    // even if there is exception in saving the object we send back the generated
    // image back to viewer below
    const uploadedObject = await uploadObject(
      cacheKey,
      outputBuffer,
      Bucket,
      contentType
    ).catch((e) => {
      console.log("Exception while writing resized image to bucket", e);
      return null;
    });

    response.body = outputBuffer.toString("base64");
    response.bodyEncoding = "base64";
    response.headers!["content-type"] = [
      { key: "content-type", value: contentType },
    ];
    response.headers!["cache-control"] = [
      { key: "cache-control", value: `max-age=${MAX_AGE.toString()}` },
    ];

    if (uploadedObject !== null) {
      response.headers!["etag"] = [
        { key: "Etag", value: uploadedObject.ETag! },
      ];
      response.headers!["last-modified"] = [
        { key: "Last-Modified", value: new Date().toUTCString() },
      ];
    }

    response.status = "200";
    response.statusDescription = "OK";
  } catch (error) {
    console.error("Error processing image:", error);
    return response;
  }

  return response;
};
