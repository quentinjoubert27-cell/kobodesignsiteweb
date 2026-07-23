// Script de migration : importe toutes les demandes existantes en clients/projets/messages
// Lancer une seule fois : node migrate-demandes.js

const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('crypto');

const SUPABASE_URL = 'https://auzcbtipzqxmllkzdxls.supabase.co';
// Remplace par ta SERVICE_ROLE_KEY (Supabase > Settings > API > service_role)
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'METS_TA_CLE_ICI';

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  console.log('Récupération des demandes…');
  const { data: demandes, error } = await sb
    .from('demandes')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) { console.error('Erreur lecture demandes:', error); process.exit(1); }
  console.log(`${demandes.length} demandes trouvées.`);

  let created = 0, skipped = 0, errors = 0;

  for (const d of demandes) {
    try {
      const email = (d.email || '').trim().toLowerCase();
      if (!email) { console.log(`  [SKIP] Demande ${d.id} — pas d'email`); skipped++; continue; }

      // Client : upsert par email
      let clientId = null;
      const { data: existing } = await sb.from('clients').select('id').eq('email', email).maybeSingle();

      if (existing) {
        clientId = existing.id;
        console.log(`  [EXIST] ${email} — client déjà présent (id: ${clientId})`);
      } else {
        // Créer un utilisateur Supabase Auth (mot de passe aléatoire, à réinitialiser via "mot de passe oublié")
        const { data: authData, error: authErr } = await sb.auth.admin.createUser({
          email,
          password: randomUUID(), // mot de passe temporaire aléatoire
          email_confirm: true,
        });
        if (authErr) throw authErr;
        clientId = authData.user.id;

        const { error: ce } = await sb
          .from('clients')
          .insert([{ id: clientId, prenom: d.prenom || '', nom: d.nom || '', email, telephone: d.telephone || null }]);
        if (ce) throw ce;
        console.log(`  [CREATE CLIENT] ${email} (id: ${clientId})`);
      }

      // Projet
      const nomProjet = `Demande ${d.type_projet ? '— ' + d.type_projet : ''} · ${d.prenom || ''} ${d.nom || ''}`.trim().slice(0, 200);
      const description = [
        d.budget ? `Budget : ${d.budget}` : null,
        d.fichiers ? `Fichiers : ${d.fichiers}` : null,
      ].filter(Boolean).join('\n') || null;

      const { data: newProjet, error: pe } = await sb
        .from('projets')
        .insert([{
          client_id: clientId,
          nom: nomProjet,
          description,
          type: d.type_projet || 'Autre',
          statut: 'En cours',
          created_at: d.created_at,
        }])
        .select('id')
        .single();
      if (pe) throw pe;
      console.log(`  [CREATE PROJET] "${nomProjet}" (id: ${newProjet.id})`);

      // Message
      if (d.message) {
        const { error: me } = await sb
          .from('messages')
          .insert([{ projet_id: newProjet.id, expediteur: 'client', contenu: d.message, lu: false, created_at: d.created_at }]);
        if (me) throw me;
        console.log(`  [CREATE MESSAGE] ok`);
      }

      // Documents : parser "nom → url | nom → url"
      if (d.fichiers) {
        const entries = d.fichiers.split('|').map(s => s.trim()).filter(Boolean);
        for (const entry of entries) {
          const parts = entry.split('→').map(s => s.trim()); // →
          const nom = parts[0] || 'Fichier';
          const url = parts[1];
          if (!url) continue;
          const ext = nom.split('.').pop().toLowerCase();
          const type = ['jpg','jpeg','png','gif','webp'].includes(ext) ? 'image/' + ext
                     : ext === 'pdf' ? 'application/pdf'
                     : 'application/octet-stream';
          await sb.from('documents').insert([{
            projet_id: newProjet.id,
            nom,
            type,
            categorie: 'document',
            url,
            uploade_par: 'client',
            created_at: d.created_at,
          }]);
          console.log(`  [CREATE DOC] ${nom}`);
        }
      }

      created++;
    } catch (err) {
      console.error(`  [ERROR] Demande ${d.id}:`, err.message || err);
      errors++;
    }
  }

  console.log(`\nTerminé — ${created} créés, ${skipped} ignorés, ${errors} erreurs.`);
}

main();
