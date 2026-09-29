# DIP — Design Intelligence Pipeline

Extension Chrome (Manifest V3) + CLI qui **dissèquent un site créatif** (GSAP, ScrollTrigger, Lenis,
animations CSS/WAAPI, WebGL/Three.js…) et produisent un **Reproduction Pack** : un dossier
Markdown + JSON + captures de référence, conçu pour qu'un agent de code (Claude Code) reconstruise
le site avec une fidélité mesurable.

> Instrumenter d'abord, regarder ensuite : les valeurs (durées, easings, staggers, déclencheurs
> ScrollTrigger, lerp du smooth scroll, shaders et uniforms) sont **lues dans le runtime de la page**,
> pas devinées depuis une vidéo.

---

## Installer l'extension (2 minutes)

1. Récupère le dossier du dépôt (`git clone` ou « Download ZIP » puis dézippe).
2. Ouvre `chrome://extensions` dans Chrome (ou Edge / Brave / Arc).
3. Active **Mode développeur** (en haut à droite).
4. Clique **Charger l'extension non empaquetée** et sélectionne le dossier **`extension/`** du dépôt.
5. Épingle l'icône **DIP** dans la barre d'outils.

Aucune étape de build : l'extension est en JavaScript pur, chargeable telle quelle.

## Utiliser DIP

1. Ouvre le site à analyser (ex. un site Awwwards).
2. Clique sur l'icône **DIP** → le panneau latéral s'ouvre.
3. Choisis le mode :
   - **Deep** (recommandé) : tout est capturé (captures par section, breakpoints 1440/1024/390,
     survols réels, courbes). Chrome affiche le bandeau « DIP débogue ce navigateur » : c'est normal.
   - **Standard** : sans bandeau, mais sans émulation de breakpoints ni survols réels.
4. Clique **Disséquer ce site**. Garde le panneau ouvert : le scan guidé (intro, cookies refusés,
   passe de scroll, frames de référence, survols, souris, breakpoints) prend en général 1 à 3 minutes.
5. **Revue** : vérifie les sections et les effets détectés (type, déclencheur, source « read:gsap »
   ou « measured:recorder », confiance). Renomme ou décoche des effets.
6. **Exporter le pack complet** (ou seulement les effets cochés) → un `.zip` est téléchargé.

**Enregistrer ma navigation** (mode manuel) : l'extension instrumente la page, tu navigues toi-même
(menus, clics, drag, transitions de page), puis tu cliques **Arrêter**. Indispensable pour les
interactions qu'un scan automatique ne peut pas deviner.

**Clé API Claude (optionnelle)** : ⚙ → colle ta clé (`sk-ant-…`, stockée uniquement sur ton appareil)
et coche « Rédiger les descriptions avec Claude ». Sans clé, le pack est complet (mesures + gabarits) ;
Claude Code fera la synthèse lui-même.

## Donner le pack à Claude Code

```text
Dézippe le pack dans un dossier vide, puis dans Claude Code :

> Lis AGENT_RULES.md puis SPEC.md et BUILD_PLAN.md de ce dossier et reconstruis le site
  section par section en suivant les règles. Vérifie chaque section avec dip-verify.
```

Contenu du pack (`dip-pack_<domaine>_<date>/`) :

| Fichier | Rôle |
|---|---|
| `SPEC.md` | Point d'entrée : tier, stack, design system, scroll, sections, effets, risques |
| `BUILD_PLAN.md` | Étapes ordonnées avec critère de fin |
| `AGENT_RULES.md` | Règles imposées à l'agent (valeurs = mesures, `data-dip-*`, verify) |
| `design/` | `tokens.json` (W3C), `tokens.css`, `typography.md` (formules clamp), `grid.md` |
| `structure/` | `sections.json`, `dom-1440/1024/390.json`, `content.md` |
| `motion/` | `scroll-system.json`, `timeline-intro.json`, `effects/eNN-*.json + .md`, `curves/` |
| `webgl/` | fiches shader, uniforms échantillonnés, GLSL (mode étude uniquement), `three-scene.json` |
| `reference/` | captures par section et breakpoint, frames 0/25/50/75/100 % des effets scrubbés, survols avant/après |
| `verify/dip.verify.json` | Contrat de vérification (sections, effets, seuils, masques) |

