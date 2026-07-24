// api/notify.js — Endpoint unifié pour toutes les notifications email client
// actions : message | statut | document | email-libre
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.kobo-design.fr');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { createClient } = require('@supabase/supabase-js');
    const { Resend } = require('resend');

    const sbAnon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    const token = (req.headers['authorization'] || '').replace('Bearer ', '');
    const { data: { user }, error: authErr } = await sbAnon.auth.getUser(token);
    const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'quentin.joubert@icloud.com,pascal@symetry.fr,lena@symetry.fr,mathilde@symetry.fr').split(',').map(e => e.trim());
    if (authErr || !user || !ADMIN_EMAILS.includes(user.email)) return res.status(401).json({ error: 'Non autorisé' });

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const resend = new Resend(process.env.RESEND_API_KEY);
    const body = req.body || {};
    const action = body.action;
    const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const HEADER = (titre, soustitre) => `
      <div style="background:#1A1A1A;padding:28px 32px;border-radius:8px 8px 0 0;">
        <p style="color:#CD3E00;font-weight:700;font-size:10px;letter-spacing:3px;text-transform:uppercase;margin:0 0 6px">Kobo Design</p>
        <h1 style="color:#FFFAF0;font-size:22px;font-weight:800;margin:0 0 4px;line-height:1.25">${titre}</h1>
        ${soustitre ? `<p style="color:rgba(255,250,240,.5);font-size:13px;margin:0">${soustitre}</p>` : ''}
      </div>`;
    const FOOTER = `<p style="text-align:center;font-size:11px;color:#aaa;margin:20px 0 0">Kobo Design · 76 Rue Mandron · 33000 Bordeaux · <a href="https://www.kobo-design.fr" style="color:#CD3E00;text-decoration:none;">kobo-design.fr</a></p>`;
    const BTN = (href, label) => `<a href="${href}" style="display:inline-block;background:#CD3E00;color:#fff;padding:13px 28px;border-radius:6px;font-weight:700;font-size:13px;text-decoration:none;">${label}</a>`;
    const PROJET_BADGE = (nom) => `<div style="background:#fff;border-radius:8px;padding:14px 18px;margin-bottom:20px;">
      <p style="font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#CD3E00;margin:0 0 2px">Projet</p>
      <p style="font-size:14px;font-weight:700;margin:0;color:#1A1A1A">${esc(nom)}</p>
    </div>`;
    const GOOGLE_REVIEW_URL = 'https://www.google.com/search?q=Kobo+design+Avis&si=APenkKm7iecQ4G6P-TsbSMFKIQtv3EFIqRAFw-i8uEbk55Z-_5cT2chRByBSV9iD2hU40JkOKKmVHHKGSvfjfMsxMcmu1NdXPSwbTeFlQ1kOFZi3-ArTvNOGp7P8oiv8CNC1XSHGbgNI';

    // ── ACTION : message ───────────────────────────────────────────
    if (action === 'message') {
      const { client_id, contenu } = body;
      if (!client_id || !contenu) return res.status(400).json({ error: 'Paramètres manquants' });
      const { data: client } = await sb.from('clients').select('email, prenom').eq('id', client_id).single();
      if (!client?.email) return res.status(404).json({ error: 'Client introuvable' });
      await resend.emails.send({
        from: 'Kobo Design <contact@kobo-design.fr>',
        to: client.email,
        subject: 'Nouveau message de Kobo Design',
        html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1A1A1A;">
          ${HEADER('Vous avez un nouveau message', '')}
          <div style="background:#F2EDE3;padding:32px;border-radius:0 0 8px 8px;">
            <p style="font-size:14px;margin:0 0 20px">Bonjour ${esc(client.prenom || '')},</p>
            <div style="background:#fff;border-radius:8px;padding:20px 24px;border-left:3px solid #CD3E00;margin-bottom:24px;">
              <p style="font-size:14px;line-height:1.6;margin:0;white-space:pre-wrap">${esc(contenu)}</p>
            </div>
            ${BTN('https://www.kobo-design.fr/espace-client2', 'Voir le message')}
          </div>
          ${FOOTER}
        </div>`,
      });
      return res.status(200).json({ ok: true });
    }

    // ── ACTION : statut ────────────────────────────────────────────
    if (action === 'statut') {
      const { projet_id, statut } = body;
      if (!projet_id || !statut) return res.status(400).json({ error: 'Paramètres manquants' });
      const { data: projet } = await sb.from('projets').select('nom, client_id').eq('id', projet_id).single();
      if (!projet) return res.status(404).json({ error: 'Projet introuvable' });
      const { data: client } = await sb.from('clients').select('email, prenom').eq('id', projet.client_id).single();
      if (!client?.email) return res.status(404).json({ error: 'Client introuvable' });

      const prenom = esc(client.prenom || '');
      const badge = PROJET_BADGE(projet.nom);

      const TEMPLATES = {
        'En étude': {
          subject: `Votre projet est à l'étude — Kobo Design`,
          html: `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1A1A1A;">
            ${HEADER('Votre projet est entre nos mains.', 'Nous avons bien reçu votre demande.')}
            <div style="background:#F2EDE3;padding:32px;border-radius:0 0 8px 8px;">
              <p style="font-size:15px;margin:0 0 20px;line-height:1.7">Bonjour <strong>${prenom}</strong>,</p>
              ${badge}
              <p style="font-size:14px;line-height:1.8;margin:0 0 16px;color:#333">Votre projet est désormais <strong>à l'étude</strong>. Notre équipe analyse votre demande avec attention pour vous proposer la meilleure solution.</p>
              <p style="font-size:14px;line-height:1.8;margin:0 0 24px;color:#333">Nous revenons vers vous très prochainement — n'hésitez pas à nous écrire si vous avez des précisions à nous apporter.</p>
              ${BTN('https://www.kobo-design.fr/espace-client2', 'Accéder à mon espace client →')}
            </div>${FOOTER}</div>`,
        },
        'Devis envoyé': {
          subject: `Votre devis est prêt — Kobo Design`,
          html: `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1A1A1A;">
            ${HEADER('Votre devis est prêt.', 'Consultez-le et dites-nous ce que vous en pensez.')}
            <div style="background:#F2EDE3;padding:32px;border-radius:0 0 8px 8px;">
              <p style="font-size:15px;margin:0 0 20px;line-height:1.7">Bonjour <strong>${prenom}</strong>,</p>
              ${badge}
              <p style="font-size:14px;line-height:1.8;margin:0 0 16px;color:#333">Votre <strong>devis personnalisé</strong> vient d'être déposé dans votre espace client. Vous pouvez le consulter et le télécharger directement.</p>
              <p style="font-size:14px;line-height:1.8;margin:0 0 24px;color:#333">Une question ? Un point à ajuster ? Écrivez-nous depuis votre espace client, nous sommes là pour affiner chaque détail.</p>
              ${BTN('https://www.kobo-design.fr/espace-client2', 'Voir mon devis →')}
            </div>${FOOTER}</div>`,
        },
        'En cours': {
          subject: `Votre projet est en cours de réalisation — Kobo Design`,
          html: `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1A1A1A;">
            ${HEADER('La réalisation a commencé.', 'Votre projet prend forme dans notre atelier.')}
            <div style="background:#F2EDE3;padding:32px;border-radius:0 0 8px 8px;">
              <p style="font-size:15px;margin:0 0 20px;line-height:1.7">Bonjour <strong>${prenom}</strong>,</p>
              ${badge}
              <p style="font-size:14px;line-height:1.8;margin:0 0 16px;color:#333">Bonne nouvelle — votre projet est désormais <strong>en cours de réalisation</strong>. Notre équipe travaille à la fabrication de votre meuble sur-mesure avec le soin qui caractérise chacune de nos réalisations.</p>
              <p style="font-size:14px;line-height:1.8;margin:0 0 24px;color:#333">Nous vous tiendrons informé de chaque étape importante via votre espace client.</p>
              ${BTN('https://www.kobo-design.fr/espace-client2', 'Suivre mon projet →')}
            </div>${FOOTER}</div>`,
        },
        'En attente': {
          subject: `Votre projet est momentanément en attente — Kobo Design`,
          html: `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1A1A1A;">
            ${HEADER('Une pause sur votre projet.', 'Nous vous recontactons très prochainement.')}
            <div style="background:#F2EDE3;padding:32px;border-radius:0 0 8px 8px;">
              <p style="font-size:15px;margin:0 0 20px;line-height:1.7">Bonjour <strong>${prenom}</strong>,</p>
              ${badge}
              <p style="font-size:14px;line-height:1.8;margin:0 0 16px;color:#333">Votre projet est <strong>momentanément en attente</strong>. Cela peut être dû à une information complémentaire dont nous avons besoin ou à une étape de validation intermédiaire.</p>
              <p style="font-size:14px;line-height:1.8;margin:0 0 24px;color:#333">Nous vous recontactons dans les plus brefs délais. N'hésitez pas à nous écrire si vous avez des questions.</p>
              ${BTN('https://www.kobo-design.fr/espace-client2', 'Nous écrire →')}
            </div>${FOOTER}</div>`,
        },
        'Terminé': {
          subject: `Votre projet est terminé — Merci pour votre confiance 🎉`,
          html: `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1A1A1A;">
            ${HEADER('Votre projet est terminé. 🎉', 'Merci pour votre confiance.')}
            <div style="background:#F2EDE3;padding:32px;border-radius:0 0 8px 8px;">
              <p style="font-size:15px;margin:0 0 20px;line-height:1.7">Bonjour <strong>${prenom}</strong>,</p>
              ${badge}
              <p style="font-size:14px;line-height:1.8;margin:0 0 16px;color:#333">C'est officiel — votre projet est <strong>terminé</strong> ! Toute l'équipe Kobo Design est ravie d'avoir concrétisé votre vision et espère que le résultat est à la hauteur de vos attentes.</p>
              <p style="font-size:14px;line-height:1.8;margin:0 0 28px;color:#333">Travailler avec vous a été un vrai plaisir. Si vous êtes satisfait de votre expérience, un avis Google nous aide énormément à faire connaître notre travail. 🙏</p>
              <div style="background:#fff;border-radius:10px;padding:24px 28px;margin-bottom:28px;text-align:center;border:1.5px solid rgba(205,62,0,.15)">
                <p style="font-size:13px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#CD3E00;margin:0 0 8px">Vous avez aimé votre expérience ?</p>
                <p style="font-size:14px;color:#555;margin:0 0 16px;line-height:1.6">Laissez-nous un avis Google — chaque témoignage nous aide à continuer à faire ce qu'on aime.</p>
                <div style="margin-bottom:16px"><span style="font-size:24px">★★★★★</span></div>
                <a href="${GOOGLE_REVIEW_URL}" style="display:inline-block;background:#1A1A1A;color:#fff;padding:13px 28px;border-radius:6px;font-weight:700;font-size:13px;text-decoration:none;">Laisser un avis Google →</a>
              </div>
              ${BTN('https://www.kobo-design.fr/espace-client2', 'Voir mon espace client →')}
            </div>${FOOTER}</div>`,
        },
      };

      const tpl = TEMPLATES[statut] || {
        subject: `Mise à jour de votre projet — ${statut}`,
        html: `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1A1A1A;">
          ${HEADER('Mise à jour de votre projet.', '')}
          <div style="background:#F2EDE3;padding:32px;border-radius:0 0 8px 8px;">
            <p style="font-size:15px;margin:0 0 20px">Bonjour <strong>${prenom}</strong>,</p>
            ${badge}
            <p style="font-size:14px;line-height:1.8;margin:0 0 24px;color:#333">Le statut de votre projet vient d'être mis à jour : <strong>${esc(statut)}</strong>.</p>
            ${BTN('https://www.kobo-design.fr/espace-client2', 'Voir mon espace client →')}
          </div>${FOOTER}</div>`,
      };

      await resend.emails.send({ from: 'Kobo Design <contact@kobo-design.fr>', to: client.email, subject: tpl.subject, html: tpl.html });
      return res.status(200).json({ ok: true });
    }

    // ── ACTION : document ──────────────────────────────────────────
    if (action === 'document') {
      const { projet_id, nom_fichier } = body;
      if (!projet_id) return res.status(400).json({ error: 'Paramètres manquants' });
      const { data: projet } = await sb.from('projets').select('nom, client_id').eq('id', projet_id).single();
      if (!projet) return res.status(404).json({ error: 'Projet introuvable' });
      const { data: client } = await sb.from('clients').select('email, prenom').eq('id', projet.client_id).single();
      if (!client?.email) return res.status(404).json({ error: 'Client introuvable' });
      await resend.emails.send({
        from: 'Kobo Design <contact@kobo-design.fr>',
        to: client.email,
        subject: `Nouveau document disponible — ${esc(projet.nom)}`,
        html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1A1A1A;">
          ${HEADER('Un document est disponible', '')}
          <div style="background:#F2EDE3;padding:32px;border-radius:0 0 8px 8px;">
            <p style="font-size:14px;margin:0 0 20px">Bonjour ${esc(client.prenom || '')},</p>
            ${PROJET_BADGE(projet.nom)}
            <p style="font-size:14px;line-height:1.8;margin:0 0 24px;color:#333">
              Un nouveau document${nom_fichier ? ` (<strong>${esc(nom_fichier)}</strong>)` : ''} vient d'être ajouté à votre projet. Consultez-le et téléchargez-le depuis votre espace client.
            </p>
            ${BTN('https://www.kobo-design.fr/espace-client2', 'Voir le document →')}
          </div>${FOOTER}
        </div>`,
      });
      return res.status(200).json({ ok: true });
    }

    // ── ACTION : email-libre ───────────────────────────────────────
    if (action === 'email-libre') {
      const { to_email, to_prenom, sujet, contenu } = body;
      if (!to_email || !sujet || !contenu) return res.status(400).json({ error: 'Paramètres manquants' });
      await resend.emails.send({
        from: 'Kobo Design <contact@kobo-design.fr>',
        to: to_email,
        subject: sujet,
        html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1A1A1A;">
          ${HEADER(esc(sujet), '')}
          <div style="background:#F2EDE3;padding:32px;border-radius:0 0 8px 8px;">
            ${to_prenom ? `<p style="font-size:14px;margin:0 0 20px">Bonjour ${esc(to_prenom)},</p>` : ''}
            <div style="background:#fff;border-radius:8px;padding:20px 24px;border-left:3px solid #CD3E00;margin-bottom:24px;">
              <p style="font-size:14px;line-height:1.6;margin:0;white-space:pre-wrap">${esc(contenu)}</p>
            </div>
            <p style="font-size:12px;color:rgba(26,26,26,.5);margin:0;">L'équipe Kobo Design</p>
          </div>${FOOTER}
        </div>`,
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });

  } catch (err) {
    console.error('notify error:', err);
    return res.status(500).end();
  }
};
