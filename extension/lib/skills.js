// Claude Code skills shipped with the DIP library and every pack (.claude/skills/<name>/...).
// Claude loads a skill by itself when the task matches its description: no command to type.

const BLENDER_SKILL = `---
name: blender-web-3d
description: Model original 3D objects for websites with Blender driven by Python scripts (headless), check them with preview renders, and export optimised .glb files for three.js. Use when a site needs a custom 3D object (product, logo, abstract sculpture, stylised object) or when ASSETS.md asks for a 3D model.
---

# Blender → web 3D

Blender runs without its interface: \`blender --background --python <script.py> -- <args>\`.
Find Blender first: env \`BLENDER\`, then \`D:\\\\Blender\\\\blender.exe\`, \`C:\\\\Program Files\\\\Blender Foundation\\\\Blender*\\\\blender.exe\`,
\`/Applications/Blender.app/Contents/MacOS/Blender\`, \`blender\` on PATH. Ask the user once if none exists
(Blender is free: blender.org, portable .zip is fine).

## Workflow (always)
1. Read the brief: role of the object, size in the scene (ASSETS.md bounding box if any), art direction
   (DESIGN_DNA.md: palette, materials, light, mood). Decide the look before modelling.
2. Write a model script \`models/<name>.py\` defining \`build()\` that creates the object with \`bpy\`
   (primitives + modifiers: Subdivision, Bevel, Solidify, Array, Screw/Lathe, Boolean; curves for lathe
   profiles and extrusions; Geometry Nodes only when needed). Name the root object (dip-verify matches names).
3. Run the helper shipped with this skill:
   \`blender -b -P .claude/skills/blender-web-3d/dip_blender.py -- --build models/<name>.py --out public/models/<name>.glb --preview previews/<name>.png --size 1.0\`
   It clears the scene, calls build(), normalises size and origin, applies transforms, exports .glb
   (Draco, +Y up) and renders a preview (3 lights, neutral backdrop).
4. LOOK at the preview PNG. Critique silhouette, proportions, bevels (sharp edges look cheap on the web),
   material (roughness!), readability at small size. Fix the script and re-run. 2–4 iterations is normal.
5. Check the budget printed by the helper: ≤ 50k triangles for a hero object, ≤ 10k for secondary
   objects, ≤ 2 MB .glb. Then \`node <DIP>/cli/dip-assets.js optimize public/models/<name>.glb\` if textures exist.

## Quality rules
- Real-world scale is irrelevant: the helper normalises to \`--size\` (largest dimension, scene units).
- Prefer procedural materials that survive glTF: Principled BSDF base colour, metallic, roughness,
  transmission, emission, clearcoat. No node tricks that glTF cannot export (they are dropped).
- Bevel every hard edge (Bevel modifier, 2–3 segments, width ≈ 1–2 % of the size) and use smooth shading
  with auto-smooth / "Smooth by Angle".
- Stylised beats fake-realistic: clean forms, deliberate proportions, one hero material.
- Organic realism (faces, animals, food with detail) is out of reach here: use an image-to-3D model
  (\`dip-assets model\`) or a CC0 asset instead, and say so.
- Animations: keyframe simple loops (rotation, bob) in Blender only if the site cannot do them in code;
  otherwise animate in three.js (DIP measured values).
`;

