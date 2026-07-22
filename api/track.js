// api/track.js — Enregistre une page vue
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.kobo-design.fr');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { createClient } = require('@supabase/supabase-js');
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { page, referrer } = req.body || {};

    // Pays via header Vercel (gratuit, sans API externe)
    const country = req.headers['x-vercel-ip-country'] || null;

    // Appareil via user-agent
    const ua = req.headers['user-agent'] || '';
    const device = /mobile|android|iphone|ipad|tablet/i.test(ua) ? 'mobile' : 'desktop';

    // Source depuis le referrer
    let source = 'Direct';
    if (referrer) {
      if (/google\.|bing\.|yahoo\.|duckduckgo\.|qwant\./i.test(referrer)) source = 'Recherche';
      else if (/instagram\.|facebook\.|tiktok\.|linkedin\.|twitter\.|pinterest\./i.test(referrer)) source = 'Réseaux sociaux';
      else if (!/kobo-design\.fr/i.test(referrer)) source = 'Autre';
      else source = 'Direct';
    }

    await sb.from('page_views').insert([{
      page: (page || '/').slice(0, 200),
      referrer: referrer ? referrer.slice(0, 500) : null,
      source,
      device,
      country,
    }]);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('track error:', err);
    return res.status(500).end();
  }
};
