# Tableau de bord administrateur — Yando

Site web React (Vite + TypeScript) pour superviser l'application à Bamako.

| Page | Contenu |
|---|---|
| Tableau de bord | Chiffres du jour : courses, chiffre d'affaires, commission, attente moyenne, annulations |
| Carte en direct | Chauffeurs en ligne (couleur = gamme) et courses en cours, en temps réel |
| Chauffeurs | Validation : documents, véhicule, valider / refuser / suspendre |
| Courses | Historique, détail du prix, paiement, chronologie, avis |
| Tarifs | Prix par gamme, majoration (1,0 à 2,5), commission, frais et délais |
| Codes promo | Création, suivi des utilisations, désactivation |
| Problèmes | Signalements, courses annulées, courses sans chauffeur |

## Lancer en local (avec les émulateurs)

1. Lancer les émulateurs et le seed (voir le README à la racine).
2. Créer un compte e-mail / mot de passe dans http://127.0.0.1:4000 → Authentication → Add user.
3. Lui donner le rôle admin (copier son UID) :
   ```bash
   cd backend/functions
   npm run set-admin -- <UID>
   ```
   Sous Windows (PowerShell) : `$env:FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099"; npm run set-admin -- <UID>`
4. Lancer le site :
   ```bash
   cd admin-dashboard
   npm install
   npm run dev
   ```
   Ouvrir http://localhost:5173 et se connecter.

Pour voir des chauffeurs sur la carte : `npm run fake-driver` dans `backend/functions`.

## Production

Copier `.env.example` en `.env.local`, mettre `VITE_USE_EMULATORS=false` et la configuration web du projet Firebase, puis `npm run build`. Le dossier `dist/` peut être publié avec Firebase Hosting.
