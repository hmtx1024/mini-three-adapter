import * as THREE from 'three';
import type { MiniThreeRuntime } from 'mini-three-adapter';

/** Deliberately identical in spirit to the mini game example. */
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
  renderer.setAnimationLoop((t: number) => {
    mesh.rotation.x = t * 0.0003;
    mesh.rotation.y = t * 0.0005;
    renderer.render(scene, camera);
  });
  runtime.on('resize', (info) => {
    camera.aspect = info.width / info.height;
    camera.updateProjectionMatrix();
    renderer.setSize(info.width, info.height, false);
  });
  runtime.on('dispose', () => renderer.dispose());
}
