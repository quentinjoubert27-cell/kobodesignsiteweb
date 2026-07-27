// api/send-access.js — Envoie un magic link au client pour créer son mot de passe

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.kobo-design.fr');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  try {
    const { createClient } = require('@supabase/supabase-js');
    const { Resend } = require('resend');

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const resend = new Resend(process.env.RESEND_API_KEY);

    // Vérifier que l'appelant est admin
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Non authentifié' });

    const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
    if (!ADMIN_EMAILS.includes(user.email)) return res.status(403).json({ error: 'Non autorisé' });

    const { clientId } = req.body || {};
    if (!clientId) return res.status(400).json({ error: 'clientId manquant' });

    // Récupérer les infos du client
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('id, prenom, email')
      .eq('id', clientId)
      .single();
    if (clientErr || !client) return res.status(404).json({ error: 'Client introuvable' });

    // Générer le magic link
    const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: client.email,
      options: { redirectTo: 'https://www.kobo-design.fr/espace-client2' }
    });
    if (linkErr) throw new Error('Génération lien : ' + linkErr.message);

    const tokenHash = linkData?.properties?.hashed_token;
    const magicLink = tokenHash
      ? `https://www.kobo-design.fr/espace-client2?token_hash=${tokenHash}&type=magiclink&new=1`
      : 'https://www.kobo-design.fr/espace-client2';

    // Envoyer l'email au client
    await resend.emails.send({
      from: 'Kobo Design <contact@kobo-design.fr>',
      to: client.email,
      subject: `Votre espace client Kobo Design est prêt, ${client.prenom} !`,
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
        <div style="background:#1A1A1A;padding:24px 32px;border-radius:8px 8px 0 0;">
          <p style="color:#CD3E00;font-weight:700;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin:0 0 4px">Kobo Design</p>
          <h1 style="color:#FFFAF0;font-size:22px;margin:0">Votre espace client est prêt !</h1>
        </div>
        <div style="background:#F2EDE3;padding:32px;border-radius:0 0 8px 8px;">
          <p style="font-size:15px;line-height:1.7;margin:0 0 24px">
            Bonjour <strong>${client.prenom}</strong>,<br><br>
            Votre espace client Kobo Design a été activé. Vous pouvez maintenant y accéder pour suivre l'avancement de votre projet, consulter vos documents et nous contacter directement.
          </p>
          <a href="${magicLink}" style="display:inline-block;background:#CD3E00;color:#fff;padding:14px 28px;border-radius:8px;font-weight:700;font-size:13px;letter-spacing:.08em;text-decoration:none;text-transform:uppercase;">
            Créer mon mot de passe →
          </a>
          <p style="font-size:11px;color:#999;margin:24px 0 0;">Ce lien est valable 24h. Après expiration, rendez-vous sur <a href="https://www.kobo-design.fr/espace-client2" style="color:#CD3E00">kobo-design.fr</a> pour vous connecter.</p>
        </div>
        <p style="text-align:center;font-size:11px;color:#999;margin-top:16px;">Kobo Design · 76 Rue Mandron · 33000 Bordeaux</p>
      </div>`,
    });

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('send-access error:', err);
    return res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
};
