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

  it('lets only app CloudFormation read the exact bootstrap version', () => {
    const policies = managedPolicyStatements(template);
    const appStatement =
      policies.LocksAppCloudFormationExecutionPolicy.find(({ Action }) =>
        toArray(Action).includes('ssm:GetParameters'),
      );

    expect(appStatement).toEqual({
      Action: 'ssm:GetParameters',
      Effect: 'Allow',
      Resource:
        'arn:aws:ssm:us-east-1:580956784928:parameter/cdk-bootstrap/hnb659fds/version',
      Sid: 'BootstrapVersion',
    });
    expect(
      policies.LocksAppRuntimeBoundary.flatMap(({ Action }) =>
        toArray(Action),
      ),
    ).not.toContain('ssm:GetParameters');
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
    const invokeStatements = Object.values(managedPolicyStatements(template))
      .flat()
      .filter(({ Action }) =>
        Array.isArray(Action)
          ? Action.includes('lambda:InvokeFunction')
          : Action === 'lambda:InvokeFunction',
      );

    expect(invokeStatements).toEqual([
      {
        Action: 'lambda:InvokeFunction',
        Effect: 'Allow',
        Resource:
          'arn:aws:lambda:us-east-1:580956784928:function:LocksAppStack-*',
        Sid: 'Invoke',
      },
      {
        Action: 'lambda:InvokeFunction',
        Effect: 'Allow',
        Resource:
          'arn:aws:lambda:us-east-1:580956784928:function:LocksGitHubOidcStack-*',
        Sid: 'InvokeOidc',
      },
    ]);
  });

  it('never grants IAM actions against every resource', () => {
    const statements = Object.values(managedPolicyStatements(template)).flat();

    for (const statement of statements) {
      const actions = toArray(statement.Action);
      if (actions.some((action) => action.startsWith('iam:'))) {
        expect(toArray(statement.Resource)).not.toContain('*');
      }
    }
  });

  it('isolates only unsupported create actions on every resource', () => {
    const statements = Object.values(managedPolicyStatements(template)).flat();
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

  it('keeps every execution and boundary policy comfortably sized', () => {
    const policies = managedPolicyStatements(template);
    const resources = template.findResources('AWS::IAM::ManagedPolicy');

    expect(Object.keys(policies).sort()).toEqual([
      'LocksAppCloudFormationExecutionPolicy',
      'LocksAppIamExecutionPolicy',
      'LocksAppRuntimeBoundary',
      'LocksCdkExecutionPolicy',
      'LocksCdkIamExecutionPolicy',
    ]);
    const resourcesByName = Object.fromEntries(
      Object.values(resources).map((resource) => [
        resource.Properties.ManagedPolicyName,
        resource,
      ]),
    );
    expect(
      resourcesByName.LocksCdkExecutionPolicy.Properties.Roles,
    ).toEqual([
      'cdk-hnb659fds-cfn-exec-role-580956784928-us-east-1',
    ]);
    expect(
      resourcesByName.LocksCdkIamExecutionPolicy.Properties.Roles,
    ).toEqual([
      'cdk-hnb659fds-cfn-exec-role-580956784928-us-east-1',
    ]);
    expect(resourcesByName.LocksAppRuntimeBoundary.Properties.Roles).toBeUndefined();
    for (const statements of Object.values(policies)) {
      const policyDocument = {
        Version: '2012-10-17',
        Statement: statements,
      };
      expect(JSON.stringify(policyDocument).length).toBeLessThanOrEqual(4_500);
    }
  });

  it('outputs both execution policy ARNs for bootstrap adoption', () => {
    template.hasOutput('CdkExecutionPolicyArn', {});
    template.hasOutput('CdkIamExecutionPolicyArn', {});
  });

  it('preserves deployed fixed-name policy replacement properties', () => {
    const resources = template.findResources('AWS::IAM::ManagedPolicy');

    expect(resources.CdkExecutionPolicy7229B59A).toMatchObject({
      Properties: {
        Description:
          'CloudFormation permissions for the Locks application stack',
        ManagedPolicyName: 'LocksCdkExecutionPolicy',
        Path: '/',
      },
    });
    expect(resources.CdkIamExecutionPolicy109909DF).toMatchObject({
      Properties: {
        Description:
          'CloudFormation permissions for Locks identity and bootstrap resources',
        ManagedPolicyName: 'LocksCdkIamExecutionPolicy',
        Path: '/',
      },
    });
  });

  it('lets GitHub assume only app deployment and bootstrap support roles', () => {
    const statements = inlineRoleStatements(
      template,
      'LocksGitHubDeployRole',
    );
    const assumeResources = statements
      .filter(({ Action }) => toArray(Action).includes('sts:AssumeRole'))
      .flatMap(({ Resource }) => toArray(Resource))
      .sort();

    expect(assumeResources).toEqual([
      'arn:aws:iam::580956784928:role/LocksAppDeployRole',
      'arn:aws:iam::580956784928:role/cdk-hnb659fds-file-publishing-role-580956784928-us-east-1',
      'arn:aws:iam::580956784928:role/cdk-hnb659fds-image-publishing-role-580956784928-us-east-1',
      'arn:aws:iam::580956784928:role/cdk-hnb659fds-lookup-role-580956784928-us-east-1',
    ]);
    expect(assumeResources).not.toContain(
      'arn:aws:iam::580956784928:role/cdk-hnb659fds-deploy-role-580956784928-us-east-1',
    );
    const actions = statements.flatMap(({ Action }) => toArray(Action));
    expect(
      actions.filter((action) =>
        [
          'cloudformation:CreateChangeSet',
          'cloudformation:CreateStack',
          'cloudformation:ExecuteChangeSet',
          'cloudformation:UpdateStack',
        ].includes(action),
      ),
    ).toEqual([]);
  });

  it('creates stack-specific application deployment identities', () => {
    const appDeployRole = roleByName(template, 'LocksAppDeployRole');
    roleByName(template, 'LocksAppCloudFormationExecutionRole');
    const trust = JSON.stringify(
      appDeployRole.Properties.AssumeRolePolicyDocument,
    );

    expect(trust).toContain(
      'arn:aws:iam::580956784928:role/LocksGitHubDeployRole',
    );
    expect(trust).toContain(
      'arn:aws:iam::580956784928:user/coding-agent',
    );

    const statements = inlineRoleStatements(template, 'LocksAppDeployRole');
    const passRole = statements.find(({ Action }) =>
      toArray(Action).includes('iam:PassRole'),
    );
    expect(passRole).toMatchObject({
      Resource:
        'arn:aws:iam::580956784928:role/LocksAppCloudFormationExecutionRole',
      Condition: {
        StringEquals: {
          'iam:PassedToService': 'cloudformation.amazonaws.com',
        },
      },
    });

    const cloudFormationResources = statements
      .filter(({ Action }) =>
        toArray(Action).some((action) =>
          action.startsWith('cloudformation:'),
        ),
      )
      .flatMap(({ Resource }) => toArray(Resource));
    expect(cloudFormationResources.length).toBeGreaterThan(0);
    expect(
      cloudFormationResources.every(
        (resource) =>
          resource.includes(':stack/LocksAppStack/') ||
          resource.includes(':changeSet/'),
      ),
    ).toBe(true);
    for (const action of [
      'cloudformation:CreateChangeSet',
      'cloudformation:CreateStack',
      'cloudformation:UpdateStack',
    ]) {
      expect(
        statements.find(({ Action }) => toArray(Action).includes(action)),
      ).toMatchObject({
        Condition: {
          StringEquals: {
            'cloudformation:RoleArn':
              'arn:aws:iam::580956784928:role/LocksAppCloudFormationExecutionRole',
          },
        },
      });
    }
  });

  it('requires the app boundary for role creation and allowlists attachments', () => {
    const statements = appExecutionStatements(template);

    expect(statements).toBeDefined();
    expect(
      statements.find(({ Action }) =>
        toArray(Action).includes('iam:CreateRole'),
      ),
    ).toMatchObject({
      Resource: 'arn:aws:iam::580956784928:role/LocksAppStack-*',
      Condition: {
        StringEquals: {
          'iam:PermissionsBoundary':
            'arn:aws:iam::580956784928:policy/LocksAppRuntimeBoundary',
        },
      },
    });
    expect(
      statements.find(({ Action }) =>
        toArray(Action).includes('iam:AttachRolePolicy'),
      ),
    ).toMatchObject({
      Resource: 'arn:aws:iam::580956784928:role/LocksAppStack-*',
      Condition: {
        StringEquals: {
          'iam:PolicyARN':
            'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
        },
      },
    });
    expect(
      statements.flatMap(({ Action }) => toArray(Action)),
    ).not.toContain('iam:DeleteRolePermissionsBoundary');
  });

  it('prevents app execution from mutating foundation and deployment identities', () => {
    const statements = appExecutionStatements(template);
    const iamStatements = statements.filter(({ Action }) =>
      toArray(Action).some((action) => action.startsWith('iam:')),
    );
    const resources = iamStatements.flatMap(({ Resource }) =>
      toArray(Resource),
    );

    expect(resources).not.toContain('*');
    expect(JSON.stringify(resources)).not.toContain('LocksGitHub');
    expect(JSON.stringify(resources)).not.toContain('cdk-hnb659fds');
    expect(JSON.stringify(resources)).not.toContain(
      'LocksAppCloudFormationExecutionRole',
    );
    expect(JSON.stringify(resources)).not.toContain('LocksAppDeployRole');
    expect(JSON.stringify(resources)).not.toContain(
      'policy/LocksCdkExecutionPolicy',
    );
    expect(JSON.stringify(resources)).not.toContain(
      'policy/LocksCdkIamExecutionPolicy',
    );
  });

  it('keeps bootstrap execution limited to foundation lifecycle', () => {
    const policies = managedPolicyStatements(template);
    const statements = [
      ...policies.LocksCdkExecutionPolicy,
      ...policies.LocksCdkIamExecutionPolicy,
    ];
    const actions = statements.flatMap(({ Action }) => toArray(Action));
    const serialized = JSON.stringify(statements);

    for (const service of [
      'apigateway:',
      'cloudfront:',
      'cognito-idp:',
      'dynamodb:',
      'scheduler:',
    ]) {
      expect(actions.some((action) => action.startsWith(service))).toBe(false);
    }
    expect(serialized).not.toContain('LocksAppStack-*');
    expect(serialized).toContain('LocksGitHubOidcStack-*');
  });

  it('conditions every managed-policy attachment on an allowlist', () => {
    const statements = Object.values(managedPolicyStatements(template)).flat();
    const attachmentStatements = statements.filter(({ Action }) =>
      toArray(Action).some((action) =>
        ['iam:AttachRolePolicy', 'iam:DetachRolePolicy'].includes(action),
      ),
    );

    expect(attachmentStatements.length).toBeGreaterThan(0);
    for (const statement of attachmentStatements) {
      expect(statement.Condition?.StringEquals?.['iam:PolicyARN']).toBeDefined();
    }
  });

  it('cannot write inline policies to execution or bootstrap roles', () => {
    const statements = Object.values(managedPolicyStatements(template)).flat();
    const inlinePolicyResources = statements
      .filter(({ Action }) =>
        toArray(Action).includes('iam:PutRolePolicy'),
      )
      .flatMap(({ Resource }) => toArray(Resource));
    const serialized = JSON.stringify(inlinePolicyResources);

    expect(serialized).not.toContain(
      'LocksAppCloudFormationExecutionRole',
    );
    expect(serialized).not.toContain('cdk-hnb659fds-cfn-exec-role');
  });

  it('limits the runtime boundary to application data and logs', () => {
    const statements =
      managedPolicyStatements(template).LocksAppRuntimeBoundary;
    const actions = statements.flatMap(({ Action }) => toArray(Action));
    const resources = statements.flatMap(({ Resource }) => toArray(Resource));

    expect(actions.some((action) => action.startsWith('iam:'))).toBe(false);
    expect(actions.sort()).toEqual([
      'dynamodb:BatchGetItem',
      'dynamodb:ConditionCheckItem',
      'dynamodb:DescribeTable',
      'dynamodb:GetItem',
      'dynamodb:Query',
      'dynamodb:Scan',
      'logs:CreateLogGroup',
      'logs:CreateLogStream',
      'logs:PutLogEvents',
      's3:DeleteObject',
      's3:DeleteObjectVersion',
      's3:GetBucketPolicy',
      's3:ListBucket',
      's3:ListBucketVersions',
      's3:PutBucketPolicy',
      'ssm:GetParameter',
    ]);
    expect(resources).toEqual(
      expect.arrayContaining([
        'arn:aws:dynamodb:us-east-1:580956784928:table/locks',
        'arn:aws:ssm:us-east-1:580956784928:parameter/locks/odds-api-key',
        'arn:aws:s3:::locks-580956784928-us-east-1-site',
        'arn:aws:s3:::locks-580956784928-us-east-1-site/*',
        'arn:aws:logs:us-east-1:580956784928:log-group:/aws/lambda/LocksAppStack-*',
      ]),
    );
    expect(resources.every((resource) => resource !== '*')).toBe(true);
  });
});

