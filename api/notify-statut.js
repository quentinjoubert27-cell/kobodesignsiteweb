// api/notify-statut.js — Email client quand le statut d'un projet change
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

    const { projet_id, statut } = req.body || {};
    if (!projet_id || !statut) return res.status(400).json({ error: 'Paramètres manquants' });

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: projet } = await sb.from('projets').select('nom, client_id').eq('id', projet_id).single();
    if (!projet) return res.status(404).json({ error: 'Projet introuvable' });

    const { data: client } = await sb.from('clients').select('email, prenom').eq('id', projet.client_id).single();
    if (!client?.email) return res.status(404).json({ error: 'Client introuvable' });

    const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const prenom = esc(client.prenom || '');
    const nomProjet = esc(projet.nom);
    const GOOGLE_REVIEW_URL = 'https://www.google.com/search?q=Kobo+design+Avis&si=APenkKm7iecQ4G6P-TsbSMFKIQtv3EFIqRAFw-i8uEbk55Z-_5cT2chRByBSV9iD2hU40JkOKKmVHHKGSvfjfMsxMcmu1NdXPSwbTeFlQ1kOFZi3-ArTvNOGp7P8oiv8CNC1XSHGbgNI';

    const HEADER = (titre, soustitre) => `
      <div style="background:#1A1A1A;padding:28px 32px;border-radius:8px 8px 0 0;">
        <p style="color:#CD3E00;font-weight:700;font-size:10px;letter-spacing:3px;text-transform:uppercase;margin:0 0 6px">Kobo Design</p>
        <h1 style="color:#FFFAF0;font-size:22px;font-weight:800;margin:0 0 4px;line-height:1.25">${titre}</h1>
        ${soustitre ? `<p style="color:rgba(255,250,240,.5);font-size:13px;margin:0">${soustitre}</p>` : ''}
      </div>`;

    const FOOTER = `<p style="text-align:center;font-size:11px;color:#aaa;margin:20px 0 0">Kobo Design · 76 Rue Mandron · 33000 Bordeaux · <a href="https://www.kobo-design.fr" style="color:#CD3E00;text-decoration:none;">kobo-design.fr</a></p>`;

    const BTN = (href, label) => `<a href="${href}" style="display:inline-block;background:#CD3E00;color:#fff;padding:13px 28px;border-radius:6px;font-weight:700;font-size:13px;text-decoration:none;letter-spacing:.03em">${label}</a>`;

    const PROJET_BADGE = `<div style="background:#fff;border-radius:8px;padding:14px 18px;margin-bottom:20px;display:flex;align-items:center;gap:12px;">
      <div style="width:8px;height:8px;border-radius:50%;background:#CD3E00;flex-shrink:0;margin-top:2px"></div>
      <div>
        <p style="font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#CD3E00;margin:0 0 2px">Projet</p>
        <p style="font-size:14px;font-weight:700;margin:0;color:#1A1A1A">${nomProjet}</p>
      </div>
    </div>`;

    const TEMPLATES = {

      'En étude': {
        subject: `Votre projet est à l'étude — Kobo Design`,
        html: `
        <div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1A1A1A;">
          ${HEADER('Votre projet est entre nos mains.', 'Nous avons bien reçu votre demande.')}
          <div style="background:#F2EDE3;padding:32px;border-radius:0 0 8px 8px;">
            <p style="font-size:15px;margin:0 0 20px;line-height:1.7">Bonjour <strong>${prenom}</strong>,</p>
            ${PROJET_BADGE}
            <p style="font-size:14px;line-height:1.8;margin:0 0 16px;color:#333">
              Votre projet est désormais <strong>à l'étude</strong>. Notre équipe analyse votre demande avec attention pour vous proposer la meilleure solution.
            </p>
            <p style="font-size:14px;line-height:1.8;margin:0 0 24px;color:#333">
              Nous revenons vers vous très prochainement — en attendant, n'hésitez pas à nous écrire si vous avez des questions ou des précisions à nous apporter.
            </p>
            ${BTN('https://www.kobo-design.fr/espace-client2', 'Accéder à mon espace client →')}
          </div>
          ${FOOTER}
        </div>`,
      },

      'Devis envoyé': {
        subject: `Votre devis est prêt — Kobo Design`,
        html: `
        <div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1A1A1A;">
          ${HEADER('Votre devis est prêt.', 'Consultez-le et dites-nous ce que vous en pensez.')}
          <div style="background:#F2EDE3;padding:32px;border-radius:0 0 8px 8px;">
            <p style="font-size:15px;margin:0 0 20px;line-height:1.7">Bonjour <strong>${prenom}</strong>,</p>
            ${PROJET_BADGE}
            <p style="font-size:14px;line-height:1.8;margin:0 0 16px;color:#333">
              Votre <strong>devis personnalisé</strong> vient d'être déposé dans votre espace client. Vous pouvez le consulter et le télécharger directement depuis votre espace.
            </p>
            <p style="font-size:14px;line-height:1.8;margin:0 0 24px;color:#333">
              Une question sur le devis ? Un point à ajuster ? Écrivez-nous directement depuis votre espace client, nous sommes là pour affiner chaque détail avec vous.
            </p>
            ${BTN('https://www.kobo-design.fr/espace-client2', 'Voir mon devis →')}
          </div>
          ${FOOTER}
        </div>`,
      },

      'En cours': {
        subject: `Votre projet est en cours de réalisation — Kobo Design`,
        html: `
        <div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1A1A1A;">
          ${HEADER('La réalisation a commencé.', 'Votre projet prend forme dans notre atelier.')}
          <div style="background:#F2EDE3;padding:32px;border-radius:0 0 8px 8px;">
            <p style="font-size:15px;margin:0 0 20px;line-height:1.7">Bonjour <strong>${prenom}</strong>,</p>
            ${PROJET_BADGE}
            <p style="font-size:14px;line-height:1.8;margin:0 0 16px;color:#333">
              Bonne nouvelle — votre projet est désormais <strong>en cours de réalisation</strong>. Notre équipe travaille à la fabrication de votre meuble sur-mesure avec le soin et la précision qui caractérisent chacune de nos réalisations.
            </p>
            <p style="font-size:14px;line-height:1.8;margin:0 0 24px;color:#333">
              Nous vous tiendrons informé de chaque étape importante. Vous pouvez également suivre l'avancement et échanger avec nous depuis votre espace client.
            </p>
            ${BTN('https://www.kobo-design.fr/espace-client2', 'Suivre mon projet →')}
          </div>
          ${FOOTER}
        </div>`,
      },

      'En attente': {
        subject: `Votre projet est momentanément en attente — Kobo Design`,
        html: `
        <div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1A1A1A;">
          ${HEADER('Une pause sur votre projet.', 'Nous vous recontactons très prochainement.')}
          <div style="background:#F2EDE3;padding:32px;border-radius:0 0 8px 8px;">
            <p style="font-size:15px;margin:0 0 20px;line-height:1.7">Bonjour <strong>${prenom}</strong>,</p>
            ${PROJET_BADGE}
            <p style="font-size:14px;line-height:1.8;margin:0 0 16px;color:#333">
              Votre projet est <strong>momentanément en attente</strong>. Cela peut être dû à une information complémentaire dont nous avons besoin, ou à une étape de validation intermédiaire.
            </p>
            <p style="font-size:14px;line-height:1.8;margin:0 0 24px;color:#333">
              Nous vous recontactons dans les plus brefs délais pour faire avancer les choses. En attendant, n'hésitez pas à nous écrire si vous avez des questions.
            </p>
            ${BTN('https://www.kobo-design.fr/espace-client2', 'Nous écrire →')}
          </div>
          ${FOOTER}
        </div>`,
      },

      'Terminé': {
        subject: `Votre projet est terminé — Merci pour votre confiance 🎉`,
        html: `
        <div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1A1A1A;">
          ${HEADER('Votre projet est terminé. 🎉', 'Merci pour votre confiance.')}
          <div style="background:#F2EDE3;padding:32px;border-radius:0 0 8px 8px;">
            <p style="font-size:15px;margin:0 0 20px;line-height:1.7">Bonjour <strong>${prenom}</strong>,</p>
            ${PROJET_BADGE}
            <p style="font-size:14px;line-height:1.8;margin:0 0 16px;color:#333">
              C'est officiel — votre projet est <strong>terminé</strong> ! Toute l'équipe Kobo Design est ravie d'avoir pu concrétiser votre vision et espère que le résultat est à la hauteur de vos attentes.
            </p>
            <p style="font-size:14px;line-height:1.8;margin:0 0 28px;color:#333">
              Travailler avec vous a été un vrai plaisir. Si vous êtes satisfait de votre expérience, un avis Google nous aide énormément à faire connaître notre travail — cela ne prend qu'une minute et ça compte vraiment pour nous. 🙏
            </p>

            <div style="background:#fff;border-radius:10px;padding:24px 28px;margin-bottom:28px;text-align:center;border:1.5px solid rgba(205,62,0,.15)">
              <p style="font-size:13px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#CD3E00;margin:0 0 8px">Vous avez aimé votre expérience ?</p>
              <p style="font-size:14px;color:#555;margin:0 0 20px;line-height:1.6">Laissez-nous un avis Google — chaque témoignage nous aide à continuer à faire ce qu'on aime.</p>
              <div style="display:flex;justify-content:center;gap:4px;margin-bottom:20px">
                <span style="font-size:22px">★★★★★</span>
              </div>
              <a href="${GOOGLE_REVIEW_URL}" style="display:inline-block;background:#1A1A1A;color:#fff;padding:13px 28px;border-radius:6px;font-weight:700;font-size:13px;text-decoration:none;">Laisser un avis Google →</a>
            </div>

            ${BTN('https://www.kobo-design.fr/espace-client2', 'Voir mon espace client →')}
            <p style="font-size:12px;color:#999;margin:20px 0 0;line-height:1.6">
              Vos documents et l'historique de votre projet restent accessibles dans votre espace client.
            </p>
          </div>
          ${FOOTER}
        </div>`,
      },
    };

    const tpl = TEMPLATES[statut] || {
      subject: `Mise à jour de votre projet — ${statut}`,
      html: `
      <div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1A1A1A;">
        ${HEADER('Mise à jour de votre projet.', '')}
        <div style="background:#F2EDE3;padding:32px;border-radius:0 0 8px 8px;">
          <p style="font-size:15px;margin:0 0 20px">Bonjour <strong>${prenom}</strong>,</p>
          ${PROJET_BADGE}
          <p style="font-size:14px;line-height:1.8;margin:0 0 24px;color:#333">
            Le statut de votre projet vient d'être mis à jour : <strong>${esc(statut)}</strong>.
          </p>
          ${BTN('https://www.kobo-design.fr/espace-client2', 'Voir mon espace client →')}
        </div>
        ${FOOTER}
      </div>`,
    };

    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'Kobo Design <contact@kobo-design.fr>',
      to: client.email,
      subject: tpl.subject,
      html: tpl.html,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('notify-statut error:', err);
    return res.status(500).end();
  }
};
