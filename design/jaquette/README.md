# Jaquette et obi de la cartouche

> Plus utilisées sur le site (la cartouche est redevenue du verre transparent). Gardées pour pouvoir y revenir.

Deux images, chacune une page HTML photographiée dans Chrome :

| Image | Source | Taille |
| --- | --- | --- |
| `public/textures/jaquette.jpg` | `jaquette.html` | 2048 × 2048 |
| `public/textures/obi.jpg` | `obi.html` | 1456 × 2048 |

- **La jaquette** (titre UMDC, collier en illustration, katakana, code-barres décoratif) épouse l'intérieur
  de la face avant du verre, arrondis compris : elle couvre toute la largeur de la cartouche. La bande blanche
  à gauche est cachée par l'obi ; les 10 % du bord passent sur les arrondis du verre.
- **L'obi** est une bande qui fait le tour de la tranche gauche. De gauche à droite dans l'image :
  dos (366 px) | arrondi + tranche + arrondi (724 px) | face avant (366 px).
- `collier-detoure.png` : le collier 3D vu de dessus, détouré, produit par `collier-rendu.html`.

Polices : Condor et IBM Plex Mono (`public/fonts/`), Noto Sans / Serif CJK JP (polices système),
Mrs Saint Delafield (Google Fonts, SIL OFL) pour la signature manuscrite.

Pour les refaire : servir la racine du projet (`python3 -m http.server` depuis `umdc/`), ouvrir
`/design/jaquette/jaquette.html` (ou `obi.html`) dans Chrome à la taille indiquée, capturer la page
en taille réelle, puis l'enregistrer en JPEG dans `public/textures/`.
