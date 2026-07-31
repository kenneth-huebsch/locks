export interface RuntimeConfig {
  apiBaseUrl: string;
  authority: string;
  clientId: string;
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const response = await fetch('/runtime-config.json', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Unable to load application configuration');
  }

  return (await response.json()) as RuntimeConfig;
}