const BLENDER_HELPER = `# DIP Blender helper — run with:
#   blender -b -P dip_blender.py -- --build model.py --out out.glb [--preview out.png] [--size 1.0] [--engine cycles|eevee]
# model.py must define build() creating the object(s) with bpy. The helper normalises, exports and renders.
import bpy, sys, os, math, importlib.util
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default

build_path = arg("--build"); out = arg("--out", "model.glb"); preview = arg("--preview"); size = float(arg("--size", "1.0"))
if not build_path:
    raise SystemExit("--build model.py is required")

bpy.ops.wm.read_factory_settings(use_empty=True)
spec = importlib.util.spec_from_file_location("model", build_path)
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
mod.build()

objs = [o for o in bpy.context.scene.objects if o.type in {"MESH", "CURVE", "FONT", "META", "SURFACE"}]
if not objs:
    raise SystemExit("build() created no geometry")
bpy.ops.object.select_all(action="DESELECT")
for o in objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.object.convert(target="MESH")
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

# normalise: largest dimension = size, centred on the origin, resting on y=0 in glTF (+Y up)
pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
dim = max(mx - mn); k = size / dim if dim > 0 else 1
centre = (mn + mx) / 2
for o in objs:
    o.location = (o.location - Vector((centre.x, centre.y, mn.z))) * k
    o.scale = o.scale * k
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

tris = 0
for o in objs:
    me = o.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
    me.calc_loop_triangles(); tris += len(me.loop_triangles)
print(f"[dip] objects={len(objs)} triangles={tris} size={size}")
if tris > 50000:
    print("[dip] WARNING: more than 50k triangles — decimate or simplify for the web")

os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
                          export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6)
print(f"[dip] exported {out} ({os.path.getsize(out) // 1024} KB)")

if preview:
    scn = bpy.context.scene
    # Cycles on the CPU works everywhere (EEVEE needs a GPU context); --engine eevee for speed on a desktop
    if arg("--engine", "cycles") == "eevee":
        scn.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items} else "BLENDER_EEVEE"
    else:
        scn.render.engine = "CYCLES"; scn.cycles.device = "CPU"; scn.cycles.samples = 32
        try:
            scn.cycles.use_denoising = True
        except Exception:
            pass
    scn.render.resolution_x = scn.render.resolution_y = 720
    scn.render.film_transparent = False
    world = bpy.data.worlds.new("dip"); world.color = (0.12, 0.12, 0.13)
    try:
        world.use_nodes = True
        world.node_tree.nodes["Background"].inputs[0].default_value = (0.12, 0.12, 0.13, 1)
    except Exception:
        pass
    scn.world = world
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); scn.collection.objects.link(cam); scn.camera = cam
    cam.location = (size * 1.6, -size * 2.2, size * 1.3); cam.data.lens = 60
    target = Vector((0, 0, size * 0.45)); cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    for name, loc, e in [("key", (size * 2, -size * 2, size * 3), 260), ("fill", (-size * 3, -size, size), 70), ("rim", (0, size * 3, size * 2), 180)]:
        l = bpy.data.objects.new(name, bpy.data.lights.new(name, "AREA")); l.data.energy = e * size * size; l.data.size = size
        l.location = loc; l.rotation_euler = (Vector((0, 0, size * 0.4)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler(); scn.collection.objects.link(l)
    scn.render.filepath = os.path.abspath(preview); os.makedirs(os.path.dirname(scn.render.filepath), exist_ok=True)
    bpy.ops.render.render(write_still=True)
    print(f"[dip] preview {preview}")
`;

const BLENDER_EXAMPLE = `# Example model for dip_blender.py: a stylised glossy apple.
import bpy, math

def build():
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=32, radius=1)
    apple = bpy.context.active_object; apple.name = "apple"
    # squash + dimple top and bottom with a lattice-free trick: proportional scale of the poles
    for v in apple.data.vertices:
        z = v.co.z
        v.co.z = z * (0.9 if z > 0 else 0.85)
        if abs(z) > 0.9: v.co.z -= 0.25 * math.copysign(1, z)
    bpy.ops.object.shade_smooth()
    mat = bpy.data.materials.new("skin"); mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.62, 0.05, 0.04, 1); bsdf.inputs["Roughness"].default_value = 0.28
    apple.data.materials.append(mat)
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.04, depth=0.45, location=(0, 0, 0.95))
    stem = bpy.context.active_object; stem.name = "stem"; stem.rotation_euler = (0.25, 0, 0)
    m2 = bpy.data.materials.new("stem"); m2.use_nodes = True
    m2.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.2, 0.12, 0.05, 1)
    stem.data.materials.append(m2)
`;

