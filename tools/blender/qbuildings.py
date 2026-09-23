"""Q-version (chibi) rounded buildings + central plaza for Blender 5.2.

Run from the repository root with::

    & "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" \
        --background --python tools/blender/qbuildings.py

Six themed chibi buildings (court / talkshow / werewolf / bar / gym /
library), each sitting on a 6x6 diorama base with beveled edges and two
front steps. Every hard-edged primitive gets a Bevel modifier; materials
are flat, solid, macaron/morandi colours (no textures). Each building is
exported individually to apps/web/public/models/buildings/<name>.glb, and
the whole plaza (6 buildings on a hexagon around a fountain, on a lawn
with radial paths) is exported to apps/web/public/models/balabala_plaza.glb.

Blender is +Z up; glTF export maps +Y -> -Z. Building fronts face local
-Y so that after export they face -Z (the default camera / "forward").
The court sits at Blender -Y (0 deg) which becomes glTF -Z.

This script is idempotent: it clears the scene before each export.
"""
import math
import os

import bpy


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PUBLIC_MODELS = os.path.join(ROOT, "apps", "web", "public", "models")
BUILDINGS_DIR = os.path.join(PUBLIC_MODELS, "buildings")
PLAZA_GLB = os.path.join(PUBLIC_MODELS, "balabala_plaza.glb")

# Layout constants (Blender units).
DIORAMA = 6.0          # square base side
BUILDING_R = 14.0      # ring radius the buildings sit on
PLAZA_R = 9.0          # central platform radius
GROUNDR = 34.0         # outer lawn radius
PATH_IN = PLAZA_R
PATH_OUT = 11.2        # just under the building front edge (BUILDING_R - 3.0)


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------
def _bsdf(mat):
    return mat.node_tree.nodes.get("Principled BSDF")


