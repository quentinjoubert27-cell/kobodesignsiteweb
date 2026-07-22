// api/list-configs-sdb.js — Vercel serverless
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.kobo-design.fr');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '') || req.query.token || '';
  const expected = process.env.ADMIN_TOKEN || '';
  if (!expected || token !== expected)
    return res.status(401).json({ error: 'Non autorisé.' });

  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data, error } = await supabase
    .from('configs_sdb')
    .select('id, created_at, prenom, email, message, meuble_l, meuble_h, meuble_p, meuble_mat, plan_l, plan_p, plan_ep, plan_mat, nb_vasques, vasque_w, vasque_d, vasque_label, nb_tablettes, nb_separateurs, nb_portes, nb_tiroirs, elements')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ configs: data });
};
