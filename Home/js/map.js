// ===== MAP PICKER (Longdo Maps) =====
const MapPicker = {
  map: null,
  marker: null,
  selectedLat: null,
  selectedLon: null,
  searchTimeout: null,

  // พิกัดกลางอำเภอบ้านไผ่ ขอนแก่น
  DEFAULT_LAT: 16.0590,
  DEFAULT_LON: 102.7313,
  DEFAULT_ZOOM: 13,

  // Longdo Maps API key
  API_KEY: '4ffd5bcaa8a5941163c24dbe2a4401e8',

  open(currentCoords, onConfirm) {
    this.onConfirm = onConfirm;
    this.selectedLat = null;
    this.selectedLon = null;

    // parse existing coords "lat, lon"
    if (currentCoords) {
      const parts = currentCoords.split(',').map(s => parseFloat(s.trim()));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        this.selectedLat = parts[0];
        this.selectedLon = parts[1];
      }
    }

    this._renderModal();
    setTimeout(() => this._initMap(), 150);
  },

  _renderModal() {
    const old = document.getElementById('mapPickerModal');
    if (old) old.remove();

    const isMobile = window.innerWidth < 768;

    const coordsHint = this.selectedLat
      ? `📍 ${this.selectedLat.toFixed(6)}, ${this.selectedLon.toFixed(6)}`
      : (isMobile ? 'แตะบนแผนที่เพื่อปักหมุด' : 'กดบนแผนที่เพื่อเลือกพิกัด');

    const confirmOpacity = this.selectedLat ? '1' : '0.4';

    const el = document.createElement('div');
    el.id = 'mapPickerModal';

    if (isMobile) {
      // Mobile: full-screen, no overlay
      el.style.cssText = `
        position:fixed;inset:0;z-index:300;
        background:#fff;
        display:flex;flex-direction:column;
        animation:fadeIn .15s ease;
      `;
    } else {
      // Desktop: centered popup with overlay
      el.style.cssText = `
        position:fixed;inset:0;z-index:300;
        background:rgba(0,0,0,.55);
        display:flex;align-items:center;justify-content:center;
        padding:16px;animation:fadeIn .2s ease;
      `;
    }

    const innerStyle = isMobile
      ? `width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;`
      : `background:#fff;border-radius:16px;width:100%;max-width:680px;
         height:90vh;max-height:90vh;display:flex;flex-direction:column;
         box-shadow:0 24px 64px rgba(0,0,0,.3);overflow:hidden;`;

    const searchResultsMaxH = isMobile ? '120px' : '180px';
    const headerPad = isMobile ? '12px 16px 10px' : '16px 20px 12px';
    const searchPad  = isMobile ? '10px 16px' : '12px 20px';
    const footerPad  = isMobile ? '10px 16px' : '12px 20px';

    el.innerHTML = `
      <div style="${innerStyle}">

        <!-- Header -->
        <div style="padding:${headerPad};border-bottom:1px solid #e2e8f0;
                    display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
          <div style="font-size:15px;font-weight:700;color:#0f172a;">📍 เลือกพิกัดจากแผนที่</div>
          <button onclick="MapPicker.close()"
            style="width:32px;height:32px;border:none;background:#f1f5f9;border-radius:50%;
                   cursor:pointer;font-size:16px;color:#64748b;
                   display:flex;align-items:center;justify-content:center;">✕</button>
        </div>

        <!-- Search -->
        <div style="padding:${searchPad};border-bottom:1px solid #f1f5f9;flex-shrink:0;">
          <div style="display:flex;gap:8px;">
            <input id="mapSearchInput" placeholder="ค้นหาสถานที่... เช่น โรงพยาบาลบ้านไผ่"
              style="flex:1;padding:9px 13px;border:1.5px solid #e2e8f0;border-radius:8px;
                     font-family:inherit;font-size:14px;color:#1e293b;outline:none;"
              oninput="MapPicker._onSearchInput(this.value)"
              onkeydown="if(event.key==='Enter') MapPicker._search(this.value)"
              onfocus="this.style.borderColor='#2563eb'"
              onblur="this.style.borderColor='#e2e8f0'" />
            <button onclick="MapPicker._search(document.getElementById('mapSearchInput').value)"
              style="padding:9px 14px;background:#2563eb;color:#fff;border:none;border-radius:8px;
                     font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;">
              ค้นหา
            </button>
          </div>
          <div id="mapSearchResults" style="margin-top:6px;max-height:${searchResultsMaxH};overflow-y:auto;"></div>
        </div>

        <!-- Map -->
        <div id="mapContainer" style="flex:1;position:relative;overflow:hidden;"></div>

        <!-- Footer -->
        <div style="padding:${footerPad};border-top:1px solid #e2e8f0;
                    display:flex;align-items:center;justify-content:space-between;
                    gap:12px;flex-shrink:0;background:#f8fafc;">
          <div id="mapCoordsDisplay"
            style="font-size:13px;color:#64748b;flex:1;min-width:0;overflow:hidden;
                   text-overflow:ellipsis;white-space:nowrap;">
            ${coordsHint}
          </div>
          <div style="display:flex;gap:8px;flex-shrink:0;">
            <button onclick="MapPicker.close()"
              style="padding:9px 14px;background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;
                     border-radius:8px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;">
              ยกเลิก
            </button>
            <button id="mapConfirmBtn" onclick="MapPicker.confirm()"
              style="padding:9px 16px;background:#10b981;color:#fff;border:none;border-radius:8px;
                     font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;
                     opacity:${confirmOpacity};">
              ✓ ยืนยัน
            </button>
          </div>
        </div>
      </div>`;

    el.addEventListener('click', e => { if (e.target === el) this.close(); });
    document.body.appendChild(el);
  },

  _initMap() {
    const container = document.getElementById('mapContainer');
    if (!container || !window.longdo) {
      console.warn('MapPicker: Longdo Maps SDK not ready');
      return;
    }

    const lat = this.selectedLat || this.DEFAULT_LAT;
    const lon = this.selectedLon || this.DEFAULT_LON;

    this.map = new longdo.Map({
      placeholder: container,
      zoom: this.DEFAULT_ZOOM,
      location: { lon, lat }
    });

    // place marker if we have existing coords
    if (this.selectedLat !== null) {
      this._placeMarker(this.selectedLat, this.selectedLon);
    }

    // click on map → place / move marker
    this.map.Event.bind('click', () => {
      const loc = this.map.location(longdo.LocationMode.Pointer);
      if (loc && loc.lat && loc.lon) {
        this._placeMarker(loc.lat, loc.lon);
      }
    });

    // Fix: Longdo creates .ldmap_placeholder with 100px default height.
    // Force it to match the container's actual rendered height,
    // then re-pan to the correct location (resizing can reset the view).
    this._fixMapSize(lat, lon);
    setTimeout(() => this._fixMapSize(lat, lon), 300);
  },

  _fixMapSize(lat, lon) {
    const container = document.getElementById('mapContainer');
    if (!container) return;
    const ph = container.querySelector('.ldmap_placeholder');
    if (ph) {
      ph.style.width  = container.offsetWidth  + 'px';
      ph.style.height = container.offsetHeight + 'px';
    }
    // Re-center map after resize (Longdo resets to default Bangkok on resize)
    if (this.map && lat !== undefined && lon !== undefined) {
      this.map.location({ lon, lat }, true);
      this.map.zoom(this.DEFAULT_ZOOM, true);
    }
  },

  _placeMarker(lat, lon) {
    this.selectedLat = lat;
    this.selectedLon = lon;

    // remove old marker
    if (this.marker) {
      this.map.Overlays.remove(this.marker);
      this.marker = null;
    }

    // add new draggable marker
    this.marker = new longdo.Marker(
      { lon, lat },
      { draggable: true, title: 'ตำแหน่งที่เลือก' }
    );
    this.map.Overlays.add(this.marker);

    // bind drag-end (drop) event
    try {
      this.marker.Event.bind(longdo.Event.Drop, () => {
        const loc = this.marker.location();
        if (loc) this._updateDisplay(loc.lat, loc.lon);
      });
    } catch (e) { /* marker drag events unsupported — click-to-place still works */ }

    this._updateDisplay(lat, lon);
  },

  _updateDisplay(lat, lon) {
    this.selectedLat = lat;
    this.selectedLon = lon;
    const display = document.getElementById('mapCoordsDisplay');
    const btn = document.getElementById('mapConfirmBtn');
    if (display) display.textContent = `📍 ${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    if (btn) btn.style.opacity = '1';
  },

  _onSearchInput(val) {
    clearTimeout(this.searchTimeout);
    const resultsEl = document.getElementById('mapSearchResults');
    if (val.length < 2) {
      if (resultsEl) resultsEl.innerHTML = '';
      return;
    }
    this.searchTimeout = setTimeout(() => this._search(val), 500);
  },

  async _search(query) {
    if (!query || !query.trim()) return;
    const resultsEl = document.getElementById('mapSearchResults');
    if (!resultsEl) return;
    resultsEl.innerHTML = '<div style="font-size:13px;color:#94a3b8;padding:4px 0;">กำลังค้นหา...</div>';

    try {
      const q = encodeURIComponent(query.trim());
      // Search near Banphai with a 50 km span
      const url = `https://search.longdo.com/mapsearch/json/search?keyword=${q}` +
                  `&lat=${this.DEFAULT_LAT}&lon=${this.DEFAULT_LON}` +
                  `&span=50000&limit=8&key=${this.API_KEY}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      this._renderResults(json.data || [], resultsEl);
    } catch (err) {
      console.error('MapPicker search error:', err);
      resultsEl.innerHTML = '<div style="font-size:13px;color:#ef4444;">ค้นหาไม่สำเร็จ กรุณาลองใหม่</div>';
    }
  },

  _renderResults(items, container) {
    if (!items.length) {
      container.innerHTML = '<div style="font-size:13px;color:#94a3b8;padding:4px 0;">ไม่พบสถานที่</div>';
      return;
    }
    container.innerHTML = items.map(item => {
      const name = item.name || '(ไม่มีชื่อ)';
      const addr = item.address ? `<span style="color:#94a3b8;font-size:12px;"> — ${item.address}</span>` : '';
      return `
        <div onclick="MapPicker._selectResult(${item.lat}, ${item.lon})"
          style="padding:8px 10px;font-size:13px;cursor:pointer;border-radius:6px;color:#334155;
                 border-bottom:1px solid #f1f5f9;line-height:1.4;
                 transition:background .12s;"
          onmouseover="this.style.background='#f1f5f9'"
          onmouseout="this.style.background=''"
        >${name}${addr}</div>`;
    }).join('');
  },

  _selectResult(lat, lon) {
    const latF = parseFloat(lat);
    const lonF = parseFloat(lon);
    // pan map to result
    this.map.location({ lon: lonF, lat: latF }, true);
    this.map.zoom(16, true);
    this._placeMarker(latF, lonF);
    // clear search UI
    const resultsEl = document.getElementById('mapSearchResults');
    const inputEl = document.getElementById('mapSearchInput');
    if (resultsEl) resultsEl.innerHTML = '';
    if (inputEl) inputEl.value = '';
  },

  confirm() {
    if (this.selectedLat === null) return;
    const coords = `${this.selectedLat.toFixed(6)}, ${this.selectedLon.toFixed(6)}`;
    if (this.onConfirm) this.onConfirm(coords);
    this.close();
  },

  close() {
    const el = document.getElementById('mapPickerModal');
    if (el) el.remove();
    // Longdo Maps cleans up when its container is removed from DOM
    this.map = null;
    this.marker = null;
  }
};
