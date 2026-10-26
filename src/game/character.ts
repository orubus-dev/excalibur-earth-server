/** game/character.ts — procedural rigged humanoids (player + citizens). Smooth, expressive, zero assets. */
import * as THREE from 'three';

export interface Persona {
  skin: number; shirt: number; pants: number; hair: number;
  female: boolean; cap: boolean; scale: number; name: string;
}

export const LAGOS_NAMES = ['Adaeze', 'Tunde', 'Chidi', 'Funke', 'Emeka', 'Ngozi', 'Sade', 'Kelechi', 'Bola', 'Ifeoma', 'Yemi', 'Obinna', 'Amara', 'Segun', 'Halima', 'Damilola'];

export function randomPersona(rng: () => number, name?: string): Persona {
  const skins = [0x8a5a3b, 0x6f4630, 0xa06a44, 0x5a3a28, 0x96603c];
  const shirts = [0xd94f3a, 0x2f8f6b, 0xe0a63c, 0x3a6ea8, 0xc25a9a, 0xefe6d8, 0x4a4a52, 0x37a05a];
  const pants = [0x2c3038, 0x4a4038, 0x6b625a, 0x27425e, 0x59504a];
  return {
    skin: skins[Math.floor(rng() * skins.length)],
    shirt: shirts[Math.floor(rng() * shirts.length)],
    pants: pants[Math.floor(rng() * pants.length)],
    hair: 0x17110c,
    female: rng() > 0.55,
    cap: rng() > 0.72,
    scale: 0.95 + rng() * 0.1,
    name: name ?? LAGOS_NAMES[Math.floor(rng() * LAGOS_NAMES.length)]
  };
}

const capsule = (r: number, len: number): THREE.CapsuleGeometry => new THREE.CapsuleGeometry(r, len, 3, 8);

export class Character {
  root = new THREE.Group();
  private hips: THREE.Group; private torso: THREE.Group; private head: THREE.Group;
  private armL: THREE.Group; private armR: THREE.Group;
  private legL: THREE.Group; private legR: THREE.Group;
  private kneeL: THREE.Group; private kneeR: THREE.Group;
  private elbowL: THREE.Group; private elbowR: THREE.Group;
  private chest: THREE.Mesh;
  phase = Math.random() * 10;
  private mats: THREE.Material[] = [];

