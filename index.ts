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
    debug: console.log,
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
  bucket: string
): Promise<PutObjectCommandOutput> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    CacheControl: `max-age=${MAX_AGE}`,
  });

  return client.send(command);
}

function getOriginalKey(uri: string): string {
  return uri.split("/").slice(0, -1).join("/");
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

  response.headers["x-lae-region"] = [
    { key: "x-lae-region", value: process.env.AWS_REGION },
  ];

  if (NOT_FOUND_STATUSES.includes(originResponse.status) === false) {
    return response;
  }

  try {
    const queryParams = event.Records[0].cf.request.querystring;
    const params = new URLSearchParams(queryParams);

    const origKey = getOriginalKey(request.uri);
    if (origKey.trim().length === 0) throw new Error(`Invalid key ${origKey}`);

    const object = await getObject(origKey, Bucket);
    const imageBuffer = await object.Body.transformToByteArray();

    const metadata = await sharp(imageBuffer).metadata();

    const width = params.has("w") ? parseInt(params.get("w"), 10) : undefined;
    const height = params.has("h") ? parseInt(params.get("h"), 10) : undefined;
    const quality = params.has("quality")
      ? parseInt(params.get("quality"), 10)
      : 100;
    const format = params.has("format")
      ? (params.get("format") as keyof sharp.FormatEnum)
      : metadata.format;
    const processedImage = sharp(imageBuffer)
      .resize({ width, height })
      .toFormat(format, { quality });

    const outputBuffer = await processedImage.toBuffer();

    // even if there is exception in saving the object we send back the generated
    // image back to viewer below
    await uploadObject(request.uri, outputBuffer, Bucket).catch((e) =>
      console.log("Exception while writing resized image to bucket", e)
    );

    response.body = outputBuffer.toString("base64");
    response.bodyEncoding = "base64";
    response.headers["content-type"] = [
      { key: "Content-Type", value: `image/${format}` },
    ];
    response.headers["cache-control"] = [
      { key: "max-age", value: MAX_AGE.toString() },
    ];
  } catch (error) {
    console.error("Error processing image:", error);
    return response;
  }

  return response;
};
