import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { TARGET_ENV } from '../lib/github-oidc-stack.js';
import { LocksAppStack } from '../lib/locks-app-stack.js';

describe('LocksAppStack', () => {
  const app = new App();
  const stack = new LocksAppStack(app, 'LocksAppStack', {
    env: TARGET_ENV,
  });
  const template = Template.fromStack(stack);

  it('keeps the site private and encrypted', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: Match.arrayWith([
          Match.objectLike({
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: 'AES256',
            },
          }),
        ]),
      },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('rewrites SPA routes only on the S3 behavior and preserves API errors', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        DefaultCacheBehavior: Match.objectLike({
          FunctionAssociations: Match.anyValue(),
        }),
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({
            PathPattern: 'api/*',
            FunctionAssociations: Match.absent(),
          }),
        ]),
      },
    });
  });

  it('protects the picks route with a Cognito JWT authorizer', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'JWT',
      IdentitySource: ['$request.header.Authorization'],
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      AuthorizationType: 'JWT',
      RouteKey: 'GET /api/week/current',
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      AuthorizationType: 'JWT',
      RouteKey: 'POST /api/picks',
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      AuthorizationType: 'JWT',
      RouteKey: 'GET /api/standings',
    });
  });

  it('creates a standings Lambda with read access to the table', () => {
    const lambdas = template.findResources('AWS::Lambda::Function');
    const standingsLambdas = Object.entries(lambdas).filter(([id]) =>
      id.includes('StandingsFunction'),
    );
    expect(standingsLambdas).toHaveLength(1);
    expect(standingsLambdas[0]?.[1].Properties).toMatchObject({
      Handler: 'index.handler',
      Runtime: 'nodejs22.x',
      Architectures: ['arm64'],
      Timeout: 10,
      MemorySize: 256,
    });
    expect(
      standingsLambdas[0]?.[1].Properties.Environment.Variables.TABLE_NAME,
    ).toBeDefined();
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['dynamodb:Query', 'dynamodb:GetItem']),
            Effect: 'Allow',
          }),
        ]),
      },
    });
  });

  it('grants submit-pick transactional DynamoDB access within the runtime boundary', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      Description: 'Execution role for authenticated pick submission',
    });
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              'dynamodb:ConditionCheckItem',
              'dynamodb:GetItem',
              'dynamodb:TransactWriteItems',
            ]),
            Effect: 'Allow',
          }),
        ]),
      },
    });
  });

  it('creates only the invited user and disables self-registration', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: {
        AllowAdminCreateUserOnly: true,
      },
      UsernameConfiguration: {
        CaseSensitive: false,
      },
    });
    template.resourceCountIs('AWS::Cognito::UserPoolUser', 1);
    template.hasResourceProperties('AWS::Cognito::UserPoolUser', {
      Username: 'kenneth.huebsch@gmail.com',
    });
  });

  it('encrypts DynamoDB and prepares scheduler access without a fake secret', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      SSESpecification: {
        SSEEnabled: true,
      },
    });
    template.resourceCountIs('AWS::Scheduler::ScheduleGroup', 1);
    template.resourceCountIs('AWS::SSM::Parameter', 0);
    template.resourceCountIs('AWS::Scheduler::Schedule', 7);
    // Description must stay unchanged (AppIamExecutionPolicy lacks UpdateRoleDescription).
    template.hasResourceProperties('AWS::IAM::Role', {
      Description: 'Allows EventBridge Scheduler to invoke sync-odds',
    });
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      Name: 'sync-odds-morning',
      State: 'ENABLED',
      ScheduleExpression: 'cron(0 12 * * ? *)',
    });
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      Name: 'sync-odds-afternoon',
      State: 'ENABLED',
      ScheduleExpression: 'cron(0 20 * * ? *)',
    });
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      Name: 'grade-games-thursday-tnf',
      State: 'ENABLED',
      ScheduleExpression: 'cron(45 23 ? * THU *)',
      ScheduleExpressionTimezone: 'America/New_York',
    });
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      Name: 'grade-games-sunday-early',
      State: 'ENABLED',
      ScheduleExpression: 'cron(15 16 ? * SUN *)',
      ScheduleExpressionTimezone: 'America/New_York',
    });
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      Name: 'grade-games-sunday-late',
      State: 'ENABLED',
      ScheduleExpression: 'cron(0 20 ? * SUN *)',
      ScheduleExpressionTimezone: 'America/New_York',
    });
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      Name: 'grade-games-sunday-snf',
      State: 'ENABLED',
      ScheduleExpression: 'cron(45 23 ? * SUN *)',
      ScheduleExpressionTimezone: 'America/New_York',
    });
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      Name: 'grade-games-monday-mnf',
      State: 'ENABLED',
      ScheduleExpression: 'cron(45 23 ? * MON *)',
      ScheduleExpressionTimezone: 'America/New_York',
    });
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'ssm:GetParameter',
            Effect: 'Allow',
            Resource:
              'arn:aws:ssm:us-east-1:580956784928:parameter/locks/odds-api-key',
          }),
          Match.objectLike({
            Action: Match.arrayWith([
              'dynamodb:GetItem',
              'dynamodb:PutItem',
              'dynamodb:UpdateItem',
            ]),
          }),
        ]),
      },
    });
  });

  it('defines grade-games Lambda with odds/score IAM and Node 22 ARM', () => {
    // Unique vs sync-odds: no ACTIVE_WEEK env; dedicated role Description.
    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'index.handler',
      Runtime: 'nodejs22.x',
      Architectures: ['arm64'],
      Timeout: 30,
      MemorySize: 256,
      Environment: {
        Variables: Match.objectLike({
          ODDS_API_ENABLED: 'true',
          ODDS_API_SPORT: 'americanfootball_nfl_preseason',
          ACTIVE_WEEK: Match.absent(),
        }),
      },
    });
    const gradeGamesLambdas = Object.values(
      template.findResources('AWS::Lambda::Function'),
    ).filter((resource) => {
      const vars = resource.Properties.Environment?.Variables ?? {};
      return (
        vars.ODDS_API_ENABLED === 'true' &&
        vars.ODDS_API_SPORT === 'americanfootball_nfl_preseason' &&
        vars.ACTIVE_WEEK === undefined
      );
    });
    expect(gradeGamesLambdas).toHaveLength(1);
    template.hasResourceProperties('AWS::IAM::Role', {
      Description: 'Execution role for scheduled score sync and pick grading',
    });
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'ssm:GetParameter',
            Effect: 'Allow',
            Resource:
              'arn:aws:ssm:us-east-1:580956784928:parameter/locks/odds-api-key',
          }),
          Match.objectLike({
            Action: Match.arrayWith([
              'dynamodb:GetItem',
              'dynamodb:PutItem',
              'dynamodb:Query',
              'dynamodb:UpdateItem',
            ]),
          }),
        ]),
      },
    });
    template.hasOutput('GradeGamesFunctionName', {});
  });

  it('grants SubmitPick the Dynamo actions needed for pick transactions', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              'dynamodb:ConditionCheckItem',
              'dynamodb:GetItem',
              'dynamodb:PutItem',
              'dynamodb:UpdateItem',
              'dynamodb:TransactWriteItems',
            ]),
          }),
        ]),
      },
    });
  });

  it('allows POST through CloudFront for future pick submission', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({
            PathPattern: 'api/*',
            AllowedMethods: Match.arrayWith(['GET', 'HEAD', 'OPTIONS', 'POST']),
          }),
        ]),
      },
    });
  });

  it('uses only the dedicated application deployment identities', () => {
    const assembly = app.synth();
    const artifact = assembly.getStackArtifact(stack.artifactId);

    expect(artifact.assumeRoleArn).toBe(
      'arn:aws:iam::580956784928:role/LocksAppDeployRole',
    );
    expect(artifact.cloudFormationExecutionRoleArn).toBe(
      'arn:aws:iam::580956784928:role/LocksAppCloudFormationExecutionRole',
    );
  });

  it('applies the exact runtime boundary to every synthesized role', () => {
    const roles = template.findResources('AWS::IAM::Role');
    expect(Object.keys(roles).length).toBeGreaterThan(0);

    for (const role of Object.values(roles)) {
      expect(role.Properties.PermissionsBoundary).toBe(
        'arn:aws:iam::580956784928:policy/LocksAppRuntimeBoundary',
      );
    }
  });
});