const THREE_SKILL = `---
name: three-premium
description: Build award-level three.js scenes for websites — renderer and colour settings, lighting, materials, post-processing, scroll-driven cameras, pointer parallax, performance budgets and fallbacks. Use for any WebGL / three.js work in a DIP project (clones, transformations, new creations).
---

# three.js, award level

## Baseline (always)
- \`renderer.outputColorSpace = SRGBColorSpace\`, tone mapping \`ACESFilmicToneMapping\` (or \`AgXToneMapping\`) with
  exposure from the DIP pack when measured; \`setPixelRatio(Math.min(devicePixelRatio, 2))\`; \`antialias\` only
  without post-processing (else SMAA / FXAA pass).
- Environment light: \`PMREMGenerator\` + \`RoomEnvironment\` (or an HDR) — materials look flat without it.
- Materials: \`MeshPhysicalMaterial\` for hero objects (clearcoat, sheen, transmission + thickness for glass,
  iridescence sparingly). One hero material, the rest quiet.
- Name every animated object (\`object.name\`) — dip-verify matches 3D motion by name.
- Resize with the container (ResizeObserver), cap the canvas to the viewport, dispose on route change.

## Motion
- Scroll: GSAP ScrollTrigger (\`scrub: true\` or a number for lag) tweening camera position / rotation / fov and
  object transforms; keyframes and ranges come from the DIP pack (\`motion/effects/*camera*\`).
- Pointer: normalised -1..1, smoothed with \`lerp\` 0.05–0.1 per frame, small amplitudes (≤ 0.3 rad, ≤ 0.5 units).
- Idle life: slow loops (0.1–0.5 rad/s), subtle float (sin, amplitude ≤ 2 % of size). Never frantic.
- Décor changes: drive clear colour, fog and light colours from the same CSS variables as the page.

## Post-processing (pmndrs \`postprocessing\` preferred)
Bloom (threshold high, intensity ≤ 1), subtle noise / grain (opacity 0.03–0.08), vignette, chromatic
aberration only on transitions. Every pass costs: stop at 3–4.

## Budget
Desktop: ≤ 100 draw calls, ≤ 500k triangles, 60 fps on an integrated GPU. Mobile: half of it, DPR 1.5,
no transmission, fewer passes. Load models with \`DRACOLoader\` / \`KTX2Loader\`; show the page before the 3D.
\`prefers-reduced-motion\`: freeze loops, keep a static composed frame.

## Assets
Objects come from code first (primitives + shaders), then Blender (skill blender-web-3d), then generation
(\`dip-assets model\`) or CC0 libraries. Never ship the original site's models or shaders.
`;

const MOTION_SKILL = `---
name: motion-premium
description: Implement premium web motion with GSAP, ScrollTrigger, SplitText / split-type and Lenis using the values measured by DIP — text reveals, scroll scrubs, pinned sequences, décor colour changes, zoom-through, media expand, image compositions, hover / press / drag micro-interactions. Use whenever animating a DIP project.
---

# Premium motion

## Source of truth
Use the measured values of the DIP packs: \`motion/effects/*.md\` (recipes), \`EFFECTS.md\` at the library root
(the same need across many sites), \`motion/scroll-system.json\` (Lenis lerp), \`motion/scene.json\` (décor).
Never invent a duration or an ease when a measured one exists; mark guesses \`[estimated]\`.

## Foundations
- Lenis: \`new Lenis({ lerp: <measured> })\`, \`lenis.on('scroll', ScrollTrigger.update)\`,
  \`gsap.ticker.add((t) => lenis.raf(t * 1000))\`, \`gsap.ticker.lagSmoothing(0)\`.
- Tempo: premium sites use 0.8–1.4 s reveals with \`expo.out\` / \`power4.out\` or custom beziers, 0.04–0.12 s
  staggers, and 0.25–0.5 s micro-interactions. Keep one tempo family per site.
- Text: split into lines (masked, \`overflow: hidden\`) → words → chars only when the reference does;
  keep \`aria-label\` with the full text; re-split on resize.

## Patterns
- Scroll-enter reveal: ScrollTrigger \`start: 'top 85%'\`, \`once: true\`.
- Scrub: \`scrub: true\` (or 0.5–1 for lag), \`ease: 'none'\` on the tween when the pack gives a linear scroll curve.
- Pinned sequence / horizontal scroll: pin the section, timeline scrubbed over N × viewport height.
- Décor change: colours as CSS variables (\`--bg\`, \`--fg\`, \`--accent\`); tween the variables on scroll
  (scrub) or toggle a theme class with a 0.6–1 s transition, exactly as \`motion/scene.json\` says.
- Zoom-through: pin, scale the target to cover the viewport (transform-origin on the entry point), swap
  to the next scene inside it at the end.
- Media expand: clip-path \`inset()\` or width/height + radius → 0 from card to full screen, image counter-scale.
- Image compositions (spiral / circle / fan / stack): place items with a formula (index → angle, radius,
  rotation), animate the group (rotation, radius, stagger) — see the \`media-choreography\` cards.
- Hover: 0.3–0.6 s, transform and colour only; magnetic elements with pointer offset × strength, lerped.
- Press / click feedback: scale 0.9–0.96 with a springy bezier, colour flash; never block navigation.
- Drag: pointer events + velocity, inertia glide (\`InertiaPlugin\`, Embla, Swiper freeMode), follow ratio 1.

## Always
\`prefers-reduced-motion\`: no scrubbed transforms, instant reveals, no loops. Animate transform / opacity /
clip-path / filter only. Verify with \`dip-verify\` when a reference exists.
`;

