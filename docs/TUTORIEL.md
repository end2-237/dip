# Tutoriel DIP — du premier scan au site premium

DIP comporte trois éléments, chacun dans son propre dossier :

| Élément | Où | Rôle | Mis à jour par |
|---|---|---|---|
| **DIP** (extension + outils) | `D:\DIP` | scanner, analyser, contrôler | la commande de mise à jour |
| **Bibliothèque** | ex. `D:\DIP-Library` | tes scans, effets, sites construits, commandes Claude Code | toi et DIP, jamais écrasée |
| **Claude Code** | ouvert dans la bibliothèque | écrire les ADN, créer, construire, corriger | ton abonnement Claude |

---

## 1. Installer (une seule fois, 5 minutes)

1. Installe **Node.js** (version LTS) depuis nodejs.org si ce n'est pas déjà fait.
2. Ouvre **PowerShell** et colle :
   ```powershell
   irm https://raw.githubusercontent.com/end2-237/dip/main/scripts/update-dip.ps1 | iex
   ```
   DIP s'installe dans `D:\DIP`, avec les outils en ligne de commande et leur navigateur.
   La variable `DIP_HOME` est définie pour que Claude Code trouve les outils.
   Pour un autre emplacement, lance d'abord `$env:DIP_HOME = "E:\Outils\DIP"`.
3. Dans Chrome : `chrome://extensions` → active **Mode développeur** → **Charger l'extension non
   empaquetée** → choisis `D:\DIP\extension`. Épingle l'icône DIP.
4. Clique l'icône DIP → bouton ▦ → le **tableau de bord** s'ouvre. Choisis le dossier de ta bibliothèque
   (un dossier vide, par exemple `D:\DIP-Library`, ou ta bibliothèque existante).

> **DIP est déjà installé ailleurs (par exemple `D:\Projets\dip`) ?** Ne déplace rien : mets-le à jour sur place.
> ```powershell
> $env:DIP_HOME = "D:\Projets\dip"   # le dossier qui contient extension\
> irm https://raw.githubusercontent.com/end2-237/dip/main/scripts/update-dip.ps1 | iex
> ```
> Puis clique ↻ sur DIP dans `chrome://extensions`. L'extension garde son identité : dossier de bibliothèque,
> réglages et clé restent en place. Le dossier est mémorisé pour les mises à jour suivantes.
> Tes dissections sont dans ta **bibliothèque** (le dossier choisi dans le tableau de bord), pas dans le dossier de
> DIP : aucune mise à jour ne les touche.

## 2. Mettre à jour

Quand une nouvelle version sort, un bandeau apparaît dans le tableau de bord et dans le panneau latéral.

1. **Copier la commande** → colle-la dans PowerShell.
2. **Recharger DIP**.

C'est tout. À la réouverture du tableau de bord, DIP met aussi à jour la bibliothèque : commandes `/dip-*`,
skills, `QUALITY_RULES.md`, index. Tes scans, tes analyses, tes sites, tes ADN, `LESSONS.md` et tes
catégories ne sont jamais touchés. Les scans d'une ancienne version portent le badge « ancienne version » :
**Bibliothèque → Redisséquer les anciennes versions**. L'ADN déjà écrit est conservé.

## 3. Collecter des sites

- **Un site** : ouvre-le dans Chrome → icône DIP → mode **Deep** → **Disséquer ce site**. Garde le panneau
  ouvert pendant 1 à 3 minutes. Le pack est enregistré tout seul dans `packs/`.
- **Plusieurs sites** : tableau de bord → **Collecte** → colle les adresses (une par ligne), choisis le secteur
  et le style si tu les connais → **Lancer la collecte**. Compte 3 à 6 minutes par site. Laisse le tableau de bord visible.
- **Où trouver des sites** : la page Collecte liste les sources (Awwwards, FWA, CSSDA, Godly…) et montre les
  secteurs encore peu couverts dans ta bibliothèque.
- **Corriger une catégorie** : Bibliothèque → clique le site → secteur, style, ★ favori.

Objectif : 20 sites ou plus, variés. C'est à partir de là que `PATTERNS.md` devient vraiment fiable.

## 4. Écrire l'ADN des sites (Claude Code)

Ouvre un terminal **dans le dossier de la bibliothèque** et lance `claude` :

