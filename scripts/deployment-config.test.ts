import { readFile } from 'node:fs/promises';

describe('deployment commands', () => {
  it('keeps noninteractive CDK options inside dedicated npm scripts', async () => {
    const packageJson = JSON.parse(
      await readFile('package.json', 'utf8'),
    ) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['deploy:oidc']).toBe(
      'cdk --app "npx tsx infrastructure/bin/locks.ts" deploy LocksGitHubOidcStack --require-approval never',
    );
    expect(packageJson.scripts['deploy:infrastructure']).toBe(
      'cdk --app "npx tsx infrastructure/bin/locks.ts" deploy LocksAppStack --require-approval never',
    );
  });

  it('uses the app-only dedicated deployment command in CI', async () => {
    const workflow = await readFile('.github/workflows/deploy.yml', 'utf8');

    expect(workflow).toContain('run: npm run deploy:infrastructure');
    expect(workflow).not.toContain('npm run deploy:oidc');
    expect(workflow).not.toContain('npm run cdk -- deploy');
  });

  it('documents dedicated deployment commands', async () => {
    const readme = await readFile('README.md', 'utf8');

    expect(readme).toContain('npm run deploy:oidc');
    expect(readme).toContain('npm run deploy:infrastructure');
    expect(readme).not.toContain('npm run cdk -- deploy');
  });
});
