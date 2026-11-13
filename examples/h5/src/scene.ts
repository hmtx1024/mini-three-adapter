import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { MiniThreeRuntime } from 'mini-three-adapter';

/**
 * Deliberately identical in spirit to the mini game example, plus OrbitControls:
 * on H5 the canvas keeps its native event system (ADR-0010), so a control that
 * binds `pointerdown` / `wheel` on `domElement` works with no bridging at all.
 */
export function startScene(runtime: MiniThreeRuntime): void {
  const renderer = new THREE.WebGLRenderer(runtime.rendererHints);
  renderer.setPixelRatio(runtime.windowInfo.pixelRatio);
  renderer.setSize(runtime.windowInfo.width, runtime.windowInfo.height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101820);
  const camera = new THREE.PerspectiveCamera(60, runtime.windowInfo.width / runtime.windowInfo.height, 0.1, 100);
  camera.position.z = 3;

  const mesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshNormalMaterial({ flatShading: true }),
  );
  scene.add(mesh);

  // `runtime.canvas` is the real <canvas>: drag and wheel zoom come straight
  // from the browser, no `handleTouch` forwarding involved.
  const controls = new OrbitControls(camera, runtime.canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 2;
  controls.maxDistance = 8;

  renderer.setAnimationLoop((t: number) => {
    mesh.rotation.x = t * 0.0003;
    mesh.rotation.y = t * 0.0005;
    controls.update();
    renderer.render(scene, camera);
  });

  runtime.on('resize', (info) => {
    camera.aspect = info.width / info.height;
    camera.updateProjectionMatrix();
    renderer.setSize(info.width, info.height, false);
  });
  runtime.on('dispose', () => {
    controls.dispose();
    renderer.dispose();
  });
}
