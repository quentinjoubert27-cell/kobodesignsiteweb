// api/notify.js — Endpoint unifié pour toutes les notifications email client
// actions : message | statut | document | email-libre | bulk-email | rappels-digest (+ GET rappels-tick pour le planificateur)
// ── Rappels clients : récap du matin et point « pas encore rappelés » de fin de journée ──
const escH = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function parisNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(new Date()).map(p => [p.type, p.value]));
  const h = parseInt(parts.hour, 10) % 24;
  return { today: parts.year + '-' + parts.month + '-' + parts.day, h, min: h * 60 + parseInt(parts.minute, 10), weekday: parts.weekday };
}

function rappelsHtml(list, today, titre, kicker) {
  const row = r => {
    const c = r.clients || {};
    const late = r.date_rappel < today;
    const tel = c.telephone ? `<a href="tel:${escH(c.telephone.replace(/\s/g, ''))}" style="color:#CD3E00;text-decoration:none;font-weight:700;">${escH(c.telephone)}</a>` : '<span style="color:#aaa;">pas de téléphone</span>';
    const quand = late ? 'En retard<br>' + new Date(r.date_rappel + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : "Aujourd'hui";
    return `<tr><td style="padding:12px 14px;border-bottom:1px solid #eee;vertical-align:top;">
      <div style="font-weight:800;font-size:14px;">${escH((c.prenom || '') + ' ' + (c.nom || ''))}</div>
      <div style="font-size:13px;color:#555;margin-top:2px;">${escH(r.motif || 'Rappeler')}</div>
      <div style="font-size:12px;margin-top:4px;">${tel}${c.email ? ' · ' + escH(c.email) : ''}</div></td>
      <td style="padding:12px 14px;border-bottom:1px solid #eee;vertical-align:top;white-space:nowrap;font-size:12px;font-weight:700;color:${late ? '#dc2626' : '#CD3E00'};">${quand}</td></tr>`;
  };
  return `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
    <div style="background:#1A1A1A;padding:24px 32px;border-radius:8px 8px 0 0;">
      <p style="color:#CD3E00;font-weight:700;font-size:10px;letter-spacing:3px;text-transform:uppercase;margin:0 0 6px">${kicker}</p>
      <h1 style="color:#FFFAF0;font-size:21px;font-weight:800;margin:0;">${titre}</h1>
    </div>
    <div style="background:#F2EDE3;padding:24px 32px;border-radius:0 0 8px 8px;">
      <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;">${list.map(row).join('')}</table>
      <p style="margin:22px 0 0;"><a href="https://www.kobo-design.fr/admin" style="display:inline-block;background:#CD3E00;color:#fff;padding:13px 28px;border-radius:6px;font-weight:700;font-size:13px;text-decoration:none;">Ouvrir le tableau de bord</a></p>
    </div></div>`;
}

// Notification push optionnelle sur le téléphone (appli gratuite ntfy) : variable NTFY_TOPIC
async function pushPhone(title, message) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;
  try {
    await fetch('https://ntfy.sh/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic, title, message, click: 'https://www.kobo-design.fr/admin', priority: 4 }) });
  } catch (e) { console.warn('ntfy:', e.message); }
}

async function fetchDue(sb, today) {
  const { data, error } = await sb.from('crm_rappels')
    .select('id, date_rappel, motif, client_id, clients(prenom, nom, telephone, email)')
    .eq('fait', false).lte('date_rappel', today).order('date_rappel', { ascending: true });
  if (error) throw new Error('Lecture rappels : ' + error.message);
  return data || [];
}

async function sendMail(resend, recipients, subject, html) {
  for (const to of recipients) await resend.emails.send({ from: 'Kobo Design <contact@kobo-design.fr>', to, subject, html });
  return recipients.length;
}

// Récap complet (matin ou à la demande depuis l'admin)
async function sendRappelsDigest(sb, resend, recipients) {
  const { today } = parisNow();
  const list = await fetchDue(sb, today);
  if (!list.length) return { count: 0, sent: 0 };
  const n = list.length;
  const sent = await sendMail(resend, recipients, `📞 ${n} client${n > 1 ? 's' : ''} à rappeler aujourd'hui`, rappelsHtml(list, today, `${n} client${n > 1 ? 's' : ''} à rappeler`, 'Kobo Design · Suivi client'));
  await pushPhone('📞 À rappeler aujourd\'hui', list.slice(0, 6).map(r => (r.clients ? r.clients.prenom + ' ' + r.clients.nom : 'Client')).join('\n') + (n > 6 ? '\n+ ' + (n - 6) + ' autres' : ''));
  return { count: n, sent };
}

// Appelé par les deux crons Vercel (matin / soir) avec CRON_SECRET ; le journal crm_digest_log évite tout doublon
async function runRappelsTick(sb, resend, admins) {
  const now = parisNow();
  const out = { matin: false, soir: false };
  const claim = async kind => { const { error } = await sb.from('crm_digest_log').insert({ kind, jour: now.today }); return !error; };

  // 1) Récap du matin (lun→sam, à partir de 8h)
  if (now.weekday !== 'Sun' && now.h >= 8 && now.h < 12 && await claim('matin')) {
    try { const r = await sendRappelsDigest(sb, resend, admins); out.matin = r.count; }
    catch (e) { await sb.from('crm_digest_log').delete().eq('kind', 'matin').eq('jour', now.today); throw e; }
  }

  const due = await fetchDue(sb, now.today);
  // 4) Récap du soir (lun→sam, à partir de 17h) : ce qui n'a toujours pas été fait
  if (now.weekday !== 'Sun' && now.h >= 17 && now.h < 20 && await claim('soir')) {
    const left = due;
    if (left.length) {
      const n = left.length;
      await sendMail(resend, admins, `⚠️ ${n} client${n > 1 ? 's' : ''} pas encore rappelé${n > 1 ? 's' : ''}`, rappelsHtml(left, now.today, `${n} rappel${n > 1 ? 's' : ''} pas encore fait${n > 1 ? 's' : ''}`, 'Kobo Design · Point de fin de journée'));
      await pushPhone('⚠️ Pas encore rappelés', left.slice(0, 6).map(r => (r.clients ? r.clients.prenom + ' ' + r.clients.nom : 'Client')).join('\n'));
      out.soir = n;
    }
  }
  return out;
}

// Destinataire des récaps de rappels (modifiable via la variable RAPPELS_EMAIL)
const RAPPELS_TO = () => (process.env.RAPPELS_EMAIL || 'contact@kobo-design.fr').split(',').map(e => e.trim()).filter(Boolean);

const DEFAULT_ADMINS = 'quentin.joubert@icloud.com,pascal@symetry.fr,lena@symetry.fr,mathilde@symetry.fr,armelle@symetry.fr';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.kobo-design.fr');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  // Cron quotidien Vercel : GET /api/notify?action=rappels-tick avec Authorization: Bearer $CRON_SECRET
  if (req.method === 'GET' && req.query && req.query.action === 'rappels-tick') {
    const secret = process.env.CRON_SECRET;
    if (!secret || (req.headers['authorization'] || '') !== 'Bearer ' + secret) return res.status(401).json({ error: 'Non autorisé' });
    try {
      const { createClient } = require('@supabase/supabase-js');
      const { Resend } = require('resend');
      const sbc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
      const out = await runRappelsTick(sbc, new Resend(process.env.RESEND_API_KEY), RAPPELS_TO());
      return res.status(200).json({ ok: true, ...out });
    } catch (err) { console.error('rappels-tick cron:', err); return res.status(500).json({ error: err.message }); }
  }
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { createClient } = require('@supabase/supabase-js');
    const { Resend } = require('resend');

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const token = (req.headers['authorization'] || '').replace('Bearer ', '');
    const { data: { user }, error: authErr } = await sb.auth.getUser(token);
    const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'quentin.joubert@icloud.com,pascal@symetry.fr,lena@symetry.fr,mathilde@symetry.fr,armelle@symetry.fr').split(',').map(e => e.trim());
    if (authErr || !user || !ADMIN_EMAILS.includes(user.email)) return res.status(401).json({ error: 'Non autorisé' });
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

    // ── ACTION : attach-config (l'équipe modélise un meuble pour un projet reçu par le formulaire) ──
    if (action === 'attach-config') {
      const { projet_id } = body;
      const cfg = body.config || {};
      if (!projet_id) return res.status(400).json({ error: 'Projet manquant' });
      const { data: projet } = await sb.from('projets').select('id, nom, client_id').eq('id', projet_id).single();
      if (!projet) return res.status(404).json({ error: 'Projet introuvable' });
      const { data: client } = await sb.from('clients').select('prenom, nom, email, telephone, code_postal').eq('id', projet.client_id).single();
      if (!client || !client.email) return res.status(404).json({ error: 'Client introuvable' });
      const furniture_type = String(body.furniture_type || cfg.furniture_type || 'tv').slice(0, 20);
      const meuble = cfg.meuble || {}, plan = cfg.plan || {}, vasques = cfg.vasques || {}, counts = cfg.counts || {};
      const elements = Array.isArray(cfg.elements) ? cfg.elements : [];
      const { data: ins, error: insErr } = await sb.from('configs_sdb').insert([{
        prenom: client.prenom || client.nom || 'Client', email: client.email,
        ...(client.telephone ? { telephone: client.telephone } : {}), ...(client.code_postal ? { code_postal: client.code_postal } : {}),
        decouverte: 'Modélisé par l\'équipe', projet_id: projet.id,
        type: furniture_type,
        meuble_l: meuble.L || 0, meuble_h: meuble.H || 0, meuble_p: meuble.P || 0, meuble_mat: meuble.matLabel || '',
        plan_l: plan.L || 0, plan_p: plan.P || 0, plan_ep: plan.Ep || 0, plan_mat: plan.matLabel || '',
        nb_vasques: vasques.nb != null ? vasques.nb : (furniture_type === 'sdb' ? 1 : 0),
        vasque_w: vasques.W || 0, vasque_d: vasques.D || 0, vasque_label: String(vasques.label || vasques.id || '').slice(0, 40),
        nb_tablettes: counts.shelf || 0, nb_separateurs: counts.separator || 0, nb_portes: counts.porte || 0, nb_tiroirs: counts.tiroir || 0,
        elements, thumbnail: String(body.thumbnail || '').slice(0, 500000) || null,
        raw_config: { furniture_type, meuble, plan, vasques, elements,
          ...(cfg.caisson2 ? { caisson2: cfg.caisson2 } : {}), ...(cfg.tvSide ? { tvSide: cfg.tvSide } : {}),
          ...(Array.isArray(cfg.cableHoles) && cfg.cableHoles.length ? { cableHoles: cfg.cableHoles } : {}) },
      }]).select('id').single();
      if (insErr) return res.status(500).json({ error: insErr.message });
      return res.status(200).json({ success: true, configId: ins.id });
    }

    // ── ACTION : rappels-digest (à la demande depuis l'admin) ──────
    if (action === 'rappels-digest') {
      const out = await sendRappelsDigest(sb, resend, RAPPELS_TO());
      return res.status(200).json({ ok: true, ...out });
    }

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
      if (statut === 'Analyse en cours' || statut === 'Prix validé' || statut === 'Proposition envoyée') return res.status(200).json({ ok: true, skipped: 'pas d\'email pour ce statut' }); // la proposition part avec son PDF
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
        'Devis en cours': {
          subject: `Votre devis est en cours de création — Kobo Design`,
          html: `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1A1A1A;">
            ${HEADER('Votre devis est en préparation.', 'Vous le recevrez très bientôt.')}
            <div style="background:#F2EDE3;padding:32px;border-radius:0 0 8px 8px;">
              <p style="font-size:15px;margin:0 0 20px;line-height:1.7">Bonjour <strong>${prenom}</strong>,</p>
              ${badge}
              <p style="font-size:14px;line-height:1.8;margin:0 0 16px;color:#333">Bonne nouvelle : votre <strong>devis est en cours de création</strong>. Notre équipe le prépare avec soin à partir de votre projet.</p>
              <p style="font-size:14px;line-height:1.8;margin:0 0 24px;color:#333">Vous le recevrez très bientôt, directement par email et dans votre espace client.</p>
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

    // ── ACTION : bulk-email (email groupé aux clients selon leur statut de projet) ──
    if (action === 'bulk-email') {
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
      const exclus = new Set((Array.isArray(body.exclure) ? body.exclure : []).map(e => String(e).trim().toLowerCase()).filter(Boolean));
      const seen = new Set(exclus);   // les adresses exclues sont traitées comme déjà vues
      const recipients = clients
        .filter(c => c.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email))
        .filter(c => { const k = c.email.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
        .map(c => ({ prenom: c.prenom || '', email: c.email, projet: premierProjet[c.id] || '' }));

      if (mode === 'preview') return res.status(200).json({ count: recipients.length, recipients });

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

    }

    // ── ACTION : document ──────────────────────────────────────────
    if (action === 'document') {
      const { projet_id, nom_fichier, doc_path, taille_kb } = body;
      const msgPerso = typeof body.message === 'string' ? body.message.trim().slice(0, 4000) : '';
      if (!projet_id) return res.status(400).json({ error: 'Paramètres manquants' });
      const { data: projet } = await sb.from('projets').select('nom, client_id').eq('id', projet_id).single();
      if (!projet) return res.status(404).json({ error: 'Projet introuvable' });
      const { data: client } = await sb.from('clients').select('email, prenom').eq('id', projet.client_id).single();
      if (!client?.email) return res.status(404).json({ error: 'Client introuvable' });

      // Tente de joindre le fichier directement (limite Resend : 40 Mo par email, on se limite à 15 Mo par prudence)
      let attachments;
      if (doc_path && (!taille_kb || taille_kb < 15000)) {
        try {
          const { data: fileBlob, error: dlErr } = await sb.storage.from('documents-client').download(doc_path);
          if (!dlErr && fileBlob) {
            const buffer = Buffer.from(await fileBlob.arrayBuffer());
            attachments = [{ filename: nom_fichier || 'document.pdf', content: buffer }];
          }
        } catch (e) { console.warn('notify-document: echec telechargement piece jointe', e); }
      }

      // lien direct vers le PDF (valable 7 jours) pour qu'il soit visible dans le corps du mail, pas seulement en pièce jointe
      let pdfUrl = null;
      if (msgPerso && doc_path) {
        try { const { data: su } = await sb.storage.from('documents-client').createSignedUrl(doc_path, 7 * 24 * 3600); pdfUrl = su && su.signedUrl; } catch (e) { console.warn('notify-document: lien PDF', e); }
      }
      await resend.emails.send({
        from: 'Kobo Design <contact@kobo-design.fr>',
        to: client.email,
        subject: msgPerso ? `Votre proposition Kobo Design — ${esc(projet.nom)}` : `Nouveau document disponible — ${esc(projet.nom)}`,
        html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1A1A1A;">
          ${HEADER(msgPerso ? 'Votre proposition' : 'Un document est disponible', '')}
          <div style="background:#F2EDE3;padding:32px;border-radius:0 0 8px 8px;">
            ${msgPerso ? '' : `<p style="font-size:14px;margin:0 0 20px">Bonjour ${esc(client.prenom || '')},</p>`}
            ${PROJET_BADGE(projet.nom)}
            ${msgPerso && pdfUrl ? `<div style="background:#fff;border:2px solid #CD3E00;border-radius:10px;padding:18px 20px;margin:0 0 22px;text-align:center;">
              <p style="font-size:13px;margin:0 0 12px;color:#333"><strong>Votre proposition est prête</strong>${attachments ? ' (également jointe à ce message)' : ''}</p>
              <a href="${pdfUrl}" style="display:inline-block;background:#CD3E00;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 26px;border-radius:8px;">📄 Ouvrir la proposition (PDF)</a>
              <p style="font-size:11px;margin:10px 0 0;color:#888">Lien valable 7 jours — ensuite, retrouvez-la dans votre espace client.</p>
            </div>` : ''}
            ${msgPerso ? `<p style="font-size:14px;line-height:1.8;margin:0 0 20px;color:#333;white-space:pre-wrap">${esc(msgPerso)}</p>
            <p style="font-size:13px;line-height:1.7;margin:0 0 24px;color:#555">${attachments ? 'La proposition est jointe à ce message (PDF). ' : ''}Vous la retrouvez aussi dans votre espace client.</p>` : `<p style="font-size:14px;line-height:1.8;margin:0 0 24px;color:#333">
              Un nouveau document${nom_fichier ? ` (<strong>${esc(nom_fichier)}</strong>)` : ''} vient d'être ajouté à votre projet${attachments ? ', vous le trouverez en pièce jointe' : ''}. Vous pouvez aussi le consulter à tout moment depuis votre espace client.
            </p>`}
            ${BTN('https://www.kobo-design.fr/espace-client2', 'Voir mon espace client →')}
          </div>${FOOTER}
        </div>`,
        ...(attachments ? { attachments } : {}),
      });
      return res.status(200).json({ ok: true, attached: !!attachments });
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

    // ── ACTION : message-save ──────────────────────────────────────
    if (action === 'message-save') {
      const { client_id, contenu } = body;
      if (!client_id || !contenu) return res.status(400).json({ error: 'Paramètres manquants' });
      const { error: insertErr } = await sb.from('messages_general').insert([{
        client_id, expediteur: 'admin', contenu, lu: true
      }]);
      if (insertErr) {
        console.error('message-save error:', insertErr);
        return res.status(500).json({ error: insertErr.message });
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });

  } catch (err) {
    console.error('notify error:', err);
    return res.status(500).end();
  }
};
