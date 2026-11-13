# Yando — Application VTC Bamako

Application de transport avec chauffeur pour Bamako : app passager, app chauffeur (Flutter) et tableau de bord administrateur.

| Dossier | Contenu | Responsable |
|---|---|---|
| `backend/` | Firebase : Cloud Functions, règles de sécurité, données de départ | Backend |
| `mobile/` | Applications Flutter passager et chauffeur | Front |
| `admin-dashboard/` | Tableau de bord web (à venir) | Backend |
| `docs/API.md` | **Contrat entre les apps et le serveur** — à lire en premier | Les deux |

## Backend : démarrer en local (sans compte payant)

Prérequis : Node.js 22, Java 11+ (pour les émulateurs), Firebase CLI.

```bash
npm install -g firebase-tools
cd backend/functions
npm install
npm test                 # tests de la formule de prix

cd ../..
firebase emulators:start --project demo-vtc-bamako
```

Dans un autre terminal, remplir la base de test :

```bash
cd backend/functions
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run seed
```

Sous Windows (PowerShell) :

```powershell
$env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"; npm run seed
```

Interface des émulateurs : http://127.0.0.1:4000

### Tests avec les émulateurs (règles de sécurité + course complète)

```bash
cd backend/functions
npm run test:emulator
```

Les émulateurs démarrent et s'arrêtent tout seuls.

### Faux chauffeur (pour tester l'app passager sans vrai chauffeur)

Avec les émulateurs lancés et le seed fait :

```bash
cd backend/functions
npm run fake-driver                 # moto, accepte toutes les courses
npm run fake-driver -- standard     # autre gamme
npm run fake-driver -- moto --refuse
```

Il se met en ligne près du Grand Marché, accepte la course, roule jusqu'au passager, démarre avec le PIN, roule jusqu'à la destination et termine. Ctrl+C pour l'arrêter.

Donner le rôle admin à un compte de test :

```bash
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm run set-admin -- <uid>
```

## Ce qui est fait

- Estimation du prix en FCFA (formule du cahier des charges, arrondi à 25, majoration 1,0 à 2,5)
- Commande avec prix recalculé côté serveur, code promo, code PIN à 4 chiffres
- Attribution automatique au chauffeur le plus proche (geohash), 15 s pour accepter, puis chauffeur suivant
- Acceptation sécurisée (un seul chauffeur peut gagner), arrivée, démarrage par PIN (5 essais), fin de course
- Commission (15 % par défaut), gains du jour du chauffeur, annulation avec frais, note et pourboire
- Lien de suivi partageable
- Validation des chauffeurs par l'admin
- Règles de sécurité Firestore, Realtime Database et Storage

## À faire

- [ ] Brancher Orange Money / Moov Money (agrégateur à choisir) — `payments/mobileMoney.ts`
- [ ] Lancer `npm run test:emulator` sur un PC (pas encore exécuté)
- [ ] Tableau de bord admin
- [ ] Remplacer les tarifs de test (`backend/seed/pricing.json`) par les tarifs validés
- [ ] Vérifier les coordonnées des repères (`backend/seed/landmarks.json`)
- [ ] Connexion de secours si le SMS n'arrive pas

## Mise en ligne (plus tard)

Créer un projet Firebase (plan Blaze, nécessaire pour les fonctions), remplacer `demo-vtc-bamako` dans `.firebaserc`, puis :

```bash
firebase deploy
```