def solid(name, color, roughness=0.7, metallic=0.0, emission=None,
          estrength=1.0, alpha=1.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (*color, alpha)
    bsdf = _bsdf(mat)
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission is not None:
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


def init_materials():
    """Define all solid materials. Called once; results cached by name."""
    M = {}
    # Shared / environment.
    M["grass"] = solid("QGrass", (0.55, 0.75, 0.42))
    M["plaza"] = solid("QPlaza", (0.86, 0.83, 0.75))
    M["path"] = solid("QPath", (0.72, 0.68, 0.56))
    M["base"] = solid("QBase", (0.88, 0.85, 0.78))
    M["step"] = solid("QStep", (0.80, 0.77, 0.70))
    M["door"] = solid("QDoor", (0.25, 0.18, 0.12))
    M["frame"] = solid("QFrame", (0.95, 0.92, 0.85))
    M["glass"] = solid("QGlass", (0.78, 0.88, 0.95), alpha=0.5)
    M["trunk"] = solid("QTrunk", (0.40, 0.26, 0.16))
    M["leaf"] = solid("QLeaf", (0.36, 0.66, 0.32))
    M["water"] = solid("QWater", (0.35, 0.65, 0.90), alpha=0.6)
    M["water_surf"] = solid("QWaterSurf", (0.40, 0.72, 0.92))
    M["iron"] = solid("QIron", (0.30, 0.30, 0.34), metallic=0.4)

    # Court: warm cream + dark brown + gold.
    M["court_wall"] = solid("QCourtWall", (0.96, 0.90, 0.82))
    M["court_trim"] = solid("QCourtTrim", (0.55, 0.41, 0.08))
    M["court_gold"] = solid("QCourtGold", (0.83, 0.66, 0.26))
    M["court_col"] = solid("QCourtCol", (0.93, 0.88, 0.78))

    # Talkshow: purple + pink + yellow.
    M["talk_wall"] = solid("QTalkWall", (0.48, 0.37, 0.65))
    M["talk_trim"] = solid("QTalkTrim", (0.91, 0.63, 0.75))
    M["talk_glow"] = solid("QTalkGlow", (1.0, 0.84, 0.10),
                           emission=(1.0, 0.80, 0.20), estrength=2.5)
    M["talk_curtain"] = solid("QTalkCurtain", (0.55, 0.18, 0.25))
    M["talk_metal"] = solid("QTalkMetal", (0.25, 0.22, 0.30), metallic=0.3)

    # Werewolf: deep blue-purple + silver + warm window glow.
    M["wolf_wall"] = solid("QWolfWall", (0.24, 0.23, 0.42))
    M["wolf_roof"] = solid("QWolfRoof", (0.16, 0.14, 0.30))
    M["wolf_silver"] = solid("QWolfSilver", (0.66, 0.66, 0.75), metallic=0.3)
    M["wolf_win"] = solid("QWolfWin", (1.0, 0.70, 0.28),
                          emission=(1.0, 0.66, 0.22), estrength=2.5)
    M["moon"] = solid("QMoon", (0.96, 0.92, 0.60),
                      emission=(0.90, 0.85, 0.50), estrength=0.6)

    # Bar: amber orange + dark brown + cream.
    M["bar_wall"] = solid("QBarWall", (0.83, 0.52, 0.23))
    M["bar_trim"] = solid("QBarTrim", (0.42, 0.26, 0.15))
    M["bar_cream"] = solid("QBarCream", (1.0, 0.94, 0.83))
    M["bar_win"] = solid("QBarWin", (1.0, 0.78, 0.45),
                         emission=(1.0, 0.72, 0.35), estrength=2.0)
    M["foam"] = solid("QFoam", (0.97, 0.97, 0.93))
    M["wood"] = solid("QWood", (0.45, 0.30, 0.18))

    # Gym: blue-grey + dark grey + yellow.
    M["gym_wall"] = solid("QGymWall", (0.36, 0.55, 0.66))
    M["gym_trim"] = solid("QGymTrim", (0.29, 0.33, 0.41))
    M["gym_yellow"] = solid("QGymYellow", (1.0, 0.84, 0.10))
    M["gym_glass"] = solid("QGymGlass", (0.55, 0.78, 0.92), alpha=0.55)
    M["gym_weight"] = solid("QGymWeight", (0.20, 0.20, 0.24))

    # Library: deep green + bronze + cream.
    M["lib_wall"] = solid("QLibWall", (0.23, 0.42, 0.31))
    M["lib_roof"] = solid("QLibRoof", (0.15, 0.30, 0.22))
    M["lib_bronze"] = solid("QLibBronze", (0.55, 0.45, 0.33), metallic=0.2)
    M["lib_cream"] = solid("QLibCream", (0.96, 0.90, 0.82))
    M["book_red"] = solid("QBookRed", (0.75, 0.30, 0.25))
    M["book_blue"] = solid("QBookBlue", (0.30, 0.45, 0.70))
    M["book_green"] = solid("QBookGreen", (0.35, 0.60, 0.38))
    M["pencil"] = solid("QPencil", (0.95, 0.78, 0.25))

    return M


# ---------------------------------------------------------------------------
# Geometry helpers. X(lx,ly,lz) -> world location; RZ(extra) -> (0,0,rot).
# All hard-edged shapes get a Bevel modifier (applied on export).
# ---------------------------------------------------------------------------
def flat(o):
    for p in o.data.polygons:
        p.use_smooth = False
    return o


def add_bevel(o, width=0.08, segments=2):
    mod = o.modifiers.new(name="Bevel", type="BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    return mod


def cube(name, loc, size, mat, rotation=(0.0, 0.0, 0.0), bevel=0.08,
         bseg=2):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rotation)
    o = bpy.context.object
    o.name = name
    o.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(mat)
    flat(o)
    if bevel and bevel > 0:
        add_bevel(o, bevel, bseg)
    return o


def cyl(name, loc, r, depth, mat, rotation=(0.0, 0.0, 0.0), vertices=12,
        bevel=0.03):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=r, depth=depth,
        location=loc, rotation=rotation)
    o = bpy.context.object
    o.name = name
    o.data.materials.append(mat)
    flat(o)
    if bevel and bevel > 0:
        add_bevel(o, bevel, 2)
    return o


def sph(name, loc, r, mat, segments=12, rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments, ring_count=rings, radius=r, location=loc)
    o = bpy.context.object
    o.name = name
    o.data.materials.append(mat)
    flat(o)
    return o


def cone(name, loc, r1, r2, depth, mat, rotation=(0.0, 0.0, 0.0),
         vertices=12, bevel=0.03):
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices, radius1=r1, radius2=r2, depth=depth,
        location=loc, rotation=rotation)
    o = bpy.context.object
    o.name = name
    o.data.materials.append(mat)
    flat(o)
    if bevel and bevel > 0:
        add_bevel(o, bevel, 2)
    return o


