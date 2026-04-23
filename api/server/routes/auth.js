const express = require('express');
const { createSetBalanceConfig } = require('@librechat/api');
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
const { findBalanceByUser, upsertBalanceFields } = require('~/models');
const { getAppConfig } = require('~/server/services/Config');
const middleware = require('~/server/middleware');

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
 * GET /api/auth/evols-ott
 * Server-side OTT exchange — called by the Evols workbench page iframe src.
 * Exchanges the one-time token with the Evols backend, finds/creates the
 * LibreChat user, sets auth cookies, and redirects to the app root.
 * This bypasses passport OIDC so no state/PKCE session is required.
 */
router.get('/evols-ott', middleware.loginLimiter, async (req, res) => {
  const { logger } = require('@librechat/data-schemas');
  const axios = require('axios');
  const { findUser, createUser } = require('~/models');
  const { setAuthTokens } = require('~/server/services/AuthService');
  const { getBasePath } = require('@librechat/api');

  const ott = req.query.ott;
  if (!ott) {
    return res.status(400).json({ error: 'ott required' });
  }

  try {
    // Exchange OTT with Evols backend (server-to-server, no user token needed)
    const backendUrl = process.env.EVOLS_BACKEND_URL || 'https://evols-backend-kdqer5oyua-uc.a.run.app';
    const exchangeRes = await axios.post(
      `${backendUrl}/api/v1/oidc/exchange-one-time-token`,
      { token: ott },
      { timeout: 10000 },
    );
    const { user: evolsUser } = exchangeRes.data;
    if (!evolsUser || !evolsUser.email) {
      throw new Error('Invalid exchange response from Evols backend');
    }

    // Find or create the LibreChat user by email
    let user = await findUser({ email: evolsUser.email }, '_id email name username');
    if (!user) {
      user = await createUser(
        {
          email: evolsUser.email,
          name: evolsUser.name || evolsUser.email,
          username: evolsUser.email.split('@')[0],
          emailVerified: true,
          provider: 'openid',
          openidId: String(evolsUser.id),
        },
        null,
        true,
        true,
      );
    }

    await setAuthTokens(user._id, res);

    const basePath = getBasePath();
    const redirectTo = basePath ? `${basePath}/` : '/';
    return res.redirect(redirectTo);
  } catch (err) {
    logger.error('[evols-ott] Exchange failed:', err.message);
    const basePath = getBasePath();
    const loginUrl = basePath ? `${basePath}/login?error=auth_failed` : '/login?error=auth_failed';
    return res.redirect(loginUrl);
  }
});

module.exports = router;
