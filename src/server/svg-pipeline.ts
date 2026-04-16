import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import sharp from 'sharp';
import { optimize } from 'svgo';

const execFileAsync = promisify(execFile);

interface RasterToVectorSVGOptions {
  scaleFactor: number;
  edgeThresholdAngle: number;
  includeFills: boolean;
  includeShading: boolean;
  edgeVectorizer: 'potrace' | 'vtracer';
  fillVectorizer: 'vtracer';
  potraceAlphaMax: number;
  potraceTurdSize: number;
  potraceOptTolerance: number;
  vtracerMode: 'polygon' | 'spline';
  vtracerCornerThreshold: number;
  vtracerFilterSpeckle: number;
  vtracerColorPrecision: number;
  optimizeSVG: boolean;
  svgoFloatPrecision: number;
  shadingOpacity: number;
}

interface RasterExportPayload {
  edgePNGBase64: string;
  fillPNGBase64?: string;
  shadingPNGBase64?: string;
  width: number;
  height: number;
  options: RasterToVectorSVGOptions;
}

export async function exportRasterPayloadToSVG(payload: RasterExportPayload) {
  const started = Date.now();
  const workDir = "./output"

  try {
    const edgePngPath = path.join(workDir, 'edges.png');
    const fillPngPath = path.join(workDir, 'fills.png');
    const shadingPngPath = path.join(workDir, 'shading.png');

    await fs.writeFile(edgePngPath, Buffer.from(payload.edgePNGBase64, 'base64'));
    if (payload.fillPNGBase64) await fs.writeFile(fillPngPath, Buffer.from(payload.fillPNGBase64, 'base64'));
    if (payload.shadingPNGBase64) await fs.writeFile(shadingPngPath, Buffer.from(payload.shadingPNGBase64, 'base64'));

    await thresholdEdgeImage(edgePngPath);

    const vectorizeStart = Date.now();
    const edgeLayer = await vectorizeEdgeLayer(edgePngPath, payload.width, payload.height, payload.options);
    const fillLayer = payload.fillPNGBase64
      ? await vectorizeFillLayer(fillPngPath, payload.width, payload.height, payload.options)
      : emptyLayer();
    const shadingLayer = payload.shadingPNGBase64
      ? await vectorizeShadingLayer(shadingPngPath, payload.width, payload.height)
      : emptyLayer();
    const vectorizeTimeMs = Date.now() - vectorizeStart;

    let merged = composeSVG(payload.width, payload.height, fillLayer.content, shadingLayer.content, edgeLayer.content, payload.options.shadingOpacity);
    const optimizeStart = Date.now();
    if (payload.options.optimizeSVG) {
      merged = optimizeSVG(merged, payload.options.svgoFloatPrecision);
    }
    const optimizeTimeMs = Date.now() - optimizeStart;

    const svgPath = path.join(workDir, 'merged.svg');
    console.log({svgPath})
    await fs.writeFile(svgPath, merged);

    const resultBuffer = Buffer.from(merged, 'utf8');
    return {
      svg: merged,
      stats: {
        renderTimeMs: 0,
        vectorizeTimeMs,
        optimizeTimeMs,
        totalTimeMs: Date.now() - started,
        edgeNodeCount: edgeLayer.nodeCount,
        fillNodeCount: fillLayer.nodeCount,
        finalNodeCount: countSvgNodes(merged),
        fileSizeBytes: resultBuffer.byteLength,
        renderResolution: { width: payload.width, height: payload.height }
      },
      diagnostics: {
        edgeVectorizerUsed: edgeLayer.vectorizer,
        fillVectorizerUsed: fillLayer.vectorizer,
        shadingEnabled: Boolean(payload.shadingPNGBase64)
      }
    };
  } finally {
    // await fs.rm(workDir, { recursive: true, force: true });
  }
}

async function thresholdEdgeImage(filePath: string) {
  const image = sharp(filePath).greyscale().threshold(250, { grayscale: true });
  await image.toFile(`${filePath}.tmp.png`);
  await fs.rename(`${filePath}.tmp.png`, filePath);
}

