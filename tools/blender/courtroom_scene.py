"""Generate the BalaBala 趣味法庭 environment for Blender 5.2.

Run from the repository root with::

    blender -b --python tools/blender/courtroom_scene.py

The scene uses low-poly primitives with warm walnut, brass, leather and carpet
materials. It is laid out for the reference images: a raised judge's bench at
the rear, two counsel tables, side galleries, foreground spectator benches,
recessed wood panels, emblem and practical sconces. A source blend, a GLB in
the repository root and the browser's public models directory are written.
"""
import math
import os
import shutil

import bpy
from mathutils import Vector


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PUBLIC_MODELS = os.path.join(ROOT, "apps", "web", "public", "models")


def material(name, color, roughness=0.55, metallic=0.0, emission=None):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        bsdf.inputs["Emission Strength"].default_value = 1.7
    return mat


WALNUT = material("Walnut - deep", (0.18, 0.038, 0.014), 0.48)
WALNUT_MID = material("Walnut - panel", (0.34, 0.085, 0.026), 0.42)
WALNUT_LIGHT = material("Walnut - polished", (0.57, 0.19, 0.055), 0.29)
CARPET = material("Warm taupe carpet", (0.19, 0.15, 0.12), 0.92)
BRASS = material("Aged brass", (0.72, 0.34, 0.055), 0.28, 0.78)
BRASS_HIGHLIGHT = material("Polished brass", (0.95, 0.59, 0.12), 0.2, 0.82)
LEATHER = material("Burgundy leather", (0.23, 0.055, 0.04), 0.46)
LAMP = material("Lamp warm glow", (1.0, 0.41, 0.075), 0.24, emission=(1.0, 0.25, 0.035))
WALL_DARK = material("Wall upper walnut", (0.11, 0.022, 0.009), 0.58)


