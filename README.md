# UMDC — Un Monde De Chalance

Site de l'album de Noé Mémorable, d'après le design Claude Design « Site UMDC — écran 3D » :
un îlot de sable sur une eau miroir, sous un ciel bleu à cumulus, le collier scanné et la cartouche de verre
avec son DVD en 3D (Three.js), panneaux Réseaux / Rejoindre / Écouter, et un back-office
pour tout piloter.

- **Front** : Vite, Three.js r149 (la version du design, pour un rendu identique), JS sans framework.
- **API** : Node ≥ 22.13 + Express, base SQLite intégrée à Node (`node:sqlite`, rien à compiler).

## Démarrer

```bash
npm install
npm run dev
```

- Site : <http://localhost:5173>
- Back-office : <http://localhost:5173/admin/> — mot de passe `umdc` en développement.

## Mettre en ligne

Sur un hébergement Node (VPS, Render, Railway, Fly…) :

```bash
npm ci
npm run build
cp .env.example .env    # puis mets un vrai ADMIN_PASSWORD dedans
npm start               # http://localhost:3000
```

Variables, dans un fichier `.env` à la racine (lu par `npm start`) ou dans l'environnement (voir `.env.example`) :

| Variable | Rôle |
| --- | --- |
| `ADMIN_PASSWORD` | **Obligatoire en production.** Mot de passe du back-office. |
| `PORT` | Port d'écoute (3000 par défaut). |
| `DATA_DIR` | Dossier de la base et des sons (`data/` par défaut). **Doit être persistant** (volume/disque) : c'est là que vivent les emails. |
| `TRUST_PROXY` | `true` derrière un proxy (Nginx, Render…) pour que la limite d'essais se base sur la vraie IP. |

Sers le site en HTTPS : le cookie de session admin est `Secure` en production.

Sauvegarde : il suffit de copier le dossier `DATA_DIR` (`umdc.sqlite` + `audio/`).

## Le back-office

| Onglet | Ce qu'on y fait |
| --- | --- |
| **Textes** | Tous les textes du site : nom de l'artiste (sous le logo), accueil, menu, panneaux, newsletter, confidentialité. |
| **Réseaux** | Ajouter, renommer, réordonner, retirer les réseaux (nom, compte, URL). |
| **Sortie & tracklist** | Ouverture d'« Écouter » (automatique à une date, forcée ouverte, forcée fermée), titre de l'album, plateformes, titres (feat., durée, son associé, en ligne ou non). |
| **Sons** | Envoyer les fichiers audio (glisser-déposer, 60 Mo max), les écouter, les supprimer. |
| **Emails** | Les inscrits, recherche, suppression, export CSV, copie des adresses. |

`Ctrl/Cmd + S` enregistre. Rien ne change sur le site avant « Enregistrer ».

### Avant la sortie, rien ne fuit

Tant que la sortie n'est pas active, l'API publique ne renvoie ni titres, ni
plateformes, ni sons, et `/api/audio/…` répond 404. En mode automatique, une
page déjà ouverte se met à jour seule à l'heure de sortie. L'admin connecté peut
écouter les sons à tout moment.

### Les emails

Chaque inscription garde l'adresse et la date du consentement (case obligatoire).
Une adresse déjà inscrite ne crée pas de doublon. L'export CSV (UTF-8 avec BOM)
s'ouvre dans Excel et s'importe dans Brevo ou Mailchimp. Aucun mail n'est envoyé
automatiquement.

## Structure

```
index.html            page du site
admin/index.html      page du back-office
src/site/             scène 3D (scene.js), interface (main.js), son d'ambiance, styles
src/admin/            back-office
src/shared/           jetons et composants du design system UMDC
server/               API Express, SQLite, contenu par défaut
public/               polices, logos, collier (géométrie binaire + textures), ciel, son d'ambiance
```

Les assets viennent du canvas Claude Design. La géométrie du collier, livrée en
base64 dans un script, est convertie en binaire (`public/models/collier.bin` :
en-tête de 8 octets — nombre de sommets, nombre d'indices — puis positions
`float32×3`, uv `float32×2`, indices `uint16`).

Le ciel est « Kloofendal 48d Partly Cloudy (Pure Sky) » de Poly Haven (CC0), moitié haute,
étalonnée plus bleue et plus contrastée (`public/textures/sky-blue-8k.jpg`, 8192 px ; `sky-blue.jpg`,
4096 px, pour les téléphones et les cartes graphiques limitées). Le shader fait onduler doucement
les nuages (une seule lecture de l'image, pour rester net), dessine un soleil
posé sur l'horizon (celui de la photo est trop haut pour être dans le cadre) avec halo et une colonne de lumière
qui monte dans le ciel et se prolonge dans l'eau (`sunPillar`), et des valeurs « HDR » pour les reflets du verre et du disque.
L'eau est un miroir façon salar d'Uyuni : à peine ridée près de l'îlot, parfaitement plate vers l'horizon,
où elle rejoint le ciel sans ligne ni brume (effet infini).
Si l'image ne charge pas, la scène repasse aux nuages peints du design.

La cartouche est un bloc de verre transparent, avec le DVD visible à l'intérieur : une face très épurée,
juste le logo et le collier avec ses perles. La jaquette et l'obi essayés un temps ne sont plus utilisés ;
leurs sources restent dans `design/jaquette/` (et les textures dans `public/textures/`) pour y revenir.

Le son est allumé par défaut : `public/audio/ambient.m4a`, l'extrait d'« Échos des plaines », part au premier clic
(ou toucher) n'importe où sur la page, les navigateurs n'autorisant le son qu'après un geste. Il commence à 5 s du début
du morceau en fondu, s'efface en fondu avant la fin puis reprend à 5 s, en boucle (`LEVEL`, `START_AT`, `FADE_IN`,
`FADE_OUT` dans `src/site/sound.js`). Le bouton « Son » le coupe.
L'extrait, choisi dans le design, est public, même avant la sortie.

Police du site public : Condor Medium partout (licence commerciale à acquérir auprès de son créateur ; le fichier
actuel vient de la version d'essai). Le back-office garde IBM Plex Mono (SIL OFL, licence dans `public/fonts/`).

Un toucher sur le collier le montre en gros plan (un autre toucher, « Revenir » ou Échap pour revenir). Sur téléphone,
le menu est une barre en bas de l'écran et la scène passe sous les barres du navigateur.
