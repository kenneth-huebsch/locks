/**
 * Manually invoke grade-games (operator path).
 *
 * Requires AWS_PROFILE=locks-publish after LocksGitHubOidcStack grants
 * OperatorLambdaInvoke on GradeGamesFunction*, and after LocksAppStack
 * has deployed the function + GradeGamesFunctionName output.
 *
 * Does not synthesize or deploy CDK stacks.
 *
 * Usage:
 *   AWS_PROFILE=locks-publish npx tsx scripts/invoke-grade-games.ts
 *   AWS_PROFILE=locks-publish npx tsx scripts/invoke-grade-games.ts 2026#W01
 */
import {
  InvokeCommand,
  LambdaClient,
} from '@aws-sdk/client-lambda';
import {
  TARGET_REGION,
  assertTargetAccount,
  getAppStackOutputs,
  requireOutput,
} from './aws-context.js';

await assertTargetAccount();

const seasonWeekArg = process.argv[2]?.trim();
const payload =
  seasonWeekArg && seasonWeekArg.length > 0
    ? { seasonWeek: seasonWeekArg }
    : {};

const outputs = await getAppStackOutputs();
const functionName = requireOutput(outputs, 'GradeGamesFunctionName');

const client = new LambdaClient({ region: TARGET_REGION });
const response = await client.send(
  new InvokeCommand({
    FunctionName: functionName,
    Payload: Buffer.from(JSON.stringify(payload)),
  }),
);

const raw = response.Payload
  ? Buffer.from(response.Payload).toString('utf8')
  : '';
const body = raw.length > 0 ? raw : '{}';

if (response.FunctionError) {
  console.error(
    `grade-games invoke failed (${response.FunctionError}) for ${functionName}:`,
  );
  console.error(body);
  process.exitCode = 1;
} else {
  console.log(`Invoked ${functionName}`);
  if (seasonWeekArg) {
    console.log(`Payload seasonWeek=${seasonWeekArg}`);
  }
  console.log(body);
}
