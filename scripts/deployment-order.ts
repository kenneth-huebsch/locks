export interface DeploymentFile {
  key: string;
  path: string;
}

export async function publishInSafeOrder(
  files: DeploymentFile[],
  upload: (file: DeploymentFile) => Promise<void>,
  deleteStale: () => Promise<void>,
): Promise<void> {
  const immutableAssets = files.filter(({ key }) =>
    key.startsWith('assets/'),
  );
  const mutableFiles = files.filter(
    ({ key }) => !key.startsWith('assets/'),
  );

  await Promise.all(immutableAssets.map(upload));
  await Promise.all(mutableFiles.map(upload));
  await deleteStale();
}
