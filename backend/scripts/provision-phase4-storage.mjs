import { PrivateStorage } from '../packages/server/dist/storage.js';
process.loadEnvFile('.env.local');
const storage = new PrivateStorage(process.env.S3_ACCESS_KEY, process.env.S3_SECRET_KEY);
for (const bucket of ['dw-staging', 'dw-canonical']) {
  const found = await storage.request('HEAD', bucket);
  if (found.status === 404) {
    const created = await storage.request(
      'PUT',
      bucket,
      '',
      undefined,
      bucket === 'dw-canonical' ? { 'x-amz-bucket-object-lock-enabled': 'true' } : {},
    );
    if (created.status !== 200) throw new Error('Bucket creation failed: ' + bucket);
  } else if (found.status !== 200) throw new Error('Bucket inspection failed: ' + bucket);
}
const lock = await storage.request('GET', 'dw-canonical', '', undefined, {}, { 'object-lock': '' });
if (
  lock.status !== 200 ||
  !(await lock.text()).includes('<ObjectLockEnabled>Enabled</ObjectLockEnabled>')
)
  throw new Error(
    'Canonical bucket lacks verified Object Lock; refusing any destructive conversion',
  );
const policy = {
  Version: '2012-10-17',
  Statement: [
    {
      Sid: 'PreserveExactCanonicalVersions',
      Effect: 'Deny',
      Principal: '*',
      Action: [
        's3:DeleteObject',
        's3:DeleteObjectVersion',
        's3:PutObjectLegalHold',
        's3:PutObjectRetention',
        's3:PutBucketVersioning',
        's3:DeleteBucket',
        's3:PutBucketObjectLockConfiguration',
      ],
      Resource: ['arn:aws:s3:::dw-canonical', 'arn:aws:s3:::dw-canonical/*'],
    },
  ],
};
const existing = await storage.request('GET', 'dw-canonical', '', undefined, {}, { policy: '' });
if (existing.status === 200) {
  if (JSON.stringify(JSON.parse(await existing.text())) !== JSON.stringify(policy))
    throw new Error('Unrecognized canonical policy; refusing replacement');
} else if (existing.status === 404) {
  const applied = await storage.request(
    'PUT',
    'dw-canonical',
    '',
    Buffer.from(JSON.stringify(policy)),
    {},
    { policy: '' },
  );
  if (applied.status !== 204) throw new Error('Canonical retention policy failed');
} else throw new Error('Canonical policy inspection failed');
console.log(
  'Private staging and versioned/Object-Lock canonical buckets verified; canonical deletion, hold removal and versioning changes denied. No existing bucket/data replaced.',
);
