/** Configurable visualization settings */

export const SPECIES = {
  commonName: 'Barn Swallow',
  scientificName: 'Hirundo rustica',
  gbifSpeciesUrl: 'https://www.gbif.org/species/9515886',
}

/** Local dataset path (served from /public). Update via: npm run fetch:barn-swallow */
export const DATASET = {
  url: '/data/hirundo-rustica.json',
}

/**
 * Local temperature pack (GISTEMP series + HadCRUT5 5° grid).
 * Update via: npm run fetch:temperature
 */
export const TEMPERATURE = {
  url: '/data/temperature.json',
  /** Map layer opacity baked into RGBA; also raster-opacity as a second control. */
  layerOpacity: 0.78,
  paintAlpha: 0.62,
  /** Anomaly color scale (°C) for white → yellow → red. */
  vmin: -1.2,
  vmax: 2.4,
  /** Nearest-neighbor upsample of the 72×36 grid before uploading to MapLibre. */
  upsample: 4,
}

export const GBIF = {
  baseUrl: 'https://api.gbif.org/v1',
  yearStart: 2000,
  yearEnd: 2025,
  maxCoordinateUncertaintyMeters: 50_000,
}

/**
 * Free raster basemap — no API key required.
 * Grayscale via raster-saturation so the temperature layer can stay in color.
 */
export const MAP_STYLE = {
  version: 8,
  name: 'Esri Street',
  sources: {
    esri: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: 'Tiles © Esri',
    },
  },
  layers: [
    {
      id: 'esri-street',
      type: 'raster',
      source: 'esri',
      minzoom: 0,
      maxzoom: 18,
      paint: {
        'raster-saturation': -1,
        'raster-contrast': 0.06,
        'raster-brightness-min': 0.05,
      },
    },
  ],
}

export const MAP = {
  /** Fixed camera — no fitBounds / easeTo animation. */
  initialView: {
    center: [15, 18],
    zoom: 2.8,
    bearing: 0,
    pitch: 0,
  },
  pointColor: '#e10600',
}

export const FLOCK = {
  /**
   * Target flock size relative to January records.
   * If January is sparse (<12), double it; otherwise use January as-is.
   */
  minJanuaryForNoBoost: 12,
  /** Trail samples behind each moving dot (wind-map style). */
  trailLength: 28,
  trailSampleMs: 32,
}

export const TIMELINE = {
  /** Milliseconds between months while animating a selected year. */
  monthMs: 1100,
  months: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
}