async function vectorizeEdgeLayer(filePath: string, width: number, height: number, options: RasterToVectorSVGOptions) {
  if (options.edgeVectorizer === 'potrace') {
    const potrace = await runPotrace(filePath, options).catch(() => null);
    if (potrace) return { content: stripOuterSvg(potrace), nodeCount: countSvgNodes(potrace), vectorizer: 'potrace' };
  }

  if (options.edgeVectorizer === 'vtracer' || options.edgeVectorizer === 'potrace') {
    const traced = await runVtracerMonochrome(filePath, options).catch(() => null);
    if (traced) return { content: stripOuterSvg(traced), nodeCount: countSvgNodes(traced), vectorizer: 'vtracer' };
  }

  const fallback = await fallbackTraceEdges(filePath, width, height);
  return { content: fallback.content, nodeCount: fallback.nodeCount, vectorizer: 'fallback-polygonizer' };
}

async function vectorizeFillLayer(filePath: string, width: number, height: number, options: RasterToVectorSVGOptions) {
  const traced = await runVtracerColor(filePath, options).catch(() => null);
  if (traced) return { content: stripOuterSvg(traced), nodeCount: countSvgNodes(traced), vectorizer: 'vtracer' };

  const fallback = await fallbackTraceFills(filePath, width, height);
  return { content: fallback.content, nodeCount: fallback.nodeCount, vectorizer: 'fallback-rects' };
}

async function vectorizeShadingLayer(filePath: string, width: number, height: number) {
  const fallback = await fallbackTraceShading(filePath, width, height);
  return { content: fallback.content, nodeCount: fallback.nodeCount, vectorizer: 'fallback-rects' };
}

async function runPotrace(filePath: string, options: RasterToVectorSVGOptions): Promise<string> {
  const output = `${filePath}.svg`;
  await execFileAsync('potrace', [
    filePath,
    '--backend', 'svg',
    '--turdsize', String(options.potraceTurdSize),
    '--alphamax', String(options.potraceAlphaMax),
    '--opttolerance', String(options.potraceOptTolerance),
    '--resolution', '300',
    '--output', output
  ]);
  return fs.readFile(output, 'utf8');
}

async function runVtracerMonochrome(filePath: string, options: RasterToVectorSVGOptions): Promise<string> {
  const output = `${filePath}.svg`;
  await execFileAsync('vtracer', [
    '--input', filePath,
    '--output', output,
    '--mode', options.vtracerMode,
    '--filter_speckle', String(options.vtracerFilterSpeckle),
    '--corner_threshold', String(options.vtracerCornerThreshold),
    '--segment_length', '5',
    '--splice_threshold', '45'
  ]);
  return fs.readFile(output, 'utf8');
}

async function runVtracerColor(filePath: string, options: RasterToVectorSVGOptions): Promise<string> {
  const output = `${filePath}.svg`;
  await execFileAsync('vtracer', [
    '--input', filePath,
    '--output', output,
    '--colormode', 'color',
    '--hierarchical', 'stacked',
    '--mode', 'polygon',
    '--filter_speckle', '10',
    '--color_precision', String(options.vtracerColorPrecision),
    '--corner_threshold', '60',
    '--segment_length', '10'
  ]);
  return fs.readFile(output, 'utf8');
}

async function fallbackTraceEdges(filePath: string, width: number, height: number) {
  const { data, info } = await sharp(filePath).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  const paths: string[] = [];
  const visited = new Uint8Array(info.width * info.height);
  const black = (x: number, y: number) => data[y * info.width + x] < 128;
  const idx = (x: number, y: number) => y * info.width + x;

  for (let y = 0; y < info.height; y += 1) {
    let x = 0;
    while (x < info.width) {
      if (!black(x, y) || visited[idx(x, y)]) {
        x += 1;
        continue;
      }
      let end = x;
      while (end + 1 < info.width && black(end + 1, y) && !visited[idx(end + 1, y)]) end += 1;
      for (let fill = x; fill <= end; fill += 1) visited[idx(fill, y)] = 1;
      const x1 = (x / info.width) * width;
      const x2 = ((end + 1) / info.width) * width;
      const yy = (y / info.height) * height;
      paths.push(`<path d="M ${round2(x1)} ${round2(yy)} L ${round2(x2)} ${round2(yy)}" stroke="#000" stroke-width="1" fill="none" stroke-linecap="square" />`);
      x = end + 1;
    }
  }

  return { content: paths.join('\n'), nodeCount: paths.length };
}

