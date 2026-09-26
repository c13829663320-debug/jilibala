"""Cartoon low-poly central plaza for Blender 5.2.

Run from the repository root with::

    & "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" \
        --background --python tools/blender/plaza_scene.py

A stylised, low-poly plaza: a circular plaza platform with a fountain at the
centre, six radial paths and six themed buildings evenly spaced on a hexagon
(radius ~20) on a green lawn. All geometry uses low segment counts and flat
shading; materials are flat cartoon colours (no textures). Lights and cameras
are intentionally not exported (the web scene provides its own).

Blender Z-up; glTF export maps Blender +Y to glTF -Z automatically. The court
sits at Blender -Y (0 deg) so it faces the default camera in the web scene.
"""
import math
import os

import bpy


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PUBLIC_MODELS = os.path.join(ROOT, "apps", "web", "public", "models")
GLB_PATH = os.path.join(PUBLIC_MODELS, "balabala_plaza.glb")
BLEND_PATH = os.path.join(ROOT, "balabala_plaza.blend")

# Layout constants.
PLAZA_R = 13.0          # central platform radius
BUILDING_R = 20.0       # building ring radius
PATH_R0 = PLAZA_R       # path inner edge
PATH_R1 = 18.6          # path outer edge (under the building porch)
GROUND_R = 48.0         # outer lawn radius


# ---------------------------------------------------------------------------
# Materials (flat cartoon colours)
# ---------------------------------------------------------------------------
def _bsdf(mat):
    return mat.node_tree.nodes.get("Principled BSDF")


def solid(name, color, roughness=0.6, metallic=0.0, emission=None,
          estrength=1.0, alpha=1.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (*color, alpha)
    bsdf = _bsdf(mat)
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = estrength
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        for attr, val in (("blend_method", "BLEND"),
                          ("surface_render_method", "DITHERED")):
            try:
                setattr(mat, attr, val)
            except Exception:
                pass
    return mat


# Ground / paving.
GRASS = solid("Grass", (0.42, 0.68, 0.32))
PLAZA_MAT = solid("Plaza paving", (0.84, 0.81, 0.72))
PATH_MAT = solid("Path paving", (0.70, 0.66, 0.54))
STONE = solid("Light stone", (0.80, 0.78, 0.74))
STONE_DARK = solid("Dark stone", (0.55, 0.53, 0.50))

# Court (warm wood / cream).
COURT_WALL = solid("Court wall", (0.60, 0.40, 0.23))
COURT_ROOF = solid("Court roof", (0.42, 0.26, 0.15))
COLUMN = solid("Column cream", (0.88, 0.85, 0.78))
DOOR = solid("Door dark", (0.22, 0.13, 0.08))

# Talkshow (purple / magenta).
TALK_WALL = solid("Talk wall", (0.52, 0.24, 0.72))
TALK_ROOF = solid("Talk roof", (0.36, 0.13, 0.52))
TALK_TRIM = solid("Talk trim", (0.85, 0.34, 0.68))
TALK_LIGHT = solid("Talk light", (1.0, 0.9, 0.4),
                   emission=(1.0, 0.85, 0.35), estrength=2.2)

# Werewolf (dark indigo).
WOLF_WALL = solid("Wolf wall", (0.24, 0.20, 0.44))
WOLF_ROOF = solid("Wolf roof", (0.14, 0.11, 0.30))
WOLF_WIN = solid("Wolf window glow", (1.0, 0.72, 0.28),
                 emission=(1.0, 0.66, 0.22), estrength=2.0)
MOON = solid("Moon", (0.96, 0.92, 0.62), emission=(0.9, 0.85, 0.5), estrength=0.8)

# Bar (amber).
BAR_WALL = solid("Bar wall", (0.70, 0.34, 0.14))
BAR_ROOF = solid("Bar roof", (0.48, 0.21, 0.08))
BAR_WIN = solid("Bar window glow", (1.0, 0.74, 0.34),
                emission=(1.0, 0.7, 0.3), estrength=1.8)
BAR_WOOD = solid("Bar wood", (0.38, 0.23, 0.11))
FOAM = solid("Foam", (0.96, 0.96, 0.92))

# Gym (steel blue).
GYM_WALL = solid("Gym wall", (0.42, 0.56, 0.72))
GYM_ROOF = solid("Gym roof", (0.28, 0.38, 0.52))
GYM_GLASS = solid("Gym glass", (0.55, 0.78, 0.92), alpha=0.55)
GYM_WEIGHT = solid("Gym weights", (0.18, 0.18, 0.22))

# Library (deep green / bronze).
LIB_WALL = solid("Lib wall", (0.24, 0.44, 0.34))
LIB_ROOF = solid("Lib roof", (0.14, 0.28, 0.21))
LIB_TRIM = solid("Lib bronze", (0.72, 0.55, 0.24))
LIB_WIN = solid("Lib window", (0.20, 0.30, 0.36))
BOOK = solid("Book red", (0.78, 0.28, 0.22))

# Nature / furniture.
TRUNK = solid("Trunk", (0.36, 0.22, 0.12))
LEAF = solid("Leaf", (0.34, 0.62, 0.30))
BENCH = solid("Bench wood", (0.46, 0.30, 0.16))
WATER = solid("Water", (0.30, 0.60, 0.85), alpha=0.55)
WATER_SURF = solid("Water surface", (0.35, 0.70, 0.90))


# ---------------------------------------------------------------------------
# Primitive helpers (low-poly, flat shaded, no UV/textures)
# ---------------------------------------------------------------------------
def flat(o):
    for p in o.data.polygons:
        p.use_smooth = False
    return o


def cube(name, loc, size, mat, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rotation)
    o = bpy.context.object
    o.name = name
    o.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(mat)
    flat(o)
    return o


def cyl(name, loc, r, depth, mat, rotation=(0.0, 0.0, 0.0), vertices=10):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=r, depth=depth,
        location=loc, rotation=rotation)
    o = bpy.context.object
    o.name = name
    o.data.materials.append(mat)
    flat(o)
    return o


