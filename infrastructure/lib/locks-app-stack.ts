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
  Certificate,
  CertificateValidation,
} from 'aws-cdk-lib/aws-certificatemanager';
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
  ARecord,
  HostedZone,
  RecordTarget,
} from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
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
const CUSTOM_DOMAIN_NAME = 'locks.inov8.cc';
const HOSTED_ZONE_ID = 'Z0077616YT47LAXJAQQ6';
const HOSTED_ZONE_NAME = 'inov8.cc';

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
    const hostedZone = HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId: HOSTED_ZONE_ID,
      zoneName: HOSTED_ZONE_NAME,
    });
    const certificate = new Certificate(this, 'SiteCertificate', {
      domainName: CUSTOM_DOMAIN_NAME,
      validation: CertificateValidation.fromDns(hostedZone),
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
      certificate,
      domainNames: [CUSTOM_DOMAIN_NAME],
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
    new ARecord(this, 'SiteAliasRecord', {
      zone: hostedZone,
      recordName: CUSTOM_DOMAIN_NAME,
      target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
    });

    const siteUrl = `https://${CUSTOM_DOMAIN_NAME}`;
    const cloudFrontSiteUrl = `https://${distribution.distributionDomainName}`;
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
        callbackUrls: [siteUrl, cloudFrontSiteUrl],
        logoutUrls: [siteUrl, cloudFrontSiteUrl],
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
      path: '/api/weeks',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration(
        'WeeksIntegration',
        currentWeekFunction,
      ),
      authorizer,
    });
    httpApi.addRoutes({
      path: '/api/week/{seasonWeek}',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration(
        'SelectedWeekIntegration',
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

    // Preseason mini-season schedules use America/New_York so kickoff windows
    // stay stable across daylight-saving changes.
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

    const syncTimezone = 'America/New_York';
    new CfnSchedule(this, 'SyncOddsTuesdayAdvanceSchedule', {
      name: 'sync-odds-tuesday-advance',
      scheduleExpression: 'cron(0 2 ? * TUE *)',
      scheduleExpressionTimezone: syncTimezone,
      description: 'Advance competition week and sync odds (Tue 2am ET)',
      ...syncOddsScheduleProps,
      target: {
        ...syncOddsScheduleProps.target,
        input:
          '{"advanceWeek":true,"advanceToken":"<aws.scheduler.scheduled-time>"}',
      },
    });
    new CfnSchedule(this, 'SyncOddsThursdaySchedule', {
      name: 'sync-odds-thursday',
      scheduleExpression: 'cron(0 17 ? * THU *)',
      scheduleExpressionTimezone: syncTimezone,
      description: 'Thursday NFL odds sync (5pm ET)',
      ...syncOddsScheduleProps,
    });
    new CfnSchedule(this, 'SyncOddsSundayMorningSchedule', {
      name: 'sync-odds-sunday-morning',
      scheduleExpression: 'cron(0 8 ? * SUN *)',
      scheduleExpressionTimezone: syncTimezone,
      description: 'Sunday morning NFL odds sync (8am ET)',
      ...syncOddsScheduleProps,
    });
    new CfnSchedule(this, 'SyncOddsSundayMiddaySchedule', {
      name: 'sync-odds-sunday-midday',
      scheduleExpression: 'cron(30 12 ? * SUN *)',
      scheduleExpressionTimezone: syncTimezone,
      description: 'Sunday midday NFL odds sync (12:30pm ET)',
      ...syncOddsScheduleProps,
    });
    new CfnSchedule(this, 'SyncOddsSundayAfternoonSchedule', {
      name: 'sync-odds-sunday-afternoon',
      scheduleExpression: 'cron(30 15 ? * SUN *)',
      scheduleExpressionTimezone: syncTimezone,
      description: 'Sunday afternoon NFL odds sync (3:30pm ET)',
      ...syncOddsScheduleProps,
    });
    new CfnSchedule(this, 'SyncOddsSundayEveningSchedule', {
      name: 'sync-odds-sunday-evening',
      scheduleExpression: 'cron(30 19 ? * SUN *)',
      scheduleExpressionTimezone: syncTimezone,
      description: 'Sunday evening NFL odds sync (7:30pm ET)',
      ...syncOddsScheduleProps,
    });
    new CfnSchedule(this, 'SyncOddsMondaySchedule', {
      name: 'sync-odds-monday',
      scheduleExpression: 'cron(0 17 ? * MON *)',
      scheduleExpressionTimezone: syncTimezone,
      description: 'Monday NFL odds sync (5pm ET)',
      ...syncOddsScheduleProps,
    });

    // Score windows run after each major game slate.
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

    new CfnSchedule(this, 'GradeGamesFridaySchedule', {
      name: 'grade-games-friday',
      scheduleExpression: 'cron(0 1 ? * FRI *)',
      scheduleExpressionTimezone: 'America/New_York',
      description: 'Grade Thursday games (Fri 1am America/New_York)',
      ...gradeGamesScheduleProps,
    });
    new CfnSchedule(this, 'GradeGamesSaturdaySchedule', {
      name: 'grade-games-saturday',
      scheduleExpression: 'cron(0 1 ? * SAT *)',
      scheduleExpressionTimezone: 'America/New_York',
      description: 'Grade Friday or holiday games (Sat 1am America/New_York)',
      ...gradeGamesScheduleProps,
    });
    new CfnSchedule(this, 'GradeGamesSundayEarlySchedule', {
      name: 'grade-games-sunday-early',
      scheduleExpression: 'cron(0 17 ? * SUN *)',
      scheduleExpressionTimezone: 'America/New_York',
      description: 'Grade early Sunday games (Sun 5pm America/New_York)',
      ...gradeGamesScheduleProps,
    });
    new CfnSchedule(this, 'GradeGamesSundayLateSchedule', {
      name: 'grade-games-sunday-late',
      scheduleExpression: 'cron(30 21 ? * SUN *)',
      scheduleExpressionTimezone: 'America/New_York',
      description: 'Grade late Sunday games (Sun 9:30pm America/New_York)',
      ...gradeGamesScheduleProps,
    });
    new CfnSchedule(this, 'GradeGamesMondaySchedule', {
      name: 'grade-games-monday',
      scheduleExpression: 'cron(0 1 ? * MON *)',
      scheduleExpressionTimezone: 'America/New_York',
      description: 'Grade Sunday night game (Mon 1am America/New_York)',
      ...gradeGamesScheduleProps,
    });
    new CfnSchedule(this, 'GradeGamesTuesdaySchedule', {
      name: 'grade-games-tuesday',
      scheduleExpression: 'cron(0 1 ? * TUE *)',
      scheduleExpressionTimezone: 'America/New_York',
      description: 'Grade Monday night game (Tue 1am America/New_York)',
      ...gradeGamesScheduleProps,
    });

    output(this, 'ApiEndpoint', httpApi.apiEndpoint);
    output(this, 'Authority', userPool.userPoolProviderUrl);
    output(this, 'CognitoDomain', userPoolDomain.baseUrl());
    output(this, 'CustomDomainName', CUSTOM_DOMAIN_NAME);
    output(this, 'DistributionDomainName', distribution.distributionDomainName);
    output(this, 'DistributionId', distribution.distributionId);
    output(this, 'GradeGamesFunctionName', gradeGamesFunction.functionName);
    output(this, 'SyncOddsFunctionName', syncOddsFunction.functionName);
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
