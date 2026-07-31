import {
  createCognitoLogoutUrl,
  logoutFromCognito,
} from './runtime-config';

describe('createCognitoLogoutUrl', () => {
  it('encodes the client and return URL for Cognito managed logout', () => {
    expect(
      createCognitoLogoutUrl(
        'https://locks.auth.us-east-1.amazoncognito.com',
        'client+id',
        'https://example.com/callback?next=/week 1',
      ),
    ).toBe(
      'https://locks.auth.us-east-1.amazoncognito.com/logout' +
        '?client_id=client%2Bid&logout_uri=https%3A%2F%2Fexample.com%2Fcallback%3Fnext%3D%2Fweek+1',
    );
  });

  it('removes the local OIDC user before navigating to Cognito', async () => {
    const removeUser = vi.fn().mockResolvedValue(undefined);
    const navigate = vi.fn();

    await logoutFromCognito(
      removeUser,
      navigate,
      'https://locks.auth.us-east-1.amazoncognito.com',
      'client-id',
      'https://example.com',
    );

    expect(removeUser).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(
      'https://locks.auth.us-east-1.amazoncognito.com/logout' +
        '?client_id=client-id&logout_uri=https%3A%2F%2Fexample.com',
    );
    expect(removeUser.mock.invocationCallOrder[0]).toBeLessThan(
      navigate.mock.invocationCallOrder[0],
    );
  });
});
