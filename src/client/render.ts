import * as THREE from 'three';

export interface ExportPNGOptions {
  /** Final PNG width in CSS/display pixels. */
  width: number;
  /** Final PNG height in CSS/display pixels. */
  height: number;

  /**
   * Render internally at width * supersample and height * supersample,
   * then downsample to width x height for cleaner edges.
   * 2 is a good default. 3-4 gives even cleaner results but uses much more VRAM.
   */
  supersample?: number;

  /** Background color used when transparentBackground is false. */
  clearColor?: THREE.ColorRepresentation;

  /** Clear alpha used when transparentBackground is false. */
  clearAlpha?: number;

  /** Export with transparent background instead of a solid background. */
  transparentBackground?: boolean;

  /** Preserve the current renderer tone mapping/look. Default: true */
  preserveToneMapping?: boolean;

  /**
   * When false, disables tone mapping for a flatter export that may vectorize better.
   * Only used when preserveToneMapping is false.
   */
  exportToneMapping?: THREE.ToneMapping;

  /**
   * Precompile the scene before export. Useful for first export to avoid shader hitching,
   * but should usually be disabled for repeated exports.
   */
  compileBeforeRender?: boolean;
}

/**
 * Render a Three.js scene to a high-quality PNG base64 string (without data URL prefix).
 *
 * Export strategy:
 * - Render to a plain high-resolution render target.
 * - Read back pixels.
 * - Flip vertically.
 * - Downsample with a 2D canvas.
 * - Encode as PNG.
 *
 * Notes for color:
 * - This function sets renderer.outputColorSpace = THREE.SRGBColorSpace during export.
 * - Therefore the pixels read back are treated as display-ready sRGB bytes.
 * - No manual linear->sRGB conversion is applied after readback.
 */
export async function renderSceneToPNGBase64(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: ExportPNGOptions,
): Promise<string> {
  const {
    width,
    height,
    supersample = 2,
    clearColor = 0xffffff,
    clearAlpha = 1,
    transparentBackground = false,
    preserveToneMapping = true,
    exportToneMapping = THREE.NoToneMapping,
    compileBeforeRender = false,
  } = options;

  validateDimensions(width, height, supersample);

  const renderWidth = Math.max(1, Math.floor(width * supersample));
  const renderHeight = Math.max(1, Math.floor(height * supersample));

  // Save renderer state.
  const prevTarget = renderer.getRenderTarget();
  const prevClearColor = renderer.getClearColor(new THREE.Color()).clone();
  const prevClearAlpha = renderer.getClearAlpha();
  const prevPixelRatio = renderer.getPixelRatio();
  const prevSize = new THREE.Vector2();
  renderer.getSize(prevSize);
  const prevViewport = new THREE.Vector4();
  renderer.getViewport(prevViewport);
  const prevScissor = new THREE.Vector4();
  renderer.getScissor(prevScissor);
  const prevScissorTest = renderer.getScissorTest();
  const prevOutputColorSpace = renderer.outputColorSpace;
  const prevToneMapping = renderer.toneMapping;
  const prevToneMappingExposure = renderer.toneMappingExposure;
  const prevAutoClear = renderer.autoClear;

  // Save camera state.
  const prevPerspectiveAspect =
    camera instanceof THREE.PerspectiveCamera ? camera.aspect : undefined;
  const prevOrtho =
    camera instanceof THREE.OrthographicCamera
      ? {
          left: camera.left,
          right: camera.right,
          top: camera.top,
          bottom: camera.bottom,
        }
      : undefined;

  const exportTarget = new THREE.WebGLRenderTarget(renderWidth, renderHeight, {
    depthBuffer: true,
    stencilBuffer: false,
    generateMipmaps: false,
    colorSpace: THREE.SRGBColorSpace,
  });

  try {
    updateCameraForAspect(camera, width / height);

    renderer.setPixelRatio(1);
    renderer.setSize(renderWidth, renderHeight, false);
    renderer.setViewport(0, 0, renderWidth, renderHeight);
    renderer.setScissor(0, 0, renderWidth, renderHeight);
    renderer.setScissorTest(false);
    renderer.autoClear = true;

    renderer.outputColorSpace = THREE.SRGBColorSpace;

    if (!preserveToneMapping) {
      renderer.toneMapping = exportToneMapping;
      renderer.toneMappingExposure = 1;
    }

    renderer.setRenderTarget(exportTarget);

    if (transparentBackground) {
      renderer.setClearColor(0x000000, 0);
    } else {
      renderer.setClearColor(clearColor, clearAlpha);
    }

    renderer.clear(true, true, true);

    if (compileBeforeRender) {
      await renderer.compileAsync(scene, camera);
    }

    renderer.render(scene, camera);

    const pixels = new Uint8Array(renderWidth * renderHeight * 4);
    renderer.readRenderTargetPixels(exportTarget, 0, 0, renderWidth, renderHeight, pixels);

    const flipped = flipPixelsVertically(pixels, renderWidth, renderHeight);
    const pngBytes = await downsampleAndEncodePNG({
      pixels: flipped,
      srcWidth: renderWidth,
      srcHeight: renderHeight,
      dstWidth: width,
      dstHeight: height,
    });

    return uint8ArrayToBase64(pngBytes);
  } finally {
    exportTarget.dispose();

    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClearColor, prevClearAlpha);
    renderer.setPixelRatio(prevPixelRatio);
    renderer.setSize(prevSize.x, prevSize.y, false);
    renderer.setViewport(prevViewport);
    renderer.setScissor(prevScissor);
    renderer.setScissorTest(prevScissorTest);
    renderer.outputColorSpace = prevOutputColorSpace;
    renderer.toneMapping = prevToneMapping;
    renderer.toneMappingExposure = prevToneMappingExposure;
    renderer.autoClear = prevAutoClear;

    if (camera instanceof THREE.PerspectiveCamera && prevPerspectiveAspect !== undefined) {
      camera.aspect = prevPerspectiveAspect;
      camera.updateProjectionMatrix();
    }

    if (camera instanceof THREE.OrthographicCamera && prevOrtho) {
      camera.left = prevOrtho.left;
      camera.right = prevOrtho.right;
      camera.top = prevOrtho.top;
      camera.bottom = prevOrtho.bottom;
      camera.updateProjectionMatrix();
    }
  }
}

