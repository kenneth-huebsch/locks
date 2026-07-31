import { publishInSafeOrder } from './deployment-order.js';

describe('publishInSafeOrder', () => {
  it('uploads immutable assets, then mutable files, before deleting stale keys', async () => {
    const operations: string[] = [];

    await publishInSafeOrder(
      [
        { key: 'index.html', path: 'dist/index.html' },
        {
          key: 'assets/index-abc123.js',
          path: 'dist/assets/index-abc123.js',
        },
        {
          key: 'runtime-config.json',
          path: 'dist/runtime-config.json',
        },
        {
          key: 'assets/index-def456.css',
          path: 'dist/assets/index-def456.css',
        },
      ],
      async (file) => {
        operations.push(`upload:${file.key}`);
      },
      async () => {
        operations.push('delete-stale');
      },
    );

    expect(operations).toEqual([
      'upload:assets/index-abc123.js',
      'upload:assets/index-def456.css',
      'upload:index.html',
      'upload:runtime-config.json',
      'delete-stale',
    ]);
  });
});
