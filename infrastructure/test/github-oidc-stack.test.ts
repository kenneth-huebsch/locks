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

  it('allows CloudFormation to read only the CDK bootstrap version parameter', () => {
    template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'ssm:GetParameters',
            Effect: 'Allow',
            Resource:
              'arn:aws:ssm:us-east-1:580956784928:parameter/cdk-bootstrap/hnb659fds/version',
          }),
        ]),
      },
    });
  });

  it('supports API tagging and scheduler rollback without service wildcards', () => {
    template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              'apigateway:TagResource',
              'apigateway:UntagResource',
            ]),
          }),
          Match.objectLike({
            Action: Match.arrayWith([
              'scheduler:DeleteSchedule',
            ]),
          }),
        ]),
      },
    });

    const policies = template.findResources('AWS::IAM::ManagedPolicy');
    expect(JSON.stringify(policies)).not.toContain('"apigateway:*"');
    expect(JSON.stringify(policies)).not.toContain('"scheduler:*"');
  });

  it('invokes only Locks custom-resource functions', () => {
    const policies = template.findResources('AWS::IAM::ManagedPolicy');
    const policy = Object.values(policies)[0] as {
      Properties: {
        PolicyDocument: {
          Statement: Array<{
            Action: string | string[];
            Effect: string;
            Resource: string | string[];
          }>;
        };
      };
    };
    const invokeStatements =
      policy.Properties.PolicyDocument.Statement.filter(({ Action }) =>
        Array.isArray(Action)
          ? Action.includes('lambda:InvokeFunction')
          : Action === 'lambda:InvokeFunction',
      );

    expect(invokeStatements).toEqual([
      {
        Action: 'lambda:InvokeFunction',
        Effect: 'Allow',
        Resource: [
          'arn:aws:lambda:us-east-1:580956784928:function:LocksAppStack-*',
          'arn:aws:lambda:us-east-1:580956784928:function:LocksGitHubOidcStack-*',
        ],
        Sid: 'Invoke',
      },
    ]);
  });

  it('never grants IAM actions against every resource', () => {
    const statements = executionPolicyStatements(template);

    for (const statement of statements) {
      const actions = toArray(statement.Action);
      if (actions.some((action) => action.startsWith('iam:'))) {
        expect(toArray(statement.Resource)).not.toContain('*');
      }
    }
  });

  it('isolates only unsupported create actions on every resource', () => {
    const statements = executionPolicyStatements(template);
    const wildcardActions = statements
      .filter((statement) => toArray(statement.Resource).includes('*'))
      .flatMap((statement) => toArray(statement.Action))
      .sort();

    expect(wildcardActions).toEqual([
      'cloudfront:CreateDistribution',
      'cloudfront:CreateFunction',
      'cloudfront:CreateOriginAccessControl',
      'cognito-idp:CreateUserPool',
    ]);
    expect(wildcardActions.every((action) => !action.endsWith(':*'))).toBe(true);
  });

  it('fits the CloudFormation execution document in an IAM managed policy', () => {
    const policyDocument = {
      Version: '2012-10-17',
      Statement: executionPolicyStatements(template),
    };

    expect(JSON.stringify(policyDocument).length).toBeLessThanOrEqual(6_144);
  });
});

interface PolicyStatementDocument {
  Action: string | string[];
  Effect: string;
  Resource: string | string[];
}

function executionPolicyStatements(
  template: Template,
): PolicyStatementDocument[] {
  const policies = template.findResources('AWS::IAM::ManagedPolicy');
  const policy = Object.values(policies)[0] as {
    Properties: {
      PolicyDocument: {
        Statement: PolicyStatementDocument[];
      };
    };
  };
  return policy.Properties.PolicyDocument.Statement;
}

function toArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}
