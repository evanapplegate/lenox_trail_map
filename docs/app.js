/* global mapboxgl */

// Mapbox public token provided by user
const MAPBOX_TOKEN = 'pk.eyJ1IjoiZXZhbmRhcHBsZWdhdGUiLCJhIjoiY2tmbzA1cWM1MWozeTM4cXV4eHUwMzFhdiJ9.Z5f9p8jJD_N1MQwycF2NEw';
mapboxgl.accessToken = MAPBOX_TOKEN;

// Initial map center roughly around Lenox, MA
const basemapSelectEl = document.getElementById('basemap');
const initialStyle = basemapSelectEl && basemapSelectEl.value ? basemapSelectEl.value : 'mapbox://styles/mapbox/outdoors-v12';
console.log('[init] booting map');
const map = new mapboxgl.Map({
  container: 'map',
  style: initialStyle,
  center: [-73.31708, 42.36243],
  zoom: 11.81,
  pitch: 0,
  bearing: 0,
  hash: true
});

map.addControl(new mapboxgl.NavigationControl({ showCompass: true, showZoom: true }), 'top-right');
map.addControl(new mapboxgl.ScaleControl({ maxWidth: 200, unit: 'imperial' }));

// Data layer configuration mapped to docs/data/*.geojson
const layerConfigs = [
  { id: 'trails', file: 'trails.geojson', linePaint: { 'line-color': '#1b7f3a', 'line-width': 2 } },
  { id: 'sidewalks', file: 'extant_sidewalks.geojson', linePaint: { 'line-color': '#6f6f6f', 'line-width': 1.5 } },
  { id: 'proposed_sidewalks', file: 'proposed_sidewalks.geojson', linePaint: { 'line-color': '#444', 'line-width': 1, 'line-dasharray': [1, 1] } },
  { id: 'proposed_paths', file: 'proposed_shared_use_paths.geojson', linePaint: { 'line-color': '#a15a00', 'line-width': 2, 'line-dasharray': [2, 1] } },
  { id: 'poi', file: 'POI.geojson' },
  { id: 'parcels', file: 'parcels.geojson', linePaint: { 'line-color': '#b59b55', 'line-width': 0.8 } },
  { id: 'easements', file: 'easements.geojson', fillPaint: { 'fill-color': '#c7e6d0', 'fill-opacity': 0.35 } },
  { id: 'contours', file: '1400_ft_contour.geojson', linePaint: { 'line-color': '#000000', 'line-width': 3, 'line-dasharray': [0, 1.5] }, lineLayout: { 'line-cap': 'round' } }
];

function detectLabelKey(props) {
  const candidates = ['name', 'Name', 'NAME', 'label', 'Label', 'LABEL', 'elev', 'elevation', 'ELEV', 'ELEVATION'];
  return candidates.find(k => Object.prototype.hasOwnProperty.call(props, k)) || null;
}

const storedLabelKeys = {};

let parkingIconAdded = false;
async function ensureParkingIcon(map) {
  if (map.hasImage && map.hasImage('parking-icon')) return;
  if (parkingIconAdded) return;
  try {
    const res = await fetch('./icons/parking.svg');
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    map.addImage('parking-icon', bitmap, { sdf: false });
    parkingIconAdded = true;
  } catch (e) {
    // silently ignore if icon can't be loaded
  }
}

function extendBoundsFromGeometry(bounds, geometry) {
  const coords = geometry && geometry.coordinates;
  if (!coords) return;
  const loop = (c) => {
    if (Array.isArray(c[0])) {
      for (const cc of c) loop(cc);
    } else if (typeof c[0] === 'number' && typeof c[1] === 'number') {
      bounds.extend(c);
    }
  };
  loop(coords);
}

function extendBoundsFromFeatureCollection(bounds, featureCollection) {
  if (!featureCollection || !Array.isArray(featureCollection.features)) return false;
  let extended = false;
  for (const feature of featureCollection.features) {
    if (feature && feature.geometry) {
      extendBoundsFromGeometry(bounds, feature.geometry);
      extended = true;
    }
  }
  return extended;
}

let steepnessDesiredVisible = false;
let overlaysInitialized = false;

