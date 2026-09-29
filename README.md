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

## Développement

```bash
npm test                         # tests unitaires + scan des fixtures (Playwright)
npm run serve:fixtures           # sert fixtures/ sur http://127.0.0.1:5555
```

- `extension/probes/probes.js` : sondes injectées dans la page (MAIN world, `document_start`).
- `extension/lib/` : scénario de scan, drivers (CDP / Standard), analyseur, fit d'easing, taxonomie, writer du pack, zip — **partagés** par l'extension et la CLI.
- `fixtures/` : pages de test avec effets connus (`expected.json` = vérité terrain).
- `docs/DECISIONS.md` : décisions d'architecture.

## Éthique

DIP est un outil d'apprentissage et d'analyse technique : il aide à comprendre et reconstruire des
techniques, pas à cloner et republier le site d'un tiers. Le mode **Partage** n'embarque que des
mesures, des descriptions et des placeholders ; `AGENT_RULES.md` impose une réimplémentation
originale. Les sondes ne lisent ni les champs de formulaire, ni les cookies, ni le localStorage.
Aucun contournement de CAPTCHA, paywall ou authentification ; les bannières cookies sont refusées par défaut.
