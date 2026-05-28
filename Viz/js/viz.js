// ===== VIZ MODULE =====
// ข้อมูลมาจาก Firebase (collection: households)
// โครงการวางผังเมืองรวมอำเภอบ้านไผ่ จ.ขอนแก่น

const FB_CFG = {
  apiKey:            'AIzaSyA_f0UniGXeSRRn4VjD-56Gp9Xb0M-I8kQ',
  authDomain:        'banphai-survey.firebaseapp.com',
  projectId:         'banphai-survey',
  storageBucket:     'banphai-survey.firebasestorage.app',
  messagingSenderId: '755175522135',
  appId:             '1:755175522135:web:da20ccae36e1d1e9210812'
};

const DEFAULT_LAT = 16.0590;
const DEFAULT_LON = 102.7313;

const Viz = {
  db:         null,
  map:        null,
  data:       [],        // households array
  overlays:   [],        // longdo overlays currently on map
  activeLayer: 'households',

  // ===== INIT MAP =====
  init() {
    if (!window.longdo) { setTimeout(() => this.init(), 200); return; }
    this.map = new longdo.Map({
      placeholder: document.getElementById('map'),
      zoom: 12,
      location: { lon: DEFAULT_LON, lat: DEFAULT_LAT }
    });
    // Firebase
    try {
      if (!firebase.apps.length) firebase.initializeApp(FB_CFG);
      this.db = firebase.firestore();
    } catch(e) { console.error('Firebase init error', e); }
  },

  // ===== LOAD DATA FROM FIREBASE =====
  async loadData() {
    const btn = document.getElementById('loadBtn');
    const status = document.getElementById('loadStatus');
    btn.disabled = true; btn.textContent = '⌛ กำลังโหลด...';
    try {
      if (!this.db) throw new Error('Firebase ไม่พร้อม');
      const snap = await this.db.collection('households').get();
      if (snap.empty) throw new Error('ไม่มีข้อมูลใน Firebase');
      this.data = snap.docs.map(d => d.data());
      this._updateStats();
      this.showLayer(this.activeLayer);
      status.textContent = `โหลดแล้ว ${this.data.length} ครัวเรือน`;
      this._toast(`โหลดสำเร็จ ${this.data.length} ครัวเรือน`);
    } catch(e) {
      status.textContent = 'โหลดไม่สำเร็จ';
      this._toast('Error: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = '☁️ โหลดข้อมูล';
    }
  },

  // ===== STATS BAR =====
  _updateStats() {
    const members = this.data.flatMap(h => h.members || []);
    const trips   = members.flatMap(m => m.trips || []);
    const withCoords = this.data.filter(h => h.coordinates && h.coordinates.trim()).length;
    document.getElementById('statsBar').style.display = 'flex';
    document.getElementById('s_hh').textContent     = this.data.length;
    document.getElementById('s_m').textContent      = members.length;
    document.getElementById('s_t').textContent      = trips.length;
    document.getElementById('s_coords').textContent = withCoords;
  },

  // ===== LAYER SWITCHER =====
  showLayer(layer) {
    this.activeLayer = layer;
    ['btnHH','btnOD','btnHeat'].forEach(id => document.getElementById(id)?.classList.remove('btn-active'));
    const map = { households:'btnHH', od:'btnOD', heatmap:'btnHeat' };
    document.getElementById(map[layer])?.classList.add('btn-active');
    this._clearOverlays();
    if (!this.data.length) { this._toast('กรุณาโหลดข้อมูลก่อน'); return; }
    if (layer === 'households') this._drawHouseholds();
    if (layer === 'od')         this._drawOD();
    if (layer === 'heatmap')    this._drawHeatmap();
  },

  _clearOverlays() {
    this.overlays.forEach(o => this.map.Overlays.remove(o));
    this.overlays = [];
  },

  // ===== LAYER: HOUSEHOLDS =====
  _drawHouseholds() {
    this.data.forEach(hh => {
      const coords = this._parseCoords(hh.coordinates);
      if (!coords) return;
      const marker = new longdo.Marker(
        { lon: coords[1], lat: coords[0] },
        {
          icon: { url: this._svgPin('#2563eb'), size: { width: 28, height: 36 }, offset: { x: 14, y: 36 } },
          title: `บ้าน ${hh.houseNo || ''} ม.${hh.moo || ''}`
        }
      );
      marker.Event?.bind('click', () => this._showHHPanel(hh));
      this.map.Overlays.add(marker);
      this.overlays.push(marker);
    });
  },

  // ===== LAYER: OD LINES =====
  _drawOD() {
    this.data.forEach(hh => {
      (hh.members || []).forEach(m => {
        (m.trips || []).forEach(t => {
          const o = this._parseCoords(t.originCoords);
          const d = this._parseCoords(t.destinationCoords);
          if (!o || !d) return;
          const line = new longdo.Polyline(
            [{ lon: o[1], lat: o[0] }, { lon: d[1], lat: d[0] }],
            { lineColor: '#f59e0b', lineWidth: 2, lineOpacity: 0.6 }
          );
          this.map.Overlays.add(line);
          this.overlays.push(line);
          // จุดต้นทาง
          const oMark = new longdo.Marker({ lon: o[1], lat: o[0] }, {
            icon: { url: this._svgPin('#10b981'), size: { width: 18, height: 24 }, offset: { x: 9, y: 24 } }
          });
          // จุดปลายทาง
          const dMark = new longdo.Marker({ lon: d[1], lat: d[0] }, {
            icon: { url: this._svgPin('#ef4444'), size: { width: 18, height: 24 }, offset: { x: 9, y: 24 } }
          });
          this.map.Overlays.add(oMark);
          this.map.Overlays.add(dMark);
          this.overlays.push(oMark, dMark);
        });
      });
    });
  },

  // ===== LAYER: HEATMAP =====
  _drawHeatmap() {
    // Longdo Maps รองรับ Heatmap ผ่าน Dot layer
    // สร้าง dataset จากพิกัดครัวเรือน
    const points = this.data
      .map(hh => this._parseCoords(hh.coordinates))
      .filter(Boolean)
      .map(c => ({ lon: c[1], lat: c[0], weight: 1 }));

    if (!points.length) { this._toast('ไม่มีพิกัดสำหรับแสดง'); return; }

    // ใช้ markers หลายๆ จุดแสดงแทน heatmap ก่อน (ทำ heatmap จริงเพิ่มทีหลัง)
    points.forEach(p => {
      const circle = new longdo.Circle(
        { lon: p.lon, lat: p.lat }, 150,
        { fillColor: 'rgba(239,68,68,0.15)', lineWidth: 0 }
      );
      this.map.Overlays.add(circle);
      this.overlays.push(circle);
    });
    this._toast(`แสดง ${points.length} จุด (heatmap)`);
  },

  // ===== INFO PANEL: HOUSEHOLD =====
  _showHHPanel(hh) {
    const panel = document.getElementById('infoPanel');
    document.getElementById('panelTitle').textContent = `🏠 บ้านเลขที่ ${hh.houseNo || '—'}`;
    const members = hh.members || [];
    const trips   = members.flatMap(m => m.trips || []);
    document.getElementById('panelBody').innerHTML = `
      <div style="font-size:13px;line-height:2;color:#475569;">
        <div>📍 ${hh.coordinates || '—'}</div>
        <div>🗓 วันที่เดินทาง: ${hh.travelDate || '—'}</div>
        <div>👥 สมาชิก: ${members.length} คน</div>
        <div>🚗 การเดินทาง: ${trips.length} เที่ยว</div>
        ${hh.surveyorName ? `<div>🧑‍💼 ผู้สำรวจ: ${hh.surveyorName}</div>` : ''}
      </div>
      <hr style="margin:12px 0;border:none;border-top:1px solid #e2e8f0;">
      <div style="font-size:12px;font-weight:700;color:#94a3b8;margin-bottom:8px;">สมาชิก</div>
      ${members.map(m => `
        <div style="background:#f8fafc;border-radius:6px;padding:8px 10px;margin-bottom:6px;font-size:13px;">
          <div style="font-weight:600;">คนที่ ${m.seq} · ${m.gender || '—'} · ${m.age || '—'} ปี</div>
          <div style="color:#64748b;">${m.occupation || 'ไม่ระบุอาชีพ'}</div>
          <div style="color:#94a3b8;font-size:12px;">${m.trips?.length || 0} การเดินทาง</div>
        </div>`).join('')}
    `;
    panel.classList.add('open');
  },

  // ===== HELPERS =====
  _parseCoords(str) {
    if (!str) return null;
    const parts = str.split(',').map(s => parseFloat(s.trim()));
    if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
    return parts; // [lat, lon]
  },

  _svgPin(color) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 32" width="24" height="32">
      <path d="M12 0C6.48 0 2 4.48 2 10c0 7.5 10 22 10 22S22 17.5 22 10C22 4.48 17.52 0 12 0z" fill="${color}"/>
      <circle cx="12" cy="10" r="4" fill="white"/>
    </svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  },

  _toast(msg) {
    const el = document.getElementById('_toast') || (() => {
      const d = document.createElement('div');
      d.id = '_toast'; d.className = 'toast'; document.body.appendChild(d); return d;
    })();
    el.textContent = msg; el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.display = 'none'; }, 3000);
  }
};

document.addEventListener('DOMContentLoaded', () => Viz.init());