def sph(name, loc, r, mat, segments=8, rings=6):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments, ring_count=rings, radius=r, location=loc)
    o = bpy.context.object
    o.name = name
    o.data.materials.append(mat)
    flat(o)
    return o


def cone(name, loc, r1, r2, depth, mat, rotation=(0.0, 0.0, 0.0), vertices=10):
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices, radius1=r1, radius2=r2, depth=depth,
        location=loc, rotation=rotation)
    o = bpy.context.object
    o.name = name
    o.data.materials.append(mat)
    flat(o)
    return o


def wedge(name, loc, width, depth, height, mat):
    """Triangular prism (gable pediment): triangle in XZ, extruded along Y."""
    w = width / 2.0
    d = depth / 2.0
    verts = [
        (-w, -d, 0.0), (w, -d, 0.0), (0.0, -d, height),
        (-w, d, 0.0), (w, d, 0.0), (0.0, d, height),
    ]
    faces = [
        (0, 1, 2),
        (3, 5, 4),
        (0, 3, 4, 1),
        (0, 2, 5, 3),
        (1, 4, 5, 2),
    ]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    o.location = loc
    bpy.context.collection.objects.link(o)
    o.data.materials.append(mat)
    flat(o)
    return o


# ---------------------------------------------------------------------------
# Placement: build a building in local space (front = local -Y) then rotate
# it around Z so its front faces the plaza centre.
# ---------------------------------------------------------------------------
def builder_frame(theta_deg, radius):
    theta = math.radians(theta_deg)
    cx = radius * math.sin(theta)
    cy = -radius * math.cos(theta)
    # Rotate local -Y onto the direction toward the centre.
    phi = math.atan2(-cx, cy)

    def X(lx, ly, lz):
        wx = cx + lx * math.cos(phi) - ly * math.sin(phi)
        wy = cy + lx * math.sin(phi) + ly * math.cos(phi)
        return (wx, wy, lz)

    def RZ(extra=0.0):
        return (0.0, 0.0, phi + extra)

    return X, RZ, (cx, cy, phi)


# ---------------------------------------------------------------------------
# Themed buildings (local space, front at -Y, floor at z=0)
# ---------------------------------------------------------------------------
def build_court(X, RZ):
    # Main block.
    cube("Court body", X(0, 0.8, 2.5), (8.0, 5.6, 5.0), COURT_WALL)
    # Three front steps descending toward -Y.
    for i, (w, y, h) in enumerate(((8.6, -3.4, 0.25),
                                   (7.6, -3.9, 0.50),
                                   (6.6, -4.4, 0.75))):
        cube(f"Court step {i}", X(0, y, h / 2), (w, 1.0, h), STONE)
    # Six columns across the porch.
    for i, x in enumerate((-3.2, -1.92, -0.64, 0.64, 1.92, 3.2)):
        cyl(f"Court col {i}", X(x, -3.0, 2.4), 0.28, 4.2, COLUMN, vertices=10)
        cube(f"Court col base {i}", X(x, -3.0, 0.45), (0.6, 0.6, 0.25), STONE)
        cube(f"Court col cap {i}", X(x, -3.0, 4.55), (0.62, 0.62, 0.3), STONE)
    # Entablature + triangular pediment.
    cube("Court entablature", X(0, -2.6, 4.7), (8.8, 1.4, 0.7), COURT_ROOF)
    wedge("Court pediment", X(0, -2.6, 5.05), 8.8, 1.4, 1.6, COURT_ROOF)
    # Small dome on the roof.
    cyl("Court dome drum", X(0, 0.8, 5.2), 1.3, 0.6, COLUMN, vertices=10)
    sph("Court dome", X(0, 0.8, 5.9), 1.2, COLUMN, segments=10, rings=6)
    # Door.
    cube("Court door", X(0, -2.02, 1.6), (1.7, 0.16, 3.2), DOOR)


