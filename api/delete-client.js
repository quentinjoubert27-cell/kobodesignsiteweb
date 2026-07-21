// api/delete-client.js — Vercel serverless
// Supprime un client Supabase Auth (+ cascade sur clients/projets/messages via FK)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.kobo-design.fr');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Non authentifié' });

  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // Vérifier que l'appelant est bien l'admin
  const { data: { user }, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Token invalide' });
  if (user.email !== 'quentin.joubert@icloud.com') return res.status(403).json({ error: 'Non autorisé' });

  const { clientId } = req.body || {};
  if (!clientId) return res.status(400).json({ error: 'clientId manquant' });

  const { error } = await sb.auth.admin.deleteUser(clientId);
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ success: true });
};