def wedge(name, loc, width, depth, height, mat, bevel=0.05):
    """Triangular prism (pediment / gable): triangle in XZ, extruded along Y."""
    w = width / 2.0
    d = depth / 2.0
    verts = [
        (-w, -d, 0.0), (w, -d, 0.0), (0.0, -d, height),
        (-w, d, 0.0), (w, d, 0.0), (0.0, d, height),
    ]
    faces = [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (0, 2, 5, 3), (1, 4, 5, 2)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    o.location = loc
    bpy.context.collection.objects.link(o)
    o.data.materials.append(mat)
    flat(o)
    if bevel and bevel > 0:
        add_bevel(o, bevel, 2)
    return o


def torus(name, loc, major, minor, mat, rotation=(0.0, 0.0, 0.0),
          major_segments=16, minor_segments=8):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major, minor_radius=minor,
        major_segments=major_segments, minor_segments=minor_segments,
        location=loc, rotation=rotation)
    o = bpy.context.object
    o.name = name
    o.data.materials.append(mat)
    flat(o)
    return o


# ---------------------------------------------------------------------------
# Transform frames.
# ---------------------------------------------------------------------------
def identity_frame():
    def X(lx, ly, lz):
        return (lx, ly, lz)

    def RZ(extra=0.0):
        return (0.0, 0.0, extra)
    return X, RZ


def builder_frame(theta_deg, radius):
    """Place local building (front = -Y) on a ring so its front faces centre.

    theta=0 -> Blender -Y (front of the plaza). Matches plaza_scene.py.
    """
    theta = math.radians(theta_deg)
    cx = radius * math.sin(theta)
    cy = -radius * math.cos(theta)
    phi = math.atan2(-cx, cy)

    def X(lx, ly, lz):
        wx = cx + lx * math.cos(phi) - ly * math.sin(phi)
        wy = cy + lx * math.sin(phi) + ly * math.cos(phi)
        return (wx, wy, lz)

    def RZ(extra=0.0):
        return (0.0, 0.0, phi + extra)

    return X, RZ


# ---------------------------------------------------------------------------
# Diorama base (shared by every building).
# Local space: floor at z=0, front at -Y, base centred on (0,0).
# ---------------------------------------------------------------------------
def create_diorama_base(X, RZ, M):
    # Main platform.
    cube("QBase", X(0, 0, 0.15), (DIORAMA, DIORAMA, 0.3),
         M["base"], bevel=0.12, bseg=3)
    # Two front steps (toward -Y).
    cube("QStepL", X(0, -2.55, 0.07), (3.6, 0.9, 0.14),
         M["step"], bevel=0.05, bseg=2)
    cube("QStepU", X(0, -1.85, 0.16), (3.2, 0.8, 0.20),
         M["step"], bevel=0.05, bseg=2)


# Generic chibi body: beveled box on top of the base.
def chibi_body(X, RZ, M, wall, trim, w=3.5, d=2.9, h=3.0, cy=0.15,
               cz=0.35, bevel=0.16):
    """Main building box. Bottom at z=cz, centred at (0, cy)."""
    zc = cz + h / 2.0
    cube("QBody", X(0, cy, zc), (w, d, h), wall, bevel=bevel, bseg=3)
    return zc + h  # roof-top height


def add_door(X, RZ, M, width=1.1, height=1.5, y_front=-1.3, z=0.35):
    """Rounded door on the front face."""
    cube("QDoor", X(0, y_front - 0.04, z + height / 2.0),
         (width, 0.12, height), M["door"], bevel=0.18, bseg=3)
    # Door frame trim.
    cube("QDoorTrimTop", X(0, y_front - 0.05, z + height + 0.08),
         (width + 0.25, 0.14, 0.16), M["frame"], bevel=0.06, bseg=2)


def add_window(X, RZ, M, x, y_front, z, w=0.8, h=0.9, glass=None,
               lit=None):
    """Rounded window with frame. lit -> emissive pane, else plain glass."""
    pane_mat = lit if lit is not None else (glass or M["glass"])
    # Frame.
    cube("QWinFrame", X(x, y_front - 0.02, z),
         (w + 0.16, 0.10, h + 0.16), M["frame"], bevel=0.10, bseg=2)
    # Pane.
    cube("QWinPane", X(x, y_front - 0.07, z),
         (w, 0.08, h), pane_mat, bevel=0.08, bseg=2)


