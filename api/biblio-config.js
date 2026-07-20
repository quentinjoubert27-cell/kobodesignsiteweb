// api/biblio-config.js — Vercel serverless
// Reçoit la configuration du configurateur bibliothèque,
// la stocke dans Supabase et envoie un email à Kobo Design.

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Endpoint de diagnostic (GET)
  if (req.method === 'GET') {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { error } = await supabase.from('configs_biblio').select('id').limit(1);
    return res.status(200).json({
      supabase_url: process.env.SUPABASE_URL ? 'OK' : 'MANQUANT',
      supabase_key: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'OK' : 'MANQUANT',
      resend_key: process.env.RESEND_API_KEY ? 'OK' : 'MANQUANT',
      contact_email: process.env.CONTACT_EMAIL ? 'OK' : 'MANQUANT',
      table_configs_biblio: error ? ('ERREUR: ' + error.message) : 'OK',
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

    const body = req.body || {};

    // ── Validation ──────────────────────────────────
    const prenom  = (body.prenom  || '').toString().trim().slice(0, 100);
    const email   = (body.email   || '').toString().trim().slice(0, 200);
    const message = (body.message || '').toString().trim().slice(0, 2000);
    const cfg     = body.config   || {};

    if (!prenom || !email)
      return res.status(400).json({ error: 'Prénom et email obligatoires.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'Email invalide.' });
    if (body.botcheck) return res.status(200).json({ success: true });

    // ── Extraction config ────────────────────────────
    const W          = Number(cfg.W)   || 0;
    const H          = Number(cfg.H)   || 0;
    const D          = Number(cfg.D)   || 0;
    const matLabel   = (cfg.matLabel   || '').toString().slice(0, 80);
    const elements   = Array.isArray(cfg.elements) ? cfg.elements : [];

    const matId  = (cfg.matId || 'chene').toString().slice(0, 40);

    const nb_etageres     = elements.filter(e => e.type === 'shelf').length;
    const nb_traverses    = elements.filter(e => e.type === 'traverse').length;
    const nb_intercalaires= elements.filter(e => e.type === 'separator').length;
    const nb_portes       = elements.filter(e => e.type === 'door').length;

    // Lien de visualisation directe (base64 de la config)
    const configB64 = Buffer.from(JSON.stringify({ W, H, D, matId, elements })).toString('base64');
    const vizUrl = `https://www.kobo-design.fr/configurateur-biblio-test?c=${configB64}`;

    // ── Supabase ─────────────────────────────────────
    const { data: inserted, error: dbError } = await supabase
      .from('configs_biblio')
      .insert([{
        prenom,
        email,
        message: message || null,
        largeur: W,
        hauteur: H,
        profondeur: D,
        essence: matLabel,
        elements,
        nb_etageres,
        nb_traverses,
        nb_intercalaires,
        nb_portes,
      }])
      .select('id')
      .single();

    if (dbError) {
      console.error('Supabase error:', dbError);
      throw new Error(dbError.message);
    }

    // ── Email ─────────────────────────────────────────
    const elDetails = elements.map(el => {
      if (el.type === 'shelf')
        return `<li>Étagère H=${el.y_cm} cm [${el.x_left_cm ?? 0}→${el.x_right_cm} cm]</li>`;
      if (el.type === 'traverse')
        return `<li>Traverse H=${el.y_cm} cm [${el.x_left_cm ?? 0}→${el.x_right_cm} cm]</li>`;
      if (el.type === 'separator')
        return `<li>Intercalaire X=${el.x_cm} cm</li>`;
      if (el.type === 'door')
        return `<li>Porte [${el.x_left_cm}→${el.x_right_cm} cm] H:${el.floor_y_cm}→${el.ceil_y_cm} cm</li>`;
      return `<li>${JSON.stringify(el)}</li>`;
    }).join('');

    const msgHtml = message
      ? `<tr><td style="padding:8px 0;font-size:12px;color:#666;font-weight:700;width:140px;vertical-align:top">Message</td><td style="padding:8px 0;font-size:14px;white-space:pre-wrap">${message}</td></tr>`
      : '';

    await resend.emails.send({
      from: 'Kobo Design <contact@kobo-design.fr>',
      to: process.env.CONTACT_EMAIL,
      replyTo: email,
      subject: `Biblio configurée — ${prenom} · ${W}×${H}×${D} cm · ${matLabel}`,
      html: `
      <div style="font-family:sans-serif;max-width:640px;margin:0 auto;color:#1A1A1A;">
        <div style="background:#1A1A1A;padding:24px 32px;border-radius:8px 8px 0 0;">
          <p style="color:#CD3E00;font-weight:700;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin:0 0 4px">Kobo Design · Configurateur</p>
          <h1 style="color:#FFFAF0;font-size:22px;margin:0">Nouvelle bibliothèque configurée</h1>
        </div>
        <div style="background:#CD3E00;padding:16px 32px;text-align:center;">
          <a href="${vizUrl}" style="display:inline-block;background:#fff;color:#CD3E00;font-weight:700;font-size:11px;letter-spacing:.15em;text-transform:uppercase;padding:10px 28px;border-radius:100px;text-decoration:none;">
            ▶ Visualiser en 3D
          </a>
        </div>
        <div style="background:#F2EDE3;padding:32px;border-radius:0 0 8px 8px;">
          <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
            <tr><td style="padding:8px 0;font-size:12px;color:#666;font-weight:700;width:140px">Prénom</td><td style="padding:8px 0;font-size:14px">${prenom}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#666;font-weight:700">Email</td><td style="padding:8px 0;font-size:14px"><a href="mailto:${email}" style="color:#CD3E00">${email}</a></td></tr>
            ${msgHtml}
          </table>
          <div style="background:#fff;border-radius:8px;padding:20px 24px;margin-bottom:24px">
            <p style="font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#CD3E00;margin:0 0 12px">Dimensions &amp; finition</p>
            <p style="font-size:20px;font-weight:700;margin:0 0 4px">${W} × ${H} × ${D} cm</p>
            <p style="font-size:13px;color:#666;margin:0">Essence : ${matLabel}</p>
          </div>
          <div style="background:#fff;border-radius:8px;padding:20px 24px;margin-bottom:24px">
            <p style="font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#CD3E00;margin:0 0 12px">Aménagement intérieur</p>
            <p style="font-size:13px;color:#666;margin:0 0 10px">
              ${nb_etageres ? `<strong>${nb_etageres}</strong> étagère${nb_etageres>1?'s':''} · ` : ''}${nb_traverses ? `<strong>${nb_traverses}</strong> traverse${nb_traverses>1?'s':''} · ` : ''}${nb_intercalaires ? `<strong>${nb_intercalaires}</strong> intercalaire${nb_intercalaires>1?'s':''} · ` : ''}${nb_portes ? `<strong>${nb_portes}</strong> porte${nb_portes>1?'s':''}` : ''}${(!nb_etageres&&!nb_traverses&&!nb_intercalaires&&!nb_portes)?'Structure vide':''}
            </p>
            <ul style="font-size:12px;color:#444;margin:0;padding-left:16px;line-height:2">${elDetails || '<li>Aucun élément</li>'}</ul>
          </div>
          <div style="background:#fff;border-radius:8px;padding:16px 24px">
            <p style="font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#999;margin:0 0 8px">JSON brut (pour import)</p>
            <pre style="font-size:10px;color:#555;margin:0;overflow-x:auto;white-space:pre-wrap;word-break:break-all">${JSON.stringify({W,H,D,matLabel,elements},null,2)}</pre>
          </div>
        </div>
      </div>`,
    });

    return res.status(200).json({ success: true, configId: inserted?.id || null });

  } catch (err) {
    console.error('biblio-config error:', err);
    // En dev/debug : renvoyer le message réel pour faciliter le diagnostic
    const isDev = process.env.VERCEL_ENV !== 'production';
    return res.status(500).json({
      error: isDev ? (err.message || String(err)) : 'Erreur serveur. Réessayez dans un instant.'
    });
  }
};
