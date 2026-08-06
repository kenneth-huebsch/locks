import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import {
  ArnPrincipal,
  CompositePrincipal,
  Effect,
  FederatedPrincipal,
  ManagedPolicy,
  OpenIdConnectProvider,
  PolicyStatement,
  Role,
  ServicePrincipal,
  User,
} from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

export const TARGET_ACCOUNT = '580956784928';
export const TARGET_REGION = 'us-east-1';
export const TARGET_ENV = {
  account: TARGET_ACCOUNT,
  region: TARGET_REGION,
} as const;

// GitHub Actions for this repo emits id-qualified OIDC subjects
// (owner@id/repo@id), not classic owner/name. Confirmed via JWT debug:
//   repo:kenneth-huebsch@25780362/locks@1317783805:ref:refs/heads/main
const GITHUB_SUBJECT =
  'repo:kenneth-huebsch@25780362/locks@1317783805:ref:refs/heads/main';
export const APP_DEPLOY_ROLE_NAME = 'LocksAppDeployRole';
export const APP_PUBLISH_ROLE_NAME = 'LocksAppPublishRole';
export const APP_EXECUTION_ROLE_NAME =
  'LocksAppCloudFormationExecutionRole';
export const APP_EXECUTION_POLICY_NAME =
  'LocksAppCloudFormationExecutionPolicy';
export const APP_IAM_EXECUTION_POLICY_NAME =
  'LocksAppIamExecutionPolicy';