# ---------------------------------------------------------------------------
# 1. Court (法庭)
# ---------------------------------------------------------------------------
def create_court(X, RZ, M):
    create_diorama_base(X, RZ, M)
    roof_top = chibi_body(X, RZ, M, M["court_wall"], M["court_trim"])
    add_door(X, RZ, M, width=1.2, height=1.5, y_front=-1.3, z=0.35)

    # Two round windows flanking the door.
    for i, x in enumerate((-1.1, 1.1)):
        sph(f"QCourtWin{i}", X(x, -1.33, 2.4), 0.28, M["frame"], 10, 6)
        sph(f"QCourtWinPane{i}", X(x, -1.36, 2.4), 0.20, M["glass"], 10, 6)

    # Four rounded columns across the front porch.
    col_z = 0.35 + 1.55
    for i, x in enumerate((-1.35, -0.45, 0.45, 1.35)):
        cyl(f"QCourtCol{i}", X(x, -1.75, col_z), 0.16, 3.1,
            M["court_col"], vertices=12, bevel=0.04)
        cyl(f"QCourtColBase{i}", X(x, -1.75, 0.42), 0.24, 0.14,
            M["court_trim"], vertices=12, bevel=0.03)
        cyl(f"QCourtColCap{i}", X(x, -1.75, 3.5), 0.24, 0.14,
            M["court_trim"], vertices=12, bevel=0.03)

    # Entablature + triangular pediment on the porch.
    cube("QCourtEnt", X(0, -1.75, 3.62), (3.8, 0.7, 0.30),
         M["court_trim"], bevel=0.06, bseg=2)
    wedge("QCourtPed", X(0, -1.75, 3.77), 3.6, 0.7, 0.9,
          M["court_trim"], bevel=0.06)

    # Scales of justice on the pediment apex: crossbar + two disc pans.
    cyl("QCourtScaleBar", X(0, -1.75, 4.85), 0.04, 1.1,
        M["court_gold"], rotation=(0, math.pi / 2.0, 0), vertices=8,
        bevel=0.02)
    for i, sx in enumerate((-0.45, 0.45)):
        cyl(f"QCourtScalePan{i}", X(sx, -1.75, 4.72), 0.18, 0.06,
            M["court_gold"], vertices=12, bevel=0.03)
    # Centre post.
    cyl("QCourtScalePost", X(0, -1.75, 4.55), 0.04, 0.5,
        M["court_gold"], vertices=8, bevel=0.02)

    # Gavel by the door (handle + mallet head).
    for i, sx in enumerate((-0.85, 0.85)):
        cyl(f"QCourtGavelHandle{i}", X(sx, -1.55, 0.85), 0.06, 0.9,
            M["wood"], vertices=10, bevel=0.02)
        cyl(f"QCourtGavelHead{i}", X(sx, -1.55, 1.35), 0.14, 0.34,
            M["court_gold"], vertices=10, bevel=0.04)

    # Bushes on the two base corners.
    for i, (sx, sy) in enumerate(((-2.3, 2.0), (2.3, 2.0))):
        sph(f"QCourtBush{i}", X(sx, sy, 0.55), 0.35, M["leaf"], 10, 6)
        sph(f"QCourtBushTop{i}", X(sx + 0.1, sy + 0.1, 0.85), 0.28,
            M["leaf"], 10, 6)


# ---------------------------------------------------------------------------
# 2. Talkshow (脱口秀剧场)
# ---------------------------------------------------------------------------
def create_talkshow(X, RZ, M):
    create_diorama_base(X, RZ, M)
    roof_top = chibi_body(X, RZ, M, M["talk_wall"], M["talk_trim"])
    add_door(X, RZ, M, width=1.0, height=1.4, y_front=-1.3, z=0.35)

    # Windows.
    for i, x in enumerate((-1.2, 1.2)):
        add_window(X, RZ, M, x, -1.33, 2.3, w=0.7, h=0.85, lit=M["talk_glow"])

    # Roof: row of stage spotlights (small cylinders pointing down + glowing ball).
    for i, x in enumerate((-1.1, 0.0, 1.1)):
        cyl(f"QTalkSpotBody{i}", X(x, -0.2, roof_top + 0.25), 0.14, 0.4,
            M["talk_metal"], vertices=10, bevel=0.03)
        sph(f"QTalkSpotBulb{i}", X(x, -0.2, roof_top + 0.05), 0.12,
            M["talk_glow"], 10, 6)

    # Big microphone on the front wall: mesh head sphere + handle cylinder.
    sph("QTalkMicHead", X(0, -1.42, 2.9), 0.30, M["talk_trim"], 12, 8)
    cyl("QTalkMicHandle", X(0, -1.42, 2.15), 0.07, 0.9,
        M["talk_metal"], vertices=8, bevel=0.02)
    # Mic stand base.
    cyl("QTalkMicBase", X(0, -1.42, 0.55), 0.22, 0.08,
        M["talk_metal"], vertices=12, bevel=0.03)

    # Curtain above the door: two drooping panels (deep red).
    for i, sx in enumerate((-0.55, 0.55)):
        cube(f"QTalkCurtain{i}", X(sx, -1.36, 3.3), (0.55, 0.10, 0.7),
             M["talk_curtain"], bevel=0.20, bseg=3,
             rotation=(0.0, 0.0, math.radians(12 if sx < 0 else -12)))

    # Light bulbs around the door frame.
    for i, sx in enumerate((-0.62, 0.62)):
        for j, z in enumerate((0.9, 1.4, 1.9)):
            sph(f"QTalkBulb{i}_{j}", X(sx, -1.40, z), 0.07,
                M["talk_glow"], 8, 5)

    # Standing spotlight on the base side: tripod legs + lamp head.
    lx, ly = 2.3, -2.1
    for i, ang in enumerate((0.0, 120.0, 240.0)):
        a = math.radians(ang)
        leg_x = lx + 0.22 * math.cos(a)
        leg_y = ly + 0.22 * math.sin(a)
        cyl(f"QTalkTripod{i}", X(leg_x, leg_y, 0.6), 0.035, 1.0,
            M["talk_metal"], vertices=8, bevel=0.01)
    cyl("QTalkSpotStand", X(lx, ly, 1.1), 0.05, 0.6,
        M["talk_metal"], vertices=8, bevel=0.02)
    sph("QTalkStandLamp", X(lx, ly, 1.45), 0.20, M["talk_glow"], 10, 6)