## Vérifier un clone : `dip-verify`

```bash
npm install                      # installe Playwright (une fois)
npx playwright install chromium  # si Chromium n'est pas déjà présent

node cli/dip-verify.js --pack ./dip-pack_site_2026-09-29 --url http://localhost:5173 --all
node cli/dip-verify.js --pack ./dip-pack_site_2026-09-29 --section s01-hero
```

Calcule le score S = 0,40·visuel + 0,20·layout + 0,30·mouvement + 0,10·tokens aux 3 breakpoints,
écrit `verify-report.md` / `.json` et des images de diff, code de sortie ≠ 0 si S < 0,90.

## Capturer sans l'extension : `dip-capture`

Même scan que l'extension, piloté par Playwright sur ta machine (GPU + IP résidentielle) :

```bash
node cli/dip-capture.js https://exemple.com --out dip-packs
node cli/dip-capture.js --urls urls.txt          # lot, un site à la fois
node cli/dip-capture.js https://exemple.com --mode share --headless
```

## Tableau de bord (Studio)

Bouton ▦ en haut du panneau DIP → une page plein écran :

- **Dossier de la bibliothèque** : choisis-le une fois (ex. `D:\DIP-Library`) ; chaque scan y est enregistré
  automatiquement (`packs/<site>/`), avec `LIBRARY.md`, `EFFECTS.md` et les commandes Claude Code.
- **Vue d’ensemble** : chiffres, prochaines étapes suggérées (ADN à écrire, types d’animations manquants),
  rythme de la bibliothèque (durées, easings, lerp).
- **Bibliothèque** : tous les scans, filtres (3D, avec/sans ADN), fiche détaillée (palette, typos, sections,
  animations, SPEC / ADN / ASSETS lisibles directement), import de packs `.zip` déjà téléchargés.
- **Bibliothèque d’effets** : tous les effets mesurés, en cartes avec aperçu et courbe, filtrables par type et par déclencheur.
- **Créer** : projet original, transformation d’un site client, clonage ou ADN. Tu décris le projet,
  DIP propose les références les plus adaptées, écrit le brief dans `briefs/` et te donne la commande à
  coller dans Claude Code (abonnement, sans clé API).

## Ce que DIP capture (v0.2)

- Scroll : scrubs, révélations, sections épinglées, défilement horizontal, Lenis / smooth scroll.
- **Décor** : changements de couleur ou d'ambiance de la page au scroll (progressifs ou en transition),
  zoom « à travers » un objet ou un mot, média qui s'agrandit jusqu'au plein écran (`motion/scene.json`).
- **Compositions d'images** : spirale, cercle ou orbite, éventail, pile, collage, avec leur mouvement
  (`structure/compositions.json`).
- **Survols** : liens, boutons, cartes, et aussi titres et éléments stylés par des règles CSS `:hover` ;
  les grands titres sont traversés lentement à la souris (effets lettre par lettre).
- **Clics** (retour visuel, sans quitter la page), **appuis longs**, **menus, accordéons, onglets**,
  **glisser** (galeries, carrousels, avec inertie).
- 3D Three.js : caméra, objets, mouvements, shaders, post-traitement, géométries en `.glb` d'étude.

## Redisséquer après une mise à jour

