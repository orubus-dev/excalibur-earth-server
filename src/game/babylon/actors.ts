/** game/babylon/actors.ts — rigged character kit: load GLB once, clone with palette swaps, blend anims. */
import type { Scene } from '@babylonjs/core/scene';
import { Vector3, Color3 } from '@babylonjs/core/Maths/math';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import { Skeleton, Bone } from '@babylonjs/core/Bones';
import { Material, StandardMaterial, PBRMaterial } from '@babylonjs/core/Materials';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import '@babylonjs/loaders/glTF';

export interface CharacterKit {
  make: (opts?: { name?: string; palette?: number }) => Actor;
  dispose: () => void;
}

export interface Actor {
  root: TransformNode;
  groups: Record<string, AnimationGroup>;
  play: (name: 'Idle' | 'Walk' | 'Run' | 'Jump', speedRatio?: number, loop?: boolean) => void;
  heading: number;
  dispose: () => void;
  height: number;
}

const SKINS = [0x8a5a3b, 0x6f4630, 0xa06a44, 0x5a3a28, 0x96603c];
const TEES = [0x1c1c1e, 0xd94f3a, 0x2f8f6b, 0xe0a63c, 0x3a6ea8, 0xefe6d8, 0xc25a9a, 0x37a05a];
const PANTS = [0x232527, 0x4a4038, 0x27425e, 0x59504a, 0x2c3038];

export const LAGOS_NAMES = ['Adaeze', 'Tunde', 'Chidi', 'Funke', 'Emeka', 'Ngozi', 'Sade', 'Kelechi', 'Bola', 'Ifeoma', 'Yemi', 'Obinna', 'Amara', 'Segun', 'Halima', 'Damilola'];

interface KitInternals {
  sourceMeshes: Mesh[];
  sourceSkeleton: Skeleton;
  sourceGroups: Record<string, AnimationGroup>;
  baseMats: Map<string, Material>;
}