const ART_SKILL = `---
name: art-direction
description: Turn DIP design DNA from several reference sites into an ORIGINAL art direction for a new brand — palette, type pairing, grid and rhythm, section archetypes, imagery and 3D language, copy tone, signature moments. Use when creating or transforming a site (/dip-create, /dip-transform) or when a design feels generic.
---

# Art direction from references (without copying)

1. Read the DNA of 2–4 references (DESIGN_DNA.md, dna.json) and the brief. Write in one paragraph what each
   reference does best, in principles (not in pixels).
2. Big idea: one sentence the whole site serves (e.g. "the calm of a hotel at dawn"). Every choice must
   support it; cut what does not.
3. Palette: derive from the brand (logo, product, place). 1 background family, 1 text colour, 1 accent,
   1–2 support tones; 60 / 30 / 10 surface split; body text contrast ≥ 4.5:1. Plan the décor rhythm
   along the page (light / dark sections, colour shifts) like the references' \`motion/scene.json\`.
4. Type: one display face with character + one neutral text face (free: Fontshare, Google Fonts,
   Velvetyne, Collletttivo). Fluid scale with clamp(); display sizes big and tight (tracking -2 to -4 %).
5. Grid and rhythm: 12 columns desktop / 4 mobile, generous margins, alternate density (dense → airy).
   Choose section archetypes from the references and remix their order for the story.
6. Imagery and 3D: one visual language (photo style, illustration, 3D material) described precisely
   enough to write generation prompts (ASSETS.md).
7. Motion personality: pick the tempo family and 3–5 signature moments from the references' measured
   effects; the rest stays simple.
8. Copy: headline formula, sentence length, CTA verbs from the DNA, rewritten for the client.
9. Originality check before building: at least 3 visible differences from each reference (palette, type,
   layout, imagery); no copied text, image, logo, font file, model or shader.
`;

const ASSET_SKILL = `---
name: asset-pipeline
description: Produce the images, videos, fonts and 3D objects of a DIP project — choose the right source for each asset (code, Blender, AI generation with dip-assets / fal.ai, free libraries), write consistent prompts from the art direction, optimise files and check licences. Use when ASSETS.md lists slots to fill or when placeholders must be replaced.
---

# Asset pipeline

## Decide per slot (cheapest good option first)
1. Code: gradients, noise, shapes, simple 3D (three.js primitives + shaders) — free, light, sharp.
2. Blender (skill blender-web-3d) for stylised custom objects.
3. Free libraries: Unsplash / Pexels (photos), Poly Haven / Kenney / Quaternius (CC0 3D), Google Fonts /
   Fontshare (fonts). Check each licence.
4. Generation, pay per use (\`node <DIP>/cli/dip-assets.js\`, needs \`FAL_KEY\` in the environment):
   \`image --prompt … --size WxH --out public/img/x.webp\` (≈ $0.03), \`model --prompt … --out public/models/x.glb\`
   (text → image → TRELLIS, ≈ $0.05), \`--engine rodin\` for higher quality (≈ $1.50).
5. The client's own photos / logo when good enough (retouch: crop, grade to the palette).

## Prompts (images)
\`<subject>, <composition and framing>, <light>, <palette from tokens>, <material / texture>, <mood>,
<camera / lens>, no text, no logo\` — same light and palette for every image of a site. For image → 3D,
ask for a single isolated object on a plain light-grey background, three-quarter view.

## Budgets
Hero image ≤ 250 KB (webp / avif, 2560 px max), other images ≤ 120 KB, video loops ≤ 3 MB (muted,
H.264 + poster), .glb ≤ 2 MB (Draco + webp textures: \`dip-assets optimize\`), 2 font families, woff2, subset.

## Never
Ship files from a DIP pack's \`assets/files/\` or \`webgl/geometry/\` (study copies of someone else's work),
generate real people's faces or trademarks, or leave an asset without a recorded source (keep
\`ASSETS_SOURCES.md\`: slot, file, source, licence, prompt, cost).
`;

export const SKILLS = {
  'blender-web-3d/SKILL.md': BLENDER_SKILL,
  'blender-web-3d/dip_blender.py': BLENDER_HELPER,
  'blender-web-3d/examples/apple.py': BLENDER_EXAMPLE,
  'three-premium/SKILL.md': THREE_SKILL,
  'motion-premium/SKILL.md': MOTION_SKILL,
  'art-direction/SKILL.md': ART_SKILL,
  'asset-pipeline/SKILL.md': ASSET_SKILL,
};
