// ===== MAP DASHBOARD (Survey Heatmap) =====
const MapDashboard = {
  _map: null,
  _zonePolygons: null,   // Map<zoneName, { poly, centroid, feature }>
  _zoneCounts: null,
  _resizeHandler: null,
  _activeZone: null,

  DEFAULT_LAT: 14.6318,
  DEFAULT_LON: 102.7916,

  // ----- Public -----

  init() {
    const households = DB.getHouseholds();
    const points = households
      .map(hh => ({ coords: this._parseCoords(hh.coordinates), hh }))
      .filter(p => p.coords !== null);

    const features = (typeof ZONES_GEOJSON !== 'undefined' && ZONES_GEOJSON.features)
      ? ZONES_GEOJSON.features
      : [];

    this._zonePolygons = new Map();
    this._activeZone = null;
    this._zoneCounts = this._countHouseholdsPerZone(points, features);

    // Compute bounds from zones (fallback to Nangrong default if no zones)
    this._zoneBounds = this._computeBounds(features);

    this._initLongdoMap();

    setTimeout(() => {
      this._drawZones(this._zoneCounts);
      this._drawHouseholdMarkers(points);
      this._renderStatsPanel(this._zoneCounts, points.length);
      this._fixMapSize();
      this._fitToZones();
    }, 200);

    if (features.length === 0) {
      this._renderNoZonesWarning();
    }
  },

  destroy() {
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }
    this._map = null;
    this._zonePolygons = null;
    this._zoneCounts = null;
    this._activeZone = null;
  },

  // ----- Map Init -----

  _initLongdoMap() {
    const container = document.getElementById('surveyMapContainer');
    if (!container || !window.longdo) {
      console.warn('MapDashboard: Longdo Maps SDK not ready');
      return;
    }

    this._map = new longdo.Map({
      placeholder: container,
      zoom: 11,
      location: { lon: this.DEFAULT_LON, lat: this.DEFAULT_LAT }
    });

    this._fixMapSize();
    setTimeout(() => this._fixMapSize(), 300);
    setTimeout(() => this._fixMapSize(), 800);

    this._resizeHandler = () => this._fixMapSize();
    window.addEventListener('resize', this._resizeHandler);
  },

  _fixMapSize() {
    const container = document.getElementById('surveyMapContainer');
    if (!container) return;

    // Force explicit height — Longdo creates .ldmap_placeholder at 100px default,
    // which prevents height:100% from working correctly.
    const isMobile = window.innerWidth <= 600;
    const targetH = isMobile
      ? Math.max(240, Math.round(window.innerWidth * 0.55))
      : Math.max(300, window.innerHeight - 82);

    container.style.height = targetH + 'px';

    const ph = container.querySelector('.ldmap_placeholder');
    if (ph) {
      ph.style.width  = container.offsetWidth + 'px';
      ph.style.height = targetH + 'px';
    }
  },

  // ----- Geometry -----

  _parseCoords(str) {
    if (!str) return null;
    const parts = str.split(',').map(s => parseFloat(s.trim()));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      return { lat: parts[0], lon: parts[1] };
    }
    return null;
  },

  // GeoJSON ring: [[lon,lat], [lon,lat], ...]
  _pointInPolygon(lat, lon, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1]; // lon, lat
      const xj = ring[j][0], yj = ring[j][1];
      const intersect = ((yi > lat) !== (yj > lat)) &&
        (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  },

  _pointInFeature(lat, lon, feature) {
    const geom = feature.geometry;
    if (!geom) return false;
    if (geom.type === 'Polygon') {
      return this._pointInPolygon(lat, lon, geom.coordinates[0]);
    }
    if (geom.type === 'MultiPolygon') {
      return geom.coordinates.some(poly => this._pointInPolygon(lat, lon, poly[0]));
    }
    return false;
  },

  _polygonCentroid(ring) {
    const n = ring.length - 1; // GeoJSON closes ring: first === last
    if (n <= 0) return { lon: this.DEFAULT_LON, lat: this.DEFAULT_LAT };
    let sumLon = 0, sumLat = 0;
    for (let i = 0; i < n; i++) {
      sumLon += ring[i][0];
      sumLat += ring[i][1];
    }
    return { lon: sumLon / n, lat: sumLat / n };
  },

  _featureCentroid(feature) {
    const geom = feature.geometry;
    if (!geom) return { lon: this.DEFAULT_LON, lat: this.DEFAULT_LAT };
    if (geom.type === 'Polygon') return this._polygonCentroid(geom.coordinates[0]);
    if (geom.type === 'MultiPolygon') return this._polygonCentroid(geom.coordinates[0][0]);
    return { lon: this.DEFAULT_LON, lat: this.DEFAULT_LAT };
  },

  _eachRing(feature, fn) {
    const geom = feature.geometry;
    if (!geom) return;
    if (geom.type === 'Polygon') geom.coordinates.forEach(fn);
    else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(p => p.forEach(fn));
  },

  _computeBounds(features) {
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    features.forEach(f => {
      this._eachRing(f, ring => {
        ring.forEach(c => {
          if (c[0] < minLon) minLon = c[0];
          if (c[0] > maxLon) maxLon = c[0];
          if (c[1] < minLat) minLat = c[1];
          if (c[1] > maxLat) maxLat = c[1];
        });
      });
    });
    if (!isFinite(minLat)) return null;
    return { minLat, maxLat, minLon, maxLon };
  },

  _fitToZones() {
    if (!this._map || !this._zoneBounds) return;
    const b = this._zoneBounds;
    const centerLat = (b.minLat + b.maxLat) / 2;
    const centerLon = (b.minLon + b.maxLon) / 2;
    try {
      this._map.location({ lon: centerLon, lat: centerLat });
      // pick a zoom based on bounds extent
      const span = Math.max(b.maxLat - b.minLat, b.maxLon - b.minLon);
      let zoom = 12;
      if (span > 0.5)  zoom = 9;
      else if (span > 0.25) zoom = 10;
      else if (span > 0.1)  zoom = 11;
      else if (span > 0.05) zoom = 12;
      else if (span > 0.02) zoom = 13;
      else                  zoom = 14;
      this._map.zoom(zoom);
    } catch (e) { /* unsupported */ }
  },

  _featureRing(feature) {
    const geom = feature.geometry;
    if (!geom) return [];
    if (geom.type === 'Polygon') return geom.coordinates[0];
    if (geom.type === 'MultiPolygon') return geom.coordinates[0][0];
    return [];
  },

  _countHouseholdsPerZone(points, features) {
    return features.map(feature => {
      const name = (feature.properties && feature.properties.name) || 'ไม่ระบุ';
      const matched = points.filter(p => this._pointInFeature(p.coords.lat, p.coords.lon, feature));
      return { name, feature, count: matched.length };
    });
  },

  // ----- Drawing -----

  _zoneColor(count) {
    if (count === 0) return { fill: 'rgba(148,163,184,0.15)', line: 'rgba(148,163,184,0.7)' };
    if (count < 5)  return { fill: 'rgba(59,130,246,0.15)',  line: 'rgba(59,130,246,0.8)' };
    if (count < 15) return { fill: 'rgba(59,130,246,0.25)',  line: 'rgba(37,99,235,0.9)' };
    return              { fill: 'rgba(37,99,235,0.35)',       line: 'rgba(30,64,175,1)' };
  },

  _drawZones(zoneCounts) {
    if (!this._map) return;

    zoneCounts.forEach(({ name, feature, count }) => {
      const ring = this._featureRing(feature);
      if (ring.length < 3) return;

      const color = this._zoneColor(count);
      const locs  = ring.map(c => ({ lon: c[0], lat: c[1] }));

      let poly;
      try {
        poly = new longdo.Polygon(locs, {
          lineColor: color.line,
          lineWidth: 2,
          fillColor: color.fill
        });
        this._map.Overlays.add(poly);
      } catch (e) {
        console.warn('MapDashboard: Polygon overlay failed', e);
        poly = null;
      }

      const centroid = this._featureCentroid(feature);
      this._zonePolygons.set(name, { poly, centroid, feature, count });

      // count label at centroid
      try {
        const label = new longdo.Dot(
          { lon: centroid.lon, lat: centroid.lat },
          {
            radius: count > 0 ? 14 : 10,
            weight: 1.5,
            lineColor: '#fff',
            fillColor: count > 0 ? '#2563eb' : '#94a3b8',
            title: String(count)
          }
        );
        this._map.Overlays.add(label);
      } catch (e) { /* Dot not supported — skip label */ }
    });
  },

  _drawHouseholdMarkers(points) {
    if (!this._map) return;
    points.forEach(({ coords }) => {
      try {
        const dot = new longdo.Dot(
          { lon: coords.lon, lat: coords.lat },
          { radius: 5, weight: 1.2, lineColor: '#fff', fillColor: '#10b981' }
        );
        this._map.Overlays.add(dot);
      } catch (e) { /* skip */ }
    });
  },

  // ----- Stats Panel -----

  _renderStatsPanel(zoneCounts, totalPlotted) {
    const totalEl = document.getElementById('mapTotalCount');
    if (totalEl) {
      totalEl.textContent = `รวม ${totalPlotted} ครัวเรือนที่มีพิกัด`;
    }

    const listEl = document.getElementById('zoneList');
    if (!listEl) return;

    if (zoneCounts.length === 0) {
      listEl.innerHTML = `<div class="zone-empty">ยังไม่มีข้อมูลโซน<br>กรุณาแก้ไข js/zones.js</div>`;
      return;
    }

    const sorted = [...zoneCounts].sort((a, b) => b.count - a.count);
    listEl.innerHTML = sorted.map(({ name, count }) => `
      <div class="zone-row" onclick="MapDashboard._onZoneClick('${name.replace(/'/g, "\\'")}')">
        <div class="zone-row-name">${name}</div>
        <div class="zone-count-badge ${count === 0 ? 'zero' : ''}">${count}</div>
      </div>
    `).join('');
  },

  _renderNoZonesWarning() {
    const listEl = document.getElementById('zoneList');
    if (listEl) {
      listEl.innerHTML = `<div class="zone-empty">ยังไม่มีข้อมูลโซน<br>กรุณาแก้ไขไฟล์ <code>js/zones.js</code><br>ด้วยข้อมูล GeoJSON จริง</div>`;
    }
  },

  // ----- Interaction -----

  _onZoneClick(name) {
    this._highlightZone(name);

    // pan map to zone centroid
    const entry = this._zonePolygons && this._zonePolygons.get(name);
    if (entry && this._map) {
      try {
        this._map.location(entry.centroid);
      } catch (e) { /* pan not supported */ }
    }
  },

  _highlightZone(name) {
    // update sidebar active state
    document.querySelectorAll('.zone-row').forEach(el => {
      el.classList.toggle('active', el.querySelector('.zone-row-name').textContent === name);
    });
    this._activeZone = name;

    if (!this._map || !this._zonePolygons) return;

    // redraw all polygons with updated colors
    this._zonePolygons.forEach((entry, zoneName) => {
      if (!entry.poly) return;
      const isActive = zoneName === name;
      const color = isActive
        ? { fill: 'rgba(245,158,11,0.35)', line: 'rgba(217,119,6,1)' }
        : this._zoneColor(entry.count);
      try {
        this._map.Overlays.remove(entry.poly);
        const ring = this._featureRing(entry.feature);
        const locs = ring.map(c => ({ lon: c[0], lat: c[1] }));
        entry.poly = new longdo.Polygon(locs, {
          lineColor: color.line,
          lineWidth: isActive ? 3 : 2,
          fillColor: color.fill
        });
        this._map.Overlays.add(entry.poly);
      } catch (e) { /* skip */ }
    });
  }
};
