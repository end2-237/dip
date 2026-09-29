# DIP Blender helper — run with:
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
