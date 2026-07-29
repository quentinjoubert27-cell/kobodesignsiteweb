// api/contact.js — Vercel serverless (CommonJS)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.kobo-design.fr');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });


  try {
    const { createClient } = require('@supabase/supabase-js');
    const { Resend } = require('resend');

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    const resend = new Resend(process.env.RESEND_API_KEY);

    const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const body = req.body || {};

    const prenom      = (body.prenom || '').toString().slice(0, 100);
    const nom         = (body.nom || '').toString().slice(0, 100);
    const email       = (body.email || '').toString().slice(0, 200);
    const telephone   = (body.telephone || '').toString().slice(0, 30);
    const code_postal = (body.code_postal || '').toString().trim().slice(0, 10);
    const type_projet = (body.type_projet || '').toString().slice(0, 100);
    const budget      = (body.budget || '').toString().slice(0, 50);
    const message     = (body.message || '').toString().slice(0, 5000);
    const fichiers    = (body.fichiers || '').toString().slice(0, 2000);
    const decouverte  = (body.decouverte || '').toString().slice(0, 100);

    // Validation
    if (!prenom || !email || !message) {
      return res.status(400).json({ error: 'Champs obligatoires manquants.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Email invalide.' });
    }
    if (body.website) return res.status(200).json({ success: true }); // honeypot

    // 1. Enregistrer dans Supabase (demandes)
    await supabase
      .from('demandes')
      .insert([{
        prenom, nom, email, telephone, type_projet, budget, message, fichiers,
        ...(code_postal ? { code_postal } : {}),
        ...(decouverte  ? { decouverte }  : {}),
      }]);

    // 2. Créer compte Auth + client + projet dans l'admin
    try {
      let userId = null;

      // Chercher d'abord dans la table clients par email
      const { data: existingClient } = await supabase
        .from('clients').select('id').eq('email', email).maybeSingle();

      if (existingClient) {
        userId = existingClient.id;
        // Mise à jour Auth (non-bloquante si ça échoue)
        await supabase.auth.admin.updateUserById(userId, {
          user_metadata: { prenom, nom: nom || '' }
        }).catch(() => {});
      } else {
        // Chercher dans Supabase Auth au cas où le compte existe mais pas dans clients
        const { data: authList } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const existingAuth = (authList?.users || []).find(u => u.email === email);

        if (existingAuth) {
          userId = existingAuth.id;
        } else {
          const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
            email,
            email_confirm: true,
            user_metadata: { prenom, nom, needs_password: true },
          });
          if (createErr) throw new Error('createUser: ' + createErr.message);
          userId = newUser.user.id;
        }
      }

      // Upsert client (conflit sur email ET id)
      const { error: upsertErr } = await supabase.from('clients').upsert({
        id: userId,
        prenom,
        nom: nom || '',
        email,
        telephone: telephone || null,
      }, { onConflict: 'id' });
      if (upsertErr) throw new Error('upsert client: ' + upsertErr.message);

      // Créer le projet
      const nomProjet = `Demande ${type_projet ? '— ' + type_projet : ''} · ${prenom} ${nom}`.slice(0, 200);
      const { data: newProjet, error: projetErr } = await supabase.from('projets').insert({
        client_id: userId,
        nom: nomProjet,
        description: [
          decouverte  ? `Découverte : ${decouverte}`  : null,
          code_postal ? `Code postal : ${code_postal}` : null,
          budget      ? `Budget : ${budget}`           : null,
          fichiers    ? `Fichiers : ${fichiers}`        : null,
        ].filter(Boolean).join('\n') || null,
        statut: 'En étude',
      }).select('id').single();
      if (projetErr) throw new Error('insert projet: ' + projetErr.message);

      if (newProjet?.id) {
        await supabase.from('messages').insert([{
          projet_id: newProjet.id, expediteur: 'client', contenu: message, lu: false
        }]);

        if (fichiers) {
          const entries = fichiers.split('|').map(s => s.trim()).filter(Boolean);
          for (const entry of entries) {
            const parts = entry.split('→').map(s => s.trim());
            const docNom = parts[0] || 'Fichier';
            const url = parts[1];
            if (!url) continue;
            const ext = docNom.split('.').pop().toLowerCase();
            const docType = ['jpg','jpeg','png','gif','webp'].includes(ext) ? 'image/' + ext
                          : ext === 'pdf' ? 'application/pdf'
                          : 'application/octet-stream';
            await supabase.from('documents').insert([{
              projet_id: newProjet.id, nom: docNom, type: docType,
              categorie: 'document', url, uploade_par: 'client'
            }]);
          }
        }
      }
    } catch (adminErr) {
      console.error('[contact] Erreur création client/projet:', adminErr.message);
      // Log dans audit_logs pour visibilité admin
      await supabase.from('audit_logs').insert([{
        event: 'contact_admin_creation_failed',
        meta: { email, prenom, nom, error: adminErr.message }
      }]).catch(() => {});
    }

    // 3. Email via Resend
    const fichiersHtml = fichiers
      ? `<tr><td style="padding:8px 0;font-size:12px;color:#666;font-weight:700;width:130px;">Fichiers</td><td style="padding:8px 0;font-size:14px;">${fichiers}</td></tr>`
      : '';

    await resend.emails.send({
      from: 'Kobo Design <contact@kobo-design.fr>',
      to: process.env.CONTACT_EMAIL,
      replyTo: email,
      subject: `Nouveau projet — ${esc(prenom)} ${esc(nom)} · ${esc(type_projet) || 'Non précisé'}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
          <div style="background:#1A1A1A;padding:24px 32px;border-radius:8px 8px 0 0;">
            <p style="color:#CD3E00;font-weight:700;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin:0 0 4px;">Kobo Design</p>
            <h1 style="color:#FFFAF0;font-size:22px;margin:0;">Nouveau projet reçu</h1>
          </div>
          <div style="background:#F2EDE3;padding:32px;border-radius:0 0 8px 8px;">
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:8px 0;font-size:12px;color:#666;font-weight:700;width:130px;">Nom</td><td style="padding:8px 0;font-size:14px;">${esc(prenom)} ${esc(nom)}</td></tr>
              <tr><td style="padding:8px 0;font-size:12px;color:#666;font-weight:700;">Email</td><td style="padding:8px 0;font-size:14px;"><a href="mailto:${esc(email)}" style="color:#CD3E00;">${esc(email)}</a></td></tr>
              <tr><td style="padding:8px 0;font-size:12px;color:#666;font-weight:700;">Téléphone</td><td style="padding:8px 0;font-size:14px;">${esc(telephone) || '—'}</td></tr>
              ${code_postal ? `<tr><td style="padding:8px 0;font-size:12px;color:#666;font-weight:700;">Code postal</td><td style="padding:8px 0;font-size:14px;">${esc(code_postal)}</td></tr>` : ''}
              <tr><td style="padding:8px 0;font-size:12px;color:#666;font-weight:700;">Type de projet</td><td style="padding:8px 0;font-size:14px;">${esc(type_projet) || '—'}</td></tr>
              <tr><td style="padding:8px 0;font-size:12px;color:#666;font-weight:700;">Budget</td><td style="padding:8px 0;font-size:14px;">${esc(budget) || '—'}</td></tr>
              ${fichiersHtml}
            </table>
            <div style="margin-top:24px;padding:20px;background:white;border-radius:6px;border-left:3px solid #CD3E00;">
              <p style="font-size:12px;color:#666;font-weight:700;margin:0 0 8px;">Message</p>
              <p style="font-size:14px;line-height:1.6;margin:0;white-space:pre-wrap;">${esc(message)}</p>
            </div>
            <div style="margin-top:20px;text-align:center;">
              <a href="mailto:${esc(email)}?subject=Re: Votre projet Kobo Design" style="display:inline-block;background:#CD3E00;color:white;padding:12px 24px;border-radius:6px;font-weight:700;font-size:13px;text-decoration:none;">Répondre à ${esc(prenom)}</a>
            </div>
          </div>
          <p style="text-align:center;font-size:11px;color:#999;margin-top:16px;">Kobo Design · 76 Rue Mandron · 33000 Bordeaux</p>
        </div>
      `,
    });

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Erreur contact:', err);
    const isDev = process.env.VERCEL_ENV !== 'production';
    return res.status(500).json({ error: isDev ? (err.message || String(err)) : 'Erreur serveur.' });
  }
};