async function fallbackTraceFills(filePath: string, width: number, height: number) {
  const resized = await sharp(filePath).resize({ width: Math.min(512, width), height: Math.min(512, height), fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const rects: string[] = [];
  const block = 4;
  for (let y = 0; y < resized.info.height; y += block) {
    for (let x = 0; x < resized.info.width; x += block) {
      const { r, g, b } = avgBlock(resized.data, resized.info.width, resized.info.height, x, y, block);
      if (r > 248 && g > 248 && b > 248) continue;
      rects.push(`<rect x="${round2((x / resized.info.width) * width)}" y="${round2((y / resized.info.height) * height)}" width="${round2((block / resized.info.width) * width)}" height="${round2((block / resized.info.height) * height)}" fill="rgb(${r},${g},${b})" />`);
    }
  }
  return { content: rects.join('\n'), nodeCount: rects.length };
}

async function fallbackTraceShading(filePath: string, width: number, height: number) {
  const resized = await sharp(filePath).resize({ width: Math.min(256, width), height: Math.min(256, height), fit: 'inside' }).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  const rects: string[] = [];
  const block = 6;
  for (let y = 0; y < resized.info.height; y += block) {
    for (let x = 0; x < resized.info.width; x += block) {
      let total = 0;
      let count = 0;
      for (let yy = y; yy < Math.min(y + block, resized.info.height); yy += 1) {
        for (let xx = x; xx < Math.min(x + block, resized.info.width); xx += 1) {
          total += resized.data[yy * resized.info.width + xx];
          count += 1;
        }
      }
      const gray = Math.round(total / count);
      if (gray > 245) continue;
      rects.push(`<rect x="${round2((x / resized.info.width) * width)}" y="${round2((y / resized.info.height) * height)}" width="${round2((block / resized.info.width) * width)}" height="${round2((block / resized.info.height) * height)}" fill="rgb(${gray},${gray},${gray})" />`);
    }
  }
  return { content: rects.join('\n'), nodeCount: rects.length };
}

function composeSVG(width: number, height: number, fills: string, shading: string, edges: string, shadingOpacity: number) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <g id="fills" opacity="1">${fills}</g>
  <g id="shading" opacity="${shadingOpacity}" style="mix-blend-mode:multiply">${shading}</g>
  <g id="edges" opacity="1">${edges}</g>
</svg>`;
}

function optimizeSVG(svg: string, precision: number) {
  return optimize(svg, {
    multipass: true,
    plugins: [
      'preset-default',
      // { name: 'removeViewBox', active: false },
      { name: 'cleanupNumericValues', params: { floatPrecision: precision } },
      { name: 'mergePaths' },
      { name: 'collapseGroups' },
      { name: 'convertPathData', params: { floatPrecision: precision, transformPrecision: 3 } }
    ]
  }).data;
}

function stripOuterSvg(svg: string) {
  return svg.replace(/^[\s\S]*?<svg[^>]*>/i, '').replace(/<\/svg>[\s\S]*$/i, '');
}

function countSvgNodes(svg: string) {
  const matches = svg.match(/<(path|rect|polygon|polyline|circle|ellipse|line)\b/gi);
  return matches?.length ?? 0;
}

function avgBlock(data: Buffer, width: number, height: number, startX: number, startY: number, block: number) {
  let r = 0, g = 0, b = 0, count = 0;
  for (let y = startY; y < Math.min(startY + block, height); y += 1) {
    for (let x = startX; x < Math.min(startX + block, width); x += 1) {
      const offset = (y * width + x) * 3;
      r += data[offset];
      g += data[offset + 1];
      b += data[offset + 2];
      count += 1;
    }
  }
  return { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) };
}

function emptyLayer() {
  return { content: '', nodeCount: 0, vectorizer: '' };
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
