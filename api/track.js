// api/track.js — Enregistre une page vue avec visitor_id cookie
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.kobo-design.fr');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { createClient } = require('@supabase/supabase-js');
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { page, referrer, language, screen, timezone, visitor_id } = req.body || {};

    const country = req.headers['x-vercel-ip-country'] || null;
    const ua      = req.headers['user-agent'] || '';
    const device  = /mobile|android|iphone|ipad|tablet/i.test(ua) ? 'mobile' : 'desktop';

    // Valider le visitor_id : 16 chars alphanumériques seulement
    const vid = /^[a-z0-9]{16}$/.test(visitor_id || '') ? visitor_id : null;

    // Source depuis le referrer
    let source = 'Direct';
    if (referrer) {
      if (/google\.|bing\.|yahoo\.|duckduckgo\.|qwant\./i.test(referrer))                         source = 'Recherche';
      else if (/instagram\.|facebook\.|tiktok\.|linkedin\.|twitter\.|pinterest\./i.test(referrer)) source = 'Réseaux sociaux';
      else if (!/kobo-design\.fr/i.test(referrer))                                                source = 'Autre';
    }

    await sb.from('page_views').insert([{
      page:       (page || '/').slice(0, 200),
      referrer:   referrer  ? referrer.slice(0, 500)  : null,
      source,
      device,
      country,
      visitor_id: vid,
      language:   language  ? String(language).slice(0, 10)  : null,
      screen:     screen    ? String(screen).slice(0, 20)    : null,
      timezone:   timezone  ? String(timezone).slice(0, 60)  : null,
    }]);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('track error:', err);
    return res.status(500).end();
  }
};
