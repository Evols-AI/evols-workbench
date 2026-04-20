import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

/**
 * Evols silent auto-auth.
 * On mount, checks for ?ott= in the URL. If present, exchanges it with
 * the Evols backend for a full session token and removes it from the URL.
 * The Evols workbench page mints a 30-second one-time token and passes it
 * as ?ott=<token> in the iframe src — this hook completes the handshake.
 */
export function useEvolsAutoAuth() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const ott = params.get('ott');
    if (!ott) {
      return;
    }

    // Remove OTT from URL immediately — don't leave it in history
    params.delete('ott');
    navigate({ search: params.toString() }, { replace: true });

    const exchange = async () => {
      try {
        const res = await fetch('/api/v1/oidc/exchange-one-time-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: ott }),
          credentials: 'include',
        });

        if (!res.ok) {
          throw new Error(`OTT exchange failed: ${res.status}`);
        }

        const data = await res.json();

        // Store Evols access token for LibreChat API calls
        localStorage.setItem('token', data.access_token);

        // Navigate to new conversation so the Evols AI landing screen is shown
        window.location.replace('/c/new');
      } catch (e) {
        console.error('[Evols] Auto-auth failed:', e);
        // Redirect to Evols login as fallback
        window.location.href = '/login';
      }
    };

    exchange();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
