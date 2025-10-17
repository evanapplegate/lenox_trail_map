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
  { id: 'trails', file: 'trails.geojson', linePaint: { 'line-color': '#57914e', 'line-width': 1.5 } },
  { id: 'sidewalks', file: 'extant_sidewalks.geojson', linePaint: { 'line-color': '#6f6f6f', 'line-width': 2 } },
  { id: 'proposed_sidewalks', file: 'proposed_sidewalks.geojson', linePaint: { 'line-color': '#444', 'line-width': 2, 'line-dasharray': [1, 1] } },
  { id: 'proposed_paths', file: 'proposed_shared_use_paths.geojson', linePaint: { 'line-color': '#a15a00', 'line-width': 2, 'line-dasharray': [2, 1] } },
  { id: 'poi', file: 'POI.geojson' },
  { id: 'parcels', file: 'parcels.geojson', linePaint: { 'line-color': '#bc9d7e', 'line-width': 1 } },
  { id: 'easements', file: 'easements.geojson', fillPaint: { 'fill-color': '#f4b6c2', 'fill-opacity': 0.35 } },
  { id: 'contours', file: '1400_ft_contour.geojson', linePaint: { 'line-color': '#000000', 'line-width': 1, 'line-dasharray': [0, 1.5] }, lineLayout: { 'line-cap': 'round' } }
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

let steepnessDesiredVisible = true;
let overlaysInitialized = false;
let steepnessOpacityPct = 40; // 0-100 initial
const STEEPNESS_EXAG_MAX = 1.2;

function applySteepnessExaggeration() {
  if (map.getLayer('steepness')) {
    const exag = (steepnessOpacityPct / 100) * STEEPNESS_EXAG_MAX;
    map.setPaintProperty('steepness', 'hillshade-exaggeration', exag);
  }
}

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
    applySteepnessExaggeration();
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
            'text-allow-overlap': false,
            'text-font': ['Open Sans Bold','Arial Unicode MS Bold']
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
  const slider = document.getElementById('steepnessOpacity');
  const label = document.getElementById('steepnessOpacityVal');
  if (slider) {
    slider.value = String(steepnessOpacityPct);
    slider.addEventListener('input', () => {
      steepnessOpacityPct = Number(slider.value);
      if (label) label.textContent = `${steepnessOpacityPct}%`;
      applySteepnessExaggeration();
    });
  }
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
    { id: 'parcels-line', label: 'Parcels', coupled: ['parcels-label'], swatch: { type: 'fill', color: '#f8efe7', border: '#bc9d7e' } },
    { id: 'easements-fill', label: 'Easements', swatch: { type: 'fill', color: '#f4b6c2' } },
    { id: 'trails-line', label: 'Trails', coupled: ['trails-name'], swatch: { type: 'line', color: '#1b7f3a', width: 3 } },
    { id: 'sidewalks-line', label: 'Existing sidewalks', swatch: { type: 'line', color: '#6f6f6f', width: 2 } },
    { id: 'proposed_sidewalks-line', label: 'Proposed sidewalks', swatch: { type: 'line', color: '#444', width: 2, dash: [4, 4] } },
    { id: 'proposed_paths-line', label: 'Proposed shared-use paths', swatch: { type: 'line', color: '#a15a00', width: 3, dash: [6, 3] } },
    { id: 'contours-line', label: '1,400 ft. contour line', swatch: { type: 'line', color: '#000000', width: 3, dash: [0, 6] } },
    { id: 'steepness', label: 'Steepness', swatch: { type: 'fill', color: 'linear-gradient(90deg,#fff9f0,#d7c7b9,#3b2f2f)' } }
  ];

  const setVisibility = (layerId, visible) => {
    if (!map.getLayer(layerId)) return;
    map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
  };

  for (const { id, label, coupled = [], swatch } of items) {
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
    // Legend swatch
    if (swatch) {
      const sw = document.createElement('span');
      sw.className = 'legend-swatch';
      if (swatch.type === 'fill') {
        sw.style.background = swatch.color;
        sw.style.border = `1px solid ${swatch.border || 'rgba(0,0,0,0.2)'}`;
      } else if (swatch.type === 'line') {
        sw.style.background = 'transparent';
        sw.style.borderBottom = `${swatch.width || 2}px ${swatch.dash ? 'dashed' : 'solid'} ${swatch.color}`;
      }
      row.append(cb, sw, text);
    } else {
      row.append(cb, text);
    }

    // Inline steepness slider
    if (id === 'steepness') {
      const wrap = document.createElement('span');
      wrap.className = 'steepness-slider';
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '100';
      slider.value = String(steepnessOpacityPct);
      const val = document.createElement('span');
      val.textContent = `${steepnessOpacityPct}%`;
      slider.addEventListener('input', () => {
        steepnessOpacityPct = Number(slider.value);
        val.textContent = `${steepnessOpacityPct}%`;
        applySteepnessExaggeration();
      });
      wrap.append(slider, val);
      row.append(wrap);
    }
    panel.append(row);
  }
}