def cube(name, location, size, mat, bevel=0.0, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        modifier = obj.modifiers.new("Soft carved edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 3
    obj.data.materials.append(mat)
    return obj


def cylinder(name, location, radius, depth, mat, rotation=(0, 0, 0), vertices=48, bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    if bevel:
        modifier = obj.modifiers.new("Soft edge", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
    return obj


def panel(name, position, width, height, facing="back"):
    """A recessed wood panel with a thin brass picture-frame border."""
    if facing == "back":
        cube(name + " inset", position, (width, 0.13, height), WALNUT_MID, 0.045)
        y = position[1] - 0.09
        cube(name + " top trim", (position[0], y, position[2] + height / 2 - 0.08), (width + 0.16, 0.045, 0.09), BRASS, 0.018)
        cube(name + " bottom trim", (position[0], y, position[2] - height / 2 + 0.08), (width + 0.16, 0.045, 0.09), BRASS, 0.018)
        for x in (-width / 2 + 0.08, width / 2 - 0.08):
            cube(name + " side trim", (position[0] + x, y, position[2]), (0.09, 0.045, height), BRASS, 0.018)
    else:
        cube(name + " inset", position, (0.13, width, height), WALNUT_MID, 0.045)
        x = position[0] + (0.09 if facing == "left" else -0.09)
        cube(name + " top trim", (x, position[1], position[2] + height / 2 - 0.08), (0.045, width + 0.16, 0.09), BRASS, 0.018)
        cube(name + " bottom trim", (x, position[1], position[2] - height / 2 + 0.08), (0.045, width + 0.16, 0.09), BRASS, 0.018)
        for y in (-width / 2 + 0.08, width / 2 - 0.08):
            cube(name + " side trim", (x, position[1] + y, position[2]), (0.045, 0.09, height), BRASS, 0.018)


def rostrum():
    """Three steps, carved judge bench, tall chair and brass gavel."""
    cube("Judge dais lower", (0, 5.18, 0.14), (7.2, 2.75, 0.28), WALNUT, 0.08)
    cube("Judge dais middle", (0, 5.14, 0.34), (6.55, 2.42, 0.26), CARPET, 0.06)
    cube("Judge dais top", (0, 5.0, 0.52), (5.9, 2.08, 0.28), WALNUT_MID, 0.06)
    cube("Judge bench body", (0, 4.82, 1.18), (5.7, 1.2, 1.35), WALNUT_MID, 0.08)
    cube("Judge bench cap", (0, 4.72, 1.92), (6.02, 1.4, 0.24), WALNUT_LIGHT, 0.07)
    cube("Judge bench apron", (0, 4.08, 1.18), (4.65, 0.09, 1.18), WALNUT, 0.02)
    for x in (-1.85, 0, 1.85):
        cube("Judge bench carved field", (x, 4.01, 1.2), (1.38, 0.035, 0.82), WALNUT_MID, 0.03)
    cube("Judge chair frame", (0, 5.74, 2.63), (2.15, 0.44, 2.2), WALNUT, 0.13)
    cube("Judge chair leather", (0, 5.48, 2.62), (1.72, 0.10, 1.62), LEATHER, 0.15)
    cube("Judge chair seat", (0, 5.12, 1.96), (1.85, 0.88, 0.25), LEATHER, 0.12)
    cylinder("Gavel sound block", (0, 4.36, 2.08), 0.19, 0.12, BRASS_HIGHLIGHT, vertices=32)
    cylinder("Gavel handle", (0, 4.36, 2.28), 0.06, 0.52, BRASS_HIGHLIGHT, rotation=(math.radians(90), 0, 0), vertices=20)
    cylinder("Gavel head", (0, 4.36, 2.46), 0.15, 0.46, BRASS_HIGHLIGHT, rotation=(0, math.radians(90), 0), vertices=24, bevel=0.035)


def counsel_table(side):
    x = side * 3.25
    angle = side * math.radians(2.5)
    cube(f"{side} counsel platform", (x, 2.2, 0.16), (3.25, 2.05, 0.3), WALNUT, 0.06, (0, 0, angle))
    cube(f"{side} counsel body", (x, 2.2, 0.87), (3.0, 1.45, 1.2), WALNUT_MID, 0.07, (0, 0, angle))
    cube(f"{side} counsel top", (x, 2.2, 1.55), (3.25, 1.62, 0.24), WALNUT_LIGHT, 0.06, (0, 0, angle))
    cube(f"{side} counsel inset", (x, 1.45, 0.88), (2.25, 0.05, 0.72), WALNUT, 0.025, (0, 0, angle))
    cube(f"{side} counsel plaque", (x, 1.34, 1.03), (0.82, 0.035, 0.18), BRASS, 0.015, (0, 0, angle))
    cube(f"{side} counsel chair back", (x, 3.12, 1.13), (1.25, 0.25, 1.22), WALNUT, 0.09, (0, 0, angle))
    cube(f"{side} counsel chair leather", (x, 2.97, 1.16), (1.02, 0.08, 0.9), LEATHER, 0.08, (0, 0, angle))
    cube(f"{side} counsel chair seat", (x, 2.68, 0.72), (1.08, 0.62, 0.18), LEATHER, 0.07, (0, 0, angle))


def side_gallery(side):
    x = side * 7.15
    for row, (y, width) in enumerate(((3.4, 5.5), (0.0, 6.1), (-3.4, 5.5))):
        z = 0.22 + row * 0.16
        cube(f"Gallery {side} platform {row}", (x, y, z / 2), (2.2, width, z), WALNUT, 0.05)
        cube(f"Gallery {side} seat {row}", (x, y, z + 0.4), (1.05, width - 0.14, 0.25), WALNUT_LIGHT, 0.06)
        cube(f"Gallery {side} back {row}", (x - side * 0.46, y, z + 0.92), (0.18, width - 0.14, 0.98), WALNUT_MID, 0.05)
        for i in range(1, 6):
            sy = y - width / 2 + i * width / 6
            cube(f"Gallery {side} divider {row}-{i}", (x - side * 0.03, sy, z + 0.6), (1.08, 0.035, 0.44), WALNUT, 0.01)


def front_gallery():
    for row, y in enumerate((-4.95, -2.95)):
        cube(f"Front gallery base {row}", (0, y, 0.24), (8.5, 0.92, 0.48), WALNUT, 0.05)
        cube(f"Front gallery seat {row}", (0, y + 0.08, 0.72), (8.25, 0.8, 0.25), WALNUT_LIGHT, 0.05)
        cube(f"Front gallery back {row}", (0, y + 0.4, 1.18), (8.4, 0.2, 1.04), WALNUT_MID, 0.05)
        for x in (-3.5, -2.1, -0.7, 0.7, 2.1, 3.5):
            cube(f"Front gallery divider {row}-{x}", (x, y + 0.27, 0.93), (0.05, 0.85, 0.42), WALNUT, 0.01)


def wall_lamp(name, location):
    cylinder(name + " arm", location, 0.045, 0.42, BRASS, rotation=(math.radians(90), 0, 0), vertices=16)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=0.17, location=(location[0], location[1], location[2] + 0.22))
    bulb = bpy.context.object
    bulb.name = name + " shade"
    bulb.data.materials.append(LAMP)
    data = bpy.data.lights.new(name, type="POINT")
    data.energy = 260
    data.color = (1.0, 0.46, 0.17)
    light = bpy.data.objects.new(name, data)
    light.location = (location[0], location[1], location[2] + 0.22)
    bpy.context.collection.objects.link(light)


def emblem():
    y = 6.95
    cylinder("Court emblem outer", (0, y, 4.92), 0.9, 0.12, BRASS, rotation=(math.radians(90), 0, 0), vertices=64)
    cylinder("Court emblem inner", (0, y - 0.08, 4.92), 0.72, 0.04, WALNUT_MID, rotation=(math.radians(90), 0, 0), vertices=64)
    cube("Emblem stem", (0, y - 0.16, 4.92), (0.09, 0.05, 0.9), BRASS_HIGHLIGHT, 0.02)
    cube("Emblem beam", (0, y - 0.16, 5.22), (0.92, 0.05, 0.08), BRASS_HIGHLIGHT, 0.02)
    cylinder("Emblem hub", (0, y - 0.19, 5.22), 0.1, 0.08, BRASS_HIGHLIGHT, rotation=(math.radians(90), 0, 0), vertices=24)
    for side in (-1, 1):
        cube("Emblem scale arm", (side * 0.28, y - 0.16, 4.99), (0.05, 0.04, 0.48), BRASS_HIGHLIGHT, 0.015, (0, side * math.radians(32), 0))
        cylinder("Emblem scale pan", (side * 0.38, y - 0.19, 4.76), 0.16, 0.035, BRASS_HIGHLIGHT, rotation=(math.radians(90), 0, 0), vertices=24)


def build():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    # Room envelope and warm carpet floor.
    cube("Carpet floor", (0, 0, -0.08), (18, 14, 0.16), CARPET)
    cube("Back wall", (0, 7.25, 3.5), (18, 0.3, 7), WALL_DARK)
    cube("Left wall", (-8.9, 0, 3.5), (0.3, 14, 7), WALL_DARK)
    cube("Right wall", (8.9, 0, 3.5), (0.3, 14, 7), WALL_DARK)
    cube("Back wainscot", (0, 7.02, 1.18), (17.5, 0.24, 2.35), WALNUT)
    cube("Left wainscot", (-8.67, 0, 1.18), (0.24, 13.5, 2.35), WALNUT)
    cube("Right wainscot", (8.67, 0, 1.18), (0.24, 13.5, 2.35), WALNUT)
    for i, x in enumerate((-7.25, -4.9, -2.5, 2.5, 4.9, 7.25)):
        panel(f"Back wall panel {i}", (x, 7.03, 4.25), 1.78 if abs(x) > 6 else 2.0, 3.05)
    for i, y in enumerate((5.0, 2.0, -1.1, -4.2)):
        panel(f"Left wall panel {i}", (-8.68, y, 4.25), 1.95, 3.05, "left")
        panel(f"Right wall panel {i}", (8.68, y, 4.25), 1.95, 3.05, "right")
    cube("Back cornice", (0, 6.86, 6.75), (18, 0.75, 0.28), WALNUT_LIGHT, 0.06)
    cube("Left cornice", (-8.56, 0, 6.75), (0.75, 14, 0.28), WALNUT_LIGHT, 0.06)
    cube("Right cornice", (8.56, 0, 6.75), (0.75, 14, 0.28), WALNUT_LIGHT, 0.06)

    rostrum()
    counsel_table(-1)
    counsel_table(1)
    side_gallery(-1)
    side_gallery(1)
    front_gallery()
    emblem()
    for x in (-7.7, -5.0, 5.0, 7.7):
        wall_lamp(f"Rear wall sconce {x}", (x, 6.82, 4.05))
    for y in (4.3, 0.6, -3.2):
        wall_lamp(f"Left wall sconce {y}", (-8.5, y, 4.0))
        wall_lamp(f"Right wall sconce {y}", (8.5, y, 4.0))
    bpy.ops.object.light_add(type="AREA", location=(0, 0, 8.5))
    key = bpy.context.object
    key.name = "Soft ceiling key"
    key.data.energy = 1150
    key.data.color = (1.0, 0.72, 0.47)
    key.data.shape = "RECTANGLE"
    key.data.size = 9
    key.data.size_y = 6
    bpy.ops.object.light_add(type="AREA", location=(0, -5.5, 4.5))
    fill = bpy.context.object
    fill.name = "Front gallery fill"
    fill.data.energy = 500
    fill.data.color = (1.0, 0.42, 0.2)
    fill.data.size = 6

    # The reference images use a centered audience perspective; keep the
    # preview camera inside the room so the side walls do not occlude the shot.
    bpy.ops.object.camera_add(location=(0.0, -15.8, 7.3))
    camera = bpy.context.object
    camera.name = "Reference camera"
    camera.data.lens = 46
    target = Vector((0, 2.0, 2.15))
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = camera
    engines = {item.identifier for item in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items}
    bpy.context.scene.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in engines else "BLENDER_EEVEE_NEXT"
    bpy.context.scene.render.resolution_x = 1280
    bpy.context.scene.render.resolution_y = 720
    bpy.context.scene.render.resolution_percentage = 100
    bpy.context.scene.render.image_settings.file_format = "PNG"
    bpy.context.scene.render.film_transparent = False
    bpy.context.scene.world.color = (0.018, 0.007, 0.003)
    bpy.context.scene.render.filepath = os.path.join(ROOT, "courtroom_preview.png")

    os.makedirs(PUBLIC_MODELS, exist_ok=True)
    blend_path = os.path.join(ROOT, "balabala_courtroom.blend")
    public_glb = os.path.join(PUBLIC_MODELS, "balabala_courtroom.glb")
    root_glb = os.path.join(ROOT, "balabala_courtroom.glb")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=public_glb, export_format="GLB", export_apply=True, export_lights=False, export_cameras=False)
    shutil.copyfile(public_glb, root_glb)
    bpy.ops.render.render(write_still=True)
    print(f"Wrote {blend_path}")
    print(f"Wrote {root_glb}")
    print(f"Wrote {public_glb}")


if __name__ == "__main__":
    build()
