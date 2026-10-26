"""
build-character.py — Excalibur: Earth player/citizen humanoid.
Headless bpy 5.2.3: stylized-realistic Lagos pedestrian, fully rigged,
4 baked clips (Idle / Walk / Run / Jump) -> public/assets/character.glb.

Engine contract:
- glTF +Y up; modeled facing -Y in Blender => faces +Z after export.
- Root bone at hips; clips are IN-PLACE.
- Deterministic segment-based skin weights.

Angle convention (about world X, right-hand rule, character front = -Y):
- hanging limb (down -Z):  NEGATIVE angle swings tip FORWARD, POSITIVE backward
- upright bone (up +Z):    POSITIVE angle leans top FORWARD
- foot (points -Y):        POSITIVE angle = toe DOWN, NEGATIVE = toe up
Run: /usr/bin/python3.13 scripts/build-character.py
"""
import bpy, math, os
from mathutils import Vector, Quaternion

OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'public', 'assets', 'character.glb'))
FPS = 24
D = math.radians
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---------------------------------------------------------------- materials
def mat(name, color, rough=0.8, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1.0)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m

M_SKIN = mat('ex_skin', (0.435, 0.275, 0.188), 0.52)
M_TEE = mat('ex_tee', (0.086, 0.086, 0.094), 0.85)
M_PANTS = mat('ex_pants', (0.137, 0.145, 0.161), 0.88)
M_SHOE = mat('ex_shoe', (0.055, 0.055, 0.06), 0.6)
M_SOLE = mat('ex_sole', (0.85, 0.84, 0.80), 0.55)
M_PACK = mat('ex_pack', (0.10, 0.10, 0.11), 0.78)
M_HAIR = mat('ex_pack', (0.05, 0.038, 0.028), 0.92)
M_TRIM = mat('ex_sole', (0.88, 0.88, 0.86), 0.7)

# ---------------------------------------------------------------- mesh helpers
parts = []

def smooth(o):
    for p in o.data.polygons: p.use_smooth = True

def add_sphere(name, loc, scale, material, seg=(20, 14)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg[0], ring_count=seg[1], radius=1.0, location=loc)
    o = bpy.context.active_object; o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    smooth(o)
    o.data.materials.append(material)
    parts.append((o, material)); return o

def add_cyl(name, a, b, r, material, seg=14):
    a, b = Vector(a), Vector(b)
    mid = (a + b) / 2
    d = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=seg, radius=r, depth=d.length, location=mid)
    o = bpy.context.active_object; o.name = name
    o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    bpy.ops.object.transform_apply(rotation=True)
    smooth(o)
    o.data.materials.append(material)
    parts.append((o, material)); return o

def add_box(name, loc, size, material, subd=False):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
    o = bpy.context.active_object; o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if subd:
        m = o.modifiers.new('Subd', 'SUBSURF'); m.levels = m.render_levels = 1
        smooth(o)
    o.data.materials.append(material)
    parts.append((o, material)); return o

