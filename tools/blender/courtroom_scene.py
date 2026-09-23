"""Photoreal BalaBala 趣味法庭 for Blender 5.2.

Run from the repository root with::

    "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" -b \
        --python tools/blender/courtroom_scene.py

PBR surface materials come from ambientCG (CC0) downloaded into
``tools/blender/materials``: dark walnut, deeper walnut, burgundy + brown
leather, warm beige carpet and a red carpet runner. Brass/emitters are plain
principled materials. The geometry is a fully enclosed, symmetric courtroom:
raised judge's rostrum with a tall bench chair and gavel, central witness
stand, two counsel tables with arm chairs and benches, stepped rear + side
galleries with railings, paneled walls with pilasters and crown moulding, a
coffered ceiling, double doors, a scales emblem and warm practical lights.

A source .blend, a root-level .glb and the browser's public model are written.
Lights are intentionally NOT exported (export_lights=False); the web scene
provides matching lights and an image-based environment.
"""
import math
import os
import shutil

import bpy


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PUBLIC_MODELS = os.path.join(ROOT, "apps", "web", "public", "models")
MAT_DIR = os.path.join(ROOT, "tools", "blender", "materials")


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------
def _bsdf(mat):
    return mat.node_tree.nodes.get("Principled BSDF")


def solid_material(name, color, roughness=0.5, metallic=0.0,
                   emission=None, strength=1.0, texel=1.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    mat["texel"] = texel
    mat.diffuse_color = (*color, 1)
    bsdf = _bsdf(mat)
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        bsdf.inputs["Emission Strength"].default_value = strength
    return mat


def _find_map(directory, token):
    for fname in sorted(os.listdir(directory)):
        if fname.lower().endswith(".jpg") and token.lower() in fname.lower():
            return os.path.join(directory, fname)
    return None


def pbr_material(name, folder, texel=2.0, metallic=0.0, normal_strength=1.0):
    """Build a glTF-friendly PBR material: UV -> color / normal / roughness."""
    directory = os.path.join(MAT_DIR, folder)
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    mat["texel"] = texel
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (500, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (220, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Metallic"].default_value = metallic

    def image(token, noncolor=False, x=0, y=0):
        path = _find_map(directory, token)
        if not path:
            return None
        img = bpy.data.images.load(path)
        if noncolor:
            img.colorspace_settings.name = "Non-Color"
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = img
        node.location = (x, y)
        return node

    cnode = image("Color", x=-500, y=220)
    if cnode:
        nt.links.new(cnode.outputs["Color"], bsdf.inputs["Base Color"])
    nnode = image("NormalGL", noncolor=True, x=-500, y=-120)
    if nnode:
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nmap.location = (-80, -160)
        nmap.inputs["Strength"].default_value = normal_strength
        nt.links.new(nnode.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    rnode = image("Roughness", noncolor=True, x=-500, y=-420)
    if rnode:
        nt.links.new(rnode.outputs["Color"], bsdf.inputs["Roughness"])
    return mat


WALNUT = pbr_material("Walnut", "Wood051", texel=2.4)
WALNUT_DARK = pbr_material("Walnut dark", "Wood018", texel=2.4)
LEATHER_RED = pbr_material("Leather red", "Leather013", texel=1.4, normal_strength=1.2)
LEATHER_BROWN = pbr_material("Leather brown", "Leather006", texel=1.4, normal_strength=1.2)
CARPET_BEIGE = pbr_material("Carpet beige", "Carpet016", texel=3.0)
CARPET_RED = pbr_material("Carpet red", "Carpet015", texel=3.0)
BRASS = solid_material("Polished brass", (0.83, 0.58, 0.19), 0.24, 1.0, texel=1.0)
BRASS_DARK = solid_material("Aged brass", (0.55, 0.36, 0.12), 0.4, 1.0, texel=1.0)
LAMP_GLOW = solid_material("Warm lamp glow", (1.0, 0.62, 0.28), 0.3,
                           emission=(1.0, 0.55, 0.2), strength=2.4)
LAMP_WHITE = solid_material("Soft white glow", (1.0, 0.88, 0.66), 0.4,
                            emission=(1.0, 0.86, 0.62), strength=2.0)
DARK_RECESS = solid_material("Dark recess", (0.05, 0.02, 0.012), 0.7)


# ---------------------------------------------------------------------------
# Primitive helpers (UVs are cube-projected so textures tile in world units)
# ---------------------------------------------------------------------------
def _project_uv(obj, texel):
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.cube_project(cube_size=texel)
    bpy.ops.object.mode_set(mode="OBJECT")


def cube(name, location, size, mat, bevel=0.0, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    _project_uv(obj, mat.get("texel", 1.0))
    if bevel:
        mod = obj.modifiers.new("Soft carved edges", "BEVEL")
        mod.width = bevel
        mod.segments = 2
    obj.data.materials.append(mat)
    return obj


def cylinder(name, location, radius, depth, mat,
             rotation=(0.0, 0.0, 0.0), vertices=40, bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=depth,
        location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    _project_uv(obj, mat.get("texel", 1.0))
    if bevel:
        mod = obj.modifiers.new("Soft edge", "BEVEL")
        mod.width = bevel
        mod.segments = 2
    obj.data.materials.append(mat)
    return obj


def sphere(name, location, radius, mat, segments=24, rings=16):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments, ring_count=rings, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return obj


def frange(a, b, step):
    out = []
    v = a
    while v <= b + 1e-4:
        out.append(v)
        v += step
    return out


# ---------------------------------------------------------------------------
# Wall paneling
# ---------------------------------------------------------------------------
def _wall_helpers(face):
    if face == "back":
        def P(u, z, out):
            return (u, 7.0 - out, z)

        def S(ul, t, zl):
            return (ul, t, zl)
    elif face == "front":
        def P(u, z, out):
            return (u, -7.0 + out, z)

        def S(ul, t, zl):
            return (ul, t, zl)
    elif face == "left":
        def P(u, z, out):
            return (-9.0 + out, u, z)

        def S(ul, t, zl):
            return (t, ul, zl)
    else:  # right
        def P(u, z, out):
            return (9.0 - out, u, z)

        def S(ul, t, zl):
            return (t, ul, zl)
    return P, S


def _panel_box(tag, P, S, face, u, z0, z1, width):
    zc = (z0 + z1) / 2
    h = z1 - z0
    cube(tag + " inset", P(u, zc, 0.02), S(width - 0.3, 0.05, h - 0.3), WALNUT, 0.02)
    cube(tag + " trim b", P(u, z0 + 0.07, 0.09), S(width, 0.09, 0.13), WALNUT_DARK, 0.02)
    cube(tag + " trim t", P(u, z1 - 0.07, 0.09), S(width, 0.09, 0.13), WALNUT_DARK, 0.02)
    cube(tag + " trim l", P(u - width / 2 + 0.07, zc, 0.09), S(0.13, 0.09, h), WALNUT_DARK, 0.02)
    cube(tag + " trim r", P(u + width / 2 - 0.07, zc, 0.09), S(0.13, 0.09, h), WALNUT_DARK, 0.02)


def panel_run(face, u0, u1, zmax=6.45, tag=None):
    tag = tag or face
    P, S = _wall_helpers(face)
    n = u1 - u0
    um = (u0 + u1) / 2
    # Baseboard and chair rail.
    cube(tag + " baseboard", P(um, 0.14, 0.07), S(n, 0.14, 0.28), WALNUT_DARK, 0.02)
    cube(tag + " chair rail", P(um, 2.32, 0.08), S(n, 0.15, 0.14), WALNUT_DARK, 0.02)
    # Lower, closely spaced panels.
    pu = 1.7
    u = u0 + pu / 2
    while u < u1 - pu / 2 + 0.01:
        _panel_box(f"{tag} low {round(u, 2)}", P, S, face, u, 0.42, 2.1, pu - 0.12)
        u += pu
    # Upper tall panels.
    pu2 = 2.7
    u = u0 + pu2 / 2
    while u < u1 - pu2 / 2 + 0.01:
        _panel_box(f"{tag} up {round(u, 2)}", P, S, face, u, 2.72, zmax, pu2 - 0.16)
        u += pu2
    # Pilasters on the lower grid, running full height with simple capitals.
    for uu in frange(u0, u1, pu):
        cube(tag + " pilaster " + str(round(uu, 2)), P(uu, zmax / 2, 0.08),
             S(0.16, 0.16, zmax), WALNUT_DARK, 0.02)
        cube(tag + " pilcap " + str(round(uu, 2)), P(uu, zmax - 0.18, 0.12),
             S(0.28, 0.22, 0.32), WALNUT, 0.03)
    # Crown moulding (two stacked profiles).
    cube(tag + " crown low", P(um, 6.42, 0.1), S(n, 0.2, 0.18), WALNUT_DARK, 0.02)
    cube(tag + " crown high", P(um, 6.66, 0.16), S(n, 0.3, 0.22), WALNUT, 0.03)


# ---------------------------------------------------------------------------
# Furniture
# ---------------------------------------------------------------------------
def turned_post(name, x, y, z0, height, mat, radius=0.05):
    cylinder(name + " base", (x, y, z0 + 0.06), radius * 1.5, 0.12, mat, vertices=20)
    cylinder(name + " shaft", (x, y, z0 + height / 2), radius, height - 0.12, mat, vertices=20)
    sphere(name + " finial", (x, y, z0 + height + 0.05), radius * 1.4, mat, 16, 10)


def judge_chair(x, y, base):
    """Tall tufted(ish) judge's chair, facing -Y."""
    # Seat block + leather cushion.
    cube("JC seat frame", (x, y, base + 0.42), (1.5, 1.2, 0.5), WALNUT_DARK, 0.08)
    cube("JC seat leather", (x, y - 0.05, base + 0.7), (1.32, 1.0, 0.22), LEATHER_RED, 0.1)
    # Tall back frame.
    cube("JC back frame", (x, y + 0.42, base + 2.0), (1.6, 0.34, 2.9), WALNUT_DARK, 0.1)
    cube("JC back leather", (x, y + 0.24, base + 2.0), (1.28, 0.12, 2.5), LEATHER_RED, 0.12)
    # Tufting buttons (two columns x four rows, darker studs).
    for col in (-0.34, 0.34):
        for row in (0.95, 1.45, 1.95, 2.45):
            sphere("JC button", (x + col, y + 0.16, base + row), 0.05, BRASS_DARK, 12, 8)
    # Turned posts rising above the back + crest.
    turned_post("JC post L", x - 0.72, y + 0.4, base + 0.7, 2.9, WALNUT_DARK, 0.06)
    turned_post("JC post R", x + 0.72, y + 0.4, base + 0.7, 2.9, WALNUT_DARK, 0.06)
    cube("JC crest", (x, y + 0.42, base + 3.62), (1.7, 0.4, 0.28), WALNUT, 0.08)
    sphere("JC crest center", (x, y + 0.2, base + 3.78), 0.12, BRASS, 16, 12)
    # Arm rests.
    for s in (-1, 1):
        cube("JC arm", (x + s * 0.78, y - 0.1, base + 0.95), (0.18, 1.0, 0.16), WALNUT, 0.05)


def arm_chair(tag, x, y, leather=LEATHER_BROWN, facing=-1):
    """Counsel arm chair. facing=-1 faces -Y (toward audience/camera)."""
    dy = 0.0
    cube(tag + " seat", (x, y, 0.42), (1.05, 0.95, 0.4), WALNUT_DARK, 0.07)
    cube(tag + " cushion", (x, y - 0.04 * facing, 0.66), (0.92, 0.8, 0.2), leather, 0.08)
    back_y = y + 0.42 * facing
    cube(tag + " back frame", (x, back_y, 1.15), (1.05, 0.2, 1.25), WALNUT_DARK, 0.07)
    cube(tag + " back leather", (x, back_y - 0.06 * facing, 1.15), (0.84, 0.1, 0.95), leather, 0.08)
    turned_post(tag + " post a", x - 0.5, back_y, 0.55, 1.25, WALNUT_DARK, 0.04)
    turned_post(tag + " post b", x + 0.5, back_y, 0.55, 1.25, WALNUT_DARK, 0.04)
    for s in (-1, 1):
        cube(tag + " arm", (x + s * 0.55, y - 0.05, 0.85), (0.14, 0.85, 0.14), WALNUT, 0.04)


def bench_unit(tag, x, y, length, base, leather=LEATHER_BROWN, back_side=1.0):
    """A bench whose long axis follows X; back on the back_side (+1 = +Y)."""
    cube(tag + " platform", (x, y, base - 0.1), (length, 0.7, 0.32), WALNUT_DARK, 0.05)
    cube(tag + " seat", (x, y, base + 0.12), (length - 0.12, 0.62, 0.18), leather, 0.07)
    cube(tag + " back", (x, y + back_side * 0.4, base + 0.55), (length, 0.16, 0.95), WALNUT_DARK, 0.05)
    for bx in frange(x - length / 2 + 0.5, x + length / 2 - 0.5, 1.0):
        cube(tag + " divider", (bx, y, base + 0.4), (0.05, 0.6, 0.5), WALNUT, 0.015)


def side_bench(side):
    """Two stepped benches along a side wall, facing center (long axis = Y)."""
    for row, (xo, base) in enumerate(((7.35, 0.28), (8.05, 0.6))):
        x = side * xo
        cube(f"Side {side} plat {row}", (x, 0, base - 0.1), (0.85, 5.4, 0.3), WALNUT_DARK, 0.05)
        cube(f"Side {side} seat {row}", (x, 0, base + 0.12), (0.72, 5.2, 0.18), LEATHER_BROWN, 0.07)
        cube(f"Side {side} back {row}", (side * 8.42, 0, base + 0.55), (0.16, 5.4, 0.95), WALNUT_DARK, 0.05)
        for by in frange(-2.0, 2.0, 1.0):
            cube(f"Side {side} div {row}-{round(by, 1)}", (x, by, base + 0.4), (0.6, 0.05, 0.5), WALNUT, 0.015)


def railing(tag, x, y0, y1, z_base, height=0.75):
    """A straight railing running along Y: handrail + turned balusters."""
    ym = (y0 + y1) / 2
    n = y1 - y0
    cube(tag + " rail", (x, ym, z_base + height), (0.1, n, 0.09), WALNUT, 0.03)
    for yy in frange(y0, y1, 0.32):
        cylinder(tag + " bal " + str(round(yy, 2)), (x, yy, z_base + height / 2),
                 0.035, height - 0.1, WALNUT_DARK, vertices=12)


def counsel_table(side):
    x = side * 3.1
    cube(f"Counsel {side} body", (x, 1.45, 0.5), (2.9, 1.25, 1.0), WALNUT, 0.06)
    cube(f"Counsel {side} top", (x, 1.45, 1.05), (3.05, 1.4, 0.16), WALNUT_DARK, 0.06)
    # Front carved panel + brass plaque (facing -Y).
    cube(f"Counsel {side} inset", (x, 0.82, 0.55), (2.3, 0.06, 0.6), WALNUT_DARK, 0.02)
    cube(f"Counsel {side} plaque", (x, 0.77, 0.75), (0.9, 0.05, 0.16), BRASS, 0.02)
    # Arm chair behind (+Y, faces -Y) and a bench in front (-Y, faces +Y).
    arm_chair(f"Counsel {side} chair", x, 2.55, LEATHER_RED)
    bench_unit(f"Counsel {side} front bench", x, 0.45, 2.7, 0.12, LEATHER_BROWN, back_side=-1.0)


def rostrum():
    # Three solid steps (walnut sides) with red carpet treads + brass nosing.
    steps = [
        (3.9, 8.2, 0.22, 3.55, 4.25),
        (4.6, 7.4, 0.44, 4.25, 4.95),
        (5.625, 6.6, 0.66, 4.95, 6.3),
    ]
    for (yc, width, top, y0, y1) in steps:
        depth = y1 - y0
        cube("Rostrum step", (0, yc, top / 2), (width, depth, top), WALNUT_DARK, 0.05)
        cube("Rostrum tread", (0, yc, top + 0.012), (width - 0.12, depth - 0.1, 0.03), CARPET_RED)
        cube("Rostrum nosing", (0, y0 + 0.04, top + 0.02), (width - 0.1, 0.05, 0.05), BRASS, 0.01)
    base = 0.66
    # Judge bench body on the top step.
    cube("Judge bench body", (0, 4.78, base + 0.86), (4.5, 0.85, 1.72), WALNUT, 0.08)
    cube("Judge bench top", (0, 4.7, base + 1.8), (4.85, 1.0, 0.16), WALNUT_DARK, 0.06)
    for px in (-1.5, 0, 1.5):
        cube("Judge bench field", (px, 4.33, base + 0.85), (1.25, 0.06, 1.05), WALNUT_DARK, 0.03)
    cube("Judge bench brass line", (0, 4.28, base + 1.72), (4.6, 0.05, 0.06), BRASS, 0.01)
    # Tall chair behind, gavel on the bench.
    judge_chair(0, 5.72, base)
    cylinder("Gavel block", (0, 4.34, base + 1.92), 0.17, 0.1, WALNUT_DARK, vertices=28)
    cylinder("Gavel handle", (0, 4.34, base + 2.1), 0.05, 0.42, WALNUT_DARK,
             rotation=(math.radians(90), 0, 0), vertices=18)
    cylinder("Gavel head", (0, 4.34, base + 2.26), 0.13, 0.4, WALNUT,
             rotation=(0, math.radians(90), 0), vertices=22, bevel=0.03)
    # Side railings separating the well from the rostrum.
    railing("Rostrum rail L", -3.45, 3.6, 4.95, 0.2, 0.7)
    railing("Rostrum rail R", 3.45, 3.6, 4.95, 0.2, 0.7)


def witness_stand():
    cube("Witness body", (0, 3.0, 0.5), (1.1, 0.95, 1.0), WALNUT, 0.06)
    cube("Witness top", (0, 3.0, 1.02), (1.2, 1.05, 0.12), WALNUT_DARK, 0.05)
    cylinder("Witness mic stem", (0, 2.7, 1.35), 0.03, 0.6, BRASS_DARK, vertices=14)
    sphere("Witness mic head", (0, 2.7, 1.68), 0.08, BRASS, 14, 10)


def rear_gallery():
    """Three stepped rows facing +Y, split around the central aisle."""
    rows = [
        (-2.5, 0.2, -3.0, -2.0),
        (-3.8, 0.48, -4.3, -3.3),
        (-5.1, 0.76, -5.6, -4.6),
    ]
    for (yc, top, y0, y1) in rows:
        depth = y1 - y0
        for (cx0, cx1) in ((-8.6, -1.5), (1.5, 8.6)):
            xc = (cx0 + cx1) / 2
            width = cx1 - cx0
            cube("Gallery platform", (xc, yc, top / 2), (width, depth, top), WALNUT_DARK, 0.05)
            cube("Gallery seat", (xc, yc + 0.08, top + 0.14), (width - 0.2, 0.55, 0.18), LEATHER_BROWN, 0.07)
            cube("Gallery back", (xc, y1 - 0.06, top + 0.55), (width, 0.16, 0.95), WALNUT_DARK, 0.05)
        # Front-edge railing across both blocks (gap left at the aisle).
        for (cx0, cx1) in ((-8.4, -1.7), (1.7, 8.4)):
            xc = (cx0 + cx1) / 2
            cube("Gallery front rail", (xc, y0 + 0.03, top + 0.7), (cx1 - cx0, 0.08, 0.09), WALNUT, 0.02)
            for bx in frange(cx0, cx1, 0.5):
                cylinder("Gallery bal", (bx, y0 + 0.03, (top + 0.7) / 2),
                         0.03, top + 0.6, WALNUT_DARK, vertices=10)


# ---------------------------------------------------------------------------
# Doors, emblem, sconces, ceiling
# ---------------------------------------------------------------------------
def double_doors():
    # Frame around the opening (two jambs + lintel).
    cube("Door jamb L", (-1.62, -7.0, 1.8), (0.22, 0.34, 3.6), WALNUT_DARK, 0.04)
    cube("Door jamb R", (1.62, -7.0, 1.8), (0.22, 0.34, 3.6), WALNUT_DARK, 0.04)
    cube("Door lintel", (0, -7.0, 3.72), (3.4, 0.34, 0.26), WALNUT_DARK, 0.04)
    for sx in (-1, 1):
        x = sx * 0.75
        cube("Door leaf", (x, -6.96, 1.78), (1.46, 0.1, 3.5), WALNUT, 0.05)
        cube("Door panel upper", (x, -6.89, 2.55), (1.1, 0.06, 1.2), WALNUT_DARK, 0.03)
        cube("Door panel lower", (x, -6.89, 1.05), (1.1, 0.06, 1.1), WALNUT_DARK, 0.03)
        sphere("Door knob", (sx * 0.12, -6.86, 1.05), 0.07, BRASS, 14, 10)
    # Transom panel over the lintel.
    cube("Door transom", (0, -7.0, 5.2), (3.0, 0.2, 2.6), WALNUT, 0.05)


def emblem():
    cylinder("Emblem outer ring", (0, 6.86, 4.7), 1.02, 0.14, BRASS,
             rotation=(math.radians(90), 0, 0), vertices=64)
    cylinder("Emblem inner disc", (0, 6.78, 4.7), 0.82, 0.08, LEATHER_RED,
             rotation=(math.radians(90), 0, 0), vertices=64)
    cylinder("Emblem rim torus", (0, 6.8, 4.7), 0.9, 0.06, BRASS_DARK,
             rotation=(math.radians(90), 0, 0), vertices=64)
    # Scales: post, beam, hub, hanging pans.
    cube("Emblem post", (0, 6.7, 4.62), (0.08, 0.08, 0.78), BRASS, 0.02)
    cube("Emblem beam", (0, 6.7, 5.05), (0.95, 0.08, 0.08), BRASS, 0.02)
    sphere("Emblem hub", (0, 6.66, 5.05), 0.09, BRASS, 16, 12)
    sphere("Emblem top", (0, 6.66, 5.3), 0.1, BRASS, 16, 12)
    for s in (-1, 1):
        cylinder("Emblem chain", (s * 0.4, 6.66, 4.82), 0.02, 0.4, BRASS, vertices=10)
        cylinder("Emblem pan", (s * 0.4, 6.64, 4.6), 0.17, 0.04, BRASS,
                 rotation=(math.radians(90), 0, 0), vertices=28)


def sconce(tag, x, y, z, face):
    """Brass wall sconce with a warm glowing shade + point light."""
    axis = {"back": (0, 1, 0), "front": (0, 1, 0),
            "left": (1, 0, 0), "right": (1, 0, 0)}[face]
    sign = {"back": -1, "front": 1, "left": 1, "right": -1}[face]
    # Back plate.
    if face in ("back", "front"):
        cylinder(tag + " plate", (x, y, z), 0.16, 0.06, BRASS_DARK,
                 rotation=(math.radians(90), 0, 0), vertices=24)
        cylinder(tag + " arm", (x, y + sign * 0.16, z + 0.12), 0.035, 0.34, BRASS,
                 rotation=(math.radians(90), 0, 0), vertices=14)
        shade_pos = (x, y + sign * 0.3, z + 0.2)
    else:
        cylinder(tag + " plate", (x, y, z), 0.16, 0.06, BRASS_DARK,
                 rotation=(0, math.radians(90), 0), vertices=24)
        cylinder(tag + " arm", (x + sign * 0.16, y, z + 0.12), 0.035, 0.34, BRASS,
                 rotation=(0, math.radians(90), 0), vertices=14)
        shade_pos = (x + sign * 0.3, y, z + 0.2)
    sphere(tag + " shade", shade_pos, 0.16, LAMP_GLOW, 20, 14)
    data = bpy.data.lights.new(tag, type="POINT")
    data.energy = 110
    data.color = (1.0, 0.55, 0.22)
    data.shadow_soft_size = 0.25
    light = bpy.data.objects.new(tag, data)
    light.location = shade_pos
    bpy.context.collection.objects.link(light)


def ceiling():
    cube("Ceiling slab", (0, 0, 7.06), (18.3, 14.3, 0.2), WALNUT)
    # Coffered grid beams (bottom at z ~ 6.55).
    for y in (-4.5, -1.5, 1.5, 4.5):
        cube("Ceiling beam X", (0, y, 6.78), (18.0, 0.18, 0.5), WALNUT_DARK, 0.03)
    for x in (-6.0, -3.0, 0, 3.0, 6.0):
        cube("Ceiling beam Y", (x, 0, 6.78), (0.18, 14.0, 0.5), WALNUT_DARK, 0.03)
    # Warm flush-mount fixtures in selected coffers.
    spots = [(0, 4.5), (-3, 1.5), (3, 1.5), (0, -1.5), (-3, -4.5), (3, -4.5)]
    for i, (x, y) in enumerate(spots):
        cylinder("Ceiling fixture " + str(i), (x, y, 6.92), 0.26, 0.05, LAMP_WHITE,
                 rotation=(0, 0, 0), vertices=28)
        data = bpy.data.lights.new("Ceiling light " + str(i), type="AREA")
        data.energy = 210
        data.color = (1.0, 0.85, 0.62)
        data.size = 1.2
        light = bpy.data.objects.new("Ceiling light " + str(i), data)
        light.location = (x, y, 6.85)
        bpy.context.collection.objects.link(light)


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
def build():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

    # Floor: beige carpet base + red central runner + brass edge strips.
    cube("Floor structure", (0, 0, -0.08), (18.3, 14.3, 0.16), CARPET_BEIGE)
    cube("Red runner", (0, -1.4, 0.006), (2.6, 11.0, 0.03), CARPET_RED)
    for s in (-1, 1):
        cube("Runner edge", (s * 1.32, -1.4, 0.02), (0.05, 11.0, 0.04), BRASS, 0.01)

    # Walls (front wall is split around the door opening).
    cube("Back wall", (0, 7.15, 3.5), (18.3, 0.3, 7.0), WALNUT)
    cube("Left wall", (-9.0, 0, 3.5), (0.3, 14.3, 7.0), WALNUT)
    cube("Right wall", (9.0, 0, 3.5), (0.3, 14.3, 7.0), WALNUT)
    cube("Front wall L", (-5.25, -7.15, 3.5), (7.5, 0.3, 7.0), WALNUT)
    cube("Front wall R", (5.25, -7.15, 3.5), (7.5, 0.3, 7.0), WALNUT)
    cube("Front wall lintel", (0, -7.15, 5.3), (3.0, 0.3, 3.4), WALNUT)

    ceiling()
    double_doors()

    # Paneling on every wall segment.
    panel_run("back", -8.8, 8.8)
    panel_run("left", -7.0, 7.0)
    panel_run("right", -7.0, 7.0)
    panel_run("frontL", -8.8, -1.7)
    panel_run("frontR", 1.7, 8.8)

    rostrum()
    witness_stand()
    counsel_table(-1)
    counsel_table(1)
    side_bench(-1)
    side_bench(1)
    rear_gallery()
    emblem()

    # Sconces.
    for x in (-5.6, -2.6, 2.6, 5.6):
        sconce("Back sconce " + str(x), x, 6.8, 3.9, "back")
    for y in (3.6, 0.2, -3.4):
        sconce("Left sconce " + str(y), -8.82, y, 3.7, "left")
        sconce("Right sconce " + str(y), 8.82, y, 3.7, "right")
    for x in (-3.6, 3.6):
        sconce("Front sconce " + str(x), x, -6.82, 4.4, "front")

    # Lighting rig (for the offline preview only).
    bpy.context.scene.world.color = (0.03, 0.02, 0.012)
    bpy.ops.object.light_add(type="AREA", location=(0, 0, 6.7))
    key = bpy.context.object
    key.name = "Ceiling key"
    key.data.energy = 950
    key.data.color = (1.0, 0.83, 0.66)
    key.data.size = 11
    bpy.ops.object.light_add(type="AREA", location=(0, -4.2, 3.4),
                             rotation=(math.radians(58), 0, 0))
    fill = bpy.context.object
    fill.name = "Front fill"
    fill.data.energy = 480
    fill.data.color = (1.0, 0.62, 0.36)
    fill.data.size = 7
    # Side fills to lift the walls and counsel area.
    for sx in (-1, 1):
        bpy.ops.object.light_add(type="AREA",
                                 location=(sx * 6.2, -0.5, 3.6),
                                 rotation=(0, math.radians(sx * 70), 0))
        side = bpy.context.object
        side.name = f"Side fill {sx}"
        side.data.energy = 320
        side.data.color = (1.0, 0.7, 0.45)
        side.data.size = 5

    # Preview camera: rear-center, high, looking toward the judge.
    bpy.ops.object.camera_add(location=(0.0, -6.35, 3.0))
    camera = bpy.context.object
    camera.name = "Reference camera"
    camera.data.lens = 31
    target = __import__("mathutils").Vector((0, 1.9, 1.7))
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = camera

    engines = {i.identifier for i in
               bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items}
    if "BLENDER_EEVEE_NEXT" in engines:
        bpy.context.scene.render.engine = "BLENDER_EEVEE_NEXT"
    elif "BLENDER_EEVEE" in engines:
        bpy.context.scene.render.engine = "BLENDER_EEVEE"
    bpy.context.scene.render.resolution_x = 1280
    bpy.context.scene.render.resolution_y = 720
    bpy.context.scene.render.resolution_percentage = 100
    bpy.context.scene.render.image_settings.file_format = "PNG"
    bpy.context.scene.render.film_transparent = False
    bpy.context.scene.render.filepath = os.path.join(ROOT, "courtroom_preview.png")

    os.makedirs(PUBLIC_MODELS, exist_ok=True)
    blend_path = os.path.join(ROOT, "balabala_courtroom.blend")
    public_glb = os.path.join(PUBLIC_MODELS, "balabala_courtroom.glb")
    root_glb = os.path.join(ROOT, "balabala_courtroom.glb")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=public_glb, export_format="GLB", export_apply=True,
        export_lights=False, export_cameras=False, export_image_format="AUTO")
    shutil.copyfile(public_glb, root_glb)
    bpy.ops.render.render(write_still=True)
    print("Wrote", blend_path)
    print("Wrote", root_glb)
    print("Wrote", public_glb)


if __name__ == "__main__":
    build()
