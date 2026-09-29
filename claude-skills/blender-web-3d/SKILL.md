---
name: blender-web-3d
description: Model original 3D objects for websites with Blender driven by Python scripts (headless), check them with preview renders, and export optimised .glb files for three.js. Use when a site needs a custom 3D object (product, logo, abstract sculpture, stylised object) or when ASSETS.md asks for a 3D model.
---

# Blender → web 3D

Blender runs without its interface: `blender --background --python <script.py> -- <args>`.
Find Blender first: env `BLENDER`, then `D:\\Blender\\blender.exe`, `C:\\Program Files\\Blender Foundation\\Blender*\\blender.exe`,
`/Applications/Blender.app/Contents/MacOS/Blender`, `blender` on PATH. Ask the user once if none exists
(Blender is free: blender.org, portable .zip is fine).

## Workflow (always)
1. Read the brief: role of the object, size in the scene (ASSETS.md bounding box if any), art direction
   (DESIGN_DNA.md: palette, materials, light, mood). Decide the look before modelling.
2. Write a model script `models/<name>.py` defining `build()` that creates the object with `bpy`
   (primitives + modifiers: Subdivision, Bevel, Solidify, Array, Screw/Lathe, Boolean; curves for lathe
   profiles and extrusions; Geometry Nodes only when needed). Name the root object (dip-verify matches names).
3. Run the helper shipped with this skill:
   `blender -b -P .claude/skills/blender-web-3d/dip_blender.py -- --build models/<name>.py --out public/models/<name>.glb --preview previews/<name>.png --size 1.0`
   It clears the scene, calls build(), normalises size and origin, applies transforms, exports .glb
   (Draco, +Y up) and renders a preview (3 lights, neutral backdrop).
4. LOOK at the preview PNG. Critique silhouette, proportions, bevels (sharp edges look cheap on the web),
   material (roughness!), readability at small size. Fix the script and re-run. 2–4 iterations is normal.
5. Check the budget printed by the helper: ≤ 50k triangles for a hero object, ≤ 10k for secondary
   objects, ≤ 2 MB .glb. Then `node <DIP>/cli/dip-assets.js optimize public/models/<name>.glb` if textures exist.

## Quality rules
- Real-world scale is irrelevant: the helper normalises to `--size` (largest dimension, scene units).
- Prefer procedural materials that survive glTF: Principled BSDF base colour, metallic, roughness,
  transmission, emission, clearcoat. No node tricks that glTF cannot export (they are dropped).
- Bevel every hard edge (Bevel modifier, 2–3 segments, width ≈ 1–2 % of the size) and use smooth shading
  with auto-smooth / "Smooth by Angle".
- Stylised beats fake-realistic: clean forms, deliberate proportions, one hero material.
- Organic realism (faces, animals, food with detail) is out of reach here: use an image-to-3D model
  (`dip-assets model`) or a CC0 asset instead, and say so.
- Animations: keyframe simple loops (rotation, bob) in Blender only if the site cannot do them in code;
  otherwise animate in three.js (DIP measured values).