# ---------------------------------------------------------------- body (faces -Y)
add_sphere('pelvis', (0, 0, 0.97), (0.168, 0.112, 0.098), M_PANTS)
add_sphere('abdomen', (0, 0.004, 1.13), (0.168, 0.112, 0.13), M_TEE)
add_sphere('chest', (0, -0.004, 1.33), (0.196, 0.124, 0.155), M_TEE, seg=(24, 16))
add_sphere('hem', (0, 0, 1.045), (0.172, 0.114, 0.042), M_TRIM)
add_cyl('neck', (0, -0.004, 1.475), (0, -0.006, 1.575), 0.049, M_SKIN)
add_sphere('head', (0, -0.006, 1.655), (0.090, 0.100, 0.098), M_SKIN, seg=(24, 16))
add_sphere('skull_top', (0, 0.004, 1.678), (0.094, 0.098, 0.092), M_HAIR, seg=(24, 16))
add_sphere('hair_back', (0, 0.030, 1.610), (0.088, 0.075, 0.085), M_HAIR, seg=(18, 12))
add_sphere('nose', (0, -0.098, 1.638), (0.020, 0.020, 0.024), M_SKIN, seg=(10, 8))
for side, s in (('L', 1), ('R', -1)):
    sx = lambda v: v * s
    add_sphere(f'shoulder{side}', (sx(0.155), -0.004, 1.442), (0.062, 0.062, 0.062), M_TEE, seg=(14, 10))
    add_cyl(f'sleeve{side}', (sx(0.19), -0.004, 1.425), (sx(0.215), 0.0, 1.305), 0.055, M_TEE)
    add_cyl(f'upperarm{side}', (sx(0.20), 0.0, 1.375), (sx(0.232), 0.0, 1.16), 0.047, M_SKIN)
    add_cyl(f'forearm{side}', (sx(0.232), 0.0, 1.16), (sx(0.242), 0.0, 0.935), 0.041, M_SKIN)
    add_sphere(f'hand{side}', (sx(0.244), 0.0, 0.885), (0.034, 0.024, 0.062), M_SKIN, seg=(12, 8))
    add_cyl(f'thigh{side}', (sx(0.085), 0.0, 0.94), (sx(0.092), 0.0, 0.50), 0.082, M_PANTS)
    add_cyl(f'shin{side}', (sx(0.092), 0.0, 0.50), (sx(0.094), 0.0, 0.13), 0.062, M_PANTS)
    add_box(f'cuff{side}', (sx(0.093), 0.0, 0.145), (0.135, 0.135, 0.075), M_PANTS, subd=True)
    add_box(f'shoe{side}', (sx(0.094), -0.045, 0.062), (0.096, 0.235, 0.078), M_SHOE, subd=True)
    add_box(f'sole{side}', (sx(0.094), -0.045, 0.016), (0.102, 0.245, 0.032), M_SOLE)
add_box('pack', (0, 0.145, 1.24), (0.295, 0.155, 0.385), M_PACK, subd=True)
add_box('pack_pocket', (0, 0.225, 1.10), (0.185, 0.055, 0.15), M_PACK, subd=True)
for side, s in (('L', 1), ('R', -1)):
    sx = lambda v: v * s
    add_box(f'strap_front{side}', (sx(0.095), -0.145, 1.365), (0.048, 0.02, 0.16), M_PACK)
    add_box(f'strap_top{side}', (sx(0.095), -0.045, 1.465), (0.048, 0.16, 0.02), M_PACK)
    add_box(f'strap_back{side}', (sx(0.095), 0.095, 1.40), (0.048, 0.02, 0.13), M_PACK)

# NO JOIN — keep parts as separate objects sharing one armature (join corrupts slots in 5.2)
print('[char] parts:', len(parts), 'verts:', sum(len(o.data.vertices) for o, _ in parts))

# ---------------------------------------------------------------- armature
ad = bpy.data.armatures.new('ExcaliburRig')
arm = bpy.data.objects.new('ExcaliburRig', ad)
scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
e = ad.edit_bones

def bone(name, head, tail, parent=None):
    b = e.new(name)
    b.head, b.tail = head, tail
    b.roll = 0
    if parent:
        b.parent = e[parent]; b.use_connect = True
    return b

bone('root',   (0, 0, 0.98),  (0, 0, 1.10))
bone('spine1', (0, 0, 1.10),  (0, 0, 1.24), 'root')
bone('spine2', (0, 0, 1.24),  (0, 0, 1.38), 'spine1')
bone('chest',  (0, 0, 1.38),  (0, 0, 1.52), 'spine2')
bone('neck',   (0, 0, 1.52),  (0, 0, 1.575), 'chest')
bone('head',   (0, 0, 1.575), (0, 0, 1.75), 'neck')
for side, s in (('L', 1), ('R', -1)):
    sx = lambda v: v * s
    bone(f'shoulder{side}', (sx(0.045), 0, 1.475), (sx(0.175), 0, 1.47), 'chest')
    bone(f'upperarm{side}', (sx(0.20), -0.004, 1.435), (sx(0.232), 0, 1.16), f'shoulder{side}')
    bone(f'forearm{side}',  (sx(0.232), 0, 1.16), (sx(0.242), 0, 0.935), f'upperarm{side}')
    bone(f'hand{side}',     (sx(0.242), 0, 0.935), (sx(0.244), 0, 0.80), f'forearm{side}')
    bone(f'thigh{side}',    (sx(0.085), 0, 0.96), (sx(0.092), 0, 0.50), 'root')
    bone(f'shin{side}',     (sx(0.092), 0, 0.50), (sx(0.094), 0, 0.13), f'thigh{side}')
    bone(f'foot{side}',     (sx(0.094), 0, 0.13), (sx(0.094), -0.14, 0.045), f'shin{side}')
    bone(f'toe{side}',      (sx(0.094), -0.14, 0.045), (sx(0.094), -0.235, 0.03), f'foot{side}')
