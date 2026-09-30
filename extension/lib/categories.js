// Inspiration categories: every site of the library is classified on three axes —
// sector (what the business is), style (how it looks and feels), techniques (what it does, measured).
// Sector and style come from the user (tags.json), then the DNA (dna.json "category"), then keyword guesses.
// Techniques are always computed from the measured effects.

export const SECTORS = {
  'luxe-mode': { fr: 'Luxe & mode', kw: /luxe|luxury|fashion|mode|couture|jewel|bijou|watch|montre|maison|atelier|collection|parfum|fragrance/ },
  'hotellerie-restauration': { fr: 'Hôtellerie & restauration', kw: /hotel|hôtel|resort|restaurant|bistro|chef|menu|table|booking|suite|spa|villa|travel|voyage/ },
  'tech-saas-ia': { fr: 'Tech, SaaS & IA', kw: /\bai\b|\bia\b|saas|platform|api|cloud|developer|software|data|machine learning|inference|gpu|startup|app\b|fintech|crypto|web3/ },
  'studio-agence': { fr: 'Studio créatif & agence', kw: /studio|agency|agence|creative|design|branding|digital experiences|we craft|crafted|motion design/ },
  portfolio: { fr: 'Portfolio', kw: /portfolio|freelance|designer|developer portfolio|photographer|photographe|illustrat|art director|directeur artistique/ },
  'architecture-immobilier': { fr: 'Architecture & immobilier', kw: /architect|architecture|interior|intérieur|real estate|immobili|residence|résidence|building|construction|property/ },
  'ecommerce-produit': { fr: 'E-commerce & produit', kw: /shop|store|boutique|cart|panier|product|produit|buy|acheter|collection|drop|sneaker/ },
  'culture-evenement': { fr: 'Culture, musique & événements', kw: /festival|museum|musée|exhibition|exposition|concert|music|musique|album|film|cinema|cinéma|theatre|théâtre|event|événement|gallery/ },
  'auto-mobilite': { fr: 'Automobile & mobilité', kw: /car\b|auto|automotive|voiture|electric vehicle|ev\b|mobility|mobilité|bike|vélo|drive/ },
  'sante-bienetre': { fr: 'Santé & bien-être', kw: /health|santé|wellness|bien-être|clinic|clinique|medical|care|yoga|fitness|sleep|beauty|beauté|skin/ },
  'finance-conseil': { fr: 'Finance & conseil', kw: /bank|banque|invest|finance|capital|fund|fonds|insurance|assurance|consulting|conseil|law|avocat|legal/ },
  'food-boisson': { fr: 'Food & boissons', kw: /coffee|café|wine|vin|beer|bière|chocolate|chocolat|tea|thé|drink|boisson|bakery|boulangerie|food/ },
  'education-ong': { fr: 'Éducation, ONG & institutions', kw: /school|école|university|université|course|formation|foundation|fondation|ngo|ong|charity|association|government|public/ },
  'media-contenu': { fr: 'Médias & création de contenu', kw: /magazine|journal|editorial|podcast|creator|créateur|content|contenu|media|média|news|studio de création de contenu/ },
  autre: { fr: 'Autre', kw: null },
};

export const STYLES = {
  'minimal-editorial': { fr: 'Minimal éditorial', kw: /minimal|editorial|éditorial|clean|sober|sobre|typographic|whitespace|grid|swiss|refined|épuré/ },
  'luxe-epure': { fr: 'Luxe épuré', kw: /luxury|luxe|elegant|élégant|premium|refined|timeless|intemporel|serif|quiet|calm/ },
  'immersif-3d': { fr: 'Immersif 3D', kw: /immersive|immersif|3d|webgl|spatial|cinematic|volumetric|particles|scene/ },
  'experimental': { fr: 'Expérimental', kw: /experimental|expérimental|avant-garde|unconventional|glitch|generative|génératif|art/ },
  brutaliste: { fr: 'Brutaliste', kw: /brutal|raw|brut|anti-design|monospace|grotesque|harsh/ },
  'ludique-colore': { fr: 'Ludique & coloré', kw: /playful|ludique|colorful|coloré|fun|bold|pop|vibrant|bouncy|inflatable|gonflable|youth|jeune/ },
  'tech-futuriste': { fr: 'Tech futuriste', kw: /futur|tech|sci-fi|neon|néon|dark ui|dashboard|terminal|signal|digital|cyber/ },
  'organique-nature': { fr: 'Organique & nature', kw: /organic|organique|nature|natural|earth|terre|botanical|soft|warm|chaleureux|sensory|sensoriel/ },
  'retro-vintage': { fr: 'Rétro & vintage', kw: /retro|rétro|vintage|nostalg|y2k|90s|80s|film grain|analog|analogique/ },
  'sombre-cinema': { fr: 'Sombre & cinématographique', kw: /dark|sombre|cinematic|cinéma|moody|noir|dramatic|dramatique|night/ },
};

