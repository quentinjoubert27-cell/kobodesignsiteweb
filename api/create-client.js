// api/create-client.js — Vercel serverless
// Crée un compte client Supabase Auth (nécessite service role key)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.kobo-design.fr');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  // Vérifier que c'est bien l'admin qui appelle
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Non autorisé' });

  const { createClient } = require('@supabase/supabase-js');

  // Vérifier l'identité de l'appelant avec la clé anon
  const sbAnon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data: { user }, error: authErr } = await sbAnon.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Token invalide' });

  const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'quentin.joubert@icloud.com').split(',');
  if (!ADMIN_EMAILS.includes(user.email)) return res.status(403).json({ error: 'Accès refusé' });

  // Créer le client avec la clé service role
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { prenom, nom, email, telephone, password } = req.body || {};
  if (!prenom || !nom || !email || !password)
    return res.status(400).json({ error: 'Champs manquants' });

  const { data, error } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { prenom, nom },
  });

  if (error) return res.status(400).json({ error: error.message });

  await sb.from('clients').upsert({
    id: data.user.id,
    prenom,
    nom,
    email,
    telephone: telephone || null,
  });

  return res.status(200).json({ success: true });
};