export async function loadCharacterKit(scene: Scene): Promise<CharacterKit> {
  const res = await SceneLoader.ImportMeshAsync('', '/assets/', 'character.glb', scene);
  const skinned = res.meshes.find(m => (m as Mesh).skeleton) as Mesh | undefined;
  if (!skinned) throw new Error('character.glb: no skinned mesh');
  const sourceSkeleton = skinned.skeleton!;
  const sourceGroups: Record<string, AnimationGroup> = {};
  for (const g of res.animationGroups) sourceGroups[g.name] = g;

  // stop all source anims; they must never run on the source
  for (const g of res.animationGroups) g.stop();

  // convert glTF PBR materials -> StandardMaterial (no env needed, palette-tintable)
  for (const m of res.meshes) {
    if (m instanceof Mesh && m.material && m.material instanceof PBRMaterial) {
      const pbr = m.material;
      const sm = new StandardMaterial('std_' + pbr.name, scene);
      sm.diffuseColor = pbr.albedoColor ?? new Color3(0.75, 0.75, 0.75);
      sm.specularColor = new Color3(0.10, 0.10, 0.10);
      sm.specularPower = 24;
      m.material = sm;
    }
  }

  // stash original materials so clones can be tinted per-instance
  const baseMats = new Map<string, Material>();
  for (const m of res.meshes) {
    if (m instanceof Mesh && m.material) {
      if (!baseMats.has(m.material.name)) baseMats.set(m.material.name, m.material);
    }
  }

  const tint = (hex: number, mat: Material): StandardMaterial => {
    const sm = (mat.clone(`t${hex}_${mat.name}`)) as StandardMaterial;
    if (sm.diffuseColor) sm.diffuseColor = Color3.FromHexString('#' + hex.toString(16).padStart(6, '0'));
    return sm;
  };

  const make = (opts?: { name?: string; palette?: number }): Actor => {
    const p = opts?.palette ?? Math.floor(Math.random() * 1000);
    const rng = ((): (() => number) => { let s = p * 9301 + 49297; return () => { s = (s * 233280 + 8121) % 2147483647; return s / 2147483647; }; })();
    const name = opts?.name ?? 'actor';

    const skelClone = sourceSkeleton.clone(`${name}_skel`);
    const root = new TransformNode(`${name}_root`, scene);

    // clone hierarchy
    const srcRoot = (res.meshes[0].parent as TransformNode | null) ?? res.meshes[0];
    const map = new Map<unknown, unknown>();
    const cloneNode = (src: Mesh | TransformNode, parent: TransformNode | null): void => {
      if (src instanceof Mesh) {
        const c = src.clone(`${name}_${src.name}`, parent);
        c.skeleton = skelClone;
        map.set(src, c);
        return;
      }
      const tn = new TransformNode(`${name}_${src.name}`, scene);
      tn.parent = parent;
      tn.position.copyFrom(src.position);
      tn.rotationQuaternion = src.rotationQuaternion?.clone() ?? null;
      tn.scaling.copyFrom(src.scaling);
      map.set(src, tn);
      for (const child of src.getChildMeshes()) cloneNode(child as Mesh, tn);
      for (const child of src.getChildTransformNodes(false)) cloneNode(child as TransformNode, tn);
    };
    if (srcRoot instanceof Mesh) { /* root mesh directly */ }
    if (srcRoot instanceof TransformNode && !(srcRoot instanceof Mesh)) {
      for (const child of srcRoot.getChildTransformNodes(false)) cloneNode(child, root);
      for (const child of srcRoot.getChildMeshes()) cloneNode(child as Mesh, root);
    } else {
      cloneNode(srcRoot as Mesh, root);
    }

    // palette swap on clones (skin/tee/pants/hair materials by name)
    const refLook = (opts?.palette ?? 1) === 0;  // palette 0 = the reference character
    const skinHex = refLook ? 0x6f4630 : SKINS[Math.floor(rng() * SKINS.length)];
    const teeHex = refLook ? 0x1c1c1e : TEES[Math.floor(rng() * TEES.length)];
    const pantsHex = refLook ? 0x232527 : PANTS[Math.floor(rng() * PANTS.length)];
    for (const [, cloned] of map) {
      if (cloned instanceof Mesh && cloned.material) {
        const mn = cloned.material.name;
        let mat: Material = cloned.material;
        if (mn.includes('ex_skin')) mat = tint(skinHex, cloned.material);
        else if (mn.includes('ex_tee')) mat = tint(teeHex, cloned.material);
        else if (mn.includes('ex_pants')) mat = tint(pantsHex, cloned.material);
        cloned.material = mat;
        cloned.receiveShadows = true;
      }
    }

    // clone animation groups retargeted to clones (meshes + bones)
    const boneMap = new Map<Bone, Bone>();
    sourceSkeleton.bones.forEach((b, i) => boneMap.set(b, skelClone.bones[i]));
    const groups: Record<string, AnimationGroup> = {};
    for (const [gn, g] of Object.entries(sourceGroups)) {
      const cg = new AnimationGroup(`${name}_${gn}`, scene);
      for (const ta of g.targetedAnimations) {
        const t = (ta.target instanceof Bone) ? (boneMap.get(ta.target) ?? ta.target) : (map.get(ta.target) ?? ta.target);
        cg.addTargetedAnimation(ta.animation, t);
      }
      groups[gn] = cg;
    }

    const actor: Actor = {
      root,
      groups,
      heading: 0,
      height: 1.77,
      play(gname, speedRatio = 1, loop = true) {
        for (const [k, g] of Object.entries(groups)) {
          if (k === gname) {
            g.reset();
            g.start(loop, speedRatio, g.from, g.to);
          } else g.stop();
        }
      },
      dispose() {
        for (const g of Object.values(groups)) g.dispose();
        for (const [, c] of map) (c as { dispose?: () => void }).dispose?.();
        skelClone.dispose();
        root.dispose();
      }
    };
    actor.play('Idle');
    return actor;
  };

  const kit: KitInternals = { sourceMeshes: res.meshes as Mesh[], sourceSkeleton, sourceGroups, baseMats };
  void kit;

  return {
    make,
    dispose() {
      for (const g of Object.values(sourceGroups)) g.dispose();
      skinned.dispose();
      sourceSkeleton.dispose();
    }
  };
}