export const APP_RUNTIME_BOUNDARY_NAME = 'LocksAppRuntimeBoundary';
export const CODING_AGENT_READ_POLICY_NAME = 'LocksCodingAgentReadPolicy';

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
    const appRuntimeBoundary = new ManagedPolicy(
      this,
      'AppRuntimeBoundary',
      {
        managedPolicyName: APP_RUNTIME_BOUNDARY_NAME,
        description:
          'Maximum permissions for Locks application runtime roles',
        statements: [
          new PolicyStatement({
            sid: 'TableRead',
            actions: [
              'dynamodb:BatchGetItem',
              'dynamodb:ConditionCheckItem',
              'dynamodb:DescribeTable',
              'dynamodb:GetItem',
              'dynamodb:PutItem',
              'dynamodb:Query',
              'dynamodb:Scan',
              'dynamodb:TransactWriteItems',
              'dynamodb:UpdateItem',
            ],
            resources: [
              `arn:aws:dynamodb:${TARGET_REGION}:${TARGET_ACCOUNT}:table/locks`,
              `arn:aws:dynamodb:${TARGET_REGION}:${TARGET_ACCOUNT}:table/locks/index/*`,
            ],
          }),
          new PolicyStatement({
            sid: 'OddsParameter',
            actions: ['ssm:GetParameter'],
            resources: [
              `arn:aws:ssm:${TARGET_REGION}:${TARGET_ACCOUNT}:parameter/locks/odds-api-key`,
            ],
          }),
          new PolicyStatement({
            sid: 'SiteCleanup',
            actions: [
              's3:DeleteObject',
              's3:DeleteObjectVersion',
              's3:GetBucketPolicy',
              's3:ListBucket',
              's3:ListBucketVersions',
              's3:PutBucketPolicy',
            ],
            resources: [
              `arn:aws:s3:::locks-${TARGET_ACCOUNT}-${TARGET_REGION}-site`,
              `arn:aws:s3:::locks-${TARGET_ACCOUNT}-${TARGET_REGION}-site/*`,
            ],
          }),
          new PolicyStatement({
            sid: 'LambdaLogs',
            actions: [
              'logs:CreateLogGroup',
              'logs:CreateLogStream',
              'logs:PutLogEvents',
            ],
            resources: [
              `arn:aws:logs:${TARGET_REGION}:${TARGET_ACCOUNT}:log-group:/aws/lambda/LocksAppStack-*`,
              `arn:aws:logs:${TARGET_REGION}:${TARGET_ACCOUNT}:log-group:/aws/lambda/LocksAppStack-*:*`,
            ],
          }),
        ],
      },
    );
    const appExecutionRole = new Role(this, 'AppExecutionRole', {
      roleName: APP_EXECUTION_ROLE_NAME,
      assumedBy: new ServicePrincipal('cloudformation.amazonaws.com'),
      description:
        'Executes CloudFormation changes only for LocksAppStack',
    });
    const executionPolicy = new ManagedPolicy(
      this,
      'AppExecutionPolicy',
      {
        managedPolicyName: APP_EXECUTION_POLICY_NAME,
        description:
          'CloudFormation service permissions for LocksAppStack',
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
              'cloudfront:ListTagsForResource',
            ],
            resources: [
              `arn:aws:cloudfront::${TARGET_ACCOUNT}:function/*`,
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
              'scheduler:CreateSchedule',
              'scheduler:CreateScheduleGroup',
              'scheduler:DeleteSchedule',
              'scheduler:DeleteScheduleGroup',
              'scheduler:GetSchedule',
              'scheduler:GetScheduleGroup',
              'scheduler:ListTagsForResource',
              'scheduler:TagResource',
              'scheduler:UntagResource',
              'scheduler:UpdateSchedule',
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
        roles: [appExecutionRole],
      },
    );
    const appIamExecutionPolicy = new ManagedPolicy(
      this,
      'AppIamExecutionPolicy',
      {
        managedPolicyName: APP_IAM_EXECUTION_POLICY_NAME,
        description:
          'CloudFormation IAM permissions for LocksAppStack runtime roles',
        statements: [
          new PolicyStatement({
            sid: 'CreateRuntimeRole',
            actions: ['iam:CreateRole'],
            resources: [
              `arn:aws:iam::${TARGET_ACCOUNT}:role/LocksAppStack-*`,
            ],
            conditions: {
              StringEquals: {
                'iam:PermissionsBoundary':
                  `arn:aws:iam::${TARGET_ACCOUNT}:policy/${APP_RUNTIME_BOUNDARY_NAME}`,
              },
            },
          }),
          new PolicyStatement({
            sid: 'RuntimeRoles',
            actions: [
              'iam:DeleteRole',
              'iam:DeleteRolePolicy',
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
            ],
          }),
          new PolicyStatement({
            sid: 'EnforceBoundary',
            actions: ['iam:PutRolePermissionsBoundary'],
            resources: [
              `arn:aws:iam::${TARGET_ACCOUNT}:role/LocksAppStack-*`,
            ],
            conditions: {
              StringEquals: {
                'iam:PermissionsBoundary':
                  `arn:aws:iam::${TARGET_ACCOUNT}:policy/${APP_RUNTIME_BOUNDARY_NAME}`,
              },
            },
          }),
          new PolicyStatement({
            sid: 'RuntimeManagedPolicy',
            actions: [
              'iam:AttachRolePolicy',
              'iam:DetachRolePolicy',
            ],
            resources: [
              `arn:aws:iam::${TARGET_ACCOUNT}:role/LocksAppStack-*`,
            ],
            conditions: {
              StringEquals: {
                'iam:PolicyARN':
                  'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
              },
            },
          }),
          new PolicyStatement({
            sid: 'PassRuntimeRoles',
            actions: ['iam:PassRole'],
            resources: [
              `arn:aws:iam::${TARGET_ACCOUNT}:role/LocksAppStack-*`,
            ],
            conditions: {
              StringEquals: {
                'iam:PassedToService': [
                  'lambda.amazonaws.com',
                  'scheduler.amazonaws.com',
                ],
              },
            },
          }),
        ],
        roles: [appExecutionRole],
      },
    );
    const bootstrapExecutionPolicy = new ManagedPolicy(
      this,
      'CdkExecutionPolicy',
      {
        managedPolicyName: 'LocksCdkExecutionPolicy',
        // Legacy wording is intentionally immutable for safe in-place upgrades.
        description:
          'CloudFormation permissions for the Locks application stack',
        statements: [
          new PolicyStatement({
            sid: 'OidcLambda',
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
              `arn:aws:lambda:${TARGET_REGION}:${TARGET_ACCOUNT}:function:LocksGitHubOidcStack-*`,
            ],
          }),
          new PolicyStatement({
            sid: 'OidcLogs',
            actions: [
              'logs:CreateLogGroup',
              'logs:DeleteLogGroup',
              'logs:ListTagsForResource',
              'logs:PutRetentionPolicy',
              'logs:TagResource',
              'logs:UntagResource',
            ],
            resources: [
              `arn:aws:logs:${TARGET_REGION}:${TARGET_ACCOUNT}:log-group:/aws/lambda/LocksGitHubOidcStack-*`,
            ],
          }),
          new PolicyStatement({
            sid: 'InvokeOidc',
            actions: ['lambda:InvokeFunction'],
            resources: [
              `arn:aws:lambda:${TARGET_REGION}:${TARGET_ACCOUNT}:function:LocksGitHubOidcStack-*`,
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
    bootstrapExecutionPolicy.applyRemovalPolicy(RemovalPolicy.RETAIN);
    const iamExecutionPolicy = new ManagedPolicy(
      this,
      'CdkIamExecutionPolicy',
      {
        managedPolicyName: 'LocksCdkIamExecutionPolicy',
        description:
          'CloudFormation permissions for Locks identity and bootstrap resources',
        statements: [
          new PolicyStatement({
            sid: 'Roles',
            actions: [
              'iam:CreateRole',
              'iam:DeleteRole',
              'iam:GetRole',
              'iam:ListAttachedRolePolicies',
              'iam:TagRole',
              'iam:UntagRole',
              'iam:UpdateAssumeRolePolicy',
            ],
            resources: [
              `arn:aws:iam::${TARGET_ACCOUNT}:role/LocksGitHubOidcStack-*`,
              `arn:aws:iam::${TARGET_ACCOUNT}:role/LocksGitHubDeployRole`,
              `arn:aws:iam::${TARGET_ACCOUNT}:role/${APP_DEPLOY_ROLE_NAME}`,
              `arn:aws:iam::${TARGET_ACCOUNT}:role/${APP_PUBLISH_ROLE_NAME}`,
              `arn:aws:iam::${TARGET_ACCOUNT}:role/${APP_EXECUTION_ROLE_NAME}`,
            ],
          }),
          new PolicyStatement({
            sid: 'InlineRolePolicies',
            actions: [
              'iam:DeleteRolePolicy',
              'iam:GetRolePolicy',
              'iam:PutRolePolicy',
            ],
            resources: [
              `arn:aws:iam::${TARGET_ACCOUNT}:role/LocksGitHubOidcStack-*`,
              `arn:aws:iam::${TARGET_ACCOUNT}:role/LocksGitHubDeployRole`,
              `arn:aws:iam::${TARGET_ACCOUNT}:role/${APP_DEPLOY_ROLE_NAME}`,
              `arn:aws:iam::${TARGET_ACCOUNT}:role/${APP_PUBLISH_ROLE_NAME}`,
            ],
          }),
          new PolicyStatement({
            sid: 'BootstrapRoleRead',
            actions: [
              'iam:GetRole',
              'iam:ListAttachedRolePolicies',
            ],
            resources: [
              `arn:aws:iam::${TARGET_ACCOUNT}:role/cdk-hnb659fds-cfn-exec-role-${TARGET_ACCOUNT}-${TARGET_REGION}`,
            ],
          }),
          new PolicyStatement({
            sid: 'AttachFoundationPolicies',
            actions: [
              'iam:AttachRolePolicy',
              'iam:DetachRolePolicy',
            ],
            resources: [
              `arn:aws:iam::${TARGET_ACCOUNT}:role/${APP_EXECUTION_ROLE_NAME}`,
              `arn:aws:iam::${TARGET_ACCOUNT}:role/cdk-hnb659fds-cfn-exec-role-${TARGET_ACCOUNT}-${TARGET_REGION}`,
            ],
            conditions: {
              StringEquals: {
                'iam:PolicyARN': [
                  `arn:aws:iam::${TARGET_ACCOUNT}:policy/${APP_EXECUTION_POLICY_NAME}`,
                  `arn:aws:iam::${TARGET_ACCOUNT}:policy/${APP_IAM_EXECUTION_POLICY_NAME}`,
                  `arn:aws:iam::${TARGET_ACCOUNT}:policy/LocksCdkExecutionPolicy`,
                  `arn:aws:iam::${TARGET_ACCOUNT}:policy/LocksCdkIamExecutionPolicy`,
                ],
              },
            },
          }),
          new PolicyStatement({
            sid: 'AttachCodingAgentReadPolicy',
            actions: ['iam:AttachUserPolicy', 'iam:DetachUserPolicy'],
            resources: [
              `arn:aws:iam::${TARGET_ACCOUNT}:user/coding-agent`,
            ],
            conditions: {
              StringEquals: {
                'iam:PolicyARN': `arn:aws:iam::${TARGET_ACCOUNT}:policy/${CODING_AGENT_READ_POLICY_NAME}`,
              },
            },
          }),
          new PolicyStatement({
            sid: 'PassRoles',
            actions: ['iam:PassRole'],
            resources: [
              `arn:aws:iam::${TARGET_ACCOUNT}:role/LocksGitHubOidcStack-*`,
            ],
            conditions: {
              StringEquals: {
                'iam:PassedToService': 'lambda.amazonaws.com',
              },
            },
          }),
          new PolicyStatement({
            sid: 'Policies',
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
              `arn:aws:iam::${TARGET_ACCOUNT}:policy/LocksCdkIamExecutionPolicy`,
              `arn:aws:iam::${TARGET_ACCOUNT}:policy/${APP_EXECUTION_POLICY_NAME}`,
              `arn:aws:iam::${TARGET_ACCOUNT}:policy/${APP_IAM_EXECUTION_POLICY_NAME}`,
              `arn:aws:iam::${TARGET_ACCOUNT}:policy/${APP_RUNTIME_BOUNDARY_NAME}`,
              `arn:aws:iam::${TARGET_ACCOUNT}:policy/${CODING_AGENT_READ_POLICY_NAME}`,
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
        ],
        roles: [bootstrapExecutionRole],
      },
    );
    iamExecutionPolicy.applyRemovalPolicy(RemovalPolicy.RETAIN);

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
    const appDeployRole = new Role(this, 'AppDeployRole', {
      roleName: APP_DEPLOY_ROLE_NAME,
      assumedBy: new CompositePrincipal(
        new ArnPrincipal(deployRole.roleArn),
        new ArnPrincipal(
          `arn:aws:iam::${TARGET_ACCOUNT}:user/coding-agent`,
        ),
      ),
      description:
        'Initiates CloudFormation deployments only for LocksAppStack',
      maxSessionDuration: Duration.hours(1),
    });
    appDeployRole.node.addDependency(deployRole);
    const appPublishRole = new Role(this, 'AppPublishRole', {
      roleName: APP_PUBLISH_ROLE_NAME,
      assumedBy: new ArnPrincipal(
        `arn:aws:iam::${TARGET_ACCOUNT}:user/coding-agent`,
      ),
      // Role Description is intentionally stable; LocksCdkIamExecutionPolicy
      // does not grant iam:UpdateRoleDescription.
      description:
        'Publishes the Locks static site and seeds application data',
      maxSessionDuration: Duration.hours(1),
    });
    appPublishRole.node.addDependency(iamExecutionPolicy);
    appDeployRole.addToPolicy(
      new PolicyStatement({
        sid: 'DeployAppStack',
        actions: [
          'cloudformation:ContinueUpdateRollback',
          'cloudformation:DeleteStack',
          'cloudformation:DescribeStackEvents',
          'cloudformation:DescribeStackResources',
          'cloudformation:DescribeStacks',
          'cloudformation:GetTemplate',
          'cloudformation:GetTemplateSummary',
          'cloudformation:RollbackStack',
          'cloudformation:UpdateTerminationProtection',
        ],
        resources: [
          `arn:aws:cloudformation:${TARGET_REGION}:${TARGET_ACCOUNT}:stack/LocksAppStack/*`,
        ],
      }),
    );
    appDeployRole.addToPolicy(
      new PolicyStatement({
        sid: 'WriteAppStackWithRole',
        actions: [
          'cloudformation:CreateStack',
          'cloudformation:UpdateStack',
        ],
        resources: [
          `arn:aws:cloudformation:${TARGET_REGION}:${TARGET_ACCOUNT}:stack/LocksAppStack/*`,
        ],
        conditions: {
          StringEquals: {
            'cloudformation:RoleArn':
              `arn:aws:iam::${TARGET_ACCOUNT}:role/${APP_EXECUTION_ROLE_NAME}`,
          },
        },
      }),
    );
    appDeployRole.addToPolicy(
      new PolicyStatement({
        sid: 'DeployAppChangeSet',
        actions: [
          'cloudformation:DeleteChangeSet',
          'cloudformation:DescribeChangeSet',
          'cloudformation:ExecuteChangeSet',
        ],
        resources: [
          `arn:aws:cloudformation:${TARGET_REGION}:${TARGET_ACCOUNT}:stack/LocksAppStack/*`,
          `arn:aws:cloudformation:${TARGET_REGION}:${TARGET_ACCOUNT}:changeSet/cdk-deploy-change-set/*`,
        ],
      }),
    );
    appDeployRole.addToPolicy(
      new PolicyStatement({
        sid: 'CreateAppChangeSetWithRole',
        actions: ['cloudformation:CreateChangeSet'],
        resources: [
          `arn:aws:cloudformation:${TARGET_REGION}:${TARGET_ACCOUNT}:stack/LocksAppStack/*`,
          `arn:aws:cloudformation:${TARGET_REGION}:${TARGET_ACCOUNT}:changeSet/cdk-deploy-change-set/*`,
        ],
        conditions: {
          StringEquals: {
            'cloudformation:RoleArn':
              `arn:aws:iam::${TARGET_ACCOUNT}:role/${APP_EXECUTION_ROLE_NAME}`,
          },
        },
      }),
    );
    appDeployRole.addToPolicy(
      new PolicyStatement({
        sid: 'PassAppExecutionRole',
        actions: ['iam:PassRole'],
        resources: [
          `arn:aws:iam::${TARGET_ACCOUNT}:role/${APP_EXECUTION_ROLE_NAME}`,
        ],
        conditions: {
          StringEquals: {
            'iam:PassedToService': 'cloudformation.amazonaws.com',
          },
        },
      }),
    );
    appDeployRole.addToPolicy(
      new PolicyStatement({
        sid: 'ReadBootstrap',
        actions: ['s3:GetBucketLocation', 's3:GetObject', 's3:ListBucket'],
        resources: [
          `arn:aws:s3:::cdk-hnb659fds-assets-${TARGET_ACCOUNT}-${TARGET_REGION}`,
          `arn:aws:s3:::cdk-hnb659fds-assets-${TARGET_ACCOUNT}-${TARGET_REGION}/*`,
        ],
      }),
    );
    appDeployRole.addToPolicy(
      new PolicyStatement({
        sid: 'ReadBootstrapVersion',
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [
          `arn:aws:ssm:${TARGET_REGION}:${TARGET_ACCOUNT}:parameter/cdk-bootstrap/hnb659fds/version`,
        ],
      }),
    );
    appDeployRole.addToPolicy(
      new PolicyStatement({
        sid: 'CallerIdentity',
        actions: ['sts:GetCallerIdentity'],
        resources: ['*'],
      }),
    );
    appPublishRole.addToPolicy(
      new PolicyStatement({
        sid: 'StackRead',
        actions: ['cloudformation:DescribeStacks'],
        resources: [
          `arn:aws:cloudformation:${TARGET_REGION}:${TARGET_ACCOUNT}:stack/LocksAppStack/*`,
        ],
      }),
    );
    appPublishRole.addToPolicy(
      new PolicyStatement({
        sid: 'SeedLocksTable',
        actions: ['dynamodb:PutItem'],
        resources: [
          `arn:aws:dynamodb:${TARGET_REGION}:${TARGET_ACCOUNT}:table/locks`,
        ],
      }),
    );
    appPublishRole.addToPolicy(
      new PolicyStatement({
        sid: 'PublishSite',
        actions: ['s3:ListBucket'],
        resources: [
          `arn:aws:s3:::locks-${TARGET_ACCOUNT}-${TARGET_REGION}-site`,
        ],
      }),
    );
    appPublishRole.addToPolicy(
      new PolicyStatement({
        sid: 'PublishSiteObjects',
        actions: ['s3:DeleteObject', 's3:PutObject'],
        resources: [
          `arn:aws:s3:::locks-${TARGET_ACCOUNT}-${TARGET_REGION}-site/*`,
        ],
      }),
    );
    appPublishRole.addToPolicy(
      new PolicyStatement({
        sid: 'InvalidateSite',
        actions: ['cloudfront:CreateInvalidation'],
        resources: [
          `arn:aws:cloudfront::${TARGET_ACCOUNT}:distribution/*`,
        ],
      }),
    );
    appPublishRole.addToPolicy(
      new PolicyStatement({
        sid: 'CognitoUserOps',
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminGetUser',
          'cognito-idp:ListUsers',
          'cognito-idp:AdminDisableUser',
          'cognito-idp:AdminEnableUser',
          'cognito-idp:AdminSetUserPassword',
          'cognito-idp:AdminResetUserPassword',
        ],
        resources: [
          `arn:aws:cognito-idp:${TARGET_REGION}:${TARGET_ACCOUNT}:userpool/*`,
        ],
      }),
    );
    appPublishRole.addToPolicy(
      new PolicyStatement({
        sid: 'CallerIdentity',
        actions: ['sts:GetCallerIdentity'],
        resources: ['*'],
      }),
    );

    deployRole.addToPolicy(
      new PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [
          `arn:aws:iam::${TARGET_ACCOUNT}:role/${APP_DEPLOY_ROLE_NAME}`,
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

    // Read-only policy for the coding-agent IAM user (used by live verification scripts).
    const codingAgentReadPolicy = new ManagedPolicy(
      this,
      'CodingAgentReadPolicy',
      {
        managedPolicyName: CODING_AGENT_READ_POLICY_NAME,
        description:
          'Read-only access to the Locks table for the coding-agent IAM user',
        statements: [
          new PolicyStatement({
            sid: 'TableRead',
            actions: [
              'dynamodb:DescribeTable',
              'dynamodb:GetItem',
              'dynamodb:Query',
              'dynamodb:Scan',
            ],
            resources: [
              `arn:aws:dynamodb:${TARGET_REGION}:${TARGET_ACCOUNT}:table/locks`,
              `arn:aws:dynamodb:${TARGET_REGION}:${TARGET_ACCOUNT}:table/locks/index/*`,
            ],
          }),
          new PolicyStatement({
            sid: 'StackRead',
            actions: [
              'cloudformation:DescribeStacks',
              'cloudformation:GetTemplate',
            ],
            resources: [
              `arn:aws:cloudformation:${TARGET_REGION}:${TARGET_ACCOUNT}:stack/LocksAppStack/*`,
            ],
          }),
          new PolicyStatement({
            sid: 'AssumeLocksDeploymentRoles',
            actions: ['sts:AssumeRole'],
            resources: [
              `arn:aws:iam::${TARGET_ACCOUNT}:role/${APP_DEPLOY_ROLE_NAME}`,
              `arn:aws:iam::${TARGET_ACCOUNT}:role/${APP_PUBLISH_ROLE_NAME}`,
              `arn:aws:iam::${TARGET_ACCOUNT}:role/cdk-hnb659fds-deploy-role-${TARGET_ACCOUNT}-${TARGET_REGION}`,
              `arn:aws:iam::${TARGET_ACCOUNT}:role/cdk-hnb659fds-file-publishing-role-${TARGET_ACCOUNT}-${TARGET_REGION}`,
              `arn:aws:iam::${TARGET_ACCOUNT}:role/cdk-hnb659fds-image-publishing-role-${TARGET_ACCOUNT}-${TARGET_REGION}`,
              `arn:aws:iam::${TARGET_ACCOUNT}:role/cdk-hnb659fds-lookup-role-${TARGET_ACCOUNT}-${TARGET_REGION}`,
            ],
          }),
          new PolicyStatement({
            sid: 'AuditOwnPolicies',
            actions: [
              'iam:GetUser',
              'iam:GetUserPolicy',
              'iam:ListAttachedUserPolicies',
              'iam:ListUserPolicies',
            ],
            resources: [
              `arn:aws:iam::${TARGET_ACCOUNT}:user/coding-agent`,
            ],
          }),
          new PolicyStatement({
            sid: 'InspectOidcAndRoles',
            actions: [
              'iam:GetRole',
              'iam:ListOpenIdConnectProviders',
              'iam:GetOpenIdConnectProvider',
              'cloudformation:GetTemplate',
              'cloudformation:DescribeStacks',
            ],
            resources: [
              `arn:aws:iam::${TARGET_ACCOUNT}:role/*`,
              `arn:aws:iam::${TARGET_ACCOUNT}:oidc-provider/*`,
              `arn:aws:cloudformation:${TARGET_REGION}:${TARGET_ACCOUNT}:stack/LocksGitHubOidcStack/*`,
              `arn:aws:cloudformation:${TARGET_REGION}:${TARGET_ACCOUNT}:stack/LocksAppStack/*`,
            ],
          }),
        ],
      },
    );
    const codingAgentUser = User.fromUserName(
      this,
      'CodingAgentUser',
      'coding-agent',
    );
    codingAgentReadPolicy.attachToUser(codingAgentUser);
    codingAgentReadPolicy.node.addDependency(iamExecutionPolicy);

    new CfnOutput(this, 'CodingAgentReadPolicyArn', {
      value: codingAgentReadPolicy.managedPolicyArn,
    });
    new CfnOutput(this, 'GitHubDeployRoleArn', {
      value: deployRole.roleArn,
    });
    new CfnOutput(this, 'CdkExecutionPolicyArn', {
      value: bootstrapExecutionPolicy.managedPolicyArn,
    });
    new CfnOutput(this, 'CdkIamExecutionPolicyArn', {
      value: iamExecutionPolicy.managedPolicyArn,
    });
    new CfnOutput(this, 'AppDeployRoleArn', {
      value: appDeployRole.roleArn,
    });
    new CfnOutput(this, 'AppPublishRoleArn', {
      value: appPublishRole.roleArn,
    });
    new CfnOutput(this, 'AppExecutionRoleArn', {
      value: appExecutionRole.roleArn,
    });
    new CfnOutput(this, 'AppExecutionPolicyArn', {
      value: executionPolicy.managedPolicyArn,
    });
    new CfnOutput(this, 'AppIamExecutionPolicyArn', {
      value: appIamExecutionPolicy.managedPolicyArn,
    });
    new CfnOutput(this, 'AppRuntimeBoundaryArn', {
      value: appRuntimeBoundary.managedPolicyArn,
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
