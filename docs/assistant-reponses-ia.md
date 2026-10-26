# Assistant de réponses (messagerie de l'admin)

Dans chaque zone de réponse de l'admin, « ✨ Aide à la réponse » :
- **sans IA** : les boutons Oui / Non / Oui avec supplément / Je vérifie / Délai composent un modèle de phrase ;
- **avec IA** (si une clé est configurée) : tape un mot ou deux (« oui, 40 € par porte ») puis Entrée, l'IA rédige le message à partir de la question du client. Si l'IA est indisponible (quota, clé refusée), le modèle de phrase est utilisé à la place.

Dans les deux cas c'est un **brouillon** : il arrive dans la zone de réponse, rien n'est envoyé au client sans ton clic.

## Activer l'IA gratuite (2 minutes)
1. Crée une clé gratuite :
   - **Groq** : https://console.groq.com → API Keys → Create API Key (variable `GROQ_API_KEY`) ;
   - ou **Google Gemini** : https://aistudio.google.com → Get API key (variable `GEMINI_API_KEY`).
2. Vercel → le projet → Settings → Environment Variables → ajoute la variable (Production) → Redeploy.
3. Facultatif : `IA_FOURNISSEUR` = `groq` ou `gemini` (si les deux clés existent), `IA_MODELE` pour changer de modèle.
(`ANTHROPIC_API_KEY` fonctionne aussi, mais l'API de Claude est payante.)

## Vie privée
Ce qui part vers l'IA : la question du client et les derniers messages, le nom du projet, son statut et sa description, un résumé du meuble, et ta consigne.
Jamais envoyés : e-mail, téléphone, nom, prénom (remplacés par des étiquettes, le prénom est remis après coup dans ton brouillon).
Les offres gratuites des fournisseurs peuvent utiliser les données envoyées pour améliorer leurs services : vérifie leur politique avant de choisir.