def build_talkshow(X, RZ):
    cube("Talk body", X(0, 0.5, 2.5), (7.0, 5.5, 5.0), TALK_WALL)
    cube("Talk roof", X(0, 0.5, 5.2), (7.4, 5.9, 0.4), TALK_ROOF)
    cube("Talk plinth", X(0, 0.5, 0.2), (7.2, 5.7, 0.4), TALK_TRIM)
    # Stage light rig on the roof: two uprights + cross bar + lamp bulbs.
    for s in (-1, 1):
        cyl(f"Talk pole {s}", X(s * 1.8, -0.2, 6.6), 0.09, 2.6,
            GYM_WEIGHT, vertices=8)
    cyl("Talk crossbar", X(0, -0.2, 7.9), 0.09, 4.0, GYM_WEIGHT,
        rotation=(0.0, math.pi / 2.0, 0.0), vertices=8)
    for i, x in enumerate((-1.4, 0.0, 1.4)):
        sph(f"Talk bulb {i}", X(x, -0.2, 7.55), 0.18, TALK_LIGHT, 8, 6)
    # Microphone decoration on the front facade.
    cyl("Talk mic stem", X(0, -2.28, 2.6), 0.08, 1.4, GYM_WEIGHT, vertices=8)
    sph("Talk mic head", X(0, -2.28, 3.45), 0.24, TALK_TRIM, 8, 6)
    # Awning over the door.
    cube("Talk awning", X(0, -2.7, 3.3), (3.2, 1.3, 0.18), TALK_TRIM,
         rotation=(math.radians(28), 0.0, 0.0))
    cube("Talk door", X(0, -2.3, 1.4), (1.6, 0.16, 2.8), DOOR)


def build_werewolf(X, RZ):
    cube("Wolf body", X(0, 0.3, 2.25), (5.5, 5.0, 4.5), WOLF_WALL)
    # Pointed pyramid roof (4-sided cone, rotated to sit on the box corners).
    cone("Wolf roof", X(0, 0.3, 6.0), 4.1, 0.0, 3.4, WOLF_ROOF,
         rotation=(0.0, 0.0, math.pi / 4.0), vertices=4)
    # Crescent / moon emblem on the front gable.
    sph("Moon disc", X(0, -2.28, 3.6), 0.55, MOON, segments=8, rings=6)
    sph("Moon cut", X(0.18, -2.35, 3.7), 0.45, WOLF_WALL, segments=8, rings=6)
    # Glowing small windows.
    for i, x in enumerate((-1.6, 1.6)):
        cube(f"Wolf win {i}", X(x, -2.28, 2.6), (0.9, 0.12, 1.1), WOLF_WIN)
    cube("Wolf door", X(0, -2.28, 1.1), (1.2, 0.16, 2.2), DOOR)


def build_bar(X, RZ):
    cube("Bar body", X(0, 0.5, 2.25), (7.0, 5.0, 4.5), BAR_WALL)
    cube("Bar roof", X(0, 0.5, 4.7), (7.4, 5.4, 0.4), BAR_ROOF)
    cube("Bar trim", X(0, 0.5, 3.6), (7.1, 5.1, 0.18), BAR_WOOD)
    # Big glowing front windows.
    for i, x in enumerate((-1.9, 1.9)):
        cube(f"Bar win {i}", X(x, -2.02, 2.3), (2.0, 0.12, 2.2), BAR_WIN)
    cube("Bar door", X(0, -2.02, 1.3), (1.4, 0.16, 2.6), DOOR)
    # Beer mug sign on a post by the door.
    cyl("Bar sign post", X(2.6, -2.9, 1.0), 0.08, 2.0, BAR_WOOD, vertices=8)
    cyl("Bar mug", X(2.6, -2.9, 2.3), 0.34, 0.6, BAR_WIN, vertices=10)
    sph("Bar foam", X(2.6, -2.9, 2.68), 0.34, FOAM, segments=10, rings=6)
    cyl("Bar handle", X(2.95, -2.9, 2.3), 0.06, 0.35, BAR_WOOD,
        rotation=(math.pi / 2.0, 0.0, 0.0), vertices=8)
    # A little outdoor table + two stools.
    cyl("Bar table", X(-2.6, -3.2, 0.7), 0.55, 0.1, BAR_WOOD, vertices=10)
    cyl("Bar table leg", X(-2.6, -3.2, 0.35), 0.1, 0.6, BAR_WOOD, vertices=8)
    for i, (sx, sy) in enumerate(((-3.3, -3.2), (-1.9, -3.2))):
        cyl(f"Bar stool {i}", X(sx, sy, 0.3), 0.22, 0.5, BENCH, vertices=8)


