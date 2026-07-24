// api/notify-message.js — Envoie un email au client quand l'admin lui envoie un message
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.kobo-design.fr');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { createClient } = require('@supabase/supabase-js');
    const { Resend } = require('resend');
    const sb     = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const resend = new Resend(process.env.RESEND_API_KEY);

    // Vérification session Supabase — l'appelant doit être un admin
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace('Bearer ', '');
    const sbAnon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    const { data: { user }, error: authErr } = await sbAnon.auth.getUser(token);
    const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'quentin.joubert@icloud.com,pascal@symetry.fr,lena@symetry.fr,mathilde@symetry.fr').split(',').map(e => e.trim());
    if (authErr || !user || !ADMIN_EMAILS.includes(user.email)) return res.status(401).json({ error: 'Non autorisé' });

    const { client_id, contenu } = req.body || {};
    if (!client_id || !contenu) return res.status(400).json({ error: 'Paramètres manquants' });

    // Récupérer email + prénom du client
    const { data: client } = await sb.from('clients').select('email, prenom').eq('id', client_id).single();
    if (!client?.email) return res.status(404).json({ error: 'Client introuvable' });

    const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    await resend.emails.send({
      from: 'Kobo Design <contact@kobo-design.fr>',
      to: client.email,
      subject: 'Nouveau message de Kobo Design',
      html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1A1A1A;">
        <div style="background:#1A1A1A;padding:24px 32px;border-radius:8px 8px 0 0;">
          <p style="color:#CD3E00;font-weight:700;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin:0 0 4px">Kobo Design</p>
          <h1 style="color:#FFFAF0;font-size:20px;margin:0">Vous avez un nouveau message</h1>
        </div>
        <div style="background:#F2EDE3;padding:32px;border-radius:0 0 8px 8px;">
          <p style="font-size:14px;margin:0 0 20px">Bonjour ${esc(client.prenom || '')},</p>
          <div style="background:#fff;border-radius:8px;padding:20px 24px;border-left:3px solid #CD3E00;margin-bottom:24px;">
            <p style="font-size:14px;line-height:1.6;margin:0;white-space:pre-wrap">${esc(contenu)}</p>
          </div>
          <a href="https://www.kobo-design.fr/espace-client2" style="display:inline-block;background:#CD3E00;color:#fff;padding:12px 24px;border-radius:6px;font-weight:700;font-size:13px;text-decoration:none;">Voir le message</a>
        </div>
      </div>`,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('notify-message error:', err);
    return res.status(500).end();
  }
};
