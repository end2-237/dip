# Journal des versions de DIP

Chaque version est un tag Git (`vX.Y.Z`). Pour récupérer une version précise :
`https://github.com/end2-237/dip/archive/refs/tags/vX.Y.Z.zip`.

Les versions sont publiées automatiquement (onglet **Releases** du dépôt) par le workflow
`.github/workflows/release.yml` : pour une nouvelle version, ajouter une ligne à `.github/releases.json`
et une section ici, puis pousser sur `main`. Le zip de l'extension est joint à la dernière release.

La **version de l'analyseur** (affichée dans Réglages) décide du badge « ancienne version » des sites de la
bibliothèque : elle ne change que lorsqu'une redissection apporte vraiment de nouvelles mesures.

## v0.3.2 — Bibliothèque synchronisée et guide
- Après une mise à jour, le tableau de bord réécrit tout seul les commandes `/dip-*`, les skills,
  `QUALITY_RULES.md` et l'index de la bibliothèque (une fois par version). Scans, analyses, sites, ADN,
  `LESSONS.md` et catégories ne sont jamais touchés.
- Le script de mise à jour définit `DIP_HOME` (Claude Code trouve `dip-review`, `dip-assets`… depuis n'importe
  quel dossier) et installe le navigateur des outils en ligne de commande.
- Nouvelle page **Guide** dans le tableau de bord (accessible même sans bibliothèque) et tutoriel complet
  `docs/TUTORIEL.md`.

## v0.3.1 — Mises à jour en une commande
- Le tableau de bord et le panneau signalent quand une nouvelle version est publiée (bandeau « disponible »,
  bouton **Copier la commande**, bouton **Recharger DIP**, lien vers les nouveautés).
- `scripts/update-dip.ps1` : met à jour l'extension et les outils dans `D:\DIP` en une commande PowerShell :
  `irm https://raw.githubusercontent.com/end2-237/dip/main/scripts/update-dip.ps1 | iex`
  (garde `node_modules`, relance `npm install`, affiche la version installée).
- Réglages → Version de DIP → **Vérifier**.

## v0.3.0 — Qualité, analyse ciblée, catégories (analyseur 0.2.0)
- **Catégories d'inspiration** : secteur, style, techniques ; filtres, correction manuelle, favoris,
  chiffres par secteur dans `PATTERNS.md`, références choisies par secteur et style.
- **Collecte** : scan d'une liste d'adresses à la suite, sources de sites premium, couverture par secteur.
- **Analyse ciblée d'une animation** : on entoure une zone, DIP la rejoue sous tous les angles, crée une
  fiche (`effects/`), et `/dip-effect` la complète (nom, recherches web, recette, démo).
- **dip-review** : contrôle qualité d'un site construit (zones vides, menu sur le texte, hero figé,
  sections sans animation, mobile, richesse minimale : sections, récit, visuels, appels à l'action).
- **Règles de qualité** (`QUALITY_RULES.md`), **leçons** (`LESSONS.md`), **patterns** de la bibliothèque
  (`PATTERNS.md`), section **Sites** du tableau de bord, commande `/dip-review`, Skill `premium-qa`.
- Corrections issues du scan de kalibre (identifiants de sections, balayage des survols, points clignotants).

## v0.2.0 — Décors, compositions, interactions, redissection
- Changements de décor au scroll, zoom « à travers », médias qui s'agrandissent.
- Compositions d'images (spirale, cercle, éventail, pile, collage).
- Survols CSS et titres, clics sans quitter la page, glisser avec inertie.
- Redissection en un clic des sites analysés avec une ancienne version (l'ADN est conservé).
- Bibliothèque d'effets en cartes avec aperçus et courbes.
- Skills Claude Code : blender-web-3d (Blender piloté par script), three-premium, motion-premium,
  art-direction, asset-pipeline.

## v0.1.2 — Création et tableau de bord
- Bibliothèque (`dip-library`), images et objets 3D (`dip-assets`, fal.ai), `/dip-clone`.
- Tableau de bord « Studio » : dossier de bibliothèque, vue d'ensemble, bibliothèque, animations, créer.

## v0.1.1 — 3D et interactions
- Mouvement 3D (caméra, objets, boucles, souris), appui long, menus, accordéons, onglets.
- Commandes Claude Code `/dip-dna`, `/dip-transform`, `/dip-create`.
- Corrections issues du premier vrai site (cerebrium.ai) et de la première reconstruction.

## v0.1.0 — Première version utilisable
- Extension Chrome (Deep / Standard), scan guidé, analyse, Reproduction Pack.
- `dip-capture` (même scan en ligne de commande) et `dip-verify` (boucle de fidélité).
