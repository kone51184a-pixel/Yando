# Échanges entre les applications et le serveur

Ce document est le contrat entre le **front Flutter** (apps passager et chauffeur) et le **backend Firebase**.
Toute modification se discute à deux avant d'être codée.

- Région des fonctions : `europe-west1`
- Monnaie : FCFA (`XOF`), montants **entiers**, arrondis à 25
- Projet de développement (émulateurs) : `demo-vtc-bamako`

---

## 1. Appeler une fonction depuis Flutter

```dart
final functions = FirebaseFunctions.instanceFor(region: 'europe-west1');
// En dev, avec les émulateurs :
// functions.useFunctionsEmulator('10.0.2.2', 5001); // 10.0.2.2 = PC vu depuis l'émulateur Android

final res = await functions.httpsCallable('estimatePrice').call({
  'pickup': {'lat': 12.6497, 'lng': -8.0003},
  'dropoff': {'lat': 12.6230, 'lng': -8.0230},
});
final data = res.data as Map;
```

En cas d'erreur, Flutter reçoit une `FirebaseFunctionsException` avec un `code` (liste en section 7) et un `message` en français, affichable tel quel.

---

## 2. Valeurs communes

| Nom | Valeurs |
|---|---|
| `vehicleClass` | `moto`, `standard`, `confort` |
| `paymentMethod` | `cash`, `orange_money`, `moov_money` |
| Lieu (`Place`) | `{ lat, lng, label, landmarkId? }` — `label` = nom du repère ou "Point sur la carte" |

### Statuts d'une course (`rides/{id}.status`)

```
searching ──► driver_assigned ──► driver_arrived ──► in_progress ──► completed
    │                │                  │
    ├──► no_driver   └──────────────────┴──► cancelled
    └──► cancelled
```

| Statut | Écran passager | Écran chauffeur |
|---|---|---|
| `searching` | Recherche d'un chauffeur | Proposition (si `offer.driverId` = moi) |
| `driver_assigned` | Fiche chauffeur + suivi sur la carte + PIN | Navigation vers le passager |
| `driver_arrived` | « Votre chauffeur est là » + PIN | Saisie du PIN |
| `in_progress` | Course en cours, partage du trajet | Navigation vers la destination |
| `completed` | Reçu, note, pourboire | Encaissement, gains |
| `cancelled` / `no_driver` | Message + bouton « Recommander » | Retour à l'attente |

---

## 3. Fonctions — application passager

### `estimatePrice`
Entrée :
```json
{ "pickup": {"lat": 12.6497, "lng": -8.0003}, "dropoff": {"lat": 12.623, "lng": -8.023} }
```
Sortie :
```json
{
  "distanceKm": 4.8, "durationMin": 14, "routeSource": "osrm", "surge": 1, "currency": "XOF",
  "estimates": [
    {"vehicleClass": "moto", "price": 1225},
    {"vehicleClass": "standard", "price": 2050},
    {"vehicleClass": "confort", "price": 2975}
  ]
}
```
`routeSource` = `estimation` si le service d'itinéraire n'a pas répondu : le prix reste valable.

### `createRide`
Entrée :
```json
{
  "pickup":  {"lat": 12.6497, "lng": -8.0003, "label": "Grand Marché", "landmarkId": "grand-marche"},
  "dropoff": {"lat": 12.623,  "lng": -8.023,  "label": "ACI 2000"},
  "vehicleClass": "standard",
  "paymentMethod": "cash",
  "promoCode": "BIENVENUE"
}
```
Sortie : `{ "rideId": "abc123", "price": 1550, "discount": 500 }`

Ensuite, l'app **écoute** `rides/{rideId}` en temps réel (`snapshots()`). La recherche du chauffeur démarre toute seule côté serveur.
Le **PIN** se lit dans `rides/{rideId}/private/pin` → `{ "pin": "4821" }` (seul le passager y a accès).

Erreur `failed-precondition` avec `details.rideId` : le passager a déjà une course en cours → ouvrir cette course.

### `cancelRide`
Entrée : `{ "rideId": "abc123", "reason": "Trop d'attente" }`
Sortie : `{ "ok": true, "cancellationFee": 0 }` (frais > 0 si annulation après le délai gratuit, une fois le chauffeur attribué)

### `rateRide`
Entrée : `{ "rideId": "abc123", "stars": 5, "tip": 200, "comment": "Très bien" }`
`stars` entier de 1 à 5 ; `tip` entier de 0 à 10 000 (boutons 100 / 200 / 500 conseillés).