interface PolicyStatementDocument {
  Action: string | string[];
  Condition?: Record<string, Record<string, string | string[]>>;
  Effect: string;
  Resource: string | string[];
}

interface RoleResource {
  Properties: {
    AssumeRolePolicyDocument: object;
    Policies?: Array<{
      PolicyDocument: {
        Statement: PolicyStatementDocument[];
      };
    }>;
    RoleName: string;
  };
}

function managedPolicyStatements(
  template: Template,
): Record<string, PolicyStatementDocument[]> {
  const policies = template.findResources('AWS::IAM::ManagedPolicy');
  return Object.fromEntries(
    Object.values(policies).map((policy) => {
      const typedPolicy = policy as {
        Properties: {
          ManagedPolicyName: string;
          PolicyDocument: {
            Statement: PolicyStatementDocument[];
          };
        };
      };
      return [
        typedPolicy.Properties.ManagedPolicyName,
        typedPolicy.Properties.PolicyDocument.Statement,
      ];
    }),
  );
}

function appExecutionStatements(
  template: Template,
): PolicyStatementDocument[] {
  const policies = managedPolicyStatements(template);
  return [
    ...policies.LocksAppCloudFormationExecutionPolicy,
    ...policies.LocksAppIamExecutionPolicy,
  ];
}

function toArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

function roleByName(template: Template, roleName: string): RoleResource {
  const roles = Object.values(
    template.findResources('AWS::IAM::Role'),
  ) as RoleResource[];
  const role = roles.find(
    ({ Properties }) => Properties.RoleName === roleName,
  );
  expect(role).toBeDefined();
  return role!;
}

function inlineRoleStatements(
  template: Template,
  roleName: string,
): PolicyStatementDocument[] {
  const roles = template.findResources('AWS::IAM::Role');
  const roleEntry = Object.entries(roles).find(
    ([, role]) => role.Properties.RoleName === roleName,
  );
  expect(roleEntry).toBeDefined();
  const [logicalId, role] = roleEntry!;
  const embeddedStatements = (
    (role as RoleResource).Properties.Policies ?? []
  ).flatMap(
    ({ PolicyDocument }) => PolicyDocument.Statement,
  );
  const attachedStatements = Object.values(
    template.findResources('AWS::IAM::Policy'),
  )
    .filter(({ Properties }) =>
      (Properties.Roles ?? []).some(
        (attachedRole: object | string) =>
          attachedRole === roleName ||
          JSON.stringify(attachedRole) ===
            JSON.stringify({ Ref: logicalId }),
      ),
    )
    .flatMap(
      ({ Properties }) =>
        Properties.PolicyDocument.Statement as PolicyStatementDocument[],
    );
  return [...embeddedStatements, ...attachedStatements];
}
