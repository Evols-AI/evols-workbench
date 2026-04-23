/**
 * Evols silent auto-auth.
 * The OTT is now handled server-side by GET /api/auth/evols-ott before the
 * React app loads — cookies are set and the browser is redirected to the app
 * root. Nothing to do client-side.
 */
export function useEvolsAutoAuth() {
  // no-op: OTT exchange happens server-side in api/server/routes/auth.js
}