bpy.ops.object.mode_set(mode='OBJECT')

# ---------------------------------------------------------------- weights (per object, segment-based)
SEG = {
    'root':   ((0, 0, 0.98), (0, 0, 1.10)),
    'spine1': ((0, 0, 1.10), (0, 0, 1.24)),
    'spine2': ((0, 0, 1.24), (0, 0, 1.38)),
    'chest':  ((0, 0, 1.38), (0, 0, 1.52)),
    'neck':   ((0, 0, 1.52), (0, 0, 1.575)),
    'head':   ((0, 0, 1.575), (0, 0, 1.75)),
}
for side, s in (('L', 1), ('R', -1)):
    sx = lambda v: v * s
    SEG[f'shoulder{side}'] = ((sx(0.045), 0, 1.475), (sx(0.175), 0, 1.47))
    SEG[f'upperarm{side}'] = ((sx(0.20), 0, 1.435), (sx(0.232), 0, 1.16))
    SEG[f'forearm{side}'] = ((sx(0.232), 0, 1.16), (sx(0.242), 0, 0.935))
    SEG[f'hand{side}'] = ((sx(0.242), 0, 0.935), (sx(0.244), 0, 0.80))
    SEG[f'thigh{side}'] = ((sx(0.085), 0, 0.96), (sx(0.092), 0, 0.50))
    SEG[f'shin{side}'] = ((sx(0.092), 0, 0.50), (sx(0.094), 0, 0.13))
    SEG[f'foot{side}'] = ((sx(0.094), 0, 0.13), (sx(0.094), -0.14, 0.045))
    SEG[f'toe{side}'] = ((sx(0.094), -0.14, 0.045), (sx(0.094), -0.235, 0.03))

CHAINS = {
    'armL': ['upperarmL', 'forearmL', 'handL', 'shoulderL'],
    'armR': ['upperarmR', 'forearmR', 'handR', 'shoulderR'],
    'legL': ['thighL', 'shinL', 'footL', 'toeL'],
    'legR': ['thighR', 'shinR', 'footR', 'toeR'],
    'spine': ['root', 'spine1', 'spine2', 'chest', 'neck', 'head'],
}
CHAIN_OF = {}
for cn, ms in CHAINS.items():
    for m in ms: CHAIN_OF[m] = cn

def pt_seg_dist(p, a, b):
    a, b = Vector(a), Vector(b)
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return (p - (a + ab * t)).length

for o, _m in parts:
    o.parent = arm
    mod = o.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm
    for bn in arm.data.bones: o.vertex_groups.new(name=bn.name)
    for i, v in enumerate(o.data.vertices):
        p = v.co  # objects at identity: local == world
        ranked = sorted((pt_seg_dist(p, *SEG[bn]), bn) for bn in SEG)
        d1, b1 = ranked[0]
        w = {b1: 1.0}
        if len(ranked) > 1:
            d2, b2 = ranked[1]
            if CHAIN_OF.get(b1) == CHAIN_OF.get(b2) and d2 < d1 * 1.35 and not b1.startswith(('hand', 'foot', 'toe')):
                w = {b1: 0.72, b2: 0.28}
        for bn, wt in w.items():
            o.vertex_groups[bn].add([i], wt, 'REPLACE')
print('[char] weights done on', len(parts), 'parts')

# ---------------------------------------------------------------- animation
P = arm.pose.bones
for pb in P.values():
    pb.rotation_mode = 'QUATERNION'

def bone_axes(pname):
    """world->bone-local rotation for angle application"""
    pb = P[pname]
    m = (arm.matrix_world @ pb.bone.matrix_local).to_3x3().inverted()
    return m

def key_rot(name, frame, world_axis, deg):
    pb = P[name]
    ax = (bone_axes(name) @ world_axis).normalized()
    pb.rotation_quaternion = Quaternion(ax, D(deg))
    pb.keyframe_insert('rotation_quaternion', frame=frame)