# ---------------------------------------------------------------------------
# 3. Werewolf (狼人杀馆)
# ---------------------------------------------------------------------------
def create_werewolf(X, RZ, M):
    create_diorama_base(X, RZ, M)
    # Slightly narrower body.
    roof_top = chibi_body(X, RZ, M, M["wolf_wall"], M["wolf_roof"],
                          w=3.3, d=2.8, h=2.8)
    add_door(X, RZ, M, width=0.9, height=1.4, y_front=-1.25, z=0.35)

    # Gable roof (triangle prism) sitting on the body.
    wedge("QWolfRoof", X(0, 0.15, roof_top - 0.05), 3.6, 3.1, 1.3,
          M["wolf_roof"], bevel=0.08)

    # Wolf ears on the roof slopes: two small beveled cones.
    for i, sx in enumerate((-0.9, 0.9)):
        cone(f"QWolfEar{i}", X(sx, 0.15, roof_top + 0.7), 0.22, 0.0, 0.55,
             M["wolf_roof"], vertices=4, bevel=0.04)

    # Crescent moon at the roof peak (torus slice: full torus is fine, small).
    torus("QWolfMoon", X(0, -0.2, roof_top + 0.95), 0.30, 0.09,
          M["moon"], rotation=(math.pi / 2.0, 0.0, 0.0),
          major_segments=16, minor_segments=6)

    # Round glowing windows (emissive warm yellow).
    for i, x in enumerate((-1.0, 1.0)):
        sph(f"QWolfWinF{i}", X(x, -1.28, 2.1), 0.26, M["wolf_silver"], 10, 6)
        sph(f"QWolfWin{i}", X(x, -1.31, 2.1), 0.19, M["wolf_win"], 10, 6)

    # Paw print on the base side: four toe pads + one main pad.
    px, py = -2.2, -2.0
    sph("QWolfPawMain", X(px, py, 0.36), 0.22, M["wolf_silver"], 10, 6)
    for i, (dx, dy) in enumerate(((-0.22, 0.12), (-0.07, 0.20),
                                   (0.07, 0.20), (0.22, 0.12))):
        sph(f"QWolfPawToe{i}", X(px + dx, py + dy, 0.36), 0.09,
            M["wolf_silver"], 8, 5)


