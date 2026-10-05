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

  const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'quentin.joubert@icloud.com,pascal@symetry.fr,lena@symetry.fr,mathilde@symetry.fr,armelle@symetry.fr').split(',').map(e => e.trim());
  if (!ADMIN_EMAILS.includes(user.email)) return res.status(403).json({ error: 'Accès refusé' });

  // Créer le client avec la clé service role
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { prenom, nom, email, telephone, siret, societe, code_postal } = req.body || {};
  if (!prenom || !nom || !email)
    return res.status(400).json({ error: 'Champs manquants' });

  // Pas de mot de passe saisi par l'admin : on en génère un aléatoire que personne ne connaît.
  // Le client choisira le sien via le lien "Créer mon mot de passe" (needs_password).
  const password = (req.body && req.body.password) || require('crypto').randomBytes(24).toString('base64url');

  let { data, error } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { prenom, nom, needs_password: !(req.body && req.body.password) },
  });

  let target = data && data.user, rattache = false;
  if (error) {
    if (!/already been registered|already registered/i.test(error.message || ''))
      return res.status(400).json({ error: error.message });
    // L'email a déjà un compte d'accès : on regarde s'il a déjà une fiche client
    const { data: fiche } = await sb.from('clients').select('id').ilike('email', email).maybeSingle();
    if (fiche) return res.status(409).json({ error: 'Ce client existe déjà (fiche trouvée avec cet email).', clientId: fiche.id });
    const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
    target = ((list && list.users) || []).find(u => (u.email || '').toLowerCase() === email.toLowerCase());
    if (!target) return res.status(400).json({ error: error.message });
    rattache = true; // compte d'accès existant sans fiche client : on crée simplement la fiche
  }
  data = { user: target };

  const siretTrim = (siret || '').toString().trim();
  const societeTrim = (societe || '').toString().trim();

  await sb.from('clients').upsert({
    id: data.user.id,
    prenom,
    nom,
    email,
    telephone: telephone || null,
    siret: siretTrim || null,
    societe: societeTrim || null,
    type_client: (siretTrim || societeTrim) ? 'professionnel' : 'particulier',
  });

  if (code_postal) await sb.from('clients').update({ code_postal: String(code_postal).trim().slice(0, 10) }).eq('id', data.user.id).then(() => {}, () => {});

  return res.status(200).json({ success: true, clientId: data.user.id, rattache });
};