  constructor(p: Persona) {
    const M = (c: number, rough = 0.75): THREE.MeshStandardMaterial => {
      const m = new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0.02 });
      this.mats.push(m);
      return m;
    };
    const skin = M(p.skin, 0.55), shirt = M(p.shirt), pants = M(p.pants), shoe = M(0x1a1a1c, 0.5), hairM = M(p.hair, 0.9);

    this.root.scale.setScalar(p.scale);

    // hips root at ~0.95m
    this.hips = new THREE.Group();
    this.hips.position.y = 0.95;
    this.root.add(this.hips);

    const pelvis = new THREE.Mesh(capsule(0.16, 0.1), pants);
    pelvis.rotation.z = Math.PI / 2;
    this.hips.add(pelvis);

    this.torso = new THREE.Group();
    this.torso.position.y = 0.12;
    this.hips.add(this.torso);
    this.chest = new THREE.Mesh(capsule(0.17, 0.34), shirt);
    this.chest.position.y = 0.26;
    this.torso.add(this.chest);
    if (p.female) {
      const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.23, 0.5, 10, 1, true), M(p.shirt === 0xefe6d8 ? 0x3a6ea8 : p.pants));
      skirt.position.y = -0.18;
      this.torso.add(skirt);
    }

    this.head = new THREE.Group();
    this.head.position.y = 0.58;
    this.torso.add(this.head);
    const skull = new THREE.Mesh(capsule(0.115, 0.09), skin);
    skull.position.y = 0.09;
    this.head.add(skull);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.122, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM);
    hair.position.y = 0.115;
    this.head.add(hair);
    if (p.cap) {
      const capTop = new THREE.Mesh(new THREE.SphereGeometry(0.126, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.42), M(0xc23b2e));
      capTop.position.y = 0.13;
      this.head.add(capTop);
      const brim = new THREE.Mesh(new THREE.CircleGeometry(0.12, 12, 0, Math.PI), M(0xc23b2e));
      brim.rotation.x = -Math.PI / 2;
      brim.position.set(0, 0.105, 0.1);
      this.head.add(brim);
    }

    const mkArm = (side: -1 | 1): { g: THREE.Group; e: THREE.Group } => {
      const g = new THREE.Group();
      g.position.set(side * 0.24, 0.42, 0);
      const upper = new THREE.Mesh(capsule(0.055, 0.22), shirt);
      upper.position.y = -0.14;
      g.add(upper);
      const e = new THREE.Group();
      e.position.y = -0.3;
      g.add(e);
      const fore = new THREE.Mesh(capsule(0.048, 0.2), skin);
      fore.position.y = -0.13;
      e.add(fore);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), skin);
      hand.position.y = -0.26;
      e.add(hand);
      this.torso.add(g);
      return { g, e };
    };
    const mkLeg = (side: -1 | 1): { g: THREE.Group; k: THREE.Group } => {
      const g = new THREE.Group();
      g.position.set(side * 0.1, 0, 0);
      const thigh = new THREE.Mesh(capsule(0.075, 0.3), pants);
      thigh.position.y = -0.2;
      g.add(thigh);
      const k = new THREE.Group();
      k.position.y = -0.44;
      g.add(k);
      const calf = new THREE.Mesh(capsule(0.06, 0.28), p.female ? skin : pants);
      calf.position.y = -0.18;
      k.add(calf);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.07, 0.24), shoe);
      foot.position.set(0, -0.36, 0.05);
      k.add(foot);
      this.hips.add(g);
      return { g, k };
    };
    const aL = mkArm(-1), aR = mkArm(1), lL = mkLeg(-1), lR = mkLeg(1);
    this.armL = aL.g; this.elbowL = aL.e;
    this.armR = aR.g; this.elbowR = aR.e;
    this.legL = lL.g; this.kneeL = lL.k;
    this.legR = lR.g; this.kneeR = lR.k;
  }

  /** speed m/s; grounded; dt seconds */
  animate(speed: number, dt: number, grounded = true): void {
    const run = speed > 3.6;
    const stride = run ? 9.4 : 6.2;
    this.phase += dt * stride * Math.max(speed, 0.001) * 0.55 + (speed < 0.05 ? dt * 1.4 : 0);
    const t = this.phase;
    const swing = run ? 0.85 : 0.62;
    const amp = Math.min(1, speed / (run ? 6.2 : 2.6)) * swing;

    if (grounded) {
      const s = Math.sin(t), c = Math.cos(t);
      this.legL.rotation.x = s * amp;
      this.legR.rotation.x = -s * amp;
      this.kneeL.rotation.x = Math.max(0, -c) * amp * 1.3;
      this.kneeR.rotation.x = Math.max(0, c) * amp * 1.3;
      this.armL.rotation.x = -s * amp * 0.8;
      this.armR.rotation.x = s * amp * 0.8;
      this.elbowL.rotation.x = -Math.abs(s) * amp * 0.5 - 0.15;
      this.elbowR.rotation.x = -Math.abs(c) * amp * 0.5 - 0.15;
      this.hips.position.y = 0.95 + Math.abs(s) * (run ? 0.045 : 0.028);
      this.torso.rotation.x = run ? 0.16 : amp * 0.06;
      this.torso.rotation.y = s * amp * 0.08;
      this.chest.scale.y = 1 + Math.sin(t * 0.5) * 0.012; // breathing
      this.head.rotation.y = Math.sin(t * 0.23) * 0.12;   // looking around
    } else {
      // jump tuck
      const s = Math.sin(t);
      this.legL.rotation.x = 0.5 + s * 0.1;
      this.legR.rotation.x = 0.5 - s * 0.1;
      this.kneeL.rotation.x = -0.9;
      this.kneeR.rotation.x = -0.9;
      this.armL.rotation.x = -0.7;
      this.armR.rotation.x = -0.7;
    }
  }

  dispose(): void {
    this.root.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    for (const m of this.mats) m.dispose();
  }
}
