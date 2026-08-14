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
  ProjectionType,
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

    table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
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
    // grantReadData includes base-table and GSI reads (GSI1 picks query).
    table.grantReadData(currentWeekFunction);

    const standingsFunction = new NodejsFunction(this, 'StandingsFunction', {
      entry: 'backend/functions/standings.ts',
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
    });
    table.grantReadData(standingsFunction);

    const userPool = new UserPool(this, 'UserPoolV2', {
      userPoolName: 'locks',
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      // Username case sensitivity is create-time only. CloudFormation rejects
      // in-place UsernameConfiguration updates, so this pool uses construct id
      // UserPoolV2 to replace the original pool. RemovalPolicy.DESTROY wipes
      // users; migrate users/subs after AWS apply.
      signInCaseSensitive: false,
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
    // Cognito domain prefixes are globally unique per region and cannot move
    // between pools while the old domain still exists. Replacement uses a new
    // prefix; the old locks-${TARGET_ACCOUNT} domain is destroyed with UserPool.
    const userPoolDomain = userPool.addDomain('ManagedLoginDomain', {
      cognitoDomain: {
        domainPrefix: `locks-app-${TARGET_ACCOUNT}`,
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

    httpApi.addRoutes({
      path: '/api/standings',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration(
        'StandingsIntegration',
        standingsFunction,
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
          // TransactWriteItems still requires the underlying item actions.
          'dynamodb:ConditionCheckItem',
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:TransactWriteItems',
        ],
        resources: [
          table.tableArn,
          // GSI attributes are written on the base table; keep index ARN for future queries.
          `${table.tableArn}/index/*`,
        ],
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
        // Preseason testing: pull NFL preseason board. Flip to americanfootball_nfl for regular season.
        ODDS_API_SPORT: 'americanfootball_nfl_preseason',
        ACTIVE_WEEK: '1',
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    const gradeGamesFunctionRole = new Role(this, 'GradeGamesFunctionRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      description: 'Execution role for scheduled score sync and pick grading',
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole',
        ),
      ],
    });
    gradeGamesFunctionRole.addToPolicy(
      new PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${TARGET_REGION}:${TARGET_ACCOUNT}:parameter/locks/odds-api-key`,
        ],
      }),
    );
    gradeGamesFunctionRole.addToPolicy(
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

    const gradeGamesFunction = new NodejsFunction(this, 'GradeGamesFunction', {
      entry: 'backend/functions/grade-games.ts',
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(30),
      memorySize: 256,
      role: gradeGamesFunctionRole,
      environment: {
        TABLE_NAME: table.tableName,
        ODDS_API_ENABLED: 'true',
        // Preseason dry run: match sync-odds sport key. Flip to americanfootball_nfl for regular season.
        ODDS_API_SPORT: 'americanfootball_nfl_preseason',
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    // Shared scheduler invoke role for sync-odds and grade-games (grantInvoke
    // below). Keep Description stable: AppIamExecutionPolicy does not grant
    // iam:UpdateRoleDescription (same footgun as LocksAppPublishRole).
    const schedulerInvokeRole = new Role(this, 'SyncOddsSchedulerInvokeRole', {
      assumedBy: new ServicePrincipal('scheduler.amazonaws.com'),
      description: 'Allows EventBridge Scheduler to invoke sync-odds',
    });
    syncOddsFunction.grantInvoke(schedulerInvokeRole);
    gradeGamesFunction.grantInvoke(schedulerInvokeRole);

    new CfnScheduleGroup(this, 'ScheduledFunctionsGroup', {
      name: 'locks',
    });

    // Match existing odds schedules: ENABLED for preseason dry run. Disable
    // both families during the offseason (see odds-management.md).
    const syncOddsScheduleProps = {
      groupName: 'locks',
      flexibleTimeWindow: { mode: 'OFF' },
      state: 'ENABLED',
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
      ...syncOddsScheduleProps,
    });
    new CfnSchedule(this, 'SyncOddsAfternoonSchedule', {
      name: 'sync-odds-afternoon',
      scheduleExpression: 'cron(0 20 * * ? *)',
      scheduleExpressionTimezone: 'UTC',
      description: 'Afternoon NFL odds sync (4pm ET, Tue-Mon during season)',
      ...syncOddsScheduleProps,
    });

    // Score windows (PLAN): after TNF / early / late / SNF / MNF.
    // Timezone America/New_York so expressions track ET across DST.
    const gradeGamesScheduleProps = {
      groupName: 'locks',
      flexibleTimeWindow: { mode: 'OFF' },
      state: 'ENABLED',
      target: {
        arn: gradeGamesFunction.functionArn,
        roleArn: schedulerInvokeRole.roleArn,
        retryPolicy: {
          maximumRetryAttempts: 2,
        },
      },
    } as const;

    new CfnSchedule(this, 'GradeGamesThursdayTnfSchedule', {
      name: 'grade-games-thursday-tnf',
      // Thu 11:45 PM ET — after Thursday Night Football
      scheduleExpression: 'cron(45 23 ? * THU *)',
      scheduleExpressionTimezone: 'America/New_York',
      description: 'Grade after TNF (Thu 11:45pm America/New_York)',
      ...gradeGamesScheduleProps,
    });
    new CfnSchedule(this, 'GradeGamesSundayEarlySchedule', {
      name: 'grade-games-sunday-early',
      // Sun 4:15 PM ET — after the early Sunday window
      scheduleExpression: 'cron(15 16 ? * SUN *)',
      scheduleExpressionTimezone: 'America/New_York',
      description: 'Grade after early Sunday games (Sun 4:15pm America/New_York)',
      ...gradeGamesScheduleProps,
    });
    new CfnSchedule(this, 'GradeGamesSundayLateSchedule', {
      name: 'grade-games-sunday-late',
      // Sun 8:00 PM ET — after the late afternoon window
      scheduleExpression: 'cron(0 20 ? * SUN *)',
      scheduleExpressionTimezone: 'America/New_York',
      description: 'Grade after late Sunday games (Sun 8:00pm America/New_York)',
      ...gradeGamesScheduleProps,
    });
    new CfnSchedule(this, 'GradeGamesSundaySnfSchedule', {
      name: 'grade-games-sunday-snf',
      // Sun 11:45 PM ET — after Sunday Night Football
      scheduleExpression: 'cron(45 23 ? * SUN *)',
      scheduleExpressionTimezone: 'America/New_York',
      description: 'Grade after SNF (Sun 11:45pm America/New_York)',
      ...gradeGamesScheduleProps,
    });
    new CfnSchedule(this, 'GradeGamesMondayMnfSchedule', {
      name: 'grade-games-monday-mnf',
      // Mon 11:45 PM ET — after Monday Night Football
      scheduleExpression: 'cron(45 23 ? * MON *)',
      scheduleExpressionTimezone: 'America/New_York',
      description: 'Grade after MNF (Mon 11:45pm America/New_York)',
      ...gradeGamesScheduleProps,
    });

    output(this, 'ApiEndpoint', httpApi.apiEndpoint);
    output(this, 'Authority', userPool.userPoolProviderUrl);
    output(this, 'CognitoDomain', userPoolDomain.baseUrl());
    output(this, 'DistributionDomainName', distribution.distributionDomainName);
    output(this, 'DistributionId', distribution.distributionId);
    output(this, 'GradeGamesFunctionName', gradeGamesFunction.functionName);
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