async function initializeOverlays(opts = { autoFit: false }) {
  console.log('[initializeOverlays] start', opts);
  // Terrain source and 3D setup
  if (!map.getSource('mapbox-dem')) {
    map.addSource('mapbox-dem', {
      type: 'raster-dem',
      url: 'mapbox://mapbox.terrain-rgb',
      tileSize: 512,
      maxzoom: 14
    });
    map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.3 });
    console.log('[initializeOverlays] added mapbox-dem');
  } else {
    map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.3 });
  }

  if (!map.getLayer('steepness')) {
    const steepnessLayer = {
      id: 'steepness',
      type: 'hillshade',
      source: 'mapbox-dem',
      layout: { visibility: steepnessDesiredVisible ? 'visible' : 'none' },
      paint: {
        'hillshade-exaggeration': 0.85,
        'hillshade-shadow-color': '#3b2f2f',
        'hillshade-highlight-color': '#fff9f0',
        'hillshade-accent-color': '#d7c7b9'
      }
    };
    try {
      map.addLayer(steepnessLayer, 'waterway-label');
      console.log('[initializeOverlays] added steepness before waterway-label');
    } catch (e1) {
      try {
        map.addLayer(steepnessLayer, 'road-label');
        console.log('[initializeOverlays] added steepness before road-label');
      } catch (e2) {
        map.addLayer(steepnessLayer);
        console.log('[initializeOverlays] added steepness at top');
      }
    }
  }

  if (map.getLayer('sky')) {
    map.setPaintProperty('sky', 'sky-type', 'gradient');
    map.setPaintProperty('sky', 'sky-gradient', [
      'interpolate', ['linear'], ['sky-radial-progress'],
      0, 'rgba(135, 206, 235, 1.0)',
      1, 'rgba(135, 206, 235, 0.0)'
    ]);
    map.setPaintProperty('sky', 'sky-gradient-center', [0, 0]);
    map.setPaintProperty('sky', 'sky-gradient-radius', 90);
    map.setPaintProperty('sky', 'sky-opacity', 1);
    console.log('[initializeOverlays] sky gradient updated');
  } else {
    map.addLayer({
      id: 'sky',
      type: 'sky',
      paint: {
        'sky-type': 'gradient',
        'sky-gradient': [
          'interpolate', ['linear'], ['sky-radial-progress'],
          0, 'rgba(135, 206, 235, 1.0)',
          1, 'rgba(135, 206, 235, 0.0)'
        ],
        'sky-gradient-center': [0, 0],
        'sky-gradient-radius': 90,
        'sky-opacity': 1
      }
    });
    console.log('[initializeOverlays] sky gradient added');
  }

  const bounds = new mapboxgl.LngLatBounds();
  let haveBounds = false;
  for (const cfg of layerConfigs) {
    const url = `./data/${cfg.file}`;
    try {
      const sample = await fetch(url).then(r => {
        if (!r.ok) throw new Error(`Missing ${url}`);
        return r.json();
      });

      if (extendBoundsFromFeatureCollection(bounds, sample)) haveBounds = true;

      if (!map.getSource(cfg.id)) {
        map.addSource(cfg.id, { type: 'geojson', data: url, promoteId: 'id' });
      }

      if (cfg.id === 'poi') {
        if (!map.getLayer('poi-parking')) {
          map.addLayer({
            id: 'poi-parking',
            type: 'symbol',
            source: cfg.id,
            filter: ['==', ['get', 'Name'], 'Parking'],
            layout: {
              'icon-image': ['coalesce', ['image', 'parking-15'], ['image', 'parking'], ['image', 'marker-15']],
              'icon-size': 1.0,
              'icon-allow-overlap': true
            }
          });
          console.log('[initializeOverlays] poi-parking added');
        }
        continue;
      }

      if (cfg.fillPaint && !map.getLayer(`${cfg.id}-fill`)) {
        map.addLayer({ id: `${cfg.id}-fill`, type: 'fill', source: cfg.id, paint: cfg.fillPaint });
        console.log('[initializeOverlays] added layer', `${cfg.id}-fill`);
      }
      if (cfg.linePaint && !map.getLayer(`${cfg.id}-line`)) {
        const lineDef = { id: `${cfg.id}-line`, type: 'line', source: cfg.id, paint: cfg.linePaint };
        if (cfg.lineLayout) lineDef.layout = cfg.lineLayout;
        map.addLayer(lineDef);
        console.log('[initializeOverlays] added layer', `${cfg.id}-line`);
      }

      const firstProps = sample.features?.[0]?.properties || {};
      const labelKey = cfg.id === 'parcels' ? 'parcel_owners_Owner Name' : (cfg.labelKey || storedLabelKeys[cfg.id] || detectLabelKey(firstProps));
      storedLabelKeys[cfg.id] = labelKey;

      // Trails: line-following labels coupled with line toggle
      if (cfg.id === 'trails' && labelKey && !map.getLayer('trails-name')) {
        map.addLayer({
          id: 'trails-name',
          type: 'symbol',
          source: cfg.id,
          layout: {
            'symbol-placement': 'line',
            'text-field': ['coalesce', ['get', labelKey], ''],
            'text-size': 12,
            'text-rotation-alignment': 'map',
            'text-keep-upright': true,
            'text-padding': 1
          },
          paint: {
            'text-color': '#20492f',
            'text-halo-color': '#ffffff',
            'text-halo-width': 1
          }
        });
        console.log('[initializeOverlays] added trails-name');
      }

      // Parcels: invisible hit area for clicks
      if (cfg.id === 'parcels' && !map.getLayer('parcels-hit')) {
        map.addLayer({ id: 'parcels-hit', type: 'fill', source: cfg.id, paint: { 'fill-color': '#000000', 'fill-opacity': 0.001 } });
        console.log('[initializeOverlays] added parcels-hit');
      }

      // Parcels: label shows owner name, toggled with line
      if (cfg.id === 'parcels' && !map.getLayer('parcels-label')) {
        map.addLayer({
          id: 'parcels-label',
          type: 'symbol',
          source: cfg.id,
          layout: {
            'text-field': ['coalesce', ['get', 'parcel_owners_Owner Name'], ''],
            'text-size': 12,
            'text-allow-overlap': false
          },
          paint: {
            'text-color': '#333333',
            'text-halo-color': '#ffffff',
            'text-halo-width': 1
          }
        });
        console.log('[initializeOverlays] added parcels-label');
      }
    } catch (err) {
      // skip if data missing
      console.log('[initializeOverlays] skip', cfg.id, err && err.message);
    }
  }

  if (opts.autoFit && !overlaysInitialized && haveBounds && !bounds.isEmpty()) {
    console.log('[initializeOverlays] fitBounds on first load');
    map.fitBounds(bounds, { padding: 40, duration: 0 });
  } else {
    console.log('[initializeOverlays] skip fitBounds', { autoFit: opts.autoFit, overlaysInitialized, haveBounds });
  }

  // Parcels popup
  if (!map.__parcelsClickBound) {
    map.on('click', 'parcels-hit', (e) => {
      const f = e.features && e.features[0];
      if (!f) return;
      const p = f.properties || {};
      const html = `
        <div>
          <table>
            <tr><th style="text-align:left;padding-right:8px;">Parcel</th><td>${p['MAP_PAR_ID'] || ''}</td></tr>
            <tr><th style="text-align:left;padding-right:8px;">Owner</th><td>${p['parcel_owners_Owner Name'] || ''}</td></tr>
            <tr><th style="text-align:left;padding-right:8px;">Address</th><td>${p['parcel_owners_Property Address'] || ''}</td></tr>
          </table>
        </div>`;
      new mapboxgl.Popup({ closeOnClick: true })
        .setLngLat(e.lngLat)
        .setHTML(html)
        .addTo(map);
      console.log('[popup] parcels shown at', e.lngLat);
    });
    map.__parcelsClickBound = true;
  }

  buildToggles();
  overlaysInitialized = true;
  console.log('[initializeOverlays] done');
}

