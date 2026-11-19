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
    color: '#e10600',
    /** Macaulay Library / eBird media */
    imageUrl:
      'https://cdn.download.ams.birds.cornell.edu/api/v2/asset/312652671/2400',
    imageCredit: 'Macaulay Library',
    soundUrl: '/sounds/barn-swallow.mp3',
    blurb:
      'I usually nest near human settlements, in barns. I go south in autumn, then return north in spring to breed.',
  },
  {
    id: 'european-bee-eater',
    commonName: 'European Bee-eater',
    scientificName: 'Merops apiaster',
    gbifSpeciesUrl: 'https://www.gbif.org/species/2475443',
    datasetUrl: '/data/merops-apiaster.json',
    fetchScript: 'npm run fetch:european-bee-eater',
    color: '#f0a202',
    imageUrl:
      'https://cdn.download.ams.birds.cornell.edu/api/v2/asset/459241061/2400',
    imageCredit: 'Macaulay Library',
    soundUrl: '/sounds/european-bee-eater.mp3',
    blurb:
      'I breed in sandy banks across southern Europe and spend the northern winter in Africa.',
  },
  {
    id: 'common-crane',
    commonName: 'Common Crane',
    scientificName: 'Grus grus',
    gbifSpeciesUrl: 'https://www.gbif.org/species/2474950',
    datasetUrl: '/data/grus-grus.json',
    fetchScript: 'npm run fetch:common-crane',
    color: '#2a6fdb',
    imageUrl:
      'https://cdn.download.ams.birds.cornell.edu/api/v2/asset/168488341/2400',
    imageCredit: 'Macaulay Library',
    soundUrl: '/sounds/common-crane.mp3',
    blurb:
      'I breed in northern wetlands and travel in flocks between Europe and Africa.',
  },
  {
    id: 'eurasian-blackcap',
    commonName: 'Eurasian Blackcap',
    scientificName: 'Sylvia atricapilla',
    gbifSpeciesUrl: 'https://www.gbif.org/species/2492956',
    datasetUrl: '/data/sylvia-atricapilla.json',
    fetchScript: 'npm run fetch:eurasian-blackcap',
    color: '#1f9d55',
    imageUrl: 'https://cdn.download.ams.birds.cornell.edu/api/v2/asset/459237521/2400',
    imageCredit: 'Macaulay Library',
    soundUrl: '/sounds/eurasian-blackcap.mp3',
    blurb:
      'I breed in European woodland. Many of us move to the Mediterranean or Africa outside summer.',
  },
  {
    id: 'blackpoll-warbler',
    commonName: 'Blackpoll Warbler',
    scientificName: 'Setophaga striata',
    gbifSpeciesUrl: 'https://www.gbif.org/species/6092935',
    datasetUrl: '/data/setophaga-striata.json',
    fetchScript: 'npm run fetch:blackpoll-warbler',
    color: '#8b5cf6',
    imageUrl:
      'https://cdn.download.ams.birds.cornell.edu/api/v2/asset/64804711/2400',
    imageCredit: 'Macaulay Library',
    soundUrl: '/sounds/blackpoll-warbler.mp3',
    blurb:
      'I breed in northern North America and migrate to South America for the northern winter.',
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
  paintAlpha: 0.72,
  /** Absolute air-temperature color scale (°C). Shared by the legend and the map. */
  vmin: -20,
  vmax: 40,
  colorStops: [
    { t: -20, color: '#f2f2f2' },
    { t: 40, color: '#311d1d' },
  ],
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
  /** Fixed overview. Follow mode zooms in from here. */
  initialView: {
    // High enough to keep each species' northernmost line on screen,
    // while Europe and North Africa stay in frame.
    center: [22, 46],
    zoom: 2.2,
    bearing: 0,
    pitch: 0,
  },
  /** Steady zoom while following one bird. */
  followZoom: 5,
  pointColor: '#e10600',
  /** Monthly northernmost / southernmost latitude lines (occurrence sample). */
  northLineColor: 'rgba(16, 72, 168, 0.92)',
  southLineColor: 'rgba(8, 120, 110, 0.92)',
  extremeLineWidth: 2,
  /** Dim mask north of N / south of S so attention stays between the lines. */
  extremeBandDim: 'rgba(12, 14, 18, 0.04)',
}

export const FLOCK = {
  /** Visible birds scale with GBIF monthly occurrence (shared log map). */
  minDots: 48,
  maxDots: 220,
  /**
   * Shared log domain for both species (year×month coordinate counts).
   * Bee-eater winter months sit near the floor; Barn Swallow peak near the ceiling.
   */
  occurrenceCountFloor: 800,
  occurrenceCountCeil: 350_000,
  /** @deprecated kept for older callers */
  minJanuaryForNoBoost: 12,
  /** Trail samples behind each moving bird (wind-map style). */
  trailLength: 64,
  trailSampleMs: 40,
}

export const TIMELINE = {
  /** Milliseconds between months while animating a selected year. */
  monthMs: 11000,
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
