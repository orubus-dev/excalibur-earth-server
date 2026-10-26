/** game/environment.ts — sky, sun cycle (golden-hour Lagos), fog, post stack (bloom + grade). */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const SkyShader = {
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunTint;
    varying vec3 vDir;
    void main() {
      float h = clamp(vDir.y, -0.1, 1.0);
      vec3 col = mix(horizon, top, pow(max(h, 0.0), 0.55));
      float sun = pow(max(dot(normalize(vDir), normalize(sunDir)), 0.0), 350.0);
      float halo = pow(max(dot(normalize(vDir), normalize(sunDir)), 0.0), 8.0);
      col += sunTint * (sun * 2.2 + halo * 0.28);
      gl_FragColor = vec4(col, 1.0);
    }`
};

const GradeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uNight: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uNight;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // warm cinematic grade (golden hour bias), stronger at night
      vec3 warm = vec3(1.045, 1.0, 0.94);
      vec3 cool = vec3(0.96, 1.0, 1.09);
      c.rgb *= mix(warm, cool, uNight);
      c.rgb = pow(c.rgb, vec3(mix(0.98, 1.06, uNight)));
      // vignette
      float d = distance(vUv, vec2(0.5));
      c.rgb *= 1.0 - smoothstep(0.55, 0.95, d) * 0.32;
      gl_FragColor = c;
    }`
};

export class Environment {
  private scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sky: THREE.Mesh;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  grade: ShaderPass;
  hour = 16.6;                       // golden hour start (Lagos warmth)
  night = 0;                         // 0..1
  private sunDir = new THREE.Vector3();
  nightMats: THREE.MeshStandardMaterial[] = [];   // materials whose emissive syncs with night
  nightToggles: Array<{ obj: { visible: boolean }; max: number }> = []; // glow objects visible at night

  constructor(scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer, halfRes: boolean) {
    this.scene = scene;
    scene.fog = new THREE.Fog(0xe8c9a0, 150, 420);

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 24, 16),
      new THREE.ShaderMaterial({
        uniforms: {
          top: { value: new THREE.Color(0x77aede) },
          horizon: { value: new THREE.Color(0xe8c9a0) },
          sunDir: { value: new THREE.Vector3(0, 1, 0) },
          sunTint: { value: new THREE.Color(0xffc27a) }
        },
        vertexShader: SkyShader.vertexShader,
        fragmentShader: SkyShader.fragmentShader,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false
      })
    );
    scene.add(this.sky);

    this.hemi = new THREE.HemisphereLight(0xcfe4ff, 0x8a7a5e, 0.75);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffd9a8, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 400;
    const S = 90;
    this.sun.shadow.camera.left = -S;
    this.sun.shadow.camera.right = S;
    this.sun.shadow.camera.top = S;
    this.sun.shadow.camera.bottom = -S;
    this.sun.shadow.bias = -0.0004;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(
        Math.floor((renderer.domElement.clientWidth ?? 1280) / (halfRes ? 2 : 1)),
        Math.floor((renderer.domElement.clientHeight ?? 720) / (halfRes ? 2 : 1))
      ),
      0.38, 0.7, 0.82
    );
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader as never);
    this.composer.addPass(this.grade);
  }

  /** advance day cycle; keep shadow box on player */
  tick(dt: number, px: number, pz: number, renderer: THREE.WebGLRenderer): void {
    this.hour = (this.hour + dt / 20) % 24;   // full day = 20 real minutes
    const h = this.hour;
    // sun path: sunrise 6.5, sunset 18.7 (Lagos ~12h days)
    const dayT = (h - 6.5) / (18.7 - 6.5);
    const elev = Math.sin(Math.max(0, Math.min(1, dayT)) * Math.PI) * 1.05 - 0.06;
    const az = (h / 24) * Math.PI * 2 - Math.PI * 0.5;
    this.sunDir.set(Math.cos(az) * Math.cos(elev * Math.PI / 2), Math.max(0.02, Math.sin(elev * Math.PI / 2 + 0.12)), Math.sin(az) * Math.cos(elev * Math.PI / 2)).normalize();
    const day = Math.max(0, Math.min(1, elev * 3 + 0.25));
    this.night = 1 - day;

    this.sun.position.set(px + this.sunDir.x * 160, this.sunDir.y * 160 + 30, pz + this.sunDir.z * 160);
    this.sun.target.position.set(px, 0, pz);
    this.sun.intensity = 0.2 + day * 2.9;
    this.sun.color.setHSL(0.09 - day * 0.015, 0.62 - day * 0.35, 0.52 + day * 0.2);
    this.hemi.intensity = 0.38 + day * 0.95;

    const u = (this.sky.material as THREE.ShaderMaterial).uniforms;
    (u.top.value as THREE.Color).setHSL(0.58, 0.62, 0.06 + day * 0.5);
    (u.horizon.value as THREE.Color).setHSL(day > 0.25 ? 0.09 : 0.07, 0.5, 0.1 + day * 0.62);
    (u.sunDir.value as THREE.Vector3).copy(this.sunDir);
    (u.sunTint.value as THREE.Color).setRGB(1.0, 0.72 + day * 0.14, 0.42 + day * 0.18);

    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(u.horizon.value as THREE.Color).lerp(new THREE.Color(0x0a0d14), this.night * 0.85);
    fog.near = 140;
    fog.far = 320 + day * 140;

    this.grade.uniforms.uNight.value = this.night;
    this.bloom.strength = 0.34 + this.night * 0.3;

    // night-emissive materials (city windows, billboards) + glow toggles
    for (const m of this.nightMats) m.emissiveIntensity = this.night * (m.userData.nightMax ?? 1.15);
    for (const t of this.nightToggles) t.obj.visible = this.night > t.max;
  }

  setSize(w: number, hgt: number): void {
    this.composer.setSize(w, hgt);
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    this.sky.position.copy(camera.position);
    this.composer.render();
    void renderer; void scene;
  }
}
