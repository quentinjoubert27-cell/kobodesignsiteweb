// api/audit-log.js — Enregistre un événement d'audit dans Supabase
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.kobo-design.fr');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { createClient } = require('@supabase/supabase-js');
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { event, email, meta } = req.body || {};
    if (!event) return res.status(400).json({ error: 'event requis' });

    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || null;
    const user_agent = (req.headers['user-agent'] || '').slice(0, 300);

    await sb.from('audit_logs').insert([{
      event: String(event).slice(0, 50),
      email: email ? String(email).slice(0, 200) : null,
      ip,
      user_agent,
      meta: meta || null,
    }]);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('audit-log error:', err);
    return res.status(500).end();
  }
};
