// api/list-configs.js — Vercel serverless
// Retourne la liste des configs bibliothèque (protégé par token)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Protection par token
  const token = req.query.token || '';
  const expected = process.env.ADMIN_TOKEN || '';
  if (!expected || token !== expected)
    return res.status(401).json({ error: 'Non autorisé.' });

  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data, error } = await supabase
    .from('configs_biblio')
    .select('id, created_at, prenom, email, message, largeur, hauteur, profondeur, essence, elements, nb_etageres, nb_traverses, nb_intercalaires, nb_portes')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ configs: data });
};