### `createShareLink`
Entrée : `{ "rideId": "abc123" }` → Sortie : `{ "token": "9f2c…" }`
Lien à partager : `https://europe-west1-<projet>.cloudfunctions.net/sharedTrip?t=<token>` (JSON pour l'instant ; une petite page web viendra plus tard).

### `initiateMobileMoneyPayment` *(pas encore branché)*
Entrée : `{ "rideId": "abc123" }`. Renvoie pour l'instant l'erreur `unimplemented` → proposer les espèces.

---

## 4. Fonctions — application chauffeur

Toutes exigent un compte chauffeur **validé par l'admin**. Après la validation, l'app doit appeler
`FirebaseAuth.instance.currentUser!.getIdToken(true)` pour recevoir ses droits.

| Fonction | Entrée | Quand |
|---|---|---|
| `acceptRide` | `{ rideId }` | Le chauffeur accepte la proposition (avant la fin des 15 s) |
| `declineRide` | `{ rideId }` | Il refuse → la course part au chauffeur suivant |
| `driverArrived` | `{ rideId }` | Arrivé au point de départ |
| `startRide` | `{ rideId, pin: "4821" }` | Saisie du code du passager. 5 essais max |
| `completeRide` | `{ rideId }` | Fin de course → `{ ok, price, driverEarnings }` |
| `cancelRide` | `{ rideId, reason? }` | Annulation avant le démarrage |

### Recevoir une proposition de course
1. Notification push FCM `data.type = "ride_offer"`, `data.rideId`, `data.expiresAt` (ms).
2. **En plus** (si la notification n'arrive pas), écouter :
   `rides.where('offer.driverId', isEqualTo: myUid).where('status', isEqualTo: 'searching')`
3. Afficher le compte à rebours jusqu'à `offer.expiresAt`.

### Envoyer sa position — Realtime Database (pas Firestore)
Chemin : `driverLocations/{driverUid}`
```json
{ "lat": 12.6497, "lng": -8.0003, "g": "efr3x…", "heading": 90, "online": true, "vehicleClass": "moto", "ts": 1763000000000 }
```
- `g` = geohash, calculé avec le package `geoflutterfire_plus` ou `dart_geohash` (précision 9 à 10).
- `ts` = `DateTime.now().millisecondsSinceEpoch`.
- Fréquence : **toutes les 10 s ou tous les 50 m**, pas plus (forfaits internet). Toutes les 5 s pendant une course.
- Hors ligne : écrire `online: false` (ne pas supprimer le nœud).
- Utiliser `onDisconnect().update({'online': false})` pour passer hors ligne automatiquement si le réseau coupe.
- Une position de plus de 90 s est ignorée par la recherche.

### Revenus du jour
Lire `drivers/{uid}/dailyStats/{AAAA-MM-JJ}` → `{ rides, earnings }`.

---

## 5. Données lues/écrites directement par les apps

| Chemin | Lecture | Écriture par l'app |
|---|---|---|
| `users/{uid}` | soi-même | création : `name, phone, fcmToken, language, createdAt` ; mise à jour : `name, fcmToken, language` |
| `drivers/{uid}` | soi-même | inscription avec `status: "pending"` ; ensuite seulement `name, photoUrl, fcmToken, documents, vehicle` |
| `rides/{id}` | passager, chauffeur, chauffeur sollicité | **jamais** (fonctions uniquement) |
| `rides/{id}/messages` | les deux participants | `{ senderId, text, quick, createdAt: serverTimestamp }`, 500 caractères max, course active |
| `payments/{rideId}` | passager, chauffeur | jamais |
| `pricing/{gamme}`, `config/app`, `landmarks` | tout utilisateur connecté | jamais (admin) |
| `reports` | son signalement | `{ reporterId, rideId?, text }` |
| `driverLocations/{uid}` (RTDB) | tout utilisateur connecté | le chauffeur validé, sa propre position |

### Inscription chauffeur
```json
drivers/{uid} = {
  "name": "Moussa Traoré", "phone": "+223…", "photoUrl": "…",
  "vehicleClass": "moto",
  "vehicle": { "model": "Jakarta 125", "color": "Rouge", "plate": "AB-1234-MD" },
  "documents": { "license": "drivers/{uid}/documents/permis.jpg", "idCard": "…", "vehicleDocs": "…" },
  "status": "pending", "createdAt": <serverTimestamp>
}
```
Fichiers dans Storage : `drivers/{uid}/documents/…` (image ou PDF, 5 Mo max). Photo de profil : `profiles/{uid}/…` (2 Mo max).

### Messages rapides du chat
`quick` = `"on_my_way"`, `"arrived"`, `"luggage"`, `"call_me"` ou `null` pour un message libre. Le texte est traduit côté app.

---

## 6. Notifications push (`data.type`)

| Type | Destinataire | Signification |
|---|---|---|
| `ride_offer` | chauffeur | nouvelle proposition (15 s) |
| `driver_assigned` | passager | chauffeur trouvé |
| `driver_arrived` | passager | chauffeur au point de départ |
| `ride_completed` | passager | course terminée |
| `ride_cancelled` | l'autre partie | annulation |
| `no_driver` | passager | personne n'a accepté |
| `driver_approved` / `driver_rejected` | chauffeur | décision de l'admin |

Le token FCM est enregistré par l'app dans `users/{uid}.fcmToken` ou `drivers/{uid}.fcmToken`.

---

## 7. Codes d'erreur

| Code | Exemple |
|---|---|
| `unauthenticated` | pas connecté |
| `permission-denied` | pas sa course, code PIN incorrect, compte chauffeur non validé |
| `invalid-argument` | champ manquant ou mal formé |
| `out-of-range` | point en dehors de Bamako |
| `failed-precondition` | course déjà en cours, statut incorrect |
| `deadline-exceeded` | 15 s dépassées pour accepter |
| `not-found` | course ou code promo introuvable |
| `already-exists` | code promo déjà utilisé, course déjà notée |
| `resource-exhausted` | code promo épuisé, trop d'essais de PIN |
| `unimplemented` | Mobile Money pas encore disponible |

---

## 8. Hors ligne / réseau faible (côté app)

- Firestore garde les données en cache : la course en cours s'affiche même sans réseau.
- Les appels de fonctions ne marchent pas sans réseau : afficher « Connexion en cours… » et réessayer.
- L'écoute `snapshots()` reprend toute seule quand le réseau revient.