export const TECHNIQUES = {
  '3d-webgl': { fr: '3D / WebGL', test: (p) => p.threeD || p.effects.some((e) => /3d-|camera-scroll|fluid|particles|gpgpu|noise-gradient|image-distortion/.test(e.type)) },
  'scroll-storytelling': { fr: 'Storytelling au scroll', test: (p) => p.effects.filter((e) => /pinned|horizontal|zoom-through|media-expand|camera-scroll|scroll-rotation/.test(e.type)).length >= 1 },
  'typo-motion': { fr: 'Typographie animée', test: (p) => p.effects.filter((e) => /text-reveal|text-scramble|blend-mode-text/.test(e.type)).length >= 2 },
  'image-led': { fr: 'Images & galeries', test: (p) => p.effects.some((e) => /gallery|media-choreography|image-parallax|image-reveal|image-trail|cursor-follower-media/.test(e.type)) || p.sections.reduce((a, s) => a + (s.images || 0), 0) >= 12 },
  'micro-interactions': { fr: 'Micro-interactions', test: (p) => p.effects.filter((e) => /hover-state|magnetic|custom-cursor|press-hold|click-feedback|tilt-3d/.test(e.type)).length >= 3 },
  'decor-shifts': { fr: 'Changements de décor', test: (p) => p.effects.some((e) => e.type === 'scene-color-shift') || (p.scene && p.scene.shifts > 0) },
  'smooth-scroll': { fr: 'Scroll fluide', test: (p) => /lenis|locomotive|smooth/.test(p.scroll && p.scroll.type || '') },
};

const words = (p) => [p.title, p.url, p.domain, ...(p.sections || []).map((s) => s.heading), ...(p.dna ? [...(p.dna.keywords || []), ...(p.dna.sectors || []), p.dna.register] : [])].filter(Boolean).join(' ').toLowerCase();

function bestMatch(dict, text, max) {
  const scored = Object.entries(dict)
    .filter(([, d]) => d.kw)
    .map(([k, d]) => [k, (text.match(new RegExp(d.kw.source, 'g')) || []).length])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  return scored.slice(0, max).map(([k]) => k);
}

// Map free text (a DNA sector such as "hospitality") onto the vocabulary
export function normaliseSector(v) {
  if (!v) return null;
  const s = String(v).toLowerCase();
  if (SECTORS[s]) return s;
  return bestMatch(SECTORS, s, 1)[0] || null;
}
export function normaliseStyle(v) {
  if (!v) return null;
  const s = String(v).toLowerCase();
  if (STYLES[s]) return s;
  return bestMatch(STYLES, s, 1)[0] || null;
}

/**
 * @param {object} p pack summary (library.js) with optional p.tags (tags.json) and p.dnaCategory (dna.json "category")
 */
export function classify(p) {
  const text = words(p);
  const user = p.tags || {};
  const dna = p.dnaCategory || {};
  let sector = normaliseSector(user.sector) || normaliseSector(dna.sector) || (p.dna && (p.dna.sectors || []).map(normaliseSector).find(Boolean)) || bestMatch(SECTORS, text, 1)[0] || 'autre';
  const sectorSource = user.sector ? 'user' : dna.sector || (p.dna && (p.dna.sectors || []).length) ? 'dna' : sector === 'autre' ? 'none' : 'auto';
  let styles = (user.styles && user.styles.length ? user.styles : dna.styles && dna.styles.length ? dna.styles : []).map(normaliseStyle).filter(Boolean);
  const styleSource = styles.length ? (user.styles && user.styles.length ? 'user' : 'dna') : 'auto';
  if (!styles.length) {
    styles = bestMatch(STYLES, text, 2);
    // measured hints
    const dark = (p.palette || [])[0] && lum(p.palette[0].hex) < 0.25;
    if (dark && !styles.includes('sombre-cinema') && styles.length < 2) styles.push('sombre-cinema');
    if (p.threeD && !styles.includes('immersif-3d') && styles.length < 2) styles.push('immersif-3d');
  }
  const techniques = Object.entries(TECHNIQUES).filter(([, t]) => {
    try {
      return t.test(p);
    } catch (e) {
      return false;
    }
  }).map(([k]) => k);
  return { sector, styles: [...new Set(styles)].slice(0, 3), techniques, source: { sector: sectorSource, styles: styleSource }, favorite: !!user.favorite, note: user.note || '' };
}

function lum(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return 1;
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export const label = (axis, key) => ((axis === 'sector' ? SECTORS : axis === 'style' ? STYLES : TECHNIQUES)[key] || {}).fr || key;

// Where to find premium sites to collect (browse by category on each)
export const SOURCES = [
  { name: 'Awwwards', url: 'https://www.awwwards.com/websites/', note: 'Sites du jour, filtres par catégorie et technologie' },
  { name: 'The FWA', url: 'https://thefwa.com/', note: 'Expériences interactives et 3D' },
  { name: 'CSS Design Awards', url: 'https://www.cssdesignawards.com/', note: 'Sites primés, UI et animation' },
  { name: 'Godly', url: 'https://godly.website/', note: 'Inspiration web très animée' },
  { name: 'SiteInspire', url: 'https://www.siteinspire.com/', note: 'Classement par style, type et sujet' },
  { name: 'Minimal Gallery', url: 'https://minimal.gallery/', note: 'Minimal et éditorial' },
  { name: 'Land-book', url: 'https://land-book.com/', note: 'Landing pages par secteur' },
  { name: 'One Page Love', url: 'https://onepagelove.com/', note: 'Sites une page' },
];
