import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from '@aws-sdk/client-cloudfront';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import {
  TARGET_REGION,
  assertTargetAccount,
  getAppStackOutputs,
  requireOutput,
} from './aws-context.js';
import { createRuntimeConfig } from './runtime-config.js';

await assertTargetAccount();
const outputs = await getAppStackOutputs();
const runtimeConfig = createRuntimeConfig(outputs);

await mkdir('public', { recursive: true });
await writeFile(
  'public/runtime-config.json',
  `${JSON.stringify(runtimeConfig, null, 2)}\n`,
  'utf8',
);
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
  stdio: 'inherit',
});

const bucketName = requireOutput(outputs, 'SiteBucketName');
const distributionId = requireOutput(outputs, 'DistributionId');
const s3 = new S3Client({ region: TARGET_REGION });
const files = await listFiles(resolve('dist'));
const localKeys = new Set(
  files.map((file) => relative(resolve('dist'), file).split(sep).join('/')),
);

let continuationToken: string | undefined;
do {
  const listed = await s3.send(
    new ListObjectsV2Command({
      Bucket: bucketName,
      ContinuationToken: continuationToken,
    }),
  );
  const staleKeys = (listed.Contents ?? [])
    .map(({ Key }) => Key)
    .filter(
      (key): key is string =>
        key !== undefined && !localKeys.has(key),
    );
  if (staleKeys.length > 0) {
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: {
          Objects: staleKeys.map((Key) => ({ Key })),
          Quiet: true,
        },
      }),
    );
  }
  continuationToken = listed.NextContinuationToken;
} while (continuationToken);

await Promise.all(
  files.map(async (file) => {
    const key = relative(resolve('dist'), file).split(sep).join('/');
    await s3.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: await readFile(file),
        ContentType: contentType(file),
        CacheControl: key.startsWith('assets/')
          ? 'public,max-age=31536000,immutable'
          : 'no-cache',
      }),
    );
  }),
);

execFileSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['run', 'seed'],
  { stdio: 'inherit' },
);
await new CloudFrontClient({ region: TARGET_REGION }).send(
  new CreateInvalidationCommand({
    DistributionId: distributionId,
    InvalidationBatch: {
      CallerReference: `${Date.now()}`,
      Paths: {
        Quantity: 1,
        Items: ['/*'],
      },
    },
  }),
);

console.log(
  `Published https://${requireOutput(outputs, 'DistributionDomainName')}`,
);

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    }),
  );
  return nested.flat();
}

function contentType(file: string): string {
  const types: Record<string, string> = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
  };
  return types[extname(file)] ?? 'application/octet-stream';
}