map.on('load', () => {
  console.log('[event] map load');
  initializeOverlays({ autoFit: true });
});
map.on('style.load', () => {
  console.log('[event] style load');
  initializeOverlays({ autoFit: false });
});

const basemapSelect = document.getElementById('basemap');
if (basemapSelect) {
  basemapSelect.addEventListener('change', (e) => {
    const url = e.target.value;
    const center = map.getCenter();
    const zoom = map.getZoom();
    const bearing = map.getBearing();
    const pitch = map.getPitch();
    console.log('[basemap] change ->', url, { center, zoom, bearing, pitch });
    map.once('style.load', () => {
      console.log('[basemap] restoring camera');
      map.jumpTo({ center, zoom, bearing, pitch });
    });
    map.setStyle(url);
  });
}

function buildToggles() {
  const panel = document.getElementById('layers');
  if (!panel) return;
  while (panel.firstChild) panel.removeChild(panel.firstChild);

  const items = [
    { id: 'steepness', label: 'Steepness' },
    { id: 'trails-line', label: 'Trails', coupled: ['trails-name'] },
    { id: 'sidewalks-line', label: 'Existing sidewalks' },
    { id: 'proposed_sidewalks-line', label: 'Proposed sidewalks' },
    { id: 'proposed_paths-line', label: 'Proposed shared-use paths' },
    { id: 'parcels-line', label: 'Parcels', coupled: ['parcels-label'] },
    { id: 'easements-fill', label: 'Easements' },
    { id: 'contours-line', label: '1,400 ft. contour line' }
  ];

  const setVisibility = (layerId, visible) => {
    if (!map.getLayer(layerId)) return;
    map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
  };

  for (const { id, label, coupled = [] } of items) {
    if (!map.getLayer(id) && id !== 'steepness') continue;
    const row = document.createElement('label');
    row.className = 'layer-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = id === 'steepness'
      ? (map.getLayer(id) ? (map.getLayoutProperty(id, 'visibility') !== 'none') : steepnessDesiredVisible)
      : (map.getLayer(id) ? (map.getLayoutProperty(id, 'visibility') !== 'none') : false);
    cb.onchange = async () => {
      console.log('[toggle]', id, '=>', cb.checked);
      if (id === 'steepness') steepnessDesiredVisible = cb.checked;
      if (!map.getLayer(id) && id === 'steepness') {
        await initializeOverlays({ autoFit: false });
      }
      setVisibility(id, cb.checked);
      for (const c of coupled) setVisibility(c, cb.checked);
    };
    const text = document.createElement('span');
    text.textContent = label;
    row.append(cb, text);
    panel.append(row);
  }
}


