import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import {
  Effect,
  FederatedPrincipal,
  ManagedPolicy,
  OpenIdConnectProvider,
  PolicyStatement,
  Role,
} from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

export const TARGET_ACCOUNT = '580956784928';
export const TARGET_REGION = 'us-east-1';
export const TARGET_ENV = {
  account: TARGET_ACCOUNT,
  region: TARGET_REGION,
} as const;

const GITHUB_SUBJECT =
  'repo:kenneth-huebsch/locks:ref:refs/heads/main';

export class LocksGitHubOidcStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    assertTargetEnvironment(this);

    const provider = new OpenIdConnectProvider(this, 'GitHubProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });
    const bootstrapExecutionRole = Role.fromRoleName(
      this,
      'BootstrapExecutionRole',
      `cdk-hnb659fds-cfn-exec-role-${TARGET_ACCOUNT}-${TARGET_REGION}`,
    );
    const executionPolicy = new ManagedPolicy(
      this,
      'CdkExecutionPolicy',
      {
        managedPolicyName: 'LocksCdkExecutionPolicy',
        description:
          'CloudFormation permissions for the Locks application stack',
        statements: [
          new PolicyStatement({
            sid: 'CreateNoArn',
            actions: [
              'cloudfront:CreateDistribution',
              'cloudfront:CreateFunction',
              'cloudfront:CreateOriginAccessControl',
              'cognito-idp:CreateUserPool',
            ],
            resources: ['*'],
          }),
          new PolicyStatement({
            sid: 'Api',
            actions: [
              'apigateway:DELETE',
              'apigateway:GET',
              'apigateway:PATCH',
              'apigateway:POST',
              'apigateway:PUT',
              'apigateway:TagResource',
              'apigateway:UntagResource',
            ],
            resources: [
              `arn:aws:apigateway:${TARGET_REGION}::/apis`,
              `arn:aws:apigateway:${TARGET_REGION}::/apis/*`,
            ],
          }),
          new PolicyStatement({
            sid: 'CfFn',
            actions: [
              'cloudfront:DeleteFunction',
              'cloudfront:DescribeFunction',
              'cloudfront:GetFunction',
              'cloudfront:PublishFunction',
              'cloudfront:TagResource',
              'cloudfront:UntagResource',
              'cloudfront:UpdateFunction',
            ],
            resources: [
              `arn:aws:cloudfront::${TARGET_ACCOUNT}:function/LocksAppStack-*`,
            ],
          }),
          new PolicyStatement({
            sid: 'CfDist',
            actions: [
              'cloudfront:CreateInvalidation',
              'cloudfront:DeleteDistribution',
              'cloudfront:GetDistribution',
              'cloudfront:GetDistributionConfig',
              'cloudfront:ListTagsForResource',
              'cloudfront:TagResource',
              'cloudfront:UntagResource',
              'cloudfront:UpdateDistribution',
            ],
            resources: [
              `arn:aws:cloudfront::${TARGET_ACCOUNT}:distribution/*`,
            ],
          }),
          new PolicyStatement({
            sid: 'CfOac',
            actions: [
              'cloudfront:DeleteOriginAccessControl',
              'cloudfront:GetOriginAccessControl',
              'cloudfront:UpdateOriginAccessControl',
            ],
            resources: [
              `arn:aws:cloudfront::${TARGET_ACCOUNT}:origin-access-control/*`,
            ],
          }),
          new PolicyStatement({
            sid: 'Cognito',
            actions: [
              'cognito-idp:AdminCreateUser',
              'cognito-idp:AdminDeleteUser',
              'cognito-idp:AdminGetUser',
              'cognito-idp:CreateUserPoolClient',
              'cognito-idp:CreateUserPoolDomain',
              'cognito-idp:DeleteUserPool',
              'cognito-idp:DeleteUserPoolClient',
              'cognito-idp:DeleteUserPoolDomain',
              'cognito-idp:DescribeUserPool',
              'cognito-idp:DescribeUserPoolClient',
              'cognito-idp:DescribeUserPoolDomain',
              'cognito-idp:TagResource',
              'cognito-idp:UntagResource',
              'cognito-idp:UpdateUserPool',
              'cognito-idp:UpdateUserPoolClient',
            ],
            resources: [
              `arn:aws:cognito-idp:${TARGET_REGION}:${TARGET_ACCOUNT}:userpool/*`,
            ],
          }),
          new PolicyStatement({
            sid: 'Ddb',
            actions: [
              'dynamodb:CreateTable',
              'dynamodb:DeleteTable',
              'dynamodb:DescribeContinuousBackups',
              'dynamodb:DescribeTable',
              'dynamodb:DescribeTimeToLive',
              'dynamodb:ListTagsOfResource',
              'dynamodb:TagResource',
              'dynamodb:UntagResource',
              'dynamodb:UpdateContinuousBackups',
              'dynamodb:UpdateTable',
            ],
            resources: [
              `arn:aws:dynamodb:${TARGET_REGION}:${TARGET_ACCOUNT}:table/locks`,
              `arn:aws:dynamodb:${TARGET_REGION}:${TARGET_ACCOUNT}:table/locks/index/*`,
            ],
          }),
          new PolicyStatement({
            sid: 'Roles',
            actions: [
              'iam:AttachRolePolicy',
              'iam:CreateRole',
              'iam:DeleteRole',
              'iam:DeleteRolePolicy',
              'iam:DetachRolePolicy',
              'iam:GetRole',
              'iam:GetRolePolicy',
              'iam:ListAttachedRolePolicies',
              'iam:PutRolePolicy',
              'iam:TagRole',
              'iam:UntagRole',
              'iam:UpdateAssumeRolePolicy',
            ],
            resources: [
              `arn:aws:iam::${TARGET_ACCOUNT}:role/LocksAppStack-*`,
              `arn:aws:iam::${TARGET_ACCOUNT}:role/LocksGitHubOidcStack-*`,
              `arn:aws:iam::${TARGET_ACCOUNT}:role/LocksGitHubDeployRole`,
              `arn:aws:iam::${TARGET_ACCOUNT}:role/cdk-hnb659fds-cfn-exec-role-${TARGET_ACCOUNT}-${TARGET_REGION}`,
            ],
          }),
          new PolicyStatement({
            sid: 'PassRoles',
            actions: ['iam:PassRole'],
            resources: [
              `arn:aws:iam::${TARGET_ACCOUNT}:role/LocksAppStack-*`,
              `arn:aws:iam::${TARGET_ACCOUNT}:role/LocksGitHubOidcStack-*`,
            ],
            conditions: {
              StringEquals: {
                'iam:PassedToService': 'lambda.amazonaws.com',
              },
            },
          }),
          new PolicyStatement({
            sid: 'Policy',
            actions: [
              'iam:CreatePolicy',
              'iam:CreatePolicyVersion',
              'iam:DeletePolicy',
              'iam:DeletePolicyVersion',
              'iam:GetPolicy',
              'iam:GetPolicyVersion',
              'iam:ListPolicyVersions',
              'iam:SetDefaultPolicyVersion',
              'iam:TagPolicy',
              'iam:UntagPolicy',
            ],
            resources: [
              `arn:aws:iam::${TARGET_ACCOUNT}:policy/LocksCdkExecutionPolicy`,
            ],
          }),
          new PolicyStatement({
            sid: 'Oidc',
            actions: [
              'iam:CreateOpenIDConnectProvider',
              'iam:DeleteOpenIDConnectProvider',
              'iam:GetOpenIDConnectProvider',
              'iam:TagOpenIDConnectProvider',
              'iam:UntagOpenIDConnectProvider',
            ],
            resources: [
              `arn:aws:iam::${TARGET_ACCOUNT}:oidc-provider/token.actions.githubusercontent.com`,
            ],
          }),
          new PolicyStatement({
            sid: 'Lambda',
            actions: [
              'lambda:AddPermission',
              'lambda:CreateFunction',
              'lambda:DeleteFunction',
              'lambda:GetFunction',
              'lambda:GetFunctionConfiguration',
              'lambda:ListTags',
              'lambda:RemovePermission',
              'lambda:TagResource',
              'lambda:UntagResource',
              'lambda:UpdateFunctionCode',
              'lambda:UpdateFunctionConfiguration',
            ],
            resources: [
              `arn:aws:lambda:${TARGET_REGION}:${TARGET_ACCOUNT}:function:LocksAppStack-*`,
              `arn:aws:lambda:${TARGET_REGION}:${TARGET_ACCOUNT}:function:LocksGitHubOidcStack-*`,
            ],
          }),
          new PolicyStatement({
            sid: 'Logs',
            actions: [
              'logs:CreateLogGroup',
              'logs:DeleteLogGroup',
              'logs:ListTagsForResource',
              'logs:PutRetentionPolicy',
              'logs:TagResource',
              'logs:UntagResource',
            ],
            resources: [
              `arn:aws:logs:${TARGET_REGION}:${TARGET_ACCOUNT}:log-group:/aws/lambda/LocksAppStack-*`,
              `arn:aws:logs:${TARGET_REGION}:${TARGET_ACCOUNT}:log-group:/aws/lambda/LocksGitHubOidcStack-*`,
            ],
          }),
          new PolicyStatement({
            sid: 'SiteBucket',
            actions: [
              's3:CreateBucket',
              's3:DeleteBucket',
              's3:DeleteBucketPolicy',
              's3:GetBucketLocation',
              's3:GetBucketPolicy',
              's3:GetBucketTagging',
              's3:GetEncryptionConfiguration',
              's3:ListBucket',
              's3:PutBucketPolicy',
              's3:PutBucketPublicAccessBlock',
              's3:PutBucketTagging',
              's3:PutEncryptionConfiguration',
            ],
            resources: [
              `arn:aws:s3:::locks-${TARGET_ACCOUNT}-${TARGET_REGION}-site`,
            ],
          }),
          new PolicyStatement({
            sid: 'SiteObjects',
            actions: [
              's3:DeleteObject',
              's3:GetObject',
              's3:PutObject',
            ],
            resources: [
              `arn:aws:s3:::locks-${TARGET_ACCOUNT}-${TARGET_REGION}-site/*`,
            ],
          }),
          new PolicyStatement({
            sid: 'CdkAssets',
            actions: ['s3:GetObject'],
            resources: [
              `arn:aws:s3:::cdk-hnb659fds-assets-${TARGET_ACCOUNT}-${TARGET_REGION}/*`,
            ],
          }),
          new PolicyStatement({
            sid: 'Scheduler',
            actions: [
              'scheduler:CreateScheduleGroup',
              'scheduler:DeleteSchedule',
              'scheduler:DeleteScheduleGroup',
              'scheduler:GetScheduleGroup',
              'scheduler:ListTagsForResource',
              'scheduler:TagResource',
              'scheduler:UntagResource',
            ],
            resources: [
              `arn:aws:scheduler:${TARGET_REGION}:${TARGET_ACCOUNT}:schedule-group/locks`,
              `arn:aws:scheduler:${TARGET_REGION}:${TARGET_ACCOUNT}:schedule/locks/*`,
            ],
          }),
          new PolicyStatement({
            sid: 'Invoke',
            actions: ['lambda:InvokeFunction'],
            resources: [
              `arn:aws:lambda:${TARGET_REGION}:${TARGET_ACCOUNT}:function:LocksAppStack-*`,
              `arn:aws:lambda:${TARGET_REGION}:${TARGET_ACCOUNT}:function:LocksGitHubOidcStack-*`,
            ],
          }),
          new PolicyStatement({
            sid: 'BootstrapVersion',
            actions: ['ssm:GetParameters'],
            resources: [
              `arn:aws:ssm:${TARGET_REGION}:${TARGET_ACCOUNT}:parameter/cdk-bootstrap/hnb659fds/version`,
            ],
          }),
        ],
        roles: [bootstrapExecutionRole],
      },
    );
    executionPolicy.applyRemovalPolicy(RemovalPolicy.RETAIN);

    const deployRole = new Role(this, 'GitHubDeployRole', {
      roleName: 'LocksGitHubDeployRole',
      assumedBy: new FederatedPrincipal(
        provider.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
            'token.actions.githubusercontent.com:sub': GITHUB_SUBJECT,
          },
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
      description: 'Deploys the Locks application from the main branch',
      maxSessionDuration: Duration.hours(1),
    });

    deployRole.addToPolicy(
      new PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [
          `arn:aws:iam::${TARGET_ACCOUNT}:role/cdk-hnb659fds-deploy-role-${TARGET_ACCOUNT}-${TARGET_REGION}`,
          `arn:aws:iam::${TARGET_ACCOUNT}:role/cdk-hnb659fds-file-publishing-role-${TARGET_ACCOUNT}-${TARGET_REGION}`,
          `arn:aws:iam::${TARGET_ACCOUNT}:role/cdk-hnb659fds-image-publishing-role-${TARGET_ACCOUNT}-${TARGET_REGION}`,
          `arn:aws:iam::${TARGET_ACCOUNT}:role/cdk-hnb659fds-lookup-role-${TARGET_ACCOUNT}-${TARGET_REGION}`,
        ],
      }),
    );
    deployRole.addToPolicy(
      new PolicyStatement({
        actions: ['cloudformation:DescribeStacks'],
        resources: [
          `arn:aws:cloudformation:${TARGET_REGION}:${TARGET_ACCOUNT}:stack/LocksAppStack/*`,
        ],
      }),
    );
    deployRole.addToPolicy(
      new PolicyStatement({
        actions: ['dynamodb:PutItem'],
        resources: [
          `arn:aws:dynamodb:${TARGET_REGION}:${TARGET_ACCOUNT}:table/locks`,
        ],
      }),
    );
    deployRole.addToPolicy(
      new PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [
          `arn:aws:s3:::locks-${TARGET_ACCOUNT}-${TARGET_REGION}-site`,
        ],
      }),
    );
    deployRole.addToPolicy(
      new PolicyStatement({
        actions: ['s3:DeleteObject', 's3:PutObject'],
        resources: [
          `arn:aws:s3:::locks-${TARGET_ACCOUNT}-${TARGET_REGION}-site/*`,
        ],
      }),
    );
    deployRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['cloudfront:CreateInvalidation'],
        resources: [
          `arn:aws:cloudfront::${TARGET_ACCOUNT}:distribution/*`,
        ],
      }),
    );

    new CfnOutput(this, 'GitHubDeployRoleArn', {
      value: deployRole.roleArn,
    });
    new CfnOutput(this, 'CdkExecutionPolicyArn', {
      value: executionPolicy.managedPolicyArn,
    });
  }
}

export function assertTargetEnvironment(stack: Stack): void {
  if (
    stack.account !== TARGET_ACCOUNT ||
    stack.region !== TARGET_REGION
  ) {
    throw new Error(
      `Locks stacks must target ${TARGET_ACCOUNT} in ${TARGET_REGION}`,
    );
  }
}
