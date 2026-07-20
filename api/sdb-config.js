// api/sdb-config.js — Vercel serverless
// Reçoit la configuration du configurateur salle de bain,
// la stocke dans Supabase et envoie un email à Kobo Design.

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { error } = await supabase.from('configs_sdb').select('id').limit(1);
    return res.status(200).json({
      supabase_url: process.env.SUPABASE_URL ? 'OK' : 'MANQUANT',
      supabase_key: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'OK' : 'MANQUANT',
      resend_key: process.env.RESEND_API_KEY ? 'OK' : 'MANQUANT',
      contact_email: process.env.CONTACT_EMAIL ? 'OK' : 'MANQUANT',
      table_configs_sdb: error ? ('ERREUR: ' + error.message) : 'OK',
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  try {
    const { createClient } = require('@supabase/supabase-js');
    const { Resend } = require('resend');

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const resend = new Resend(process.env.RESEND_API_KEY);

    const body = req.body || {};

    const prenom  = (body.prenom  || '').toString().trim().slice(0, 100);
    const email   = (body.email   || '').toString().trim().slice(0, 200);
    const message = (body.message || '').toString().trim().slice(0, 2000);
    const cfg     = body.config   || {};

    if (!prenom || !email)
      return res.status(400).json({ error: 'Prénom et email obligatoires.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'Email invalide.' });
    if (body.botcheck) return res.status(200).json({ success: true });

    const furniture_type = (cfg.furniture_type || 'sdb').toString().slice(0, 20);
    const meuble  = cfg.meuble  || {};
    const plan    = cfg.plan    || {};
    const vasques = cfg.vasques || {};
    const elements = Array.isArray(cfg.elements) ? cfg.elements : [];
    const counts   = cfg.counts || {};

    const { data: inserted, error: dbError } = await supabase
      .from('configs_sdb')
      .insert([{
        prenom,
        email,
        message: message || null,
        type: furniture_type,
        // meuble
        meuble_l: meuble.L || 0,
        meuble_h: meuble.H || 0,
        meuble_p: meuble.P || 0,
        meuble_mat: meuble.matLabel || '',
        // plan
        plan_l: plan.L || 0,
        plan_p: plan.P || 0,
        plan_ep: plan.Ep || 0,
        plan_mat: plan.matLabel || '',
        // vasques
        nb_vasques: vasques.nb || (furniture_type === 'sdb' ? 1 : 0),
        vasque_w: vasques.W || 0,
        vasque_d: vasques.D || 0,
        vasque_label: (vasques.label || vasques.id || '').toString().slice(0, 40),
        // intérieur
        nb_tablettes: counts.shelf || 0,
        nb_separateurs: counts.separator || 0,
        nb_portes: counts.porte || 0,
        nb_tiroirs: counts.tiroir || 0,
        elements,
      }])
      .select('id')
      .single();

    if (dbError) {
      console.error('Supabase error:', dbError);
      throw new Error(dbError.message);
    }

    // ── Email ──────────────────────────────────────────
    const elDetails = elements.map(el => {
      if (el.type === 'shelf')
        return `<li>Tablette H=${el.y_cm} cm [${el.x_left_cm ?? 0}→${el.x_right_cm} cm]</li>`;
      if (el.type === 'separator')
        return `<li>Séparateur X=${el.x_cm} cm</li>`;
      if (el.type === 'porte')
        return `<li>Porte — ${el.key}</li>`;
      if (el.type === 'tiroir')
        return `<li>Tiroir — ${el.key}</li>`;
      return `<li>${JSON.stringify(el)}</li>`;
    }).join('');

    const msgHtml = message
      ? `<tr><td style="padding:8px 0;font-size:12px;color:#666;font-weight:700;width:140px;vertical-align:top">Message</td><td style="padding:8px 0;font-size:14px;white-space:pre-wrap">${message}</td></tr>`
      : '';

    await resend.emails.send({
      from: 'Kobo Design <contact@kobo-design.fr>',
      to: process.env.CONTACT_EMAIL,
      replyTo: email,
      subject: `SDB configurée — ${prenom} · Meuble ${meuble.L}×${meuble.H}×${meuble.P} cm · ${meuble.matLabel}`,
      html: `
      <div style="font-family:sans-serif;max-width:640px;margin:0 auto;color:#1A1A1A;">
        <div style="background:#1A1A1A;padding:24px 32px;border-radius:8px 8px 0 0;">
          <p style="color:#CD3E00;font-weight:700;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin:0 0 4px">Kobo Design · Configurateur</p>
          <h1 style="color:#FFFAF0;font-size:22px;margin:0">Nouvelle salle de bain configurée</h1>
        </div>
        <div style="background:#F2EDE3;padding:32px;border-radius:0 0 8px 8px;">
          <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
            <tr><td style="padding:8px 0;font-size:12px;color:#666;font-weight:700;width:140px">Prénom</td><td style="padding:8px 0;font-size:14px">${prenom}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#666;font-weight:700">Email</td><td style="padding:8px 0;font-size:14px"><a href="mailto:${email}" style="color:#CD3E00">${email}</a></td></tr>
            ${msgHtml}
          </table>
          <div style="background:#fff;border-radius:8px;padding:20px 24px;margin-bottom:16px">
            <p style="font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#CD3E00;margin:0 0 12px">Meuble</p>
            <p style="font-size:18px;font-weight:700;margin:0 0 4px">${meuble.L} × ${meuble.H} × ${meuble.P} cm</p>
            <p style="font-size:13px;color:#666;margin:0">Finition : ${meuble.matLabel}</p>
          </div>
          <div style="background:#fff;border-radius:8px;padding:20px 24px;margin-bottom:16px">
            <p style="font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#CD3E00;margin:0 0 12px">Plan de travail</p>
            <p style="font-size:18px;font-weight:700;margin:0 0 4px">${plan.L} × ${plan.P} × ${plan.Ep} cm</p>
            <p style="font-size:13px;color:#666;margin:0">Matériau : ${plan.matLabel}</p>
          </div>
          <div style="background:#fff;border-radius:8px;padding:20px 24px;margin-bottom:16px">
            <p style="font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#CD3E00;margin:0 0 12px">Vasque${vasques.nb > 1 ? 's' : ''}</p>
            <p style="font-size:18px;font-weight:700;margin:0 0 4px">${vasques.nb}× — ${vasques.W} × ${vasques.D} cm</p>
          </div>
          <div style="background:#fff;border-radius:8px;padding:20px 24px;margin-bottom:16px">
            <p style="font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#CD3E00;margin:0 0 12px">Aménagement intérieur</p>
            <p style="font-size:13px;color:#666;margin:0 0 10px">
              ${counts.shelf ? `<strong>${counts.shelf}</strong> tablette${counts.shelf>1?'s':''} · ` : ''}${counts.separator ? `<strong>${counts.separator}</strong> séparateur${counts.separator>1?'s':''} · ` : ''}${counts.porte ? `<strong>${counts.porte}</strong> porte${counts.porte>1?'s':''} · ` : ''}${counts.tiroir ? `<strong>${counts.tiroir}</strong> tiroir${counts.tiroir>1?'s':''}` : ''}${(!counts.shelf&&!counts.separator&&!counts.porte&&!counts.tiroir)?'Structure vide':''}
            </p>
            <ul style="font-size:12px;color:#444;margin:0;padding-left:16px;line-height:2">${elDetails || '<li>Aucun élément</li>'}</ul>
          </div>
          <div style="background:#fff;border-radius:8px;padding:16px 24px">
            <p style="font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#999;margin:0 0 8px">JSON brut</p>
            <pre style="font-size:10px;color:#555;margin:0;overflow-x:auto;white-space:pre-wrap;word-break:break-all">${JSON.stringify({meuble,plan,vasques,elements},null,2)}</pre>
          </div>
        </div>
      </div>`,
    });

    return res.status(200).json({ success: true, configId: inserted?.id || null });

  } catch (err) {
    console.error('sdb-config error:', err);
    const isDev = process.env.VERCEL_ENV !== 'production';
    return res.status(500).json({
      error: isDev ? (err.message || String(err)) : 'Erreur serveur. Réessayez dans un instant.'
    });
  }
};
