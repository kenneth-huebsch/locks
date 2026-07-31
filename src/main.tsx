import { StrictMode, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from 'react-oidc-context';
import { App } from './App';
import { loadCurrentWeek } from './api';
import './index.css';
import { loadRuntimeConfig } from './runtime-config';

function AuthenticatedApp({ apiBaseUrl }: { apiBaseUrl: string }) {
  const auth = useAuth();
  const loadWeek = useCallback(
    (accessToken: string) => loadCurrentWeek(accessToken, apiBaseUrl),
    [apiBaseUrl],
  );

  return (
    <App
      auth={{
        isAuthenticated: auth.isAuthenticated,
        isLoading: auth.isLoading,
        error: auth.error,
        accessToken: auth.user?.access_token,
        signinRedirect: auth.signinRedirect,
        signoutRedirect: auth.signoutRedirect,
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
        post_logout_redirect_uri={window.location.origin}
        redirect_uri={window.location.origin}
        response_type="code"
        scope="openid email"
      >
        <AuthenticatedApp apiBaseUrl={config.apiBaseUrl} />
      </AuthProvider>
    </StrictMode>,
  );
}

void render();