def build_gym(X, RZ):
    cube("Gym body", X(0, 0.5, 2.25), (7.5, 5.5, 4.5), GYM_WALL)
    cube("Gym roof", X(0, 0.5, 4.7), (8.0, 6.0, 0.3), GYM_ROOF)
    # Semi-transparent glass curtain wall on the front.
    cube("Gym glass", X(0, -2.28, 2.4), (6.5, 0.12, 3.4), GYM_GLASS)
    cube("Gym door", X(0, -2.32, 1.2), (1.5, 0.16, 2.4), GYM_ROOF)
    # Dumbbell decoration above the glass.
    cyl("Gym bar", X(0, -2.4, 4.1), 0.09, 1.4, GYM_WEIGHT,
        rotation=(0.0, math.pi / 2.0, 0.0), vertices=8)
    for s in (-1, 1):
        sph(f"Gym plate {s}", X(s * 0.85, -2.4, 4.1), 0.26,
            GYM_WEIGHT, segments=8, rings=6)
    # Corner accents.
    for s in (-1, 1):
        cube(f"Gym corner {s}", X(s * 3.7, 0.5, 2.25), (0.3, 5.6, 4.5),
             GYM_ROOF)


def build_library(X, RZ):
    cube("Lib body", X(0, 0.5, 2.75), (7.0, 5.5, 5.5), LIB_WALL)
    # Upper tier set back.
    cube("Lib upper", X(0, 0.9, 6.4), (5.0, 4.0, 2.0), LIB_WALL)
    cube("Lib roof", X(0, 0.9, 7.5), (5.6, 4.6, 0.35), LIB_ROOF)
    # Bronze trim band + plinth.
    cube("Lib band", X(0, 0.5, 3.6), (7.1, 5.6, 0.25), LIB_TRIM)
    cube("Lib plinth", X(0, 0.5, 0.25), (7.4, 5.8, 0.5), STONE_DARK)
    # Three tall front windows.
    for i, x in enumerate((-2.2, 0.0, 2.2)):
        cube(f"Lib win {i}", X(x, -2.28, 2.8), (1.0, 0.12, 3.4), LIB_WIN)
    # Steps at the entrance.
    for i, (w, y, h) in enumerate(((6.0, -3.0, 0.2),
                                   (5.2, -3.5, 0.4))):
        cube(f"Lib step {i}", X(0, y, h / 2), (w, 0.9, h), STONE)
    cube("Lib door", X(0, -2.28, 1.6), (1.5, 0.16, 3.0), DOOR)
    # Book-shaped decoration on the roof.
    cube("Lib book", X(0, 0.9, 7.9), (2.2, 1.3, 0.28), BOOK)
    cube("Lib book pages", X(0, 0.9, 8.06), (1.9, 1.1, 0.12), COLUMN)


# ---------------------------------------------------------------------------
# Environment props
# ---------------------------------------------------------------------------
def tree(x, y, s=1.0):
    cyl("Tree trunk", (x, y, 0.75 * s), 0.18 * s, 1.5 * s, TRUNK, vertices=7)
    cone("Tree leaf L", (x, y, 2.2 * s), 1.1 * s, 0.4 * s, 1.8 * s,
         LEAF, vertices=7)
    cone("Tree leaf U", (x, y, 3.1 * s), 0.75 * s, 0.0, 1.4 * s,
         LEAF, vertices=7)


def bench(x, y, angle):
    cube("Bench seat", (x, y, 0.45), (1.6, 0.45, 0.18), BENCH,
         rotation=(0.0, 0.0, angle))
    cube("Bench back", (x, y, 0.95), (1.6, 0.14, 0.8), BENCH,
         rotation=(0.0, 0.0, angle))
    for s in (-1, 1):
        # simple legs
        cube("Bench leg", (x + s * 0.6, y, 0.22), (0.12, 0.4, 0.44),
             STONE_DARK, rotation=(0.0, 0.0, angle))


