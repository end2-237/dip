# Example model for dip_blender.py: a stylised glossy apple.
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
