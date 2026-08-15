/**
 * Manually advance the active competition week and sync its odds.
 *
 * This invokes the deployed sync-odds Lambda with a unique idempotency token.
 * It requires AWS_PROFILE=locks-publish and an explicit confirmation argument.
 *
 * Usage:
 *   AWS_PROFILE=locks-publish npx tsx scripts/invoke-advance-week.ts --confirm
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

if (!process.argv.includes('--confirm')) {
  throw new Error('Pass --confirm to advance the active competition week');
}

await assertTargetAccount();

const outputs = await getAppStackOutputs();
const functionName = requireOutput(outputs, 'SyncOddsFunctionName');
const advanceToken = `manual-${new Date().toISOString()}`;
const payload = {
  advanceWeek: true,
  advanceToken,
};

const response = await new LambdaClient({ region: TARGET_REGION }).send(
  new InvokeCommand({
    FunctionName: functionName,
    Payload: Buffer.from(JSON.stringify(payload)),
  }),
);

const body = response.Payload
  ? Buffer.from(response.Payload).toString('utf8')
  : '{}';

if (response.FunctionError) {
  console.error(
    `advance-week invoke failed (${response.FunctionError}) for ${functionName}:`,
  );
  console.error(body);
  process.exitCode = 1;
} else {
  console.log(`Invoked ${functionName} with advanceToken=${advanceToken}`);
  console.log(body);
}