def key_loc(name, frame, loc):
    P[name].location = loc
    P[name].keyframe_insert('location', frame=frame)

def new_action(name):
    a = bpy.data.actions.new(name)
    a.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = a
    return a

def release(a):
    a.use_fake_user = True
    if arm.animation_data: arm.animation_data.action = None

def clear_pose():
    for pb in P.values():
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)

# --- WALK: 32-frame cycle (keys 1..33, f33 == f1)
def make_walk():
    a = new_action('Walk')
    for f, z, x in ((1, 0.0, 0.006), (9, -0.030, 0.012), (17, 0.0, 0.006), (25, 0.026, -0.012), (33, 0.0, 0.006)):
        key_loc('root', f, (x, 0, z))
    # thighs: NEG=fwd. L back at f1, R fwd at f1
    for f, ang in ((1, 27), (9, 12), (17, -27), (25, 10), (33, 27)):
        key_rot('thighL', f, X, ang)
    for f, ang in ((1, -27), (9, 10), (17, 27), (25, -12), (33, -27)):
        key_rot('thighR', f, X, ang)
    # shins: POS=bend (heel back)
    for f, ang in ((1, 8), (9, 22), (17, 12), (25, 52), (33, 8)):
        key_rot('shinL', f, X, ang)
    for f, ang in ((1, 12), (9, 52), (17, 8), (25, 22), (33, 12)):
        key_rot('shinR', f, X, ang)
    # feet: POS=toe down
    for f, ang in ((1, 0), (9, 6), (17, 24), (25, -12), (33, 0)):
        key_rot('footL', f, X, ang)
    for f, ang in ((1, 24), (9, -12), (17, 0), (25, 6), (33, 24)):
        key_rot('footR', f, X, ang)
    for f, ang in ((17, 18), (33, 0)):
        key_rot('toeL', f, X, ang)
    for f, ang in ((1, 18), (17, 0), (33, 18)):
        key_rot('toeR', f, X, ang)
    # arms opposite legs (NEG=fwd): L arm fwd at f1
    for f, ang in ((1, -20), (9, -6), (17, 25), (25, 10), (33, -20)):
        key_rot('upperarmL', f, X, ang)
    for f, ang in ((1, 25), (9, 10), (17, -20), (25, -6), (33, 25)):
        key_rot('upperarmR', f, X, ang)
    for f, ang in ((1, 14), (17, 32), (33, 14)):
        key_rot('forearmL', f, X, ang)
    for f, ang in ((1, 32), (17, 14), (33, 32)):
        key_rot('forearmR', f, X, ang)
    # torso counter-yaw + lean
    for f, ang in ((1, -5), (17, 5), (33, -5)):
        key_rot('spine2', f, Z, ang)
    for f, ang in ((1, 3), (17, -3), (33, 3)):
        key_rot('chest', f, Z, ang)
    for f in (1, 17, 33): key_rot('spine1', f, X, 4)
    for f, ang in ((1, 3), (17, -3), (33, 3)):
        key_rot('head', f, Z, ang)
    release(a)

# --- RUN: 24-frame cycle (keys 1..25)
def make_run():
    a = new_action('Run')
    for f, z in ((1, 0.012), (6, -0.040), (13, 0.030), (19, -0.040), (25, 0.012)):
        key_loc('root', f, (0, 0, z))
    for f, ang in ((1, 42), (6, 18), (13, -48), (19, 6), (25, 42)):
        key_rot('thighL', f, X, ang)
    for f, ang in ((1, -48), (6, 6), (13, 42), (19, 18), (25, -48)):
        key_rot('thighR', f, X, ang)
    for f, ang in ((1, 18), (6, 45), (13, 20), (19, 100), (25, 18)):
        key_rot('shinL', f, X, ang)
    for f, ang in ((1, 20), (6, 100), (13, 18), (19, 45), (25, 20)):
        key_rot('shinR', f, X, ang)
    for f, ang in ((1, 8), (13, -30), (25, 8)):
        key_rot('footL', f, X, ang)
    for f, ang in ((1, -30), (13, 8), (25, -30)):
        key_rot('footR', f, X, ang)
    for f, ang in ((1, 38), (13, -46), (25, 38)):
        key_rot('upperarmL', f, X, ang)
    for f, ang in ((1, -46), (13, 38), (25, -46)):
        key_rot('upperarmR', f, X, ang)
    for f in (1, 13, 25):
        key_rot('forearmL', f, X, 88)
        key_rot('forearmR', f, X, 88)
    for f, ang in ((1, 14), (13, -14), (25, 14)):
        key_rot('spine2', f, Z, ang)
    for f in (1, 13, 25): key_rot('spine1', f, X, 12)
    release(a)