# ---------------------------------------------------------------------------
# 4. Bar (酒吧)
# ---------------------------------------------------------------------------
def create_bar(X, RZ, M):
    create_diorama_base(X, RZ, M)
    roof_top = chibi_body(X, RZ, M, M["bar_wall"], M["bar_trim"])
    add_door(X, RZ, M, width=1.0, height=1.4, y_front=-1.3, z=0.35)

    # Warm glowing windows.
    for i, x in enumerate((-1.15, 1.15)):
        add_window(X, RZ, M, x, -1.33, 2.2, w=0.8, h=1.0, lit=M["bar_win"])

    # Big beer mug on the roof: cylinder body + hemisphere foam.
    cyl("QBarMug", X(0, 0.15, roof_top + 0.45), 0.32, 0.85,
        M["bar_cream"], vertices=14, bevel=0.05)
    sph("QBarFoam", X(0, 0.15, roof_top + 0.92), 0.32, M["foam"], 12, 8)
    # Mug handle (small torus side).
    torus("QBarMugHandle", X(0.36, 0.15, roof_top + 0.5), 0.16, 0.05,
          M["bar_cream"], rotation=(math.pi / 2.0, 0.0, math.pi / 2.0),
          major_segments=10, minor_segments=6)

    # Striped awning over the front: alternating orange/cream slats.
    for i in range(5):
        sx = -0.9 + i * 0.45
        mat = M["bar_wall"] if i % 2 == 0 else M["bar_cream"]
        cube(f"QBarAwning{i}", X(sx, -1.55, 2.9), (0.42, 0.7, 0.10),
             mat, bevel=0.04, bseg=2,
             rotation=(math.radians(20), 0.0, 0.0))

    # Barrel by the door: cylinder + two iron rings.
    bx, by = -2.1, -1.9
    cyl("QBarBarrel", X(bx, by, 0.65), 0.28, 0.7,
        M["wood"], vertices=12, bevel=0.05)
    for i, z in enumerate((0.45, 0.85)):
        torus(f"QBarBarrelRing{i}", X(bx, by, z), 0.285, 0.03,
              M["iron"], major_segments=12, minor_segments=4)

    # Two small wine glasses (bowl + stem + base).
    for i, (gx, gy) in enumerate(((2.0, -1.9), (2.4, -1.9))):
        cyl(f"QBarGlassBase{i}", X(gx, gy, 0.38), 0.10, 0.04,
            M["bar_cream"], vertices=10, bevel=0.02)
        cyl(f"QBarGlassStem{i}", X(gx, gy, 0.55), 0.03, 0.32,
            M["bar_cream"], vertices=8, bevel=0.01)
        sph(f"QBarGlassBowl{i}", X(gx, gy, 0.78), 0.12,
            M["bar_win"], 10, 6)

    # Round table + two chairs on the base.
    tx, ty = 1.8, 0.5
    cyl("QBarTableTop", X(tx, ty, 0.75), 0.38, 0.08,
        M["wood"], vertices=12, bevel=0.04)
    cyl("QBarTableLeg", X(tx, ty, 0.50), 0.06, 0.5,
        M["wood"], vertices=8, bevel=0.02)
    for i, (cx, cy) in enumerate(((tx - 0.55, ty), (tx + 0.55, ty))):
        cube(f"QBarSeat{i}", X(cx, cy, 0.40), (0.35, 0.35, 0.10),
             M["bar_trim"], bevel=0.06, bseg=2)
        cyl(f"QBarSeatLeg{i}", X(cx, cy, 0.22), 0.04, 0.30,
            M["wood"], vertices=8, bevel=0.01)


# ---------------------------------------------------------------------------
# 5. Gym (健身房)
# ---------------------------------------------------------------------------
def create_gym(X, RZ, M):
    create_diorama_base(X, RZ, M)
    roof_top = chibi_body(X, RZ, M, M["gym_wall"], M["gym_trim"],
                          w=3.6, d=2.9, h=2.9)
    add_door(X, RZ, M, width=0.9, height=1.3, y_front=-1.3, z=0.35)

    # Large glass curtain wall on the front (left of door).
    cube("QGymGlass", X(-0.8, -1.33, 1.9), (1.4, 0.10, 1.8),
         M["gym_glass"], bevel=0.10, bseg=2)
    # Right window.
    add_window(X, RZ, M, 1.2, -1.33, 2.0, w=0.8, h=1.0)

    # Big dumbbell on the roof: bar + two big balls.
    cyl("QGymDumbBar", X(0, 0.15, roof_top + 0.25), 0.07, 1.5,
        M["gym_weight"], rotation=(0, math.pi / 2.0, 0), vertices=10,
        bevel=0.02)
    for i, sx in enumerate((-0.75, 0.75)):
        sph(f"QGymDumbPlate{i}", X(sx, 0.15, roof_top + 0.25), 0.28,
            M["gym_weight"], 12, 8)
        sph(f"QGymDumbPlateInner{i}", X(sx * 0.7, 0.15, roof_top + 0.25),
            0.18, M["gym_yellow"], 10, 6)

    # Barbell plate on the right wall: flat cylinder + center hole (small torus).
    cyl("QGymPlate", X(1.85, 0.2, 1.6), 0.35, 0.12,
        M["gym_weight"], rotation=(0, math.pi / 2.0, 0), vertices=14,
        bevel=0.04)
    cyl("QGymPlateHole", X(1.85, 0.12, 1.6), 0.12, 0.14,
        M["gym_trim"], rotation=(0, math.pi / 2.0, 0), vertices=10,
        bevel=0.02)

    # Yoga mat (flat box) + kettlebell on the base left.
    cube("QGymMat", X(-2.2, -1.9, 0.36), (0.9, 0.55, 0.06),
         M["gym_yellow"], bevel=0.05, bseg=2,
         rotation=(0.0, 0.0, math.radians(15)))
    # Kettlebell: ball + handle arch.
    sph("QGymKettle", X(-2.2, 0.8, 0.6), 0.22, M["gym_weight"], 10, 6)
    torus("QGymKettleHandle", X(-2.2, 0.8, 0.85), 0.14, 0.05,
          M["gym_weight"], rotation=(math.pi / 2.0, 0.0, 0.0),
          major_segments=10, minor_segments=5)


