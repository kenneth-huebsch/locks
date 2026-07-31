import type { RuntimeConfig } from '../shared/runtime-config.js';
import {
  type StackOutputs,
  requireOutput,
} from './aws-context.js';

export function createRuntimeConfig(
  outputs: StackOutputs,
): RuntimeConfig {
  return {
    apiBaseUrl: '/api',
    authority: requireOutput(outputs, 'Authority'),
    clientId: requireOutput(outputs, 'UserPoolClientId'),
    cognitoDomain: requireOutput(outputs, 'CognitoDomain'),
  };
}
