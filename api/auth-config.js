// GET /api/auth-config?pass=TON_MOT_DE_PASSE
// Pose le cookie d'auth et redirige vers /configurateur

const SECRET = process.env.CONFIG_PASS || 'kobodesign2026';

module.exports = function handler(req, res) {
  const { pass } = req.query;

  if (pass !== SECRET) {
    res.status(403).send('Accès refusé');
    return;
  }

  res.setHeader(
    'Set-Cookie',
    'kb_auth=ok; Path=/; SameSite=Lax; Max-Age=31536000'
  );
  res.redirect(302, '/configurateur');
}