# ---------------------------------------------------------------------------
# 6. Library (图书馆)
# ---------------------------------------------------------------------------
def create_library(X, RZ, M):
    create_diorama_base(X, RZ, M)
    roof_top = chibi_body(X, RZ, M, M["lib_wall"], M["lib_bronze"],
                          w=3.4, d=2.9, h=3.1)
    # Tall arched door.
    add_door(X, RZ, M, width=1.0, height=1.7, y_front=-1.3, z=0.35)
    # Arched door top (half-sphere cap).
    sph("QLibDoorArch", X(0, -1.32, 2.05), 0.50, M["door"], 12, 6)

    # Two tall windows flanking the door.
    for i, x in enumerate((-1.15, 1.15)):
        cube("QLibWinFrame", X(x, -1.33, 2.3), (0.7, 0.10, 1.6),
             M["lib_cream"], bevel=0.12, bseg=3)
        cube("QLibWinPane", X(x, -1.37, 2.3), (0.5, 0.08, 1.4),
             M["glass"], bevel=0.10, bseg=2)

    # Three stacked books on the roof.
    book_z = roof_top + 0.12
    for i, (dx, mat) in enumerate(((0, M["book_red"]),
                                   (0.05, M["book_blue"]),
                                   (-0.05, M["book_green"]))):
        cube(f"QLibBook{i}", X(dx, 0.15, book_z + i * 0.18),
             (1.3, 0.9, 0.16), mat, bevel=0.05, bseg=2,
             rotation=(0.0, 0.0, math.radians(i * 4 - 4)))
        cube(f"QLibBookPage{i}", X(dx, 0.10, book_z + i * 0.18),
             (1.1, 0.7, 0.05), M["lib_cream"], bevel=0.02, bseg=1)

    # Big pencil leaning by the door: hexagonal body + cone tip + eraser.
    px, py = -1.9, -1.8
    cyl("QLibPencil", X(px, py, 0.9), 0.08, 1.2,
        M["pencil"], vertices=6, bevel=0.02,
        rotation=(math.radians(12), 0.0, 0.0))
    cone("QLibPencilTip", X(px, py, 1.6), 0.08, 0.0, 0.35,
         M["wood"], vertices=6, bevel=0.02,
         rotation=(math.radians(12), 0.0, 0.0))
    cyl("QLibPencilEraser", X(px, py, 0.32), 0.085, 0.18,
        M["talk_curtain"], vertices=6, bevel=0.02,
        rotation=(math.radians(12), 0.0, 0.0))

    # Bushes by the steps.
    for i, sx in enumerate((-1.0, 1.0)):
        sph(f"QLibBush{i}", X(sx, -2.3, 0.5), 0.28, M["leaf"], 10, 6)

    # Open book on the base right: two angled panels.
    bx, by = 2.1, 0.6
    cube("QLibOpenLeft", X(bx - 0.22, by, 0.42), (0.5, 0.35, 0.06),
         M["lib_cream"], bevel=0.03, bseg=1,
         rotation=(math.radians(20), 0.0, math.radians(-10)))
    cube("QLibOpenRight", X(bx + 0.22, by, 0.42), (0.5, 0.35, 0.06),
         M["lib_cream"], bevel=0.03, bseg=1,
         rotation=(math.radians(20), 0.0, math.radians(10)))


# ---------------------------------------------------------------------------
# Plaza environment
# ---------------------------------------------------------------------------
def create_fountain(M):
    # Raised base + basin.
    cyl("QFtnBase", (0, 0, 0.15), 2.4, 0.30, M["plaza"], vertices=18,
        bevel=0.08)
    cyl("QFtnBasin", (0, 0, 0.55), 1.9, 0.55, M["plaza"], vertices=18,
        bevel=0.08)
    cyl("QFtnWater", (0, 0, 0.84), 1.65, 0.06, M["water_surf"],
        vertices=18, bevel=0.02)
    # Centre pillar + bowl.
    cyl("QFtnPillar", (0, 0, 1.4), 0.35, 1.2, M["plaza"], vertices=12,
        bevel=0.06)
    sph("QFtnBowl", (0, 0, 2.1), 0.65, M["plaza"], 12, 8)
    # Water jet.
    cone("QFtnJet", (0, 0, 2.9), 0.22, 0.05, 1.6, M["water"],
         vertices=10, bevel=0.02)
    sph("QFtnDrop", (0, 0, 3.8), 0.14, M["water"], 8, 5)


