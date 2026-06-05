// ===== MAP PICKER (Leaflet + OSM + Nominatim) — Roadside theme ส้ม =====
// Interface เดียวกับ map.js (Longdo) — drop-in replacement
const MapPicker = {
  map: null,
  marker: null,
  selectedLat: null,
  selectedLon: null,
  selectedName: null,
  searchTimer: null,
  onConfirm: null,

  DEFAULT_LAT: 16.0590,
  DEFAULT_LON: 102.7313,
  DEFAULT_ZOOM: 13,
  // ธีมส้ม
  ACCENT: '#d97706',

  open(currentCoords, onConfirm) {
    this.onConfirm = onConfirm;
    this.selectedLat = null;
    this.selectedLon = null;
    this.selectedName = null;
    if (currentCoords) {
      const p = currentCoords.split(',').map(s => parseFloat(s.trim()));
      if (p.length === 2 && !isNaN(p[0]) && !isNaN(p[1])) {
        this.selectedLat = p[0]; this.selectedLon = p[1];
      }
    }
    this._renderModal();
    // Leaflet ต้องรอ DOM mount ก่อน
    setTimeout(() => this._initMap(), 60);
  },

  _renderModal() {
    const old = document.getElementById('mapPickerModal');
    if (old) old.remove();
    const isMobile = window.innerWidth < 768;
    const hint = this.selectedLat
      ? `📍 ${this.selectedLat.toFixed(6)}, ${this.selectedLon.toFixed(6)}`
      : (isMobile ? 'แตะบนแผนที่เพื่อปักหมุด · หรือค้นหาด้านบน' : 'คลิกบนแผนที่เพื่อปักหมุด · หรือค้นหาด้านบน');
    const confirmOpacity = this.selectedLat ? '1' : '0.4';
    const accent = this.ACCENT;

    const el = document.createElement('div');
    el.id = 'mapPickerModal';
    el.style.cssText = isMobile
      ? 'position:fixed;inset:0;z-index:300;background:#fff;display:flex;flex-direction:column;animation:fadeIn .15s ease;'
      : 'position:fixed;inset:0;z-index:300;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px;animation:fadeIn .2s ease;';

    const innerStyle = isMobile
      ? 'width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;'
      : 'background:#fff;border-radius:16px;width:100%;max-width:680px;height:90vh;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,.3);overflow:hidden;';

    el.innerHTML = `
      <div style="${innerStyle}">
        <div style="padding:${isMobile?'12px 16px 10px':'16px 20px 12px'};border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
          <div style="font-size:15px;font-weight:700;color:#0f172a;">📍 เลือกพิกัดจากแผนที่ <span style="font-size:11px;color:#94a3b8;font-weight:500;margin-left:6px;">(OpenStreetMap)</span></div>
          <button onclick="MapPicker.close()" style="width:32px;height:32px;border:none;background:#f1f5f9;border-radius:50%;cursor:pointer;font-size:16px;color:#64748b;display:flex;align-items:center;justify-content:center;">✕</button>
        </div>

        <div style="padding:${isMobile?'10px 16px':'12px 20px'};border-bottom:1px solid #f1f5f9;flex-shrink:0;">
          <div style="display:flex;gap:8px;">
            <input id="mapSearchInput" placeholder="ค้นหาสถานที่... เช่น โรงพยาบาลบ้านไผ่"
              style="flex:1;padding:9px 13px;border:1.5px solid #e2e8f0;border-radius:8px;font-family:inherit;font-size:14px;color:#1e293b;outline:none;"
              oninput="MapPicker._onSearchInput(this.value)"
              onkeydown="if(event.key==='Enter')MapPicker._search(this.value)"
              onfocus="this.style.borderColor='${accent}'"
              onblur="this.style.borderColor='#e2e8f0'" />
            <button onclick="MapPicker._search(document.getElementById('mapSearchInput').value)"
              style="padding:9px 14px;background:${accent};color:#fff;border:none;border-radius:8px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;">
              ค้นหา
            </button>
          </div>
          <div id="mapSearchResults" style="margin-top:6px;max-height:${isMobile?'120px':'180px'};overflow-y:auto;"></div>
        </div>

        <div id="mapContainer" style="flex:1;position:relative;overflow:hidden;background:#e5e7eb;"></div>

        <div style="padding:${isMobile?'10px 16px':'12px 20px'};border-top:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-shrink:0;background:#f8fafc;">
          <div id="mapCoordsDisplay" style="font-size:13px;color:#64748b;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${hint}</div>
          <div style="display:flex;gap:8px;flex-shrink:0;">
            <button onclick="MapPicker.close()" style="padding:9px 14px;background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;border-radius:8px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;">ยกเลิก</button>
            <button id="mapConfirmBtn" onclick="MapPicker.confirm()" style="padding:9px 16px;background:#10b981;color:#fff;border:none;border-radius:8px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;opacity:${confirmOpacity};">✓ ยืนยัน</button>
          </div>
        </div>
      </div>`;
    el.addEventListener('click', e => { if (e.target === el) this.close(); });
    document.body.appendChild(el);
  },

  _initMap() {
    const container = document.getElementById('mapContainer');
    if (!container || typeof L === 'undefined') {
      console.warn('MapPicker: Leaflet not loaded');
      container && (container.innerHTML = '<div style="padding:24px;color:#dc2626;text-align:center;">โหลดแผนที่ไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ต</div>');
      return;
    }
    const lat = this.selectedLat || this.DEFAULT_LAT;
    const lon = this.selectedLon || this.DEFAULT_LON;

    this.map = L.map(container, { zoomControl: true, attributionControl: true })
      .setView([lat, lon], this.DEFAULT_ZOOM);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);

    if (this.selectedLat !== null) {
      this._placeMarker(this.selectedLat, this.selectedLon);
    }

    this.map.on('click', (e) => {
      this._placeMarker(e.latlng.lat, e.latlng.lng);
      // reverse geocode เพื่อเอาชื่อสถานที่
      this._reverseGeocode(e.latlng.lat, e.latlng.lng);
    });

    // force layout recompute หลัง modal mount
    setTimeout(() => this.map && this.map.invalidateSize(), 200);
  },

  _placeMarker(lat, lon) {
    this.selectedLat = lat;
    this.selectedLon = lon;
    if (!this.marker) {
      this.marker = L.marker([lat, lon], { draggable: true }).addTo(this.map);
      this.marker.on('dragend', () => {
        const p = this.marker.getLatLng();
        this.selectedLat = p.lat; this.selectedLon = p.lng;
        this._reverseGeocode(p.lat, p.lng);
        this._updateCoordsDisplay();
      });
    } else {
      this.marker.setLatLng([lat, lon]);
    }
    this._updateCoordsDisplay();
  },

  _updateCoordsDisplay() {
    const c = document.getElementById('mapCoordsDisplay');
    const b = document.getElementById('mapConfirmBtn');
    if (c && this.selectedLat !== null) c.innerHTML = `📍 ${this.selectedLat.toFixed(6)}, ${this.selectedLon.toFixed(6)}${this.selectedName ? ' · ' + this.selectedName : ''}`;
    if (b) b.style.opacity = this.selectedLat !== null ? '1' : '0.4';
  },

  // ===== Search via Nominatim (free, 1 req/sec) =====
  _onSearchInput(value) {
    clearTimeout(this.searchTimer);
    const v = value.trim();
    if (v.length < 3) {
      const r = document.getElementById('mapSearchResults');
      if (r) r.innerHTML = '';
      return;
    }
    this.searchTimer = setTimeout(() => this._search(v), 450);
  },

  async _search(query) {
    const q = (query || '').trim();
    const resultsEl = document.getElementById('mapSearchResults');
    if (!q || !resultsEl) return;
    resultsEl.innerHTML = '<div style="padding:10px;color:#94a3b8;font-size:13px;">⌛ กำลังค้นหา...</div>';
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=8&accept-language=th&countrycodes=th&q=${encodeURIComponent(q)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!data.length) {
        resultsEl.innerHTML = '<div style="padding:10px;color:#94a3b8;font-size:13px;">ไม่พบสถานที่ — ลองพิมพ์ใหม่หรือคลิกบนแผนที่</div>';
        return;
      }
      resultsEl.innerHTML = data.map((d, i) => `
        <div onclick="MapPicker._pickResult(${d.lat}, ${d.lon}, ${JSON.stringify(d.display_name).replace(/"/g,'&quot;')})"
          style="padding:8px 10px;border-bottom:1px solid #f1f5f9;cursor:pointer;font-size:13px;color:#1e293b;line-height:1.4;"
          onmouseover="this.style.background='#fef3c7'"
          onmouseout="this.style.background='transparent'">
          <div style="font-weight:600;">${d.display_name.split(',')[0]}</div>
          <div style="font-size:11px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${d.display_name}</div>
        </div>`).join('');
    } catch (e) {
      resultsEl.innerHTML = `<div style="padding:10px;color:#dc2626;font-size:13px;">❌ ค้นหาไม่สำเร็จ: ${e.message}</div>`;
    }
  },

  _pickResult(lat, lon, name) {
    this.selectedName = name;
    this._placeMarker(parseFloat(lat), parseFloat(lon));
    this.map.setView([lat, lon], 16);
    const r = document.getElementById('mapSearchResults');
    if (r) r.innerHTML = '';
    const inp = document.getElementById('mapSearchInput');
    if (inp) inp.value = name.split(',')[0];
  },

  async _reverseGeocode(lat, lon) {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&accept-language=th&lat=${lat}&lon=${lon}&zoom=18`;
      const res = await fetch(url);
      const d = await res.json();
      if (d && d.display_name) {
        this.selectedName = d.display_name.split(',')[0];
        this._updateCoordsDisplay();
      }
    } catch { /* silent */ }
  },

  confirm() {
    if (this.selectedLat === null) return;
    const coords = `${this.selectedLat.toFixed(6)}, ${this.selectedLon.toFixed(6)}`;
    if (this.onConfirm) this.onConfirm(coords, this.selectedName || '');
    this.close();
  },

  close() {
    const el = document.getElementById('mapPickerModal');
    if (el) el.remove();
    if (this.map) { this.map.remove(); this.map = null; }
    this.marker = null;
  }
};