def fountain():
    # Raised base + basin.
    cyl("Fountain base", (0, 0, 0.28), 3.2, 0.24, PLAZA_MAT, vertices=12)
    cyl("Fountain basin", (0, 0, 0.62), 2.6, 0.6, STONE, vertices=12)
    cyl("Fountain water", (0, 0, 0.93), 2.3, 0.06, WATER_SURF, vertices=12)
    # Central pillar.
    cyl("Fountain pillar", (0, 0, 1.9), 0.5, 1.8, STONE, vertices=10)
    sph("Fountain bowl", (0, 0, 2.9), 0.9, STONE, segments=10, rings=6)
    # Water jet: translucent cone narrowing toward the top.
    cone("Fountain jet", (0, 0, 4.1), 0.28, 0.06, 2.2, WATER, vertices=10)
    sph("Fountain drop", (0, 0, 5.3), 0.18, WATER, segments=8, rings=6)


# ---------------------------------------------------------------------------
# Build scene
# ---------------------------------------------------------------------------
def build():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

    # Outer lawn.
    cyl("Lawn", (0, 0, -0.2), GROUND_R, 0.4, GRASS, vertices=24)
    # Central plaza platform.
    cyl("Plaza", (0, 0, 0.08), PLAZA_R, 0.16, PLAZA_MAT, vertices=12)

    # Six radial paths.
    for k in range(6):
        theta = math.radians(k * 60.0)
        rmid = (PATH_R0 + PATH_R1) / 2.0
        length = PATH_R1 - PATH_R0
        px = rmid * math.sin(theta)
        py = -rmid * math.cos(theta)
        rot_z = math.atan2(-math.cos(theta), math.sin(theta))
        cube(f"Path {k}", (px, py, 0.05), (length, 2.4, 0.10), PATH_MAT,
             rotation=(0.0, 0.0, rot_z))

    fountain()

    # Six themed buildings.
    builders = [
        (0, "Court", build_court),
        (60, "Talkshow", build_talkshow),
        (120, "Werewolf", build_werewolf),
        (180, "Bar", build_bar),
        (240, "Gym", build_gym),
        (300, "Library", build_library),
    ]
    positions = []
    for theta, name, fn in builders:
        X, RZ, (cx, cy, phi) = builder_frame(theta, BUILDING_R)
        fn(X, RZ)
        positions.append((name, theta, round(cx, 3), round(cy, 3)))

    # Trees midway between buildings, further out.
    for k in range(6):
        theta = math.radians(k * 60.0 + 30.0)
        r = 26.0
        tree(r * math.sin(theta), -r * math.cos(theta), s=1.0)

    # Benches on the plaza edge between the paths.
    for k in range(6):
        theta = math.radians(k * 60.0 + 30.0)
        r = PLAZA_R - 1.0
        x = r * math.sin(theta)
        y = -r * math.cos(theta)
        # Face the plaza centre.
        ang = math.atan2(-y, -x) + math.pi / 2.0
        bench(x, y, ang)

    # A couple of extra trees to fill the lawn corners.
    for theta_deg, r, s in ((75, 33, 1.25), (165, 34, 1.1), (255, 33, 1.2), (345, 34, 1.15)):
        th = math.radians(theta_deg)
        tree(r * math.sin(th), -r * math.cos(th), s=s)

    # Lighting + world for the offline .blend preview only (not exported).
    bpy.context.scene.world.color = (0.78, 0.84, 0.92)
    bpy.ops.object.light_add(type="SUN", location=(20, -20, 40))
    sun = bpy.context.object
    sun.name = "Sun"
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(45), math.radians(20), math.radians(30))

    # Count triangles.
    tris = 0
    for o in bpy.context.scene.objects:
        if o.type == "MESH":
            tris += len(o.data.polygons)

    os.makedirs(PUBLIC_MODELS, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=GLB_PATH, export_format="GLB", export_apply=True,
        export_lights=False, export_cameras=False, export_image_format="AUTO")

    print("=== PLAZA BUILD COMPLETE ===")
    print(f"Triangles (polygons): {tris}")
    for name, theta, cx, cy in positions:
        print(f"  {name:9s} @ {theta:3d} deg -> Blender ({cx}, {cy})")
    print(f"Wrote blend: {BLEND_PATH}")
    print(f"Wrote GLB:   {GLB_PATH}")


if __name__ == "__main__":
    build()
