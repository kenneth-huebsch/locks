import {
  CfnOutput,
  DefaultStackSynthesizer,
  Duration,
  PermissionsBoundary,
  RemovalPolicy,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import {
  HttpApi,
  HttpMethod,
} from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  Function as CloudFrontFunction,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  OriginRequestPolicy,
  ResponseHeadersPolicy,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import {
  HttpOrigin,
  S3BucketOrigin,
} from 'aws-cdk-lib/aws-cloudfront-origins';
import {
  CfnUserPoolUser,
  OAuthScope,
  UserPool,
  UserPoolClientIdentityProvider,
} from 'aws-cdk-lib/aws-cognito';
import {
  AttributeType,
  BillingMode,
  Table,
  TableEncryption,
} from 'aws-cdk-lib/aws-dynamodb';
import {
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
} from 'aws-cdk-lib/aws-s3';
import {
  CfnSchedule,
  CfnScheduleGroup,
} from 'aws-cdk-lib/aws-scheduler';
import type { Construct } from 'constructs';
import {
  APP_DEPLOY_ROLE_NAME,
  APP_EXECUTION_ROLE_NAME,
  APP_RUNTIME_BOUNDARY_NAME,
  TARGET_ACCOUNT,
  TARGET_REGION,
  assertTargetEnvironment,
} from './github-oidc-stack.js';

const INVITED_EMAIL = 'kenneth.huebsch@gmail.com';

export class LocksAppStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, {
      ...props,
      permissionsBoundary: PermissionsBoundary.fromArn(
        `arn:aws:iam::${TARGET_ACCOUNT}:policy/${APP_RUNTIME_BOUNDARY_NAME}`,
      ),
      synthesizer: new DefaultStackSynthesizer({
        deployRoleArn:
          `arn:aws:iam::${TARGET_ACCOUNT}:role/${APP_DEPLOY_ROLE_NAME}`,
        cloudFormationExecutionRole:
          `arn:aws:iam::${TARGET_ACCOUNT}:role/${APP_EXECUTION_ROLE_NAME}`,
      }),
    });
    assertTargetEnvironment(this);

    const table = new Table(this, 'Table', {
      tableName: 'locks',
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey: { name: 'SK', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const currentWeekFunction = new NodejsFunction(
      this,
      'CurrentWeekFunction',
      {
        entry: 'backend/functions/current-week.ts',
        handler: 'handler',
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        timeout: Duration.seconds(10),
        memorySize: 256,
        environment: {
          TABLE_NAME: table.tableName,
        },
        bundling: {
          minify: true,
          sourceMap: true,
        },
      },
    );
    table.grantReadData(currentWeekFunction);

    const userPool = new UserPool(this, 'UserPool', {
      userPoolName: 'locks',
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      standardAttributes: {
        email: { required: true, mutable: false },
      },
      passwordPolicy: {
        minLength: 12,
        requireDigits: true,
        requireLowercase: true,
        requireSymbols: true,
        requireUppercase: true,
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const userPoolDomain = userPool.addDomain('ManagedLoginDomain', {
      cognitoDomain: {
        domainPrefix: `locks-${TARGET_ACCOUNT}`,
      },
    });
    new CfnUserPoolUser(this, 'InvitedUser', {
      userPoolId: userPool.userPoolId,
      username: INVITED_EMAIL,
      desiredDeliveryMediums: ['EMAIL'],
      userAttributes: [
        { name: 'email', value: INVITED_EMAIL },
        { name: 'email_verified', value: 'true' },
      ],
    });

    const httpApi = new HttpApi(this, 'HttpApi', {
      apiName: 'locks',
      createDefaultStage: true,
    });

    const siteBucket = new Bucket(this, 'SiteBucket', {
      bucketName: `locks-${TARGET_ACCOUNT}-${TARGET_REGION}-site`,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const spaRewrite = new CloudFrontFunction(this, 'SpaRewrite', {
      runtime: FunctionRuntime.JS_2_0,
      code: FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  if (request.uri.endsWith('/')) {
    request.uri += 'index.html';
  } else if (!request.uri.includes('.')) {
    request.uri = '/index.html';
  }
  return request;
}`),
    });

    const distribution = new Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: ResponseHeadersPolicy.SECURITY_HEADERS,
        functionAssociations: [
          {
            eventType: FunctionEventType.VIEWER_REQUEST,
            function: spaRewrite,
          },
        ],
      },
      additionalBehaviors: {
        'api/*': {
          origin: new HttpOrigin(
            `${httpApi.apiId}.execute-api.${this.region}.${this.urlSuffix}`,
          ),
          allowedMethods: AllowedMethods.ALLOW_ALL,
          cachePolicy: CachePolicy.CACHING_DISABLED,
          originRequestPolicy:
            OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
        },
      },
    });

    const siteUrl = `https://${distribution.distributionDomainName}`;
    const userPoolClient = userPool.addClient('WebClient', {
      userPoolClientName: 'locks-web',
      authFlows: {
        userSrp: true,
      },
      generateSecret: false,
      supportedIdentityProviders: [
        UserPoolClientIdentityProvider.COGNITO,
      ],
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [OAuthScope.OPENID, OAuthScope.EMAIL],
        callbackUrls: [siteUrl],
        logoutUrls: [siteUrl],
      },
    });
    const authorizer = new HttpJwtAuthorizer(
      'CognitoAuthorizer',
      userPool.userPoolProviderUrl,
      {
        jwtAudience: [userPoolClient.userPoolClientId],
        identitySource: ['$request.header.Authorization'],
      },
    );
    httpApi.addRoutes({
      path: '/api/week/current',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration(
        'CurrentWeekIntegration',
        currentWeekFunction,
      ),
      authorizer,
    });

    const submitPickFunctionRole = new Role(this, 'SubmitPickFunctionRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      description: 'Execution role for authenticated pick submission',
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole',
        ),
      ],
    });
    submitPickFunctionRole.addToPolicy(
      new PolicyStatement({
        actions: [
          'dynamodb:ConditionCheckItem',
          'dynamodb:GetItem',
          'dynamodb:TransactWriteItems',
        ],
        resources: [table.tableArn],
      }),
    );

    const submitPickFunction = new NodejsFunction(this, 'SubmitPickFunction', {
      entry: 'backend/functions/submit-pick.ts',
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(10),
      memorySize: 256,
      role: submitPickFunctionRole,
      environment: {
        TABLE_NAME: table.tableName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    httpApi.addRoutes({
      path: '/api/picks',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration(
        'SubmitPickIntegration',
        submitPickFunction,
      ),
      authorizer,
    });

    const syncOddsFunctionRole = new Role(this, 'SyncOddsFunctionRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      description: 'Execution role for scheduled odds synchronization',
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole',
        ),
      ],
    });
    syncOddsFunctionRole.addToPolicy(
      new PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${TARGET_REGION}:${TARGET_ACCOUNT}:parameter/locks/odds-api-key`,
        ],
      }),
    );
    syncOddsFunctionRole.addToPolicy(
      new PolicyStatement({
        actions: [
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:Query',
          'dynamodb:UpdateItem',
        ],
        resources: [
          table.tableArn,
          `${table.tableArn}/index/*`,
        ],
      }),
    );

    const syncOddsFunction = new NodejsFunction(this, 'SyncOddsFunction', {
      entry: 'backend/functions/sync-odds.ts',
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(30),
      memorySize: 256,
      role: syncOddsFunctionRole,
      environment: {
        TABLE_NAME: table.tableName,
        ODDS_API_ENABLED: 'true',
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    const schedulerInvokeRole = new Role(this, 'SyncOddsSchedulerInvokeRole', {
      assumedBy: new ServicePrincipal('scheduler.amazonaws.com'),
      description: 'Allows EventBridge Scheduler to invoke sync-odds',
    });
    syncOddsFunction.grantInvoke(schedulerInvokeRole);

    new CfnScheduleGroup(this, 'ScheduledFunctionsGroup', {
      name: 'locks',
    });

    const scheduleProps = {
      groupName: 'locks',
      flexibleTimeWindow: { mode: 'OFF' },
      state: 'DISABLED',
      target: {
        arn: syncOddsFunction.functionArn,
        roleArn: schedulerInvokeRole.roleArn,
        retryPolicy: {
          maximumRetryAttempts: 2,
        },
      },
    } as const;

    new CfnSchedule(this, 'SyncOddsMorningSchedule', {
      name: 'sync-odds-morning',
      scheduleExpression: 'cron(0 12 * * ? *)',
      scheduleExpressionTimezone: 'UTC',
      description: 'Morning NFL odds sync (8am ET, Tue-Mon during season)',
      ...scheduleProps,
    });
    new CfnSchedule(this, 'SyncOddsAfternoonSchedule', {
      name: 'sync-odds-afternoon',
      scheduleExpression: 'cron(0 20 * * ? *)',
      scheduleExpressionTimezone: 'UTC',
      description: 'Afternoon NFL odds sync (4pm ET, Tue-Mon during season)',
      ...scheduleProps,
    });

    output(this, 'ApiEndpoint', httpApi.apiEndpoint);
    output(this, 'Authority', userPool.userPoolProviderUrl);
    output(this, 'CognitoDomain', userPoolDomain.baseUrl());
    output(this, 'DistributionDomainName', distribution.distributionDomainName);
    output(this, 'DistributionId', distribution.distributionId);
    output(this, 'SiteBucketName', siteBucket.bucketName);
    output(this, 'TableName', table.tableName);
    output(this, 'UserPoolClientId', userPoolClient.userPoolClientId);
    output(this, 'UserPoolId', userPool.userPoolId);
  }
}

function output(stack: Stack, id: string, value: string): void {
  new CfnOutput(stack, id, {
    exportName: `Locks${id}`,
    value,
  });
}
