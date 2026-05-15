const express = require('express');
const jwtDecode = require('jsonwebtoken/decode');
const { createSetBalanceConfig, findOpenIDUser } = require('@librechat/api');
const {
  resetPasswordRequestController,
  resetPasswordController,
  registrationController,
  graphTokenController,
  refreshController,
} = require('~/server/controllers/AuthController');
const {
  regenerateBackupCodes,
  disable2FA,
  confirm2FA,
  enable2FA,
  verify2FA,
} = require('~/server/controllers/TwoFactorController');
const { verify2FAWithTempToken } = require('~/server/controllers/auth/TwoFactorAuthController');
const { logoutController } = require('~/server/controllers/auth/LogoutController');
const { loginController } = require('~/server/controllers/auth/LoginController');
const { setAuthTokens } = require('~/server/services/AuthService');
const { findUser, createUser, updateUser } = require('~/models');
const { findBalanceByUser, upsertBalanceFields } = require('~/models');
const { getAppConfig } = require('~/server/services/Config');
const middleware = require('~/server/middleware');
const { logger } = require('@librechat/data-schemas');

const setBalanceConfig = createSetBalanceConfig({
  getAppConfig,
  findBalanceByUser,
  upsertBalanceFields,
});

const router = express.Router();

const ldapAuth = !!process.env.LDAP_URL && !!process.env.LDAP_USER_SEARCH_BASE;
//Local
router.post('/logout', middleware.requireJwtAuth, logoutController);
router.post(
  '/login',
  middleware.logHeaders,
  middleware.loginLimiter,
  middleware.checkBan,
  ldapAuth ? middleware.requireLdapAuth : middleware.requireLocalAuth,
  setBalanceConfig,
  loginController,
);
router.post('/refresh', refreshController);
router.post(
  '/register',
  middleware.registerLimiter,
  middleware.checkBan,
  middleware.checkInviteUser,
  middleware.validateRegistration,
  registrationController,
);
router.post(
  '/requestPasswordReset',
  middleware.resetPasswordLimiter,
  middleware.checkBan,
  middleware.validatePasswordReset,
  resetPasswordRequestController,
);
router.post(
  '/resetPassword',
  middleware.checkBan,
  middleware.validatePasswordReset,
  resetPasswordController,
);

router.post('/2fa/enable', middleware.requireJwtAuth, enable2FA);
router.post('/2fa/verify', middleware.requireJwtAuth, verify2FA);
router.post('/2fa/verify-temp', middleware.checkBan, verify2FAWithTempToken);
router.post('/2fa/confirm', middleware.requireJwtAuth, confirm2FA);
router.post('/2fa/disable', middleware.requireJwtAuth, disable2FA);
router.post('/2fa/backup/regenerate', middleware.requireJwtAuth, regenerateBackupCodes);

router.get('/graph-token', middleware.requireJwtAuth, graphTokenController);

/**
 * One-time token exchange: called by the Evols workbench shell page before loading the
 * iframe.  It POSTs the OTT to the Evols backend, receives an id_token, resolves (or
 * creates) the MongoDB user, then issues a fresh LibreChat session — replacing whatever
 * session cookie was previously set in the browser.
 *
 * GET /api/auth/evols-ott?ott=<token>
 */
router.get('/evols-ott', async (req, res) => {
  const { ott } = req.query;
  const evolsBackendUrl = process.env.EVOLS_BACKEND_URL;
  const domainClient = process.env.DOMAIN_CLIENT || '/';

  if (!ott) {
    logger.warn('[evols-ott] Missing ott query parameter');
    return res.redirect(`${domainClient}/login`);
  }

  if (!evolsBackendUrl) {
    logger.error('[evols-ott] EVOLS_BACKEND_URL is not set');
    return res.redirect(`${domainClient}/login`);
  }

  try {
    const exchangeRes = await fetch(`${evolsBackendUrl}/api/v1/oidc/exchange-one-time-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: ott }),
    });

    if (!exchangeRes.ok) {
      logger.warn(`[evols-ott] OTT exchange failed: ${exchangeRes.status}`);
      return res.redirect(`${domainClient}/login`);
    }

    const tokenData = await exchangeRes.json();
    const idToken = tokenData.id_token;
    if (!idToken) {
      logger.warn('[evols-ott] No id_token in exchange response');
      return res.redirect(`${domainClient}/login`);
    }

    const claims = jwtDecode(idToken);
    const sub = claims.sub;
    const email = claims.email || '';
    const fullName = claims.name || email;

    const { user: existingUser } = await findOpenIDUser({ findUser, email, openidId: sub });

    let mongoUser = existingUser;
    if (!mongoUser) {
      mongoUser = await createUser(
        { provider: 'openid', openidId: sub, username: email.split('@')[0], email, emailVerified: true, name: fullName },
        null,
        true,
        true,
      );
      logger.info(`[evols-ott] Created new LibreChat user for ${email} (sub=${sub})`);
    } else if (mongoUser.openidId !== sub) {
      await updateUser(mongoUser._id.toString(), { provider: 'openid', openidId: sub });
      logger.info(`[evols-ott] Updated openidId for ${email}: ${mongoUser.openidId} -> ${sub}`);
    }

    // Clear any existing OIDC cookies so the old session cannot be reused
    res.clearCookie('token_provider');
    res.clearCookie('refreshToken');
    res.clearCookie('openid_access_token');
    res.clearCookie('openid_id_token');
    res.clearCookie('openid_user_id');

    await setAuthTokens(mongoUser._id, res);
    logger.info(`[evols-ott] Session established for ${email} (sub=${sub})`);
    return res.redirect(`${domainClient}/`);
  } catch (err) {
    logger.error('[evols-ott] Unexpected error:', err);
    return res.redirect(`${domainClient}/login`);
  }
});

module.exports = router;
