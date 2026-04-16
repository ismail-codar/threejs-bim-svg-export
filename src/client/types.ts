export interface RasterToVectorSVGOptions {
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

export interface ExportStats {
  renderTimeMs: number;
  vectorizeTimeMs: number;
  optimizeTimeMs: number;
  totalTimeMs: number;
  edgeNodeCount: number;
  fillNodeCount: number;
  finalNodeCount: number;
  fileSizeBytes: number;
  renderResolution: { width: number; height: number };
}

export interface ExportResponse {
  svg: string;
  stats: ExportStats;
  diagnostics: {
    edgeVectorizerUsed: string;
    fillVectorizerUsed: string;
    shadingEnabled: boolean;
  };
}