```text
/dip-dna packs/<site>        (un site)
/dip-dna                     (tous les sites qui n'ont pas encore d'ADN)
```

Claude écrit `DESIGN_DNA.md` et `dna.json`, l'essence du site. Le badge **ADN** apparaît dans le tableau de bord.

## 5. Comprendre une animation précise

1. Panneau DIP → **Analyser une animation précise**. Tu peux aussi passer par tableau de bord → Effets.
2. Fais défiler jusqu'à l'animation → **Entourer** → dessine un cercle autour → **Analyser cette zone**.
3. Le résultat arrive dans **Effets → Analyses ciblées**. Clique la carte → **Copier `/dip-effect …`**.
4. Dans Claude Code, colle la commande. Claude nomme l'effet, cherche des références sur le web, écrit la
   recette exacte et construit une démo dans `effects/<dossier>/demo/`.

## 6. Créer un site

1. Tableau de bord → **Créer** → choisis le mode :
   - **Projet original** ;
   - **Transformer un site** : un site client ordinaire rendu premium ;
   - **Cloner un site** : une étude.
2. Décris le projet : client, secteur, ambiance, contenus. DIP propose les références les plus proches (même
   secteur, même style) ; ajoute-en ou retires-en.
3. **Copier la commande** → colle-la dans Claude Code (dans la bibliothèque).
   Claude propose un concept, puis construit le site dans `sites/<projet>/`, en respectant `QUALITY_RULES.md`.
   Il vise au moins 10 sections, 12 visuels, un appel à l'action toutes les 3–4 pages d'écran et 3 moments
   signature.
4. **Contrôle** : `/dip-review sites/<projet>`. Claude lance la revue, corrige, relance, et note les nouvelles
   erreurs dans `LESSONS.md` pour ne plus les refaire. L'objectif est un score ≥ 85.
5. Le site apparaît dans **Sites** avec son score, ses points à corriger et ses captures.

### Images et objets 3D

- **Gratuit** : photos libres, formes 3D en code, ou Blender si tu l'as installé. La skill `blender-web-3d` est
  utilisée automatiquement.
- **À l'unité (fal.ai)** : environ 0,03 $ par image et 0,05 à 1,50 $ par objet 3D. Mets la clé dans une variable
  d'environnement, **jamais dans un chat ni dans un fichier** :
  ```powershell
  [Environment]::SetEnvironmentVariable('FAL_KEY', '<ta clé>', 'User')
  ```
  Claude utilise ensuite `dip-assets` tout seul quand `ASSETS.md` demande un visuel.

## 7. Structure de la bibliothèque

```text
D:\DIP-Library\
  packs\<site>\         un scan : SPEC.md, motion\, reference\, DESIGN_DNA.md…
  effects\<analyse>\    analyses ciblées : EFFECT.md, frames\, demo\
  sites\<projet>\       sites construits avec DIP (+ review\REVIEW.md)
  briefs\  production\  briefs et packs de production générés par « Créer »
  LIBRARY.md  EFFECTS.md  PATTERNS.md  QUALITY_RULES.md  LESSONS.md  index.json
  .claude\commands\     /dip-dna, /dip-create, /dip-transform, /dip-clone, /dip-effect, /dip-review
  .claude\skills\       premium-qa, motion-premium, three-premium, blender-web-3d, art-direction, asset-pipeline
```

Tu peux sauvegarder ou déplacer ce dossier librement. Dans le nouvel emplacement, resélectionne-le dans le
tableau de bord.

## 8. En cas de souci

| Problème | Solution |
|---|---|
| « Chrome demande à nouveau l'accès au dossier » | clique **Autoriser** dans le bandeau |
| Les commandes `/dip-*` n'apparaissent pas dans Claude Code | lance `claude` **dans** le dossier de la bibliothèque ; sinon Réglages → Reconstruire l'index |
| Claude ne trouve pas `dip-review` | ouvre un nouveau terminal (DIP_HOME) ou relance la commande de mise à jour |
| Bandeau « DIP débogue ce navigateur » | normal en mode Deep |
| Un scan s'arrête | garde la fenêtre visible, relance ; les sites très lourds passent mieux en mode Standard |
| La redissection ne s'ouvre pas | laisse le tableau de bord au premier plan pendant l'opération |
