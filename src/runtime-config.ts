import type { RuntimeConfig } from '../shared/runtime-config';

export type { RuntimeConfig } from '../shared/runtime-config';

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const response = await fetch('/runtime-config.json', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Unable to load application configuration');
  }

  return (await response.json()) as RuntimeConfig;
}

export function createCognitoLogoutUrl(
  cognitoDomain: string,
  clientId: string,
  logoutUri: string,
): string {
  const domain = cognitoDomain.endsWith('/')
    ? cognitoDomain.slice(0, -1)
    : cognitoDomain;
  const query = new URLSearchParams({
    client_id: clientId,
    logout_uri: logoutUri,
  });
  return `${domain}/logout?${query.toString()}`;
}

export async function logoutFromCognito(
  removeUser: () => Promise<void>,
  navigate: (url: string) => void,
  cognitoDomain: string,
  clientId: string,
  logoutUri: string,
): Promise<void> {
  await removeUser();
  navigate(createCognitoLogoutUrl(cognitoDomain, clientId, logoutUri));
}
