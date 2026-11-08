import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { MiniThreeRuntime } from 'mini-three-adapter';

/** A minimal rotating cube with working OrbitControls touch input. */
export function startScene(runtime: MiniThreeRuntime): void {
  const { canvas, windowInfo } = runtime;

  const renderer = new THREE.WebGLRenderer({
    ...runtime.rendererHints,
    // WebGL2 is the only backend supported by three >= r163 and by this adapter.
  });
  renderer.setPixelRatio(windowInfo.pixelRatio);
  renderer.setSize(windowInfo.width, windowInfo.height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101820);

  const camera = new THREE.PerspectiveCamera(60, windowInfo.width / windowInfo.height, 0.1, 100);
  camera.position.set(2.4, 1.8, 3.2);

  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x44aaff, roughness: 0.35, metalness: 0.1 }),
  );
  scene.add(cube);
  scene.add(new THREE.AmbientLight(0xffffff, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 2);
  key.position.set(3, 5, 4);
  scene.add(key);
  scene.add(new THREE.GridHelper(10, 10));

  // Controls attach to renderer.domElement (our patched canvas) and receive
  // PointerEvents through runtime.bridge automatically via wx.onTouch*.
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  // Modern three.js loop API. runtime.frames is available if you need FPS/fpsCap.
  renderer.setAnimationLoop((time: number) => {
    cube.rotation.x = time * 0.0004;
    cube.rotation.y = time * 0.0006;
    controls.update();
    renderer.render(scene, camera);
  });

  runtime.on('resize', (info) => {
    camera.aspect = info.width / info.height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(info.pixelRatio);
    renderer.setSize(info.width, info.height, false);
  });

  runtime.on('visibilitychange', (visible) => {
    if (!visible) renderer.setAnimationLoop(null);
  });

  runtime.on('dispose', () => {
    renderer.setAnimationLoop(null);
    controls.dispose();
    cube.geometry.dispose();
    (cube.material as THREE.Material).dispose();
    renderer.dispose();
  });
}
