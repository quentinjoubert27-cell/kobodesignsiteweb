// api/auto-register.js — Vercel serverless
// Crée automatiquement un compte client + projet depuis le configurateur

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.kobo-design.fr');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Register-Secret');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  // Vérification du secret partagé (pas de fallback — refus si env var absente)
  const secret = req.headers['x-register-secret'] || '';
  const expected = process.env.REGISTER_SECRET || '';
  if (!expected || secret !== expected) return res.status(403).json({ error: 'Non autorisé' });

  const { createClient } = require('@supabase/supabase-js');
  const { Resend } = require('resend');

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const resend = new Resend(process.env.RESEND_API_KEY);

  const body = req.body || {};
  const prenom     = (body.prenom     || '').toString().trim().slice(0, 80);
  const nom        = (body.nom        || '').toString().trim().slice(0, 80);
  const email      = (body.email      || '').toString().trim().toLowerCase().slice(0, 200);
  const telephone  = (body.telephone  || '').toString().trim().slice(0, 30);
  const projetNom  = (body.projetNom  || 'Configuration').toString().trim().slice(0, 200);
  const decouverte = (body.decouverte || '').toString().trim().slice(0, 100);
  const projetDescRaw = (body.projetDesc || '').toString().trim();
  const projetDesc = [decouverte ? `Découverte : ${decouverte}` : null, projetDescRaw || null].filter(Boolean).join('\n').slice(0, 2000);
  const configId   = body.configId   || null;
  const configTable= body.configTable || null;

  if (!prenom || !email) return res.status(400).json({ error: 'Prénom et email obligatoires' });

  try {
    // 1. Créer ou récupérer l'utilisateur (lookup par email via table clients, pas listUsers)
    let userId;
    const { data: clientRow } = await sb.from('clients').select('id').eq('email', email).maybeSingle();
    const found = clientRow ? { id: clientRow.id } : null;

    let isNew = false;
    if (found) {
      userId = found.id;
      await sb.auth.admin.updateUserById(userId, {
        user_metadata: { prenom, nom: nom || '' }
      });
    } else {
      isNew = true;
      const { data: newUser, error: createErr } = await sb.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { prenom, nom, needs_password: true },
      });
      if (createErr) throw new Error('Création compte: ' + createErr.message);
      userId = newUser.user.id;
    }

    // 2. Upsert dans la table clients
    await sb.from('clients').upsert({
      id: userId,
      prenom,
      nom: nom || '',
      email,
      telephone: telephone || null,
    }, { onConflict: 'id' });

    // 3. Créer le projet
    const { data: projet, error: projetErr } = await sb.from('projets').insert({
      client_id: userId,
      nom: projetNom,
      description: projetDesc,
      statut: 'En étude',
    }).select().single();
    if (projetErr) throw new Error('Création projet: ' + projetErr.message);

    // 3b. Lier la config au projet si fourni
    if (configId && configTable && ['configs_biblio', 'configs_sdb'].includes(configTable)) {
      await sb.from(configTable).update({ projet_id: projet.id }).eq('id', configId);
    }

    // 4. Générer un token OTP et construire une URL custom qui bypass PKCE
    const { data: linkData } = await sb.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: 'https://www.kobo-design.fr/espace-client2' }
    });
    const tokenHash = linkData?.properties?.hashed_token;
    // URL custom : notre page vérifie le token directement avec verifyOtp (pas de PKCE nécessaire)
    const magicLink = tokenHash
      ? `https://www.kobo-design.fr/espace-client2?token_hash=${tokenHash}&type=magiclink${isNew ? '&new=1' : ''}`
      : 'https://www.kobo-design.fr/espace-client2';

    // 5. Envoyer l'email au client (contenu différent selon nouveau ou existant)
    const emailSubject = isNew
      ? `Votre espace client Kobo Design est prêt, ${prenom} !`
      : `Nouvelle configuration reçue, ${prenom} !`;

    const emailBody = isNew
      ? `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
          <div style="background:#1A1A1A;padding:24px 32px;border-radius:8px 8px 0 0;">
            <p style="color:#CD3E00;font-weight:700;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin:0 0 4px">Kobo Design</p>
            <h1 style="color:#FFFAF0;font-size:22px;margin:0">Votre espace client est prêt !</h1>
          </div>
          <div style="background:#F2EDE3;padding:32px;border-radius:0 0 8px 8px;">
            <p style="font-size:15px;line-height:1.7;margin:0 0 24px">
              Bonjour <strong>${prenom}</strong>,<br><br>
              Nous avons bien reçu votre configuration. Votre espace client Kobo Design a été créé — vous pouvez y suivre l'avancement de votre projet, consulter vos documents et nous contacter directement.
            </p>
            <div style="background:#fff;border-radius:8px;padding:20px 24px;margin-bottom:24px;">
              <p style="font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#CD3E00;margin:0 0 8px">Votre projet</p>
              <p style="font-size:15px;font-weight:700;margin:0 0 4px">${projetNom}</p>
              <p style="font-size:13px;color:#666;margin:0">Statut : En étude</p>
            </div>
            <a href="${magicLink}" style="display:inline-block;background:#CD3E00;color:#fff;padding:14px 28px;border-radius:8px;font-weight:700;font-size:13px;letter-spacing:.08em;text-decoration:none;text-transform:uppercase;">
              Créer mon mot de passe →
            </a>
            <p style="font-size:11px;color:#999;margin:24px 0 0;">Ce lien est valable 24h. Après expiration, rendez-vous sur <a href="https://www.kobo-design.fr/espace-client2" style="color:#CD3E00">kobo-design.fr/espace-client</a>.</p>
          </div>
        </div>`
      : `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
          <div style="background:#1A1A1A;padding:24px 32px;border-radius:8px 8px 0 0;">
            <p style="color:#CD3E00;font-weight:700;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin:0 0 4px">Kobo Design</p>
            <h1 style="color:#FFFAF0;font-size:22px;margin:0">Votre nouveau projet est disponible</h1>
          </div>
          <div style="background:#F2EDE3;padding:32px;border-radius:0 0 8px 8px;">
            <p style="font-size:15px;line-height:1.7;margin:0 0 24px">
              Bonjour <strong>${prenom}</strong>,<br><br>
              Nous avons bien reçu votre configuration. Un nouveau projet a été ajouté à votre espace client — vous pouvez le consulter dès maintenant.
            </p>
            <div style="background:#fff;border-radius:8px;padding:20px 24px;margin-bottom:24px;">
              <p style="font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#CD3E00;margin:0 0 8px">Projet ajouté</p>
              <p style="font-size:15px;font-weight:700;margin:0 0 4px">${projetNom}</p>
              <p style="font-size:13px;color:#666;margin:0">Statut : En étude</p>
            </div>
            <a href="${magicLink}" style="display:inline-block;background:#CD3E00;color:#fff;padding:14px 28px;border-radius:8px;font-weight:700;font-size:13px;letter-spacing:.08em;text-decoration:none;text-transform:uppercase;">
              Accéder à mon espace →
            </a>
            <p style="font-size:11px;color:#999;margin:24px 0 0;">Ce lien est valable 24h.</p>
          </div>
        </div>`;

    await resend.emails.send({
      from: 'Kobo Design <contact@kobo-design.fr>',
      to: email,
      subject: emailSubject,
      html: emailBody,
    });

    // 6. Notifier l'admin
    if (process.env.CONTACT_EMAIL) {
      await resend.emails.send({
        from: 'Kobo Design <contact@kobo-design.fr>',
        to: process.env.CONTACT_EMAIL,
        subject: isNew ? `Nouveau client via configurateur — ${prenom} ${nom}` : `Nouvelle config — client existant — ${prenom} ${nom}`,
        html: `<p style="font-family:sans-serif">Nouveau compte créé automatiquement via le configurateur :<br><br>
          <strong>${prenom} ${nom}</strong><br>
          ${email}<br>
          ${telephone || 'Pas de téléphone'}<br><br>
          Projet créé : <strong>${projetNom}</strong><br><br>
          <a href="https://www.kobo-design.fr/admin">Voir dans l'admin →</a></p>`,
      });
    }

    return res.status(200).json({ success: true, projetId: projet?.id, isNew });

  } catch (err) {
    console.error('auto-register error:', err);
    const isDev = process.env.VERCEL_ENV !== 'production';
    return res.status(500).json({ error: isDev ? err.message : 'Erreur serveur.' });
  }
};