def create_ground_plaza_paths(M):
    # Outer lawn (slightly below the plaza top).
    cyl("QLawn", (0, 0, -0.12), GROUNDR, 0.30, M["grass"], vertices=32,
        bevel=0.10)
    # Central plaza platform.
    cyl("QPlaza", (0, 0, 0.10), PLAZA_R, 0.20, M["plaza"], vertices=24,
        bevel=0.10)
    # Six radial paths.
    for k in range(6):
        theta = math.radians(k * 60.0)
        rmid = (PATH_IN + PATH_OUT) / 2.0
        length = PATH_OUT - PATH_IN
        px = rmid * math.sin(theta)
        py = -rmid * math.cos(theta)
        rot_z = math.atan2(-math.cos(theta), math.sin(theta))
        cube(f"QPath{k}", (px, py, 0.04), (length, 1.8, 0.10),
             M["path"], bevel=0.08, bseg=2,
             rotation=(0.0, 0.0, rot_z))


def qtree(x, y, M, s=1.0):
    cyl("QTreeTrunk", (x, y, 0.6 * s), 0.15 * s, 1.2 * s, M["trunk"],
        vertices=8, bevel=0.03)
    sph("QTreeCrown", (x, y, 1.6 * s), 0.85 * s, M["leaf"], 12, 8)
    sph("QTreeCrown2", (x + 0.3 * s, y + 0.2 * s, 1.9 * s), 0.55 * s,
        M["leaf"], 10, 6)


# ---------------------------------------------------------------------------
# Scene / export plumbing
# ---------------------------------------------------------------------------
def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def export_selected(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.context.scene.objects:
        if o.type == "MESH":
            o.select_set(True)
    bpy.context.view_layer.objects.active = None
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", export_apply=True,
        export_lights=False, export_cameras=False,
        export_image_format="AUTO")


def count_tris():
    n = 0
    for o in bpy.context.scene.objects:
        if o.type == "MESH":
            n += len(o.data.polygons)
    return n


# Building registry: (filename, builder function).
BUILDERS = [
    ("court", create_court),
    ("talkshow", create_talkshow),
    ("werewolf", create_werewolf),
    ("bar", create_bar),
    ("gym", create_gym),
    ("library", create_library),
]

# Ring angles in degrees: court 0 (-Y/front), then every 60.
RING_ANGLES = {
    "court": 0,
    "talkshow": 60,
    "werewolf": 120,
    "bar": 180,
    "gym": 240,
    "library": 300,
}


def build_individual(name, fn, M):
    clear_scene()
    X, RZ = identity_frame()
    fn(X, RZ, M)
    path = os.path.join(BUILDINGS_DIR, f"{name}.glb")
    export_selected(path)
    tris = count_tris()
    print(f"[INDIV] {name:9s} -> {path}  tris={tris}")


def build_plaza(M):
    clear_scene()
    create_ground_plaza_paths(M)
    create_fountain(M)

    for name, fn in BUILDERS:
        angle = RING_ANGLES[name]
        X, RZ = builder_frame(angle, BUILDING_R)
        fn(X, RZ, M)

    # Decorative trees between buildings, further out.
    for k in range(6):
        theta = math.radians(k * 60.0 + 30.0)
        r = 21.0
        qtree(r * math.sin(theta), -r * math.cos(theta), M, s=1.0)
    # A few extra trees on the lawn.
    for deg, r, s in ((75, 27, 1.2), (165, 28, 1.1),
                      (255, 27, 1.2), (345, 28, 1.1)):
        th = math.radians(deg)
        qtree(r * math.sin(th), -r * math.cos(th), M, s=s)

    # World + sun for the offline .blend preview only (not exported).
    bpy.context.scene.world.color = (0.78, 0.84, 0.92)
    bpy.ops.object.light_add(type="SUN", location=(20, -20, 40))
    sun = bpy.context.object
    sun.name = "QSun"
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(45), math.radians(20),
                           math.radians(30))

    export_selected(PLAZA_GLB)
    tris = count_tris()
    print(f"[PLAZA] {PLAZA_GLB}  tris={tris}")


def main():
    M = init_materials()
    os.makedirs(BUILDINGS_DIR, exist_ok=True)
    for name, fn in BUILDERS:
        build_individual(name, fn, M)
    build_plaza(M)
    print("=== QBUILDINGS COMPLETE ===")


if __name__ == "__main__":
    main()
