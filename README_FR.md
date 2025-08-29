# SOS Safi — Kit prêt à l'emploi (Agent + Admin + Offline + Option Serveur)

Ce dossier contient :
- `agent.html` — application **Agent** (terrain) : scan QR, ajout de bacs, points noirs, **photos offline**, calcul d'itinéraires, export/import.
- `admin.html` — **Dashboard Admin** : import multi-agents, statistiques, carte globale, **génération de missions** (JSON + QR), export global.
- `db.js` — helper **IndexedDB** (stockage des photos offline).
- `manifest.webmanifest`, `sw.js`, `icons/` — PWA (installable, fonctionne hors-ligne après 1re visite).
- `server/` — **API optionnelle** (Node/Express + SQLite + upload photos) pour une vraie synchronisation multi-appareils (si vous la souhaitez).

## Installation rapide (sans serveur)
1. Téléchargez tous les fichiers dans un même dossier (ou servez le dossier via un petit serveur statique).
2. Ouvrez `agent.html` pour les agents, `admin.html` pour les responsables.
3. L'application s'installe comme PWA (icône sur l'écran d'accueil).

> **Note :** en mode 100% local, les données ne se synchronisent pas automatiquement entre appareils. Vous pouvez **Exporter** depuis les agents, puis **Importer** dans `admin.html` pour consolider.

## Mode Serveur (synchronisation)
Si vous voulez la synchro en temps réel entre plusieurs appareils :
```bash
cd server
npm install
node server.js   # API sur http://localhost:3000
```
Endpoints principaux : `/api/login`, `/api/bins`, `/api/black`, `/api/photos`. Authentification par token JWT simple (comptes de démo: `admin/admin`, `agent/agent`).

### Intégration côté front
- Ajoutez une variable `SERVER_URL` et envoyez les modifications (`bins`, `blackSpots` et `photos`) avec `fetch()`.
- Laissez `IndexedDB` actif pour conserver l'**offline** et **resynchroniser** quand internet revient.

## Données & Export
- L'export **inclut les photos** (en DataURL). Si le JSON dépasse ~2 Mo, l'app essaie de créer un **ZIP** (si la librairie JSZip est disponible).
- L'admin peut importer plusieurs fichiers (un par agent), le dashboard va **fusionner** automatiquement en gardant les dernières mises à jour.

## Génération de mission
- Dans `admin.html`, sélectionnez des bacs/points sur la carte (clic / clic droit), donnez un nom et téléchargez `mission.json`.
- Le QR de mission encode le même JSON : imprimez-le, les agents peuvent scanner pour charger la mission (ajout simple côté agent si vous le souhaitez).

## Sécurité & RGPD
- Les photos restent **locales** sauf si vous les exportez ou envoyez vers le serveur.
- Prévoyez une **politique de rétention** (ex: suppression au bout de X jours) selon vos besoins.

Bon déploiement !
