import * as THREE from 'three';
import type { MiniThreeRuntime } from 'mini-three-adapter';

export function startScene(runtime: MiniThreeRuntime): void {
  const renderer = new THREE.WebGLRenderer(runtime.rendererHints);
  renderer.setPixelRatio(runtime.windowInfo.pixelRatio);
  renderer.setSize(runtime.windowInfo.width, runtime.windowInfo.height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101820);
  const camera = new THREE.PerspectiveCamera(60, runtime.windowInfo.width / runtime.windowInfo.height, 0.1, 100);
  camera.position.z = 4;

  const mesh = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.8, 0.28, 128, 24),
    new THREE.MeshNormalMaterial(),
  );
  scene.add(mesh);

  renderer.setAnimationLoop((time: number) => {
    mesh.rotation.x = time * 0.0003;
    mesh.rotation.y = time * 0.0005;
    renderer.render(scene, camera);
  });

  runtime.on('resize', (info) => {
    camera.aspect = info.width / info.height;
    camera.updateProjectionMatrix();
    renderer.setSize(info.width, info.height, false);
  });
  runtime.on('dispose', () => {
    renderer.setAnimationLoop(null);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    renderer.dispose();
  });
}
