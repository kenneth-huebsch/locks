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
        Aliases: ['locks.inov8.cc'],
        DefaultCacheBehavior: Match.objectLike({
          FunctionAssociations: Match.anyValue(),
        }),
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({
            PathPattern: 'api/*',
            FunctionAssociations: Match.absent(),
          }),
        ]),
        ViewerCertificate: Match.objectLike({
          AcmCertificateArn: Match.anyValue(),
          SslSupportMethod: 'sni-only',
        }),
      },
    });
  });

  it('provisions the custom domain certificate and Route53 alias', () => {
    template.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: 'locks.inov8.cc',
      DomainValidationOptions: Match.arrayWith([
        Match.objectLike({
          DomainName: 'locks.inov8.cc',
          HostedZoneId: 'Z0077616YT47LAXJAQQ6',
        }),
      ]),
      ValidationMethod: 'DNS',
    });
    template.hasResourceProperties('AWS::Route53::RecordSet', {
      HostedZoneId: 'Z0077616YT47LAXJAQQ6',
      Name: 'locks.inov8.cc.',
      Type: 'A',
      AliasTarget: Match.objectLike({
        DNSName: Match.anyValue(),
        HostedZoneId: Match.anyValue(),
      }),
    });
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      CallbackURLs: Match.arrayWith(['https://locks.inov8.cc']),
      LogoutURLs: Match.arrayWith(['https://locks.inov8.cc']),
    });
    template.hasOutput('CustomDomainName', {
      Value: 'locks.inov8.cc',
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
      RouteKey: 'GET /api/weeks',
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      AuthorizationType: 'JWT',
      RouteKey: 'GET /api/week/{seasonWeek}',
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      AuthorizationType: 'JWT',
      RouteKey: 'POST /api/picks',
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      AuthorizationType: 'JWT',
      RouteKey: 'GET /api/standings',
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      AuthorizationType: 'NONE',
      RouteKey: 'GET /api/reminders/incomplete-picks',
    });
  });

  it('creates an incomplete-picks Lambda with table and SSM read access', () => {
    const lambdas = template.findResources('AWS::Lambda::Function');
    const incompleteLambdas = Object.entries(lambdas).filter(([id]) =>
      id.includes('IncompletePicksFunction'),
    );
    expect(incompleteLambdas).toHaveLength(1);
    expect(incompleteLambdas[0]?.[1].Properties).toMatchObject({
      Handler: 'index.handler',
      Runtime: 'nodejs22.x',
      Architectures: ['arm64'],
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
    template.resourceCountIs('AWS::Scheduler::Schedule', 13);
    // Description must stay unchanged (AppIamExecutionPolicy lacks UpdateRoleDescription).
    template.hasResourceProperties('AWS::IAM::Role', {
      Description: 'Allows EventBridge Scheduler to invoke sync-odds',
    });
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      Name: 'sync-odds-tuesday-advance',
      State: 'ENABLED',
      ScheduleExpression: 'cron(0 2 ? * TUE *)',
      ScheduleExpressionTimezone: 'America/New_York',
      Target: Match.objectLike({
        Input:
          '{"advanceWeek":true,"advanceToken":"<aws.scheduler.scheduled-time>"}',
        RetryPolicy: { MaximumRetryAttempts: 2 },
      }),
    });
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      Name: 'sync-odds-thursday',
      State: 'ENABLED',
      ScheduleExpression: 'cron(0 17 ? * THU *)',
      ScheduleExpressionTimezone: 'America/New_York',
    });
    for (const [name, expression] of [
      ['sync-odds-sunday-morning', 'cron(0 8 ? * SUN *)'],
      ['sync-odds-sunday-midday', 'cron(30 12 ? * SUN *)'],
      ['sync-odds-sunday-afternoon', 'cron(30 15 ? * SUN *)'],
      ['sync-odds-sunday-evening', 'cron(30 19 ? * SUN *)'],
      ['sync-odds-monday', 'cron(0 17 ? * MON *)'],
      ['grade-games-friday', 'cron(0 1 ? * FRI *)'],
      ['grade-games-saturday', 'cron(0 1 ? * SAT *)'],
      ['grade-games-sunday-early', 'cron(0 17 ? * SUN *)'],
      ['grade-games-sunday-late', 'cron(30 21 ? * SUN *)'],
      ['grade-games-monday', 'cron(0 1 ? * MON *)'],
      ['grade-games-tuesday', 'cron(0 1 ? * TUE *)'],
    ]) {
      template.hasResourceProperties('AWS::Scheduler::Schedule', {
        Name: name,
        State: 'ENABLED',
        ScheduleExpression: expression,
        ScheduleExpressionTimezone: 'America/New_York',
        Target: Match.objectLike({
          RetryPolicy: { MaximumRetryAttempts: 2 },
        }),
      });
    }
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

  it('defines grade-games Lambda with ESPN-only config and narrowed IAM', () => {
    // Both scheduled functions resolve active week from DynamoDB.
    const lambdas = template.findResources('AWS::Lambda::Function');
    const gradeLambdas = Object.entries(lambdas).filter(([id]) =>
      id.includes('GradeGamesFunction'),
    );
    expect(gradeLambdas).toHaveLength(1);
    expect(gradeLambdas[0]?.[1].Properties).toMatchObject({
      Handler: 'index.handler',
      Runtime: 'nodejs22.x',
      Architectures: ['arm64'],
      Timeout: 30,
      MemorySize: 256,
      Environment: {
        Variables: {
          GRADE_GAMES_ENABLED: 'true',
        },
      },
    });
    expect(
      gradeLambdas[0]?.[1].Properties.Environment.Variables.TABLE_NAME,
    ).toBeDefined();
    expect(
      gradeLambdas[0]?.[1].Properties.Environment.Variables.ODDS_API_ENABLED,
    ).toBeUndefined();
    expect(
      gradeLambdas[0]?.[1].Properties.Environment.Variables.ODDS_API_SPORT,
    ).toBeUndefined();

    const scheduledLambdas = Object.entries(lambdas).filter(([id]) =>
      id.includes('SyncOddsFunction') || id.includes('GradeGamesFunction'),
    );
    expect(scheduledLambdas).toHaveLength(2);
    for (const [, resource] of scheduledLambdas) {
      expect(resource.Properties.Environment.Variables.ACTIVE_WEEK).toBeUndefined();
    }
    template.hasResourceProperties('AWS::IAM::Role', {
      Description: 'Execution role for scheduled score sync and pick grading',
    });
    const gradeRole = Object.entries(
      template.findResources('AWS::IAM::Role'),
    ).find(
      ([, resource]) =>
        resource.Properties.Description ===
        'Execution role for scheduled score sync and pick grading',
    );
    expect(gradeRole).toBeDefined();
    const gradePolicies = Object.values(
      template.findResources('AWS::IAM::Policy'),
    ).filter((resource) =>
      resource.Properties.Roles?.some(
        (role: { Ref?: string }) => role.Ref === gradeRole?.[0],
      ),
    );
    expect(gradePolicies).toHaveLength(1);
    const gradePolicyJson = JSON.stringify(gradePolicies);
    expect(gradePolicyJson).not.toContain('ssm:GetParameter');
    expect(gradePolicyJson).not.toContain('dynamodb:PutItem');
    expect(gradePolicyJson).toContain('dynamodb:GetItem');
    expect(gradePolicyJson).toContain('dynamodb:Query');
    expect(gradePolicyJson).toContain('dynamodb:UpdateItem');
    template.hasOutput('GradeGamesFunctionName', {});
    template.hasOutput('SyncOddsFunctionName', {});
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
