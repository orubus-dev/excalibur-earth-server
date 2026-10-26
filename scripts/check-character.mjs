/** check-character.mjs — validate character.glb loads in Babylon: anims, skeleton, bounds. */
import { readFileSync } from 'node:fs';
import { NullEngine, Scene, SceneLoader, Vector3 } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

const buf = readFileSync(new URL('../public/assets/character.glb', import.meta.url));
const engine = new NullEngine();
const scene = new Scene(engine);
const data = new Uint8Array(buf);
const res = await SceneLoader.ImportMeshAsync('', 'data:', data, scene, undefined, '.glb');
console.log('meshes:', res.meshes.length, res.meshes.map(m => m.name).slice(0, 12).join(', '));
const skel = res.skeletons[0];
console.log('skeletons:', res.skeletons.length, '| bones:', skel ? skel.bones.length : 0);
console.log('anim groups:', res.animationGroups.map(g => `${g.name}[${g.from}-${g.to}] targets=${g.targetedAnimations.length}`).join('  '));
// bounds of whole transform nodes
let min = new Vector3(1e9, 1e9, 1e9), max = new Vector3(-1e9, -1e9, -1e9);
for (const m of res.meshes) {
  if (!m.getVerticesData('position')) continue;
  m.bakeCurrentTransformIntoVertices?.();
  const b = m.getBoundingInfo().boundingBox;
  for (const v of [b.minimumWorld, b.maximumWorld]) {
    min = Vector3.Minimize(min, v); max = Vector3.Maximize(max, v);
  }
}
console.log('bounds min', min.toString(), 'max', max.toString());
console.log('height(m):', (max.y - min.y).toFixed(2));
engine.dispose();
