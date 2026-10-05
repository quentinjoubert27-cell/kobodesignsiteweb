// api/bulk-email.js — Email groupé aux clients dont le projet est dans certains statuts (admin uniquement)
// modes : preview (liste des destinataires, aucun envoi) | test (un seul email, à l'admin connecté) | send (envoi réel)
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.kobo-design.fr');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  try {
    const { createClient } = require('@supabase/supabase-js');
    const { Resend } = require('resend');
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const token = (req.headers['authorization'] || '').replace('Bearer ', '');
    const { data: { user }, error: authErr } = await sb.auth.getUser(token);
    const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'quentin.joubert@icloud.com,pascal@symetry.fr,lena@symetry.fr,mathilde@symetry.fr,armelle@symetry.fr').split(',').map(e => e.trim().toLowerCase());
    if (authErr || !user || !ADMIN_EMAILS.includes((user.email || '').toLowerCase())) return res.status(401).json({ error: 'Non autorisé' });

    const body = req.body || {};
    const mode = body.mode;
    const statuts = Array.isArray(body.statuts) ? body.statuts.filter(s => typeof s === 'string') : [];
    const sujet = String(body.sujet || '').trim().slice(0, 200);
    const message = String(body.message || '').trim().slice(0, 5000);
    if (!['preview', 'test', 'send'].includes(mode)) return res.status(400).json({ error: 'Mode invalide' });
    if (!statuts.length) return res.status(400).json({ error: 'Choisis au moins un statut' });
    if (mode !== 'preview' && (!sujet || !message)) return res.status(400).json({ error: 'Objet et message obligatoires' });

    // Destinataires : un email par client (même s'il a plusieurs projets)
    const { data: projets, error: pErr } = await sb.from('projets').select('nom, statut, client_id, created_at').in('statut', statuts).order('created_at', { ascending: false }).limit(5000);
    if (pErr) throw new Error(pErr.message);
    const ids = [...new Set((projets || []).map(p => p.client_id).filter(Boolean))];
    let clients = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await sb.from('clients').select('id, prenom, email').in('id', ids.slice(i, i + 200));
      if (error) throw new Error(error.message);
      clients = clients.concat(data || []);
    }
    const premierProjet = {};
    (projets || []).forEach(p => { if (!premierProjet[p.client_id]) premierProjet[p.client_id] = p.nom; });
    const seen = new Set();
    const recipients = clients
      .filter(c => c.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email))
      .filter(c => { const k = c.email.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
      .map(c => ({ prenom: c.prenom || '', email: c.email, projet: premierProjet[c.id] || '' }));

    if (mode === 'preview') return res.status(200).json({ count: recipients.length, recipients });

    const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const paragraphs = message.split(/\n{2,}/).map(p => `<p style="font-size:14px;line-height:1.8;margin:0 0 16px;color:#333">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
    const html = (r) => `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1A1A1A;">
      <div style="background:#1A1A1A;padding:28px 32px;border-radius:8px 8px 0 0;">
        <p style="color:#CD3E00;font-weight:700;font-size:10px;letter-spacing:3px;text-transform:uppercase;margin:0 0 6px">Kobo Design</p>
        <h1 style="color:#FFFAF0;font-size:22px;font-weight:800;margin:0;line-height:1.25">Votre projet nous tient à cœur.</h1>
      </div>
      <div style="background:#F2EDE3;padding:32px;border-radius:0 0 8px 8px;">
        <p style="font-size:15px;margin:0 0 20px;line-height:1.7">Bonjour${r.prenom ? ' <strong>' + esc(r.prenom) + '</strong>' : ''},</p>
        ${r.projet ? `<div style="background:#fff;border-radius:8px;padding:14px 18px;margin-bottom:20px;"><p style="font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#CD3E00;margin:0 0 2px">Projet</p><p style="font-size:14px;font-weight:700;margin:0;color:#1A1A1A">${esc(r.projet)}</p></div>` : ''}
        ${paragraphs}
        <p style="font-size:14px;line-height:1.8;margin:8px 0 0;color:#333">À très bientôt,<br><strong>L'équipe Kobo Design</strong></p>
      </div>
      <p style="text-align:center;font-size:11px;color:#aaa;margin:20px 0 0">Vous recevez cet email car vous avez déposé une demande de projet auprès de Kobo Design.<br>Kobo Design · 76 Rue Mandron · 33000 Bordeaux · <a href="https://www.kobo-design.fr" style="color:#CD3E00;text-decoration:none;">kobo-design.fr</a></p>
    </div>`;
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = 'Kobo Design <contact@kobo-design.fr>';

    if (mode === 'test') {
      const ex = recipients[0] || { prenom: 'Prénom', projet: 'Nom du projet' };
      await resend.emails.send({ from, to: user.email, subject: '[TEST] ' + sujet, html: html(ex) });
      return res.status(200).json({ ok: true, sentTo: user.email });
    }

    // mode send : l'admin doit avoir vu l'aperçu et confirmé le même nombre de destinataires
    if (Number(body.confirmCount) !== recipients.length) return res.status(409).json({ error: 'La liste a changé depuis l\'aperçu (' + recipients.length + ' destinataires). Relance l\'aperçu.' });
    if (!recipients.length) return res.status(400).json({ error: 'Aucun destinataire' });
    let sent = 0, failed = [];
    for (let i = 0; i < recipients.length; i += 50) {
      const chunk = recipients.slice(i, i + 50);
      const { error } = await resend.batch.send(chunk.map(r => ({ from, to: r.email, subject: sujet, html: html(r) })));
      if (error) failed = failed.concat(chunk.map(r => r.email)); else sent += chunk.length;
    }
    return res.status(200).json({ ok: true, sent, failed });
  } catch (err) {
    console.error('bulk-email error:', err);
    return res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
};
