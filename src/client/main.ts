import * as THREE from 'three';
import { exportSceneToSVG } from './exporter';
import type { RasterToVectorSVGOptions } from './types';

const viewer = document.getElementById('viewer') as HTMLDivElement;
const status = document.getElementById('status') as HTMLPreElement;
const downloadLink = document.getElementById('downloadLink') as HTMLAnchorElement;
const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;

const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, preserveDrawingBuffer: false });
renderer.setSize(viewer.clientWidth, viewer.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
viewer.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf3f3f3);

const camera = new THREE.PerspectiveCamera(45, viewer.clientWidth / viewer.clientHeight, 0.1, 1000);
camera.position.set(18, 15, 18);
camera.lookAt(0, 3, 0);

const ambient = new THREE.AmbientLight(0xffffff, 0.85);
scene.add(ambient);

const dir = new THREE.DirectionalLight(0xffffff, 1.2);
dir.position.set(10, 20, 10);
scene.add(dir);

const grid = new THREE.GridHelper(40, 40, 0x999999, 0xcccccc);
scene.add(grid);

buildDemoBim(scene);

function animate() {
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

window.addEventListener('resize', () => {
  const width = viewer.clientWidth;
  const height = viewer.clientHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
});

exportBtn.addEventListener('click', async () => {
  exportBtn.disabled = true;
  downloadLink.style.display = 'none';
  status.textContent = 'Raster katmanları hazırlanıyor ve backend tarafında SVG üretiliyor...';

  try {
    const options = collectOptions();
    const result = await exportSceneToSVG(renderer, scene, camera, options);

    const blob = new Blob([result.svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    downloadLink.href = url;
    downloadLink.style.display = 'inline-block';

    // status.textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    status.textContent = `Hata: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    exportBtn.disabled = false;
  }
});

function collectOptions(): Partial<RasterToVectorSVGOptions> {
  const getNumber = (id: string) => Number((document.getElementById(id) as HTMLInputElement).value);
  const getBool = (id: string) => (document.getElementById(id) as HTMLSelectElement).value === 'true';
  const getValue = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement).value;

  return {
    scaleFactor: getNumber('scaleFactor'),
    edgeThresholdAngle: getNumber('edgeThresholdAngle'),
    includeFills: getBool('includeFills'),
    includeShading: getBool('includeShading'),
    edgeVectorizer: getValue('edgeVectorizer') as 'potrace' | 'vtracer',
    fillVectorizer: 'vtracer',
    potraceAlphaMax: getNumber('potraceAlphaMax'),
    potraceTurdSize: getNumber('potraceTurdSize'),
    potraceOptTolerance: getNumber('potraceOptTolerance'),
    vtracerMode: 'polygon',
    vtracerCornerThreshold: getNumber('vtracerCornerThreshold'),
    vtracerFilterSpeckle: getNumber('vtracerFilterSpeckle'),
    vtracerColorPrecision: getNumber('vtracerColorPrecision'),
    optimizeSVG: false,
    svgoFloatPrecision: getNumber('svgoFloatPrecision'),
    shadingOpacity: 0.15,
  };
}

function buildDemoBim(targetScene: THREE.Scene) {
  const root = new THREE.Group();

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(20, 0.5, 14),
    new THREE.MeshStandardMaterial({ color: 0xd7d7d7 })
  );
  floor.position.y = -0.25;
  root.add(floor);

  const towerMaterial = new THREE.MeshStandardMaterial({ color: 0xc8d6e5 });
  const glassMaterial = new THREE.MeshStandardMaterial({ color: 0x7f8fa6 });
  const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x576574 });

  const leftBlock = createBuildingBlock(6, 8, 6, towerMaterial, glassMaterial, roofMaterial);
  leftBlock.position.set(-4, 4, 0);
  root.add(leftBlock);

  const rightBlock = createBuildingBlock(6, 10, 6, towerMaterial, glassMaterial, roofMaterial);
  rightBlock.position.set(4, 5, 0);
  root.add(rightBlock);

  const connector = new THREE.Mesh(
    new THREE.BoxGeometry(4, 4, 6),
    new THREE.MeshStandardMaterial({ color: 0xb2bec3 })
  );
  connector.position.set(0, 2, 0);
  root.add(connector);

  const columns = new THREE.Group();
  for (const x of [-7, -5, -3, 3, 5, 7]) {
    const column = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 3.5, 0.35),
      new THREE.MeshStandardMaterial({ color: 0x95a5a6 })
    );
    column.position.set(x, 1.75, 6);
    columns.add(column);
  }
  root.add(columns);

  targetScene.add(root);
}

function createBuildingBlock(
  width: number,
  height: number,
  depth: number,
  wallMaterial: THREE.Material,
  glassMaterial: THREE.Material,
  roofMaterial: THREE.Material
): THREE.Group {
  const group = new THREE.Group();

  const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), wallMaterial);
  group.add(body);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(width + 0.4, 0.3, depth + 0.4), roofMaterial);
  roof.position.y = height / 2 + 0.15;
  group.add(roof);

  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const windowMesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 0.1),
        glassMaterial
      );
      windowMesh.position.set(-width / 2 + 1.4 + col * 1.6, -height / 2 + 1.5 + row * 1.8, depth / 2 + 0.06);
      group.add(windowMesh);

      const backWindow = windowMesh.clone();
      backWindow.position.z = -depth / 2 - 0.06;
      group.add(backWindow);
    }
  }

  return group;
}
