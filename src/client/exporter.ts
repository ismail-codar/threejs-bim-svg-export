import * as THREE from "three";
import { RasterToVectorSVGOptions, ExportResponse } from "./types";

const defaultOptions: RasterToVectorSVGOptions = {
  scaleFactor: 4,
  edgeThresholdAngle: 15,
  includeFills: true,
  includeShading: false,
  edgeVectorizer: "potrace",
  fillVectorizer: "vtracer",
  potraceAlphaMax: 0,
  potraceTurdSize: 3,
  potraceOptTolerance: 0,
  vtracerMode: "polygon",
  vtracerCornerThreshold: 45,
  vtracerFilterSpeckle: 3,
  vtracerColorPrecision: 4,
  optimizeSVG: false,
  svgoFloatPrecision: 2,
  shadingOpacity: 0.15,
};

interface RasterExportPayload {
  edgePNGBase64: string;
  fillPNGBase64?: string;
  shadingPNGBase64?: string;
  width: number;
  height: number;
  options: RasterToVectorSVGOptions;
}

export async function exportSceneToSVG(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options?: Partial<RasterToVectorSVGOptions>,
): Promise<ExportResponse> {
  const resolved = { ...defaultOptions, ...options };
  const start = performance.now();
  const raster = await buildRasterPayload(renderer, scene, camera, resolved);

  const response = await fetch("http://localhost:3001/api/export-svg", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(raster),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "SVG export failed");
  }

  const json = (await response.json()) as ExportResponse;
  json.stats.renderTimeMs = Math.round(
    performance.now() -
      start -
      json.stats.vectorizeTimeMs -
      json.stats.optimizeTimeMs,
  );
  return json;
}

async function buildRasterPayload(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: RasterToVectorSVGOptions,
): Promise<RasterExportPayload> {
  const viewport = new THREE.Vector2();
  renderer.getSize(viewport);

  const width = Math.max(1, Math.floor(viewport.x * options.scaleFactor));
  const height = Math.max(1, Math.floor(viewport.y * options.scaleFactor));

  const edgeScene = buildEdgeScene(scene, options.edgeThresholdAngle);
  const edgePNGBase64 = await renderSceneToPNGBase64(
    renderer,
    edgeScene,
    camera,
    width,
    height,
    0xffffff,
  );

  let fillPNGBase64: string | undefined;
  if (options.includeFills) {
    const fillScene = buildFlatFillScene(scene);
    fillPNGBase64 = await renderSceneToPNGBase64(
      renderer,
      fillScene,
      camera,
      width,
      height,
      0xffffff,
    );
  }

  let shadingPNGBase64: string | undefined;
  if (options.includeShading) {
    const shadingScene = buildShadingScene(scene);
    shadingPNGBase64 = await renderSceneToPNGBase64(
      renderer,
      shadingScene,
      camera,
      width,
      height,
      0xffffff,
    );
  }

  return {
    edgePNGBase64,
    fillPNGBase64,
    shadingPNGBase64,
    width,
    height,
    options,
  };
}

function buildEdgeScene(
  sourceScene: THREE.Scene,
  thresholdAngle: number,
): THREE.Scene {
  const edgeScene = new THREE.Scene();
  sourceScene.updateMatrixWorld(true);

  sourceScene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;

    const edgesGeometry = new THREE.EdgesGeometry(
      mesh.geometry,
      thresholdAngle,
    );
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });
    const edgeLines = new THREE.LineSegments(edgesGeometry, edgeMaterial);

    edgeLines.matrix.copy(mesh.matrixWorld);
    edgeLines.matrixAutoUpdate = false;
    edgeScene.add(edgeLines);
  });

  return edgeScene;
}

function buildFlatFillScene(sourceScene: THREE.Scene): THREE.Scene {
  const fillScene = new THREE.Scene();
  sourceScene.updateMatrixWorld(true);

  sourceScene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;

    const color = extractMaterialColor(mesh.material);
    const material = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
    });
    const clone = new THREE.Mesh(mesh.geometry, material);
    clone.matrix.copy(mesh.matrixWorld);
    clone.matrixAutoUpdate = false;
    fillScene.add(clone);
  });

  return fillScene;
}

function buildShadingScene(sourceScene: THREE.Scene): THREE.Scene {
  const shadingScene = new THREE.Scene();
  sourceScene.updateMatrixWorld(true);

  sourceScene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;

    const material = new THREE.MeshNormalMaterial({ flatShading: true });
    const clone = new THREE.Mesh(mesh.geometry, material);
    clone.matrix.copy(mesh.matrixWorld);
    clone.matrixAutoUpdate = false;
    shadingScene.add(clone);
  });

  return shadingScene;
}

function extractMaterialColor(
  material: THREE.Material | THREE.Material[],
): THREE.Color {
  const candidate = Array.isArray(material) ? material[0] : material;
  const anyMaterial = candidate as THREE.MeshBasicMaterial & {
    color?: THREE.Color;
  };
  return anyMaterial?.color?.clone?.() ?? new THREE.Color(0xbdbdbd);
}

async function renderSceneToPNGBase64(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  width: number,
  height: number,
  clearColor: number,
): Promise<string> {
  const target = new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: true,
    stencilBuffer: false,
    generateMipmaps: false,
  });

  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color()).clone();
  const prevAlpha = renderer.getClearAlpha();
  const prevPixelRatio = renderer.getPixelRatio();
  const prevSize = new THREE.Vector2();
  renderer.getSize(prevSize);

  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.setRenderTarget(target);
  renderer.setClearColor(clearColor, 1);
  renderer.clear(true, true, true);
  renderer.render(scene, camera);

  const buffer = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, width, height, buffer);

  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.setPixelRatio(prevPixelRatio);
  renderer.setSize(prevSize.x, prevSize.y, false);
  target.dispose();

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  const flipped = flipPixelsVertically(buffer, width, height);
  const imageData = new ImageData(
    new Uint8ClampedArray(flipped),
    width,
    height,
  );
  ctx.putImageData(imageData, 0, 0);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (!value) {
        reject(new Error("Canvas PNG encoding failed"));
        return;
      }
      resolve(value);
    }, "image/png");
  });

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });

  // const pngPreview = document.createElement("img");
  // pngPreview.src = dataUrl;
  // document.body.appendChild(pngPreview);
  //setTimeout(() => pngPreview.remove(), 5000);

  return dataUrl.split(",")[1] ?? "";
}

function flipPixelsVertically(
  pixels: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const rowSize = width * 4;
  const output = new Uint8Array(pixels.length);

  for (let y = 0; y < height; y += 1) {
    const srcStart = y * rowSize;
    const dstStart = (height - y - 1) * rowSize;
    output.set(pixels.subarray(srcStart, srcStart + rowSize), dstStart);
  }

  return output;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });

  return dataUrl.split(",")[1] ?? "";
}
