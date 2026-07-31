import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import {
  LocksGitHubOidcStack,
  TARGET_ENV,
} from '../lib/github-oidc-stack.js';

describe('LocksGitHubOidcStack', () => {
  const app = new App();
  const template = Template.fromStack(
    new LocksGitHubOidcStack(app, 'LocksGitHubOidcStack', {
      env: TARGET_ENV,
    }),
  );

  it('restricts GitHub trust to the locks main branch', () => {
    template.hasResourceProperties('Custom::AWSCDKOpenIdConnectProvider', {
      Url: 'https://token.actions.githubusercontent.com',
      ClientIDList: ['sts.amazonaws.com'],
    });
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'sts:AssumeRoleWithWebIdentity',
            Condition: {
              StringEquals: {
                'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
                'token.actions.githubusercontent.com:sub':
                  'repo:kenneth-huebsch/locks:ref:refs/heads/main',
              },
            },
          }),
        ]),
      },
    });
  });

  it('uses scoped deployment policies instead of administrator access', () => {
    const roles = template.findResources('AWS::IAM::Role');
    expect(JSON.stringify(roles)).not.toContain('AdministratorAccess');
    expect(JSON.stringify(roles)).not.toContain('"Action":"*"');
    expect(JSON.stringify(roles)).toContain('sts:AssumeRole');
  });

  it('allows CloudFormation to manage the invited Cognito user lifecycle', () => {
    template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              'cognito-idp:AdminCreateUser',
              'cognito-idp:AdminDeleteUser',
              'cognito-idp:AdminGetUser',
            ]),
          }),
        ]),
      },
    });
  });
});
