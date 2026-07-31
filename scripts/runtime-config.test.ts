import { createRuntimeConfig } from './runtime-config.js';

describe('createRuntimeConfig', () => {
  it('includes the Cognito managed-login domain from stack outputs', () => {
    expect(
      createRuntimeConfig({
        Authority: 'https://issuer.example.com',
        CognitoDomain: 'https://locks.auth.us-east-1.amazoncognito.com',
        UserPoolClientId: 'client-id',
      }),
    ).toEqual({
      apiBaseUrl: '/api',
      authority: 'https://issuer.example.com',
      clientId: 'client-id',
      cognitoDomain: 'https://locks.auth.us-east-1.amazoncognito.com',
    });
  });
});