Chaque pack garde la version de DIP qui l'a produit. Dans le tableau de bord, les sites analysés avec une
ancienne version portent le badge « ancienne version » : **Bibliothèque → Redisséquer les anciennes
versions** (ou « Redisséquer » dans la fiche d'un site). Une petite fenêtre s'ouvre pour chaque site ; garde
le tableau de bord visible. L'ADN déjà écrit par Claude (`DESIGN_DNA.md`, `dna.json`) est conservé.

## Skills Claude Code

La bibliothèque et chaque pack contiennent `.claude/skills/` ; Claude les utilise tout seul :
`blender-web-3d` (objets 3D modélisés par script Blender, rendu d'aperçu, export `.glb`),
`three-premium`, `motion-premium`, `art-direction`, `asset-pipeline`. Copie de référence : `claude-skills/`.

## Créer : bibliothèque, commandes Claude Code, images et 3D

**Bibliothèque** — la mémoire du studio : chaque site scanné devient une référence (ADN, palettes, typos,
animations mesurées classées par besoin).

```bash
node cli/dip-library.js add D:\DIP-Clone\dip-pack_site.zip --lib D:\DIP-Library   # dossier ou .zip
node cli/dip-library.js search premium --effect text-reveal-lines --lib D:\DIP-Library
```
Le dossier contient `LIBRARY.md` (tous les sites), `EFFECTS.md` (animations mesurées par type) et les
commandes Claude Code. Ouvre Claude Code dans ce dossier (abonnement Claude, pas d'API) :

| Commande | Rôle |
|---|---|
| `/dip-dna` (dans un pack) | écrit `DESIGN_DNA.md` + `dna.json` : l'essence du site |
| `/dip-create <brief>` | concept original + pack de production à partir de la bibliothèque |
| `/dip-transform <pack client> <packs référence>` | transforme un site ordinaire en projet premium |
| `/dip-clone <url>` | boucle complète : capture → ADN → construction → vérification (3 essais max / section) |

**Images et objets 3D originaux** (fal.ai, paiement à l'usage, sans abonnement ; clé dans une variable
d'environnement, jamais dans un fichier ni dans un chat) :

```powershell
$env:FAL_KEY="<ta clé fal.ai>"
node cli/dip-assets.js image --prompt "..." --size 1600x900 --out public/img/hero.webp
node cli/dip-assets.js model --prompt "a glossy red apple" --out public/models/apple.glb   # texte → image → 3D (TRELLIS)
node cli/dip-assets.js model --image photo.png --engine rodin --out public/models/obj.glb
node cli/dip-assets.js optimize public/models/apple.glb          # Draco + textures webp (gratuit, local)
```
Chaque pack contient `ASSETS.md` : pour chaque image, vidéo, police et objet 3D du site, son rôle, sa taille
et comment produire un équivalent original (formes 3D paramétriques à reconstruire en code, géométries
sur mesure exportées en `.glb` d'étude dans `webgl/geometry/`).

## Développement

```bash
npm test                         # tests unitaires + scan des fixtures (Playwright)
npm run serve:fixtures           # sert fixtures/ sur http://127.0.0.1:5555
npm run package:extension        # crée dist/dip-extension-0.2.0.zip (partage / Chrome Web Store)
```

- `extension/probes/probes.js` : sondes injectées dans la page (MAIN world, `document_start`).
- `extension/lib/` : scénario de scan, drivers (CDP / Standard), analyseur, fit d'easing, taxonomie, writer du pack, zip — **partagés** par l'extension et la CLI.
- `fixtures/` : pages de test avec effets connus (`expected.json` = vérité terrain).
- `docs/DECISIONS.md` : décisions d'architecture.

## Limites actuelles (v0.1)

- Le mode **Standard** est moins testé que le mode Deep (pas d'émulation de breakpoints ni de survols réels).
- Pas encore de clips vidéo WebM (intro, survols) : les références sont des captures PNG.
- Les effets non expliqués par une trace (« unexplained », détection par diff d'images) et la sélection
  d'une zone en mode manuel sont prévus dans une version suivante.
- La bibliothèque est locale (dossier + index) ; la web app de partage n'est pas encore construite.

## Éthique

DIP est un outil d'apprentissage et d'analyse technique : il aide à comprendre et reconstruire des
techniques, pas à cloner et republier le site d'un tiers. Le mode **Partage** n'embarque que des
mesures, des descriptions et des placeholders ; `AGENT_RULES.md` impose une réimplémentation
originale. Les sondes ne lisent ni les champs de formulaire, ni les cookies, ni le localStorage.
Aucun contournement de CAPTCHA, paywall ou authentification ; les bannières cookies sont refusées par défaut.
