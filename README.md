# UMDC — Un Monde De Chalance®

Site d'album en HTML / CSS / JavaScript, repris du design Figma, avec un
back-office pour tout piloter (réseaux, newsletter, sons, date de sortie).

Aucune dépendance à installer : le serveur est un seul fichier Node.

---

## Démarrer

```bash
node server.js
```

- Site : <http://localhost:3000>
- Back-office : <http://localhost:3000/admin>

Le mot de passe du back-office vaut `umdc` par défaut. **Change-le** avant de
mettre le site en ligne :

```bash
UMDC_ADMIN_PASSWORD="ton-mot-de-passe" node server.js
```

Autres réglages : `PORT=8080 node server.js`.

---

## Les trois options du menu

| Entrée | Ce qu'elle ouvre |
| --- | --- |
| `>RÉSEAUX` | Instagram, X.com, et tout réseau ajouté plus tard |
| `>REJOINDRE` | Le champ email qui inscrit à la newsletter |
| `>EMAIL` | L'adresse de contact (booking, presse) |
| `>ÉCOUTER` | **N'apparaît que le jour de la sortie** : plateformes + lecture des sons |

Chaque entrée peut être renommée, masquée ou réordonnée depuis le back-office
(onglet « Textes & menu »).

---

## Le jour de la sortie

Onglet **Sortie & écoute** du back-office, trois modes :

- **Automatique** — l'onglet `>ÉCOUTER` s'ouvre tout seul à la date et l'heure
  indiquées. Une page déjà ouverte se rafraîchit d'elle-même au moment J.
- **Forcer l'ouverture** — pour un test ou une sortie anticipée.
- **Forcer la fermeture** — pour refermer quoi qu'il arrive.

Tant que la sortie n'est pas active, le serveur ne renvoie **ni les liens de
plateformes, ni les URL des fichiers audio** — même à quelqu'un qui inspecterait
les requêtes réseau. Rien ne fuite avant l'heure.

### Mettre les sons

Onglet **Sons** :

1. Dépose les fichiers (mp3, m4a, wav, ogg — 25 Mo max chacun) dans la zone
   prévue. Mets des extraits si tu ne veux pas diffuser les morceaux entiers.
2. Déplie une piste (bouton `▾`), choisis son fichier dans la liste, et colle
   au besoin le lien direct du titre sur chaque plateforme.
3. Décoche « en ligne » pour garder une piste muette le jour J.

Sur le site, une piste avec un son devient cliquable dans `>ÉCOUTER` et se joue
dans un lecteur en bas d'écran, avec ses liens par plateforme.

### Les plateformes

Onglet **Sortie & écoute**, en bas : Spotify, Apple Music, Deezer, YouTube sont
déjà là — il suffit de coller l'URL de l'album. Une plateforme sans URL
n'apparaît pas. Tu peux en ajouter d'autres et les réordonner.

---

## Les emails de la newsletter

Ils arrivent dans `data/subscribers.json`. L'onglet **Emails** du back-office
les liste, les exporte en CSV et permet de tout effacer.

---

## Organisation des fichiers

```
server.js              serveur + API (zéro dépendance)
data/site.json         tout le contenu du site
data/subscribers.json  les inscrits à la newsletter
public/
  index.html           le site
  admin.html           le back-office
  css/ js/             styles et scripts
  assets/              le lettrage UMDC exporté de Figma
  audio/               les fichiers déposés depuis le back-office
```

### API

| Route | Usage |
| --- | --- |
| `GET /api/site` | Contenu public (filtré selon l'état de la sortie) |
| `POST /api/subscribe` | Inscription newsletter `{ "email": "…" }` |
| `GET·PUT /api/admin/site` | Lecture / écriture de la configuration |
| `GET·POST·DELETE /api/admin/audio` | Bibliothèque audio |
| `GET·DELETE /api/admin/subscribers` | Inscrits |

Les routes `/api/admin/*` exigent l'en-tête `x-umdc-key`.

---

## Mettre en ligne

**Avec Node** (recommandé — newsletter, back-office et bascule automatique à la
date fonctionnent) : n'importe quel hébergeur Node (Railway, Render, Fly, un
VPS). Sers le dossier derrière HTTPS et définis `UMDC_ADMIN_PASSWORD`.

**En statique** (Netlify, GitHub Pages, un simple FTP) :

```bash
node server.js export   # écrit public/site.json
```

Puis déploie le dossier `public/`. Le site s'affiche et joue les sons, mais :

- la newsletter bascule sur un `mailto:` vers l'adresse de contact ;
- il n'y a pas de back-office en ligne ;
- **il faut relancer l'export et redéployer le jour de la sortie** — l'état est
  figé au moment de l'export.

---

## Notes de conversion depuis Figma

Le lettrage `UMDC / UN MONDE DE CHALANCE®` est l'export SVG d'origine
(`public/assets/logo-umdc.svg`), utilisé tel quel.

Le menu et la tracklist étaient vectorisés dans la maquette (du texte converti
en contours). Ils sont redevenus du vrai texte, parce qu'ils doivent être
modifiables depuis le back-office et accueillir l'onglet `>ÉCOUTER` le jour J.
Les exports d'origine restent dans `public/assets/` sous le suffixe
`-figma-reference` pour comparaison.

### La police

La maquette utilise **Condor** (Type Network). Le fichier `Condor Medium.otf`
fourni est installé en `public/assets/fonts/condor-medium.woff2` et déclaré en
tête de `public/css/site.css`. Toute la mise en page est calée sur sa hauteur de
capitale (738/1000), donc remplacer la police suffit à tout réaligner.

Deux limites de ce fichier précis :

1. **C'est une version d'essai.** Elle contient A-Z et a-z, rien d'autre : pas
   de chiffres, pas de lettres accentuées, pas de « > ». La numérotation des
   pistes, les sept titres accentués (ÉCHOS, LA MARÉE, CANOPÉE, MÉMO, SPÉCIMEN,
   LA DERNIÈRE FOIS, RÉSEAUX) et les chevrons du menu retombent sur Archivo,
   réglé au plus près (`wdth 84 / wght 500`).
2. **Ce n'est pas la bonne graisse.** Les fûts de la maquette mesurent 0,273 fois
   la hauteur de capitale, ceux de Condor Medium 0,202 : le design est environ
   35 % plus gras — c'est un Condor Bold ou Black, probablement dans une chasse
   plus étroite. Les chasses de ligne, elles, correspondent à 1,2 % près, ce qui
   confirme la famille.

Son champ de licence indique « All rights reserved. For TN use only » et ses
bits d'embarquement (`fsType 4`) n'autorisent que l'aperçu et l'impression :
il faut un kit web sous licence pour une mise en ligne.

Pour passer au fichier définitif : dépose le `.woff2` dans
`public/assets/fonts/`, change le `src` du `@font-face` en tête de
`public/css/site.css`, et ajuste `font-weight` dans la règle `body` juste en
dessous. Rien d'autre à toucher.

La grille (593 | 24 | 432 px sur 1280), le pas de 36,63 px entre les lignes et
le calage du menu sur les pistes 1, 3, 5 et 7 sont repris au pixel.
