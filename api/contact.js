// api/contact.js — Fonction serverless Vercel
// Reçoit le formulaire, stocke dans Supabase, envoie email via Resend

export const config = {
  api: {
    bodyParser: false, // on gère manuellement pour supporter les fichiers
  },
};

import { createClient } from '@supabase/supabase-js';
import formidable from 'formidable';
import { Resend } from 'resend';
import fs from 'fs';
import path from 'path';

// ── Clients ──────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const resend = new Resend(process.env.RESEND_API_KEY);

// ── Rate limiting simple (en mémoire, réinitialisé à chaque cold start) ──
const rateLimitMap = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxRequests = 5;

  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return false;
  }

  const entry = rateLimitMap.get(ip);
  if (now - entry.start > windowMs) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return false;
  }

  if (entry.count >= maxRequests) return true;

  entry.count++;
  return false;
}

// ── Helper : parser le formulaire multipart ──────────────────────────
function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({
      maxFileSize: 10 * 1024 * 1024, // 10 Mo par fichier
      maxFiles: 5,
      allowEmptyFiles: true,
      minFileSize: 0,
    });
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

// ── Helper : upload fichier vers Supabase Storage ────────────────────
async function uploadFile(file, demandeId) {
  const ext = path.extname(file.originalFilename || file.newFilename || '');
  const fileName = `${demandeId}/${Date.now()}${ext}`;
  const fileBuffer = fs.readFileSync(file.filepath);

  const { data, error } = await supabase.storage
    .from('fichiers-demandes')
    .upload(fileName, fileBuffer, {
      contentType: file.mimetype || 'application/octet-stream',
      upsert: false,
    });

  if (error) throw error;
  return fileName;
}

// ── Handler principal ────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', 'https://www.kobo-design.fr');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  // Rate limiting
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Trop de requêtes, réessayez dans 15 minutes.' });
  }

  try {
    // Parser le formulaire
    const { fields, files } = await parseForm(req);

    // Extraire les champs (formidable renvoie des tableaux)
    const get = (key) => (Array.isArray(fields[key]) ? fields[key][0] : fields[key]) || '';

    const prenom      = get('prenom').slice(0, 100);
    const nom         = get('nom').slice(0, 100);
    const email       = get('email').slice(0, 200);
    const telephone   = get('telephone').slice(0, 30);
    const type_projet = get('type_projet').slice(0, 100);
    const budget      = get('budget').slice(0, 50);
    const message     = get('message').slice(0, 5000);

    // Validation basique
    if (!prenom || !email || !message) {
      return res.status(400).json({ error: 'Champs obligatoires manquants.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Email invalide.' });
    }

    // Anti-spam honeypot
    if (get('botcheck')) {
      return res.status(200).json({ success: true }); // silencieux
    }

    // ── 1. Enregistrer dans Supabase ──────────────────────────────
    const { data: demande, error: dbError } = await supabase
      .from('demandes')
      .insert([{ prenom, nom, email, telephone, type_projet, budget, message }])
      .select()
      .single();

    if (dbError) throw dbError;

    // ── 2. Upload des fichiers si présents ────────────────────────
    const fichiersUploades = [];
    const filesArray = files.fichiers
      ? Array.isArray(files.fichiers) ? files.fichiers : [files.fichiers]
      : [];

    for (const file of filesArray) {
      if (file.size > 0) {
        const chemin = await uploadFile(file, demande.id);
        fichiersUploades.push(file.originalFilename || chemin);
      }
    }

    // ── 3. Mettre à jour la demande avec les fichiers ─────────────
    if (fichiersUploades.length > 0) {
      await supabase
        .from('demandes')
        .update({ fichiers: fichiersUploades })
        .eq('id', demande.id);
    }

    // ── 4. Envoyer email de notification via Resend ───────────────
    await resend.emails.send({
      from: 'Kobo Design <noreply@kobo-design.fr>',
      to: process.env.CONTACT_EMAIL,
      replyTo: email,
      subject: `Nouveau projet — ${prenom} ${nom} (${type_projet})`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1A1A1A;">
          <div style="background: #1A1A1A; padding: 24px 32px; border-radius: 8px 8px 0 0;">
            <p style="color: #CD3E00; font-weight: 700; font-size: 11px; letter-spacing: 3px; text-transform: uppercase; margin: 0 0 4px;">Kobo Design</p>
            <h1 style="color: #FFFAF0; font-size: 22px; margin: 0;">Nouveau projet reçu</h1>
          </div>
          <div style="background: #F2EDE3; padding: 32px; border-radius: 0 0 8px 8px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr><td style="padding: 8px 0; font-size: 12px; color: #666; font-weight: 700; width: 130px;">Nom</td><td style="padding: 8px 0; font-size: 14px;">${prenom} ${nom}</td></tr>
              <tr><td style="padding: 8px 0; font-size: 12px; color: #666; font-weight: 700;">Email</td><td style="padding: 8px 0; font-size: 14px;"><a href="mailto:${email}" style="color: #CD3E00;">${email}</a></td></tr>
              <tr><td style="padding: 8px 0; font-size: 12px; color: #666; font-weight: 700;">Téléphone</td><td style="padding: 8px 0; font-size: 14px;">${telephone || '—'}</td></tr>
              <tr><td style="padding: 8px 0; font-size: 12px; color: #666; font-weight: 700;">Type de projet</td><td style="padding: 8px 0; font-size: 14px;">${type_projet || '—'}</td></tr>
              <tr><td style="padding: 8px 0; font-size: 12px; color: #666; font-weight: 700;">Budget</td><td style="padding: 8px 0; font-size: 14px;">${budget || '—'}</td></tr>
              ${fichiersUploades.length > 0 ? `<tr><td style="padding: 8px 0; font-size: 12px; color: #666; font-weight: 700;">Fichiers</td><td style="padding: 8px 0; font-size: 14px;">${fichiersUploades.join(', ')}</td></tr>` : ''}
            </table>
            <div style="margin-top: 24px; padding: 20px; background: white; border-radius: 6px; border-left: 3px solid #CD3E00;">
              <p style="font-size: 12px; color: #666; font-weight: 700; margin: 0 0 8px;">Message</p>
              <p style="font-size: 14px; line-height: 1.6; margin: 0; white-space: pre-wrap;">${message}</p>
            </div>
            <div style="margin-top: 20px; text-align: center;">
              <a href="mailto:${email}?subject=Re: Votre projet Kobo Design" style="display: inline-block; background: #CD3E00; color: white; padding: 12px 24px; border-radius: 6px; font-weight: 700; font-size: 13px; text-decoration: none;">Répondre à ${prenom}</a>
            </div>
          </div>
          <p style="text-align: center; font-size: 11px; color: #999; margin-top: 16px;">Kobo Design · 76 Rue Mandron · 33000 Bordeaux</p>
        </div>
      `,
    });

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Erreur contact:', err);
    return res.status(500).json({ error: 'Une erreur est survenue. Veuillez réessayer.' });
  }
}