function validateDimensions(width: number, height: number, supersample: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error('width and height must be finite numbers');
  }

  if (width <= 0 || height <= 0) {
    throw new Error('width and height must be > 0');
  }

  if (!Number.isFinite(supersample) || supersample < 1) {
    throw new Error('supersample must be a finite number >= 1');
  }
}

function updateCameraForAspect(camera: THREE.Camera, aspect: number): void {
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    return;
  }

  if (camera instanceof THREE.OrthographicCamera) {
    const centerX = (camera.left + camera.right) * 0.5;
    const centerY = (camera.top + camera.bottom) * 0.5;
    const viewHeight = camera.top - camera.bottom;
    const newWidth = viewHeight * aspect;

    camera.left = centerX - newWidth * 0.5;
    camera.right = centerX + newWidth * 0.5;
    camera.top = centerY + viewHeight * 0.5;
    camera.bottom = centerY - viewHeight * 0.5;
    camera.updateProjectionMatrix();
  }
}

function flipPixelsVertically(
  pixels: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const rowSize = width * 4;
  const output = new Uint8Array(pixels.length);

  for (let y = 0; y < height; y++) {
    const srcStart = y * rowSize;
    const dstStart = (height - 1 - y) * rowSize;
    output.set(pixels.subarray(srcStart, srcStart + rowSize), dstStart);
  }

  return output;
}

async function downsampleAndEncodePNG(params: {
  pixels: Uint8Array;
  srcWidth: number;
  srcHeight: number;
  dstWidth: number;
  dstHeight: number;
}): Promise<Uint8Array> {
  const { pixels, srcWidth, srcHeight, dstWidth, dstHeight } = params;

  const srcCanvas = createCanvas(srcWidth, srcHeight);
  const srcCtx = get2DContext(srcCanvas);
  srcCtx.putImageData(
    new ImageData(new Uint8ClampedArray(pixels), srcWidth, srcHeight),
    0,
    0,
  );

  const dstCanvas = createCanvas(dstWidth, dstHeight);
  const dstCtx = get2DContext(dstCanvas);
  dstCtx.imageSmoothingEnabled = true;
  (dstCtx as CanvasRenderingContext2D & { imageSmoothingQuality?: string }).imageSmoothingQuality = 'high';
  dstCtx.drawImage(srcCanvas as CanvasImageSource, 0, 0, dstWidth, dstHeight);

  const blob = await canvasToPNGBlob(dstCanvas);
  return new Uint8Array(await blob.arrayBuffer());
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  throw new Error('No canvas implementation is available in this environment');
}

function get2DContext(canvas: AnyCanvas): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  if (!ctx) {
    throw new Error('2D canvas context unavailable');
  }
  return ctx as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
}

async function canvasToPNGBlob(canvas: AnyCanvas): Promise<Blob> {
  if ('convertToBlob' in canvas) {
    return await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' });
  }

  return await new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to encode PNG blob'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 0x8000;
  let binary = '';

  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }

  return btoa(binary);
}