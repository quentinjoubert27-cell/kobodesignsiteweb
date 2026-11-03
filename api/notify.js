// api/notify.js — Endpoint unifié pour toutes les notifications email client
// actions : message | statut | assigner | brouillon | campagne | document | email-libre | bulk-email | rappels-digest (+ GET rappels-tick pour le planificateur)
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


// ── Campagnes : lien de désinscription signé + audience ciblée ──
const SITE = 'https://www.kobo-design.fr';
function tokenDesinscription(email) {
  return require('crypto').createHmac('sha256', process.env.SUPABASE_SERVICE_ROLE_KEY || '').update(String(email).toLowerCase()).digest('hex').slice(0, 32);
}
function lienDesinscription(email) {
  return SITE + '/api/notify?action=desinscription&e=' + encodeURIComponent(email) + '&t=' + tokenDesinscription(email);
}
// Retourne { recipients, tables_manquantes } selon les filtres (clients, projets, prix déjà envoyé, dernier contact, déjà reçu, concours)
async function resoudreAudience(sb, f, exclure) {
  f = f || {};
  const arr = v => Array.isArray(v) ? v.filter(x => typeof x === 'string' && x) : [];
  const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v;
  const statuts = arr(f.statuts), types = arr(f.types), sources = arr(f.sources), temps = arr(f.temperatures), tags = arr(f.tags);
  const prix = ['envoye', 'jamais'].includes(f.prix) ? f.prix : 'tous';
  const pMin = num(f.prix_jours_min), pMax = num(f.prix_jours_max), cMin = num(f.contact_jours_min), rMin = num(f.pas_recu_jours);
  const concours = ['avec', 'seulement'].includes(f.concours) ? f.concours : 'non';
  const DAY = 864e5, now = Date.now();
  const tout = async (q) => { const { data, error } = await q.limit(5000); if (error) throw new Error(error.message); return data || []; };
  let tablesManquantes = false;
  const optionnel = async (q) => { const { data, error } = await q.limit(5000); if (error) { tablesManquantes = true; return []; } return data || []; };

  const [clients, projets, docs, acts, desinscrits, envois] = await Promise.all([
    tout(sb.from('clients').select('id, prenom, nom, email, source, temperature, tags')),
    tout(sb.from('projets').select('id, client_id, nom, statut, type, created_at, updated_at').order('created_at', { ascending: false })),
    tout(sb.from('documents').select('projet_id, type, created_at').in('type', ['Proposition', 'Devis']).eq('uploade_par', 'kobo')),
    tout(sb.from('crm_activites').select('client_id, created_at').eq('auto', false).order('created_at', { ascending: false })),
    optionnel(sb.from('newsletter_desinscrits').select('email')),
    optionnel(sb.from('newsletter_envois').select('email, created_at').eq('statut', 'envoye').order('created_at', { ascending: false })),
  ]);
  const bloques = new Set(desinscrits.map(d => String(d.email).toLowerCase()));
  (Array.isArray(exclure) ? exclure : []).forEach(e => { e = String(e).trim().toLowerCase(); if (e) bloques.add(e); });
  const recuLe = {}; envois.forEach(e => { const k = String(e.email).toLowerCase(); if (!recuLe[k]) recuLe[k] = e.created_at; });
  const contactLe = {}; acts.forEach(a => { if (!contactLe[a.client_id]) contactLe[a.client_id] = a.created_at; });
  const projetClient = {}; projets.forEach(p => { projetClient[p.id] = p.client_id; });
  const prixLe = {}; docs.forEach(d => { const c = projetClient[d.projet_id]; if (c && (!prixLe[c] || d.created_at > prixLe[c])) prixLe[c] = d.created_at; });
  const parClient = {}; projets.forEach(p => { (parClient[p.client_id] = parClient[p.client_id] || []).push(p); });
  const jours = iso => iso ? (now - new Date(iso).getTime()) / DAY : null;

  const vus = new Set(), recipients = [];
  const ajoute = r => {
    const k = String(r.email || '').toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(k) || bloques.has(k) || vus.has(k)) return;
    vus.add(k); recipients.push(r);
  };
  {
    for (const c of (concours === 'seulement' ? [] : clients)) {
      const ps = parClient[c.id] || [];
      const retenus = ps.filter(p => (!statuts.length || statuts.includes(p.statut)) && (!types.length || types.includes(p.type)));
      if ((statuts.length || types.length) && !retenus.length) continue;
      if (sources.length && !sources.includes(c.source)) continue;
      if (temps.length && !temps.includes(c.temperature)) continue;
      if (tags.length && !(c.tags || []).some(t => tags.includes(t))) continue;
      const jp = jours(prixLe[c.id]);
      if (prix === 'jamais' && jp != null) continue;
      if (prix === 'envoye' && jp == null) continue;
      if ((pMin != null || pMax != null) && jp == null) continue;   // une durée depuis « prix envoyé » ne concerne que ceux qui en ont reçu un
      if (pMin != null && jp < pMin) continue;
      if (pMax != null && jp > pMax) continue;
      const jc = jours(contactLe[c.id]);
      if (cMin != null && jc != null && jc < cMin) continue;
      const jr = jours(recuLe[String(c.email || '').toLowerCase()]);
      if (rMin != null && jr != null && jr < rMin) continue;
      const base = retenus.length ? retenus : ps;
      ajoute({ origine: 'client', client_id: c.id, prenom: c.prenom || '', nom: c.nom || '', email: c.email, projet: (base[0] || {}).nom || '', statut: (base[0] || {}).statut || '', nb_projets: ps.length,
        prix_le: prixLe[c.id] || null, contact_le: contactLe[c.id] || null, recu_le: recuLe[String(c.email || '').toLowerCase()] || null, source: c.source || '', temperature: c.temperature || '' });
    }
  }
  if (concours !== 'non') {
    const leads = await optionnel(sb.from('concours_leads').select('nom, email, newsletter_consent').eq('newsletter_consent', true));
    for (const l of leads) {
      const jr = jours(recuLe[String(l.email || '').toLowerCase()]);
      if (rMin != null && jr != null && jr < rMin) continue;
      const [prenom, ...reste] = String(l.nom || '').trim().split(/\s+/);
      ajoute({ origine: 'concours', client_id: null, prenom: prenom || '', nom: reste.join(' '), email: l.email, projet: '', statut: 'Jeu concours', nb_projets: 0, prix_le: null, contact_le: null, recu_le: recuLe[String(l.email || '').toLowerCase()] || null, source: 'Jeu concours', temperature: '' });
    }
  }
  return { recipients, tables_manquantes: tablesManquantes };
}

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
  // Lien « Se désinscrire » des campagnes : public, protégé par une signature
  if (req.method === 'GET' && req.query && req.query.action === 'desinscription') {
    const e = String(req.query.e || '').trim().toLowerCase(), t = String(req.query.t || '');
    const page = (titre, texte) => res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titre}</title><body style="font-family:sans-serif;background:#F2EDE3;color:#1A1A1A;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px"><div style="max-width:440px;background:#fff;border-radius:10px;padding:32px;text-align:center"><p style="color:#CD3E00;font-weight:700;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin:0 0 10px">Kobo Design</p><h1 style="font-size:20px;margin:0 0 12px">${titre}</h1><p style="font-size:14px;line-height:1.6;color:#555;margin:0">${texte}</p></div></body>`);
    if (!e || t !== tokenDesinscription(e)) return page('Lien invalide', 'Ce lien de désinscription n\'est pas valide. Écrivez-nous à contact@kobo-design.fr et nous vous retirerons de la liste.');
    try {
      const { createClient } = require('@supabase/supabase-js');
      const sbu = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
      const { error } = await sbu.from('newsletter_desinscrits').upsert([{ email: e }], { onConflict: 'email' });
      if (error) throw new Error(error.message);
      return page('Vous êtes désinscrit', 'Nous ne vous enverrons plus d\'e-mails d\'information. Les messages liés à un projet en cours vous parviendront toujours.');
    } catch (err) { console.error('desinscription:', err); return page('Une erreur est survenue', 'Réessayez dans un instant ou écrivez-nous à contact@kobo-design.fr.'); }
  }
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { createClient } = require('@supabase/supabase-js');
    const { Resend } = require('resend');

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const token = (req.headers['authorization'] || '').replace('Bearer ', '');
    const { data: { user }, error: authErr } = await sb.auth.getUser(token);
    const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'quentin.joubert@icloud.com,pascal@symetry.fr,lena@symetry.fr,mathilde@symetry.fr,armelle@symetry.fr').split(',').map(e => e.trim());
    if (authErr || !user) return res.status(401).json({ error: 'Non autorisé' });
    // seule l'action « client-message » (un client prévient l'équipe d'un message qu'il vient d'envoyer) est ouverte aux comptes clients
    if (!ADMIN_EMAILS.includes(user.email) && !(req.body && req.body.action === 'client-message')) return res.status(401).json({ error: 'Non autorisé' });
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

    // Accès à l'espace client : lien « créer mon mot de passe » (24 h) pour un compte jamais activé, sinon null
    const accesLienPour = async (cid, mail) => {
      try {
        const { data: au } = await sb.auth.admin.getUserById(cid);
        if (!(au && au.user && au.user.user_metadata && au.user.user_metadata.needs_password === true)) return null;
        const { data: ld } = await sb.auth.admin.generateLink({ type: 'magiclink', email: mail, options: { redirectTo: 'https://www.kobo-design.fr/espace-client2' } });
        const th = ld && ld.properties && ld.properties.hashed_token;
        return th ? 'https://www.kobo-design.fr/espace-client2?token_hash=' + th + '&type=magiclink&new=1' : null;
      } catch (e) { console.warn('accesLienPour', e.message); return null; }
    };
    // Bloc d'accès pour un document / une proposition : deux boutons si le compte n'a pas de mot de passe, un seul sinon
    const ACCES_DOC = (lien, intro, libelleSimple) => lien
      ? `<div style="background:#fff;border-radius:10px;padding:18px 20px;margin:0 0 4px;">
          <p style="font-size:13px;line-height:1.7;margin:0 0 14px;color:#333">${intro}</p>
          <p style="font-size:12px;margin:0 0 6px;color:#555"><strong>Vous n'avez pas encore créé votre mot de passe ?</strong> Cliquez ici :</p>
          ${BTN(lien, 'Créer mon mot de passe →')}
          <p style="font-size:12px;margin:16px 0 6px;color:#555"><strong>Vous avez déjà votre mot de passe ?</strong> Cliquez là :</p>
          ${BTN('https://www.kobo-design.fr/espace-client2', 'Accéder à mon espace →')}
          <p style="font-size:11px;color:#999;margin:14px 0 0;">Le lien « Créer mon mot de passe » est valable 24h.</p>
        </div>`
      : BTN('https://www.kobo-design.fr/espace-client2', libelleSimple || 'Voir mon espace client →');

    // ── ACTION : client-message (un client écrit dans la messagerie : l'équipe reçoit un mail, ce qui garde aussi une trace) ──
    if (action === 'client-message') {
      const contenu = typeof body.contenu === 'string' ? body.contenu.trim().slice(0, 4000) : '';
      if (!contenu) return res.status(400).json({ error: 'Message vide' });
      // le message doit exister, envoyé à l'instant par ce client : pas de mail pour un texte inventé
      const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: recents } = await sb.from('messages_general').select('contenu').eq('client_id', user.id).eq('expediteur', 'client').gte('created_at', since).order('created_at', { ascending: false }).limit(10);
      const { data: recentsP } = await sb.from('messages').select('contenu, projet_id').eq('expediteur', 'client').gte('created_at', since).order('created_at', { ascending: false }).limit(30);
      const okG = (recents || []).some(m => String(m.contenu).trim() === contenu);
      let okProj = null;
      if (!okG && recentsP && recentsP.length) {
        const { data: mesProjets } = await sb.from('projets').select('id, nom').eq('client_id', user.id);
        const ids = (mesProjets || []).map(x => x.id);
        const hit = recentsP.find(m => ids.includes(m.projet_id) && String(m.contenu).trim() === contenu);
        if (hit) okProj = (mesProjets || []).find(x => x.id === hit.projet_id);
      }
      if (!okG && !okProj) return res.status(400).json({ error: 'Message introuvable' });
      const { data: client } = await sb.from('clients').select('prenom, nom, email, telephone').eq('id', user.id).maybeSingle();
      const { data: projets } = await sb.from('projets').select('nom, assigne_a, statut, created_at').eq('client_id', user.id).order('created_at', { ascending: false });
      const pr = okProj ? (projets || []).find(x => x.nom === okProj.nom) : (projets || [])[0];
      const dest = new Set((process.env.CONTACT_EMAIL ? process.env.CONTACT_EMAIL.split(',') : ADMIN_EMAILS).map(x => x.trim()).filter(Boolean));
      (projets || []).forEach(x => { if (x.assigne_a && ADMIN_EMAILS.includes(x.assigne_a)) dest.add(x.assigne_a); });
      const cl = client ? ((client.prenom || '') + ' ' + (client.nom || '')).trim() : (user.email || 'Client');
      await resend.emails.send({
        from: 'Kobo Design <contact@kobo-design.fr>',
        to: Array.from(dest),
        ...(client && client.email ? { reply_to: client.email } : {}),
        subject: 'Nouveau message de ' + cl + (pr ? ' — ' + pr.nom : ''),
        html: `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1A1A1A;">
          ${HEADER('Nouveau message client', esc(cl))}
          <div style="background:#F2EDE3;padding:32px;border-radius:0 0 8px 8px;">
            ${pr ? PROJET_BADGE(pr.nom) : ''}
            <div style="background:#fff;border-radius:8px;padding:20px 24px;border-left:3px solid #CD3E00;margin-bottom:20px;"><p style="font-size:14px;line-height:1.6;margin:0;white-space:pre-wrap">${esc(contenu)}</p></div>
            <p style="font-size:13px;color:#555;margin:0 0 20px">${esc(cl)}${client && client.telephone ? ' · ' + esc(client.telephone) : ''}${client && client.email ? ' · ' + esc(client.email) : ''}</p>
            ${BTN('https://www.kobo-design.fr/admin', 'Répondre dans l\'admin')}
          </div>${FOOTER}</div>`,
      });
      return res.status(200).json({ ok: true });
    }

    // ── ACTION : assigner (un projet est confié à un membre de l'équipe : mail à cette personne, jamais au client) ──
    if (action === 'assigner') {
      const { projet_id, assigne_a, note } = body;
      if (!projet_id) return res.status(400).json({ error: 'Projet manquant' });
      const dest = assigne_a ? String(assigne_a).trim() : null;
      if (dest && !ADMIN_EMAILS.includes(dest)) return res.status(400).json({ error: 'Cette adresse ne fait pas partie de l\'équipe' });
      const { data: projet } = await sb.from('projets').select('*').eq('id', projet_id).single();
      if (!projet) return res.status(404).json({ error: 'Projet introuvable' });
      const upd = { assigne_a: dest, updated_at: new Date().toISOString() };
      if (dest && !projet.statut) upd.statut = 'En étude';
      const { error: upErr } = await sb.from('projets').update(upd).eq('id', projet_id);
      if (upErr) return res.status(500).json({ error: upErr.message, colonne_manquante: /assigne_a/.test(upErr.message || '') });
      // pas de mail si on retire l'assignation, ou si la personne se l'attribue elle-même
      if (!dest || dest === user.email || dest === projet.assigne_a) return res.status(200).json({ ok: true, mail: false });
      const { data: client } = await sb.from('clients').select('prenom, nom, email, telephone').eq('id', projet.client_id).maybeSingle();
      const NOMS = { 'quentin.joubert@icloud.com': 'Quentin', 'pascal@symetry.fr': 'Pascal', 'lena@symetry.fr': 'Léna', 'mathilde@symetry.fr': 'Mathilde', 'armelle@symetry.fr': 'Armelle' };
      const par = NOMS[user.email] || user.email;
      const cl = client ? ((client.prenom || '') + ' ' + (client.nom || '')).trim() : '';
      await resend.emails.send({
        from: 'Kobo Design <contact@kobo-design.fr>',
        to: dest,
        subject: 'Projet à étudier : ' + (projet.nom || '') + (cl ? ' (' + cl + ')' : ''),
        html: `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1A1A1A;">
          ${HEADER('Un projet t\'est confié pour étude', 'Confié par ' + esc(par))}
          <div style="background:#F2EDE3;padding:32px;border-radius:0 0 8px 8px;">
            ${PROJET_BADGE(projet.nom)}
            ${cl ? `<p style="font-size:14px;margin:0 0 14px"><strong>Client :</strong> ${esc(cl)}${client && client.telephone ? ' · ' + esc(client.telephone) : ''}${client && client.email ? ' · ' + esc(client.email) : ''}</p>` : ''}
            ${note ? `<div style="background:#fff;border-radius:8px;padding:16px 20px;border-left:3px solid #CD3E00;margin-bottom:20px;"><p style="font-size:14px;line-height:1.6;margin:0;white-space:pre-wrap">${esc(note)}</p></div>` : ''}
            <p style="font-size:13px;color:#555;margin:0 0 22px">Le client n'a reçu aucun mail : cette demande est interne.</p>
            ${BTN('https://www.kobo-design.fr/admin', 'Ouvrir le projet dans l\'admin')}
          </div>${FOOTER}</div>`,
      });
      return res.status(200).json({ ok: true, mail: true });
    }

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
      // plusieurs meubles par projet : « config_id » modifie un meuble précis, sans « config_id » on en crée un nouveau
      const { data: existant } = await sb.from('configs_sdb').select('id, decouverte').eq('projet_id', projet.id).order('created_at', { ascending: true });
      const modelesEquipe = (existant || []).filter(x => x.decouverte === 'Modélisé par l\'équipe');
      const modeleEquipe = body.config_id ? modelesEquipe.find(x => String(x.id) === String(body.config_id)) : null;
      if (body.config_id && !modeleEquipe) return res.status(404).json({ error: 'Ce meuble n\'existe plus sur le projet' });
      const libelle = String(body.libelle || cfg.libelle || '').slice(0, 60) || ('Meuble ' + ((modeleEquipe ? modelesEquipe.findIndex(x => x.id === modeleEquipe.id) : modelesEquipe.length) + 1));
      const rowData = {
        prenom: client.prenom || client.nom || 'Client', email: client.email,
        ...(client.telephone ? { telephone: client.telephone } : {}), ...(client.code_postal ? { code_postal: client.code_postal } : {}),
        decouverte: 'Modélisé par l\'équipe', projet_id: projet.id,
        type: furniture_type,
        meuble_l: Math.round(meuble.L) || 0, meuble_h: Math.round(meuble.H) || 0, meuble_p: Math.round(meuble.P) || 0, meuble_mat: meuble.matLabel || '',   // colonnes entières : une cote à virgule (ex. 205,6 lue par l'IA) ferait refuser l'enregistrement
        plan_l: Math.round(plan.L) || 0, plan_p: Math.round(plan.P) || 0, plan_ep: Math.round(plan.Ep) || 0, plan_mat: plan.matLabel || '',
        nb_vasques: vasques.nb != null ? vasques.nb : (furniture_type === 'sdb' ? 1 : 0),
        vasque_w: vasques.W || 0, vasque_d: vasques.D || 0, vasque_label: String(vasques.label || vasques.id || '').slice(0, 40),
        nb_tablettes: Math.round(counts.shelf) || 0, nb_separateurs: Math.round(counts.separator) || 0, nb_portes: Math.round(counts.porte) || 0, nb_tiroirs: Math.round(counts.tiroir) || 0,
        elements, thumbnail: String(body.thumbnail || '').slice(0, 500000) || null,
        raw_config: { furniture_type, libelle, meuble, plan, vasques, elements,
          ...(cfg.caisson2 ? { caisson2: cfg.caisson2 } : {}), ...(cfg.tvSide ? { tvSide: cfg.tvSide } : {}),
          ...(Array.isArray(cfg.cableHoles) && cfg.cableHoles.length ? { cableHoles: cfg.cableHoles } : {}),
          ...(Array.isArray(cfg.caissons) ? { caissons: cfg.caissons, longueur_totale_cm: cfg.longueur_totale_cm } : {}),
          ...(cfg.technical_spec ? { technical_spec: cfg.technical_spec } : {}),
          // modèle importé par l'équipe (meuble en formes libres : plaques et rubans) : pièces et décomptes de quincaillerie
          ...(Array.isArray(cfg.formes_libres) && cfg.formes_libres.length ? { formes_libres: cfg.formes_libres } : {}),
          ...(cfg.quincaillerie && typeof cfg.quincaillerie === 'object' ? { quincaillerie: cfg.quincaillerie } : {}),
          ...(cfg.nom_modele ? { nom_modele: String(cfg.nom_modele).slice(0, 80) } : {}) },
      };
      let configId, dbErr;
      if (modeleEquipe) {
        const up = await sb.from('configs_sdb').update(rowData).eq('id', modeleEquipe.id).select('id').single();
        configId = up.data && up.data.id; dbErr = up.error;
      } else {
        const ins = await sb.from('configs_sdb').insert([rowData]).select('id').single();
        configId = ins.data && ins.data.id; dbErr = ins.error;
      }
      if (dbErr) return res.status(500).json({ error: dbErr.message });
      return res.status(200).json({ success: true, configId, remplace: !!modeleEquipe });
    }

    // ── ACTION : delete-config (efface le modèle fait par l'équipe pour un projet, pour tout recommencer) ──
    if (action === 'delete-config') {
      const { projet_id, config_id } = body;
      if (!projet_id) return res.status(400).json({ error: 'Projet manquant' });
      // seuls les modèles faits par l'équipe sont effaçables : jamais la configuration envoyée par un client
      const { data: lignes } = await sb.from('configs_sdb').select('id, decouverte').eq('projet_id', projet_id);
      let equipe = (lignes || []).filter(x => x.decouverte === 'Modélisé par l\'équipe');
      if (config_id) equipe = equipe.filter(x => String(x.id) === String(config_id));
      else if (equipe.length > 1) return res.status(400).json({ error: 'Plusieurs meubles sur ce projet : précisez lequel effacer' });
      const ids = equipe.map(x => x.id);
      if (!ids.length) return res.status(404).json({ error: 'Aucun modèle d\'équipe à effacer pour ce projet' });
      const { error: delErr } = await sb.from('configs_sdb').delete().in('id', ids);
      if (delErr) return res.status(500).json({ error: delErr.message });
      return res.status(200).json({ ok: true, supprimes: ids.length });
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
      // Compte sans mot de passe (créé par un formulaire, jamais activé) : le mail contient son accès pour créer son mot de passe
      const accesLien = await accesLienPour(client_id, client.email);
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
            ${ACCES_DOC(accesLien, 'Votre espace client est prêt : vous pouvez y lire vos messages et nous répondre.', 'Voir le message')}
          </div>
          ${FOOTER}
        </div>`,
      });
      return res.status(200).json({ ok: true });
    }

    // ── ACTION : analyser-plan (photo / plan d'un projet → modèle du configurateur, relu par l'équipe avant import ; rien n'est enregistré ici) ──
    if (action === 'analyser-plan') {
      const r = await require('../lib/photo-ia.js').traiter(sb, body);
      return res.status(r.status).json(r.json);
    }

    // ── ACTION : rediger-proposition (brouillon du mail qui accompagne une proposition : rien n'est envoyé ici) ──
    if (action === 'rediger-proposition') {
      const r = await require('../lib/repondre-ia.js').redigerProposition(sb, body);
      return res.status(r.status).json(r.json);
    }

    // ── ACTION : repondre (aide à la rédaction des réponses de la messagerie : brouillon seulement, rien n'est envoyé) ──
    if (action === 'repondre') {
      const r = await require('../lib/repondre-ia.js').traiter(sb, body);
      return res.status(r.status).json(r.json);
    }

    // ── ACTION : statut ────────────────────────────────────────────
    if (action === 'statut') {
      const { projet_id, statut } = body;
      if (!projet_id || !statut) return res.status(400).json({ error: 'Paramètres manquants' });
      if (statut === 'Analyse en cours' || statut === 'Prix validé' || statut === 'Proposition envoyée' || statut === 'En attente de réponse client' || statut === 'Terminé') return res.status(200).json({ ok: true, skipped: 'pas d\'email pour ce statut' }); // la proposition part avec son PDF
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

    // ── ACTION : campagne (e-mail à un groupe ciblé : aperçu détaillé, test, envoi, historique, désinscription) ──
    if (action === 'campagne') {
      const mode = body.mode;
      if (!['preview', 'test', 'send'].includes(mode)) return res.status(400).json({ error: 'Mode invalide' });
      const sujet = String(body.sujet || '').trim().slice(0, 200);
      const message = String(body.message || '').trim().slice(0, 8000);
      const filtres = body.filtres && typeof body.filtres === 'object' ? body.filtres : {};
      if (mode !== 'preview' && (!sujet || !message)) return res.status(400).json({ error: 'Objet et message obligatoires' });
      const { recipients, tables_manquantes } = await resoudreAudience(sb, filtres, body.exclure);
      if (mode === 'preview') return res.status(200).json({ count: recipients.length, recipients: recipients.slice(0, 1500), tables_manquantes });

      const perso = (t, r) => String(t).replace(/\{\{\s*prenom\s*\}\}/gi, r.prenom || '').replace(/\{\{\s*projet\s*\}\}/gi, r.projet || 'votre projet');
      const html = (r) => {
        const paragraphs = perso(message, r).split(/\n{2,}/).map(p => `<p style="font-size:14px;line-height:1.8;margin:0 0 16px;color:#333">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
        return `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1A1A1A;">
        <div style="background:#1A1A1A;padding:28px 32px;border-radius:8px 8px 0 0;">
          <p style="color:#CD3E00;font-weight:700;font-size:10px;letter-spacing:3px;text-transform:uppercase;margin:0 0 6px">Kobo Design</p>
          <h1 style="color:#FFFAF0;font-size:22px;font-weight:800;margin:0;line-height:1.25">${esc(perso(body.titre || sujet, r))}</h1>
        </div>
        <div style="background:#F2EDE3;padding:32px;border-radius:0 0 8px 8px;">
          <p style="font-size:15px;margin:0 0 20px;line-height:1.7">Bonjour${r.prenom ? ' <strong>' + esc(r.prenom) + '</strong>' : ''},</p>
          ${paragraphs}
          <p style="font-size:14px;line-height:1.8;margin:8px 0 0;color:#333">À très bientôt,<br><strong>L'équipe Kobo Design</strong></p>
        </div>
        <p style="text-align:center;font-size:11px;color:#aaa;margin:20px 0 0">Kobo Design · 76 Rue Mandron · 33000 Bordeaux · <a href="${SITE}" style="color:#CD3E00;text-decoration:none;">kobo-design.fr</a><br>Vous ne souhaitez plus recevoir nos e-mails d'information ? <a href="${lienDesinscription(r.email)}" style="color:#aaa;">Se désinscrire</a></p>
      </div>`;
      };
      const from = 'Kobo Design <contact@kobo-design.fr>';
      const entetes = r => ({ 'List-Unsubscribe': '<' + lienDesinscription(r.email) + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
      if (mode === 'test') {
        const ex = recipients[0] || { prenom: 'Prénom', projet: 'Nom du projet', email: user.email };
        await resend.emails.send({ from, to: user.email, subject: '[TEST] ' + perso(sujet, ex), html: html({ ...ex, email: user.email }) });
        return res.status(200).json({ ok: true, sentTo: user.email });
      }
      if (tables_manquantes) return res.status(500).json({ error: 'Tables manquantes : exécute docs/supabase-campagnes.sql dans Supabase', tables_manquantes: true });
      if (Number(body.confirmCount) !== recipients.length) return res.status(409).json({ error: 'La liste a changé depuis l\'aperçu (' + recipients.length + ' destinataires). Relance l\'aperçu.' });
      if (!recipients.length) return res.status(400).json({ error: 'Aucun destinataire' });
      const { data: camp, error: cErr } = await sb.from('newsletter_campagnes').insert([{ sujet, message, filtres, nb_destinataires: recipients.length, nb_envoyes: 0, envoye_par: user.email }]).select('id').single();
      if (cErr) return res.status(500).json({ error: cErr.message, tables_manquantes: true });
      let sent = 0; const failed = [], lignes = [];
      for (let i = 0; i < recipients.length; i += 50) {
        const chunk = recipients.slice(i, i + 50);
        const { error } = await resend.batch.send(chunk.map(r => ({ from, to: r.email, subject: perso(sujet, r), html: html(r), headers: entetes(r) })));
        chunk.forEach(r => lignes.push({ campagne_id: camp.id, email: r.email, client_id: r.client_id, statut: error ? 'echec' : 'envoye' }));
        if (error) failed.push(...chunk.map(r => r.email)); else sent += chunk.length;
      }
      await sb.from('newsletter_envois').insert(lignes);
      await sb.from('newsletter_campagnes').update({ nb_envoyes: sent }).eq('id', camp.id);
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
      const accesDoc = await accesLienPour(projet.client_id, client.email);
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
            ${ACCES_DOC(accesDoc, 'Cette ' + (msgPerso ? 'proposition' : 'pièce') + ' est aussi disponible dans votre espace client, avec le suivi de votre projet et vos messages.')}
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

    // ── ACTION : brouillon (message client préparé, mails INTERNES aux relecteurs : le client ne reçoit rien) ──
    if (action === 'brouillon') {
      const { brouillon_id, type } = body;
      if (!brouillon_id) return res.status(400).json({ error: 'Brouillon manquant' });
      const { data: b } = await sb.from('messages_brouillons').select('*').eq('id', brouillon_id).maybeSingle();
      if (!b) return res.status(404).json({ error: 'Brouillon introuvable' });
      const { data: client } = await sb.from('clients').select('prenom, nom').eq('id', b.client_id).maybeSingle();
      const cl = client ? ((client.prenom || '') + ' ' + (client.nom || '')).trim() : '';
      const NOMS = { 'quentin.joubert@icloud.com': 'Quentin', 'pascal@symetry.fr': 'Pascal', 'lena@symetry.fr': 'Léna', 'mathilde@symetry.fr': 'Mathilde', 'armelle@symetry.fr': 'Armelle' };
      const nom = e => NOMS[e] || e;
      const cadre = (titre, sous, corps) => `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1A1A1A;">
          ${HEADER(titre, sous)}
          <div style="background:#F2EDE3;padding:32px;border-radius:0 0 8px 8px;">${corps}
            ${BTN('https://www.kobo-design.fr/admin?message=' + encodeURIComponent(b.client_id), 'Ouvrir la conversation du client')}
          </div>${FOOTER}</div>`;
      const bulle = t => `<div style="background:#fff;border-radius:8px;padding:18px 22px;border-left:3px solid #CD3E00;margin-bottom:18px;"><p style="font-size:14px;line-height:1.6;margin:0;white-space:pre-wrap">${esc(t)}</p></div>`;
      if (type === 'relecture') {
        const dests = (b.relecteurs || []).filter(e => ADMIN_EMAILS.includes(e) && e !== user.email);
        for (const to of dests) {
          await resend.emails.send({
            from: 'Kobo Design <contact@kobo-design.fr>', to,
            subject: 'À relire avant envoi' + (cl ? ' : message pour ' + cl : ''),
            html: cadre('Un message client attend ta relecture', 'Préparé par ' + esc(nom(b.auteur)),
              `${cl ? `<p style="font-size:14px;margin:0 0 14px"><strong>Pour :</strong> ${esc(cl)}</p>` : ''}${bulle(b.contenu)}
               <p style="font-size:13px;color:#555;margin:0 0 22px">Le client n'a rien reçu. Le bouton ci-dessous ouvre la conversation du client : réponds « C'est bon » ou « À modifier » sous le brouillon.</p>`),
          });
        }
        return res.status(200).json({ ok: true, mails: dests.length });
      }
      if (type === 'avis') {
        const { data: a } = await sb.from('messages_brouillons_avis').select('*').eq('brouillon_id', brouillon_id).eq('relecteur', user.email).maybeSingle();
        if (!a) return res.status(404).json({ error: 'Avis introuvable' });
        if (b.auteur === user.email) return res.status(200).json({ ok: true, mail: false });
        await resend.emails.send({
          from: 'Kobo Design <contact@kobo-design.fr>', to: b.auteur,
          subject: nom(user.email) + (a.avis === 'ok' ? ' valide ton message' : ' demande une modification') + (cl ? ' (' + cl + ')' : ''),
          html: cadre(a.avis === 'ok' ? nom(user.email) + ' valide ton message' : nom(user.email) + ' demande une modification', cl ? 'Message pour ' + esc(cl) : '',
            `${a.commentaire ? `<p style="font-size:13px;font-weight:700;margin:0 0 6px">Son commentaire</p>${bulle(a.commentaire)}` : ''}
             <p style="font-size:13px;font-weight:700;margin:0 0 6px">Ton message</p>${bulle(b.contenu)}`),
        });
        return res.status(200).json({ ok: true, mail: true });
      }
      return res.status(400).json({ error: 'Type inconnu' });
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
