// api/contact.js — Fonction serverless Vercel (CommonJS)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Debug temporaire — à supprimer après
  if (req.method === 'GET') {
    return res.status(200).json({
      supabase_url: process.env.SUPABASE_URL ? 'OK' : 'MANQUANT',
      supabase_key: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'OK' : 'MANQUANT',
      resend_key: process.env.RESEND_API_KEY ? 'OK' : 'MANQUANT',
      contact_email: process.env.CONTACT_EMAIL ? 'OK' : 'MANQUANT',
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  try {
    const { createClient } = require('@supabase/supabase-js');
    const { Resend } = require('resend');

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    const resend = new Resend(process.env.RESEND_API_KEY);

    const body = req.body;

    const prenom      = (body.prenom || '').toString().slice(0, 100);
    const nom         = (body.nom || '').toString().slice(0, 100);
    const email       = (body.email || '').toString().slice(0, 200);
    const telephone   = (body.telephone || '').toString().slice(0, 30);
    const type_projet = (body.type_projet || '').toString().slice(0, 100);
    const budget      = (body.budget_affiche || body.budget || '').toString().slice(0, 50);
    const message     = (body.message || '').toString().slice(0, 5000);

    if (!prenom || !email || !message) {
      return res.status(400).json({ error: 'Champs obligatoires manquants.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Email invalide.' });
    }
    if (body.botcheck) {
      return res.status(200).json({ success: true });
    }

    // Enregistrer dans Supabase
    const { error: dbError } = await supabase
      .from('demandes')
      .insert([{ prenom, nom, email, telephone, type_projet, budget, message }]);

    if (dbError) {
      console.error('Supabase error:', dbError);
      throw dbError;
    }

    // Envoyer email via Resend
    await resend.emails.send({
      from: 'Kobo Design <onboarding@resend.dev>',
      to: process.env.CONTACT_EMAIL,
      replyTo: email,
      subject: `Nouveau projet — ${prenom} ${nom} (${type_projet})`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
          <div style="background:#1A1A1A;padding:24px 32px;border-radius:8px 8px 0 0;">
            <p style="color:#CD3E00;font-weight:700;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin:0 0 4px;">Kobo Design</p>
            <h1 style="color:#FFFAF0;font-size:22px;margin:0;">Nouveau projet reçu</h1>
          </div>
          <div style="background:#F2EDE3;padding:32px;border-radius:0 0 8px 8px;">
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:8px 0;font-size:12px;color:#666;font-weight:700;width:130px;">Nom</td><td style="padding:8px 0;font-size:14px;">${prenom} ${nom}</td></tr>
              <tr><td style="padding:8px 0;font-size:12px;color:#666;font-weight:700;">Email</td><td style="padding:8px 0;font-size:14px;"><a href="mailto:${email}" style="color:#CD3E00;">${email}</a></td></tr>
              <tr><td style="padding:8px 0;font-size:12px;color:#666;font-weight:700;">Téléphone</td><td style="padding:8px 0;font-size:14px;">${telephone || '—'}</td></tr>
              <tr><td style="padding:8px 0;font-size:12px;color:#666;font-weight:700;">Type de projet</td><td style="padding:8px 0;font-size:14px;">${type_projet || '—'}</td></tr>
              <tr><td style="padding:8px 0;font-size:12px;color:#666;font-weight:700;">Budget</td><td style="padding:8px 0;font-size:14px;">${budget || '—'}</td></tr>
            </table>
            <div style="margin-top:24px;padding:20px;background:white;border-radius:6px;border-left:3px solid #CD3E00;">
              <p style="font-size:12px;color:#666;font-weight:700;margin:0 0 8px;">Message</p>
              <p style="font-size:14px;line-height:1.6;margin:0;white-space:pre-wrap;">${message}</p>
            </div>
            <div style="margin-top:20px;text-align:center;">
              <a href="mailto:${email}?subject=Re: Votre projet Kobo Design" style="display:inline-block;background:#CD3E00;color:white;padding:12px 24px;border-radius:6px;font-weight:700;font-size:13px;text-decoration:none;">Répondre à ${prenom}</a>
            </div>
          </div>
          <p style="text-align:center;font-size:11px;color:#999;margin-top:16px;">Kobo Design · 76 Rue Mandron · 33000 Bordeaux</p>
        </div>
      `,
    });

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Erreur contact:', err);
    return res.status(500).json({ error: err.message || 'Une erreur est survenue.' });
  }
};