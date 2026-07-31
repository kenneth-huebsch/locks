#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import {
  LocksGitHubOidcStack,
  TARGET_ACCOUNT,
  TARGET_ENV,
  TARGET_REGION,
} from '../lib/github-oidc-stack.js';
import { LocksAppStack } from '../lib/locks-app-stack.js';

if (
  process.env.CDK_DEFAULT_ACCOUNT !== TARGET_ACCOUNT ||
  process.env.CDK_DEFAULT_REGION !== TARGET_REGION
) {
  throw new Error(
    `Refusing to synthesize: expected AWS account ${TARGET_ACCOUNT} in ${TARGET_REGION}`,
  );
}

const app = new App();
new LocksGitHubOidcStack(app, 'LocksGitHubOidcStack', {
  env: TARGET_ENV,
});
new LocksAppStack(app, 'LocksAppStack', {
  env: TARGET_ENV,
});
