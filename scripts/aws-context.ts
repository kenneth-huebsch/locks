import {
  CloudFormationClient,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';

export const TARGET_ACCOUNT = '580956784928';
export const TARGET_REGION = 'us-east-1';
export const APP_STACK_NAME = 'LocksAppStack';

export type StackOutputs = Record<string, string>;

export async function assertTargetAccount(): Promise<void> {
  const identity = await new STSClient({ region: TARGET_REGION }).send(
    new GetCallerIdentityCommand({}),
  );
  if (identity.Account !== TARGET_ACCOUNT) {
    throw new Error(
      `Refusing AWS mutation: expected account ${TARGET_ACCOUNT}, received ${identity.Account ?? 'unknown'}`,
    );
  }
}

export async function getAppStackOutputs(): Promise<StackOutputs> {
  const response = await new CloudFormationClient({
    region: TARGET_REGION,
  }).send(new DescribeStacksCommand({ StackName: APP_STACK_NAME }));
  const stack = response.Stacks?.[0];
  if (!stack) {
    throw new Error(`${APP_STACK_NAME} was not found`);
  }

  return Object.fromEntries(
    (stack.Outputs ?? []).map(({ OutputKey, OutputValue }) => {
      if (!OutputKey || !OutputValue) {
        throw new Error(`${APP_STACK_NAME} contains an incomplete output`);
      }
      return [OutputKey, OutputValue];
    }),
  );
}

export function requireOutput(
  outputs: StackOutputs,
  key: string,
): string {
  const value = outputs[key];
  if (!value) {
    throw new Error(`${APP_STACK_NAME} output ${key} is required`);
  }
  return value;
}
