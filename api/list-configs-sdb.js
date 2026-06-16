// api/list-configs-sdb.js — Vercel serverless
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.query.token || '';
  const expected = process.env.ADMIN_TOKEN || '';
  if (!expected || token !== expected)
    return res.status(401).json({ error: 'Non autorisé.' });

  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data, error } = await supabase
    .from('configs_sdb')
    .select('id, created_at, prenom, email, message, meuble_L, meuble_H, meuble_P, meuble_mat, plan_L, plan_P, plan_Ep, plan_mat, nb_vasques, vasque_W, vasque_D, nb_tablettes, nb_separateurs, nb_portes, nb_tiroirs, elements')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ configs: data });
};
