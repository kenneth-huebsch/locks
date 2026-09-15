/**
 * Manually invoke remind-incomplete (operator path).
 *
 * Requires AWS_PROFILE=locks-publish after LocksGitHubOidcStack grants
 * OperatorLambdaInvoke on RemindIncompleteFunction*, and after LocksAppStack
 * has deployed the function + RemindIncompleteFunctionName output.
 *
 * Does not synthesize or deploy CDK stacks.
 *
 * Usage:
 *   AWS_PROFILE=locks-publish npx tsx scripts/invoke-remind-incomplete.ts
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

const outputs = await getAppStackOutputs();
const functionName = requireOutput(outputs, 'RemindIncompleteFunctionName');

const client = new LambdaClient({ region: TARGET_REGION });
const response = await client.send(
  new InvokeCommand({
    FunctionName: functionName,
    Payload: Buffer.from('{}'),
  }),
);

const raw = response.Payload
  ? Buffer.from(response.Payload).toString('utf8')
  : '';
const body = raw.length > 0 ? raw : '{}';

if (response.FunctionError) {
  console.error(
    `remind-incomplete invoke failed (${response.FunctionError}) for ${functionName}:`,
  );
  console.error(body);
  process.exitCode = 1;
} else {
  console.log(`Invoked ${functionName}`);
  console.log(body);
}