# --- IDLE: 24-frame loop
def make_idle():
    a = new_action('Idle')
    for f, z in ((1, 0.006), (13, 0.014), (25, 0.006)):
        key_loc('root', f, (0, 0, z))
    for f, ang in ((1, 2), (13, 5), (25, 2)):
        key_rot('spine1', f, X, ang)
    for f, ang in ((1, 1.5), (13, -0.5), (25, 1.5)):
        key_rot('chest', f, X, ang)
    for f, ang in ((1, 2), (13, 4), (25, 2)):
        key_rot('upperarmL', f, X, ang)
        key_rot('upperarmR', f, X, ang)
    for f in (1, 13, 25):
        key_rot('forearmL', f, X, 7)
        key_rot('forearmR', f, X, 7)
    for f, ang in ((1, -6), (13, 6), (25, -6)):
        key_rot('head', f, Z, ang)
    for f, ang in ((1, 1), (13, -1), (25, 1)):
        key_rot('thighL', f, X, ang)
        key_rot('thighR', f, X, ang)
    release(a)

# --- JUMP: 38 frames, one-shot
def make_jump():
    a = new_action('Jump')
    for f, z in ((1, 0.0), (7, -0.22), (14, 0.10), (20, 0.16), (27, 0.06), (32, -0.10), (38, 0.0)):
        key_loc('root', f, (0, 0, z))
    # thighs NEG=fwd: crouch fwd, launch extend back, tuck fwd
    for f, ang in ((1, 0), (7, 78), (14, -22), (20, 62), (27, -18), (32, 40), (38, 0)):
        key_rot('thighL', f, X, ang)
        key_rot('thighR', f, X, ang)
    for f, ang in ((1, 2), (7, 96), (14, 8), (20, 112), (27, 30), (32, 55), (38, 2)):
        key_rot('shinL', f, X, ang)
        key_rot('shinR', f, X, ang)
    for f, ang in ((1, 0), (7, -12), (14, 18), (20, -8), (27, 10), (32, 4), (38, 0)):
        key_rot('footL', f, X, ang)
        key_rot('footR', f, X, ang)
    # arms BOTH together: POS=back, NEG=fwd/up
    for f, ang in ((1, 0), (7, 46), (14, -68), (20, -82), (27, -20), (32, 24), (38, 0)):
        key_rot('upperarmL', f, X, ang)
        key_rot('upperarmR', f, X, ang)
    for f in (1, 7, 14, 20, 27, 32, 38):
        key_rot('forearmL', f, X, 12)
        key_rot('forearmR', f, X, 12)
    for f, ang in ((1, 2), (7, 26), (14, -6), (20, -10), (27, 8), (32, 14), (38, 2)):
        key_rot('spine1', f, X, ang)
    release(a)

clear_pose(); make_walk()
clear_pose(); make_run()
clear_pose(); make_idle()
clear_pose(); make_jump()
clear_pose()

# ---------------------------------------------------------------- sanity: pose extremes
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
if arm.animation_data: arm.animation_data.action = bpy.data.actions['Walk']
bpy.context.scene.frame_set(1)
bpy.context.view_layer.update()
def bone_head_w(name):
    pb = P[name]
    return arm.matrix_world @ pb.matrix @ Vector(pb.bone.head_local)
try:
    print('[char] f1 thighL-head z:', round(bone_head_w('thighL').z, 3), '(knee raised = fwd swing leg)')
except Exception as ex:
    print('[char] sanity skipped:', ex)
if arm.animation_data: arm.animation_data.action = None

# ---------------------------------------------------------------- export
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    export_animation_mode='ACTIONS',
    export_animations=True,
    export_skins=True,
    export_morph_animation=False,
    export_yup=True,
    export_apply=False,
)
print('[char] exported', OUT, os.path.getsize(OUT), 'bytes')
