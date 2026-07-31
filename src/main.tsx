import { StrictMode, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from 'react-oidc-context';
import { App } from './App';
import { loadCurrentWeek } from './api';
import './index.css';
import {
  loadRuntimeConfig,
  logoutFromCognito,
  type RuntimeConfig,
} from './runtime-config';

function AuthenticatedApp({ config }: { config: RuntimeConfig }) {
  const auth = useAuth();
  const loadWeek = useCallback(
    (accessToken: string) =>
      loadCurrentWeek(accessToken, config.apiBaseUrl),
    [config.apiBaseUrl],
  );
  const logout = useCallback(
    () =>
      logoutFromCognito(
        auth.removeUser,
        (url) => window.location.assign(url),
        config.cognitoDomain,
        config.clientId,
        window.location.origin,
      ),
    [
      auth.removeUser,
      config.clientId,
      config.cognitoDomain,
    ],
  );

  return (
    <App
      auth={{
        isAuthenticated: auth.isAuthenticated,
        isLoading: auth.isLoading,
        error: auth.error,
        accessToken: auth.user?.access_token,
        signinRedirect: auth.signinRedirect,
        logout,
      }}
      loadCurrentWeek={loadWeek}
    />
  );
}

async function render() {
  const config = await loadRuntimeConfig();
  const root = document.getElementById('root');
  if (!root) {
    throw new Error('Root element was not found');
  }

  createRoot(root).render(
    <StrictMode>
      <AuthProvider
        authority={config.authority}
        client_id={config.clientId}
        onSigninCallback={() => {
          window.history.replaceState({}, document.title, window.location.pathname);
        }}
        redirect_uri={window.location.origin}
        response_type="code"
        scope="openid email"
      >
        <AuthenticatedApp config={config} />
      </AuthProvider>
    </StrictMode>,
  );
}

void render();
