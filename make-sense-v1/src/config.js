/** Configurable visualization settings */

/**
 * Local GBIF occurrence datasets (served from /public).
 * Refresh with: npm run fetch:barn-swallow | fetch:european-bee-eater | fetch:common-crane | fetch:eurasian-blackcap | fetch:blackpoll-warbler
 */
export const SPECIES_CATALOG = [
  {
    id: 'barn-swallow',
    commonName: 'Barn Swallow',
    scientificName: 'Hirundo rustica',
    gbifSpeciesUrl: 'https://www.gbif.org/species/9515886',
    datasetUrl: '/data/hirundo-rustica.json',
    fetchScript: 'npm run fetch:barn-swallow',
    /** Macaulay Library / eBird media */
    imageUrl:
      'https://cdn.download.ams.birds.cornell.edu/api/v2/asset/312652671/2400',
    imageCredit: 'Macaulay Library',
  },
  {
    id: 'european-bee-eater',
    commonName: 'European Bee-eater',
    scientificName: 'Merops apiaster',
    gbifSpeciesUrl: 'https://www.gbif.org/species/2475443',
    datasetUrl: '/data/merops-apiaster.json',
    fetchScript: 'npm run fetch:european-bee-eater',
    imageUrl:
      'https://cdn.download.ams.birds.cornell.edu/api/v2/asset/459241061/2400',
    imageCredit: 'Macaulay Library',
  },
  {
    id: 'common-crane',
    commonName: 'Common Crane',
    scientificName: 'Grus grus',
    gbifSpeciesUrl: 'https://www.gbif.org/species/2474950',
    datasetUrl: '/data/grus-grus.json',
    fetchScript: 'npm run fetch:common-crane',
    imageUrl:
      'https://cdn.download.ams.birds.cornell.edu/api/v2/asset/168488341/2400',
    imageCredit: 'Macaulay Library',
  },
  {
    id: 'eurasian-blackcap',
    commonName: 'Eurasian Blackcap',
    scientificName: 'Sylvia atricapilla',
    gbifSpeciesUrl: 'https://www.gbif.org/species/2492956',
    datasetUrl: '/data/sylvia-atricapilla.json',
    fetchScript: 'npm run fetch:eurasian-blackcap',
    imageUrl: 'https://cdn.download.ams.birds.cornell.edu/api/v2/asset/459237521/2400',
    imageCredit: 'Macaulay Library',
  },
  {
    id: 'blackpoll-warbler',
    commonName: 'Blackpoll Warbler',
    scientificName: 'Setophaga striata',
    gbifSpeciesUrl: 'https://www.gbif.org/species/6092935',
    datasetUrl: '/data/setophaga-striata.json',
    fetchScript: 'npm run fetch:blackpoll-warbler',
    imageUrl:
      'https://cdn.download.ams.birds.cornell.edu/api/v2/asset/64804711/2400',
    imageCredit: 'Macaulay Library',
  },
]

/** @deprecated Prefer SPECIES_CATALOG — kept for any leftover single-species imports */
export const SPECIES = SPECIES_CATALOG[0]

/** @deprecated Prefer species.datasetUrl from SPECIES_CATALOG */
export const DATASET = {
  url: SPECIES_CATALOG[0].datasetUrl,
}

/**
 * Local temperature pack:
 * - GISTEMP CSV series (global anomaly readout)
 * - NCEP absolute °C map grid
 * Update via: npm run fetch:temperature
 */
export const TEMPERATURE = {
  url: '/data/temperature.json',
  paintAlpha: 0.62,
  /** Absolute air-temperature color scale (°C): white → yellow → red → purple. */
  vmin: -20,
  vmax: 38,
  /** Viewport sample step (CSS px) when the map is still. */
  sampleStep: 2,
  /** Coarser while tweening months. */
  animSampleStep: 3,
  /**
   * Sparse unproject grid for painting (control points across the viewport).
   * Intermediate pixels interpolate lon/lat — far cheaper than unproject-per-pixel.
   */
  unprojectCellsX: 24,
  unprojectCellsY: 14,
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
    // Centered to keep both European breeding & African wintering grounds in view.
    center: [15, 28],
    zoom: 2.35,
    bearing: 0,
    pitch: 0,
  },
  pointColor: '#e10600',
  /** Monthly northernmost / southernmost latitude lines (occurrence sample). */
  northLineColor: 'rgba(16, 72, 168, 0.92)',
  southLineColor: 'rgba(8, 120, 110, 0.92)',
  extremeLineWidth: 1.5,
}

export const FLOCK = {
  /** Visible dots scale with GBIF monthly occurrence (shared log map). */
  minDots: 10,
  maxDots: 100,
  /**
   * Shared log domain for both species (year×month coordinate counts).
   * Bee-eater winter months sit near the floor; Barn Swallow peak near the ceiling.
   */
  occurrenceCountFloor: 800,
  occurrenceCountCeil: 350_000,
  /** @deprecated kept for older callers */
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
