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

  it('adopts both execution policies with repeated CDK bootstrap flags', async () => {
    const readme = await readFile('README.md', 'utf8');
    const executionPolicyFlag = '--cloudformation-execution-policies';

    expect(readme.match(new RegExp(executionPolicyFlag, 'g'))).toHaveLength(2);
    expect(readme).toContain(
      `${executionPolicyFlag} "arn:aws:iam::580956784928:policy/LocksCdkExecutionPolicy"`,
    );
    expect(readme).toContain(
      `${executionPolicyFlag} "arn:aws:iam::580956784928:policy/LocksCdkIamExecutionPolicy"`,
    );
    expect(readme.match(/policy\/LocksCdkExecutionPolicy/g)).toHaveLength(2);
    expect(readme.match(/policy\/LocksCdkIamExecutionPolicy/g)).toHaveLength(2);
  });

  it('pins third-party actions to immutable v4 commit SHAs', async () => {
    const workflow = await readFile('.github/workflows/deploy.yml', 'utf8');

    expect(workflow).toContain(
      'uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4',
    );
    expect(workflow).toContain(
      'uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4',
    );
    expect(workflow).toContain(
      'uses: aws-actions/configure-aws-credentials@7474bc4690e29a8392af63c5b98e7449536d5c3a # v4',
    );
    expect(workflow).not.toMatch(/uses: .+@v4(?:\s|$)/);
  });
});
