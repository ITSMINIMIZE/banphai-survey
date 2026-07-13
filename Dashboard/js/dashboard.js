'use strict';

// ── FIREBASE CONFIG ───────────────────────────────────────────────────────────
const FB_CFG = {
  apiKey:            'AIzaSyA_f0UniGXeSRRn4VjD-56Gp9Xb0M-I8kQ',
  authDomain:        'banphai-survey.firebaseapp.com',
  projectId:         'banphai-survey',
  storageBucket:     'banphai-survey.firebasestorage.app',
  messagingSenderId: '755175522135',
  appId:             '1:755175522135:web:da20ccae36e1d1e9210812'
};

const CENTER = { lat: 14.6318, lon: 102.7916 };

// ── STATE ─────────────────────────────────────────────────────────────────────
let db = null, auth = null;
let households = [];
let stations   = [];
let charts = {};
let leafletMap = null;
let desireLayer = null;
let choroLayer  = null;
let zoneLayer   = null;
let selectedZone = null;
let cachedPairMap = null;  // reused when only selection changes

// ── GEOMETRY ──────────────────────────────────────────────────────────────────
function parseCoords(str) {
  if (!str) return null;
  const p = str.split(',').map(s => parseFloat(s.trim()));
  return (p.length === 2 && !isNaN(p[0]) && !isNaN(p[1])) ? { lat: p[0], lon: p[1] } : null;
}

function ptInRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi))
      inside = !inside;
  }
  return inside;
}

function ptInFeature(lat, lon, f) {
  const g = f.geometry;
  if (!g) return false;
  if (g.type === 'Polygon') return ptInRing(lat, lon, g.coordinates[0]);
  if (g.type === 'MultiPolygon') return g.coordinates.some(p => ptInRing(lat, lon, p[0]));
  return false;
}

function zFeatures() {
  return (typeof ZONES_GEOJSON !== 'undefined' && ZONES_GEOJSON.features) ? ZONES_GEOJSON.features : [];
}

function zName(f) {
  const p = f.properties || {};
  return p.name || p.Name || p.NAME || p.TAMBON_T || p.tambon || 'ไม่ระบุ';
}

function assignZone(coords) {
  if (!coords) return '(ไม่มีพิกัด)';            // ข้อมูลไม่มีพิกัด — แยกจาก "นอกพื้นที่" จริง
  for (const f of zFeatures()) {
    if (ptInFeature(coords.lat, coords.lon, f)) return zName(f);
  }
  return '(นอกพื้นที่)';                          // มีพิกัดแต่อยู่นอกโซนที่กำหนด
}

function zCentroid(f) {
  const g = f.geometry;
  let ring = [];
  if (g.type === 'Polygon') ring = g.coordinates[0];
  else if (g.type === 'MultiPolygon') ring = g.coordinates[0][0];
  const n = ring.length - 1;
  if (n <= 0) return CENTER;
  let sLat = 0, sLon = 0;
  for (let i = 0; i < n; i++) { sLon += ring[i][0]; sLat += ring[i][1]; }
  return { lat: sLat / n, lon: sLon / n };
}

function allCentroids() {
  const m = {};
  zFeatures().forEach(f => { m[zName(f)] = zCentroid(f); });
  return m;
}

function featureRings(f) {
  const g = f.geometry;
  if (!g) return [];
  if (g.type === 'Polygon') return g.coordinates;
  if (g.type === 'MultiPolygon') return g.coordinates.flatMap(p => p);
  return [];
}

// ── FIREBASE ──────────────────────────────────────────────────────────────────
function fbInit() {
  if (!firebase.apps.length) firebase.initializeApp(FB_CFG);
  db   = firebase.firestore();
  auth = firebase.auth();
}

async function loginAdmin(username, password) {
  const u = username.trim().toLowerCase().replace(/\s+/g, '');
  // ถ้าพิมพ์ email เต็ม (มี @) ใช้ตรงๆ — มิฉะนั้นต่อ @banphai.local
  const email = u.includes('@') ? u : u + '@banphai.local';
  await auth.signInWithEmailAndPassword(email, password);
}

// ── DATA PULL ─────────────────────────────────────────────────────────────────
// nested schema: households/{}/members/{}/trips/{} → ประกอบเป็น hh.members[].trips[]
async function pullHouseholds() {
  const snap = await db.collection('households').get({ source: 'server' });
  const households = snap.docs.map(d => {
    const x = d.data(); delete x._device; delete x._syncedAt;
    x.members = []; return x;
  });

  // members ของแต่ละ household (parallel)
  const memSnaps = await Promise.all(
    snap.docs.map(d => d.ref.collection('members').get({ source: 'server' }))
  );
  const memberRefs = [];
  memSnaps.forEach((mSnap, i) => {
    mSnap.docs.forEach(md => {
      const m = md.data(); delete m._device; delete m._syncedAt;
      m.trips = [];
      households[i].members.push(m);
      memberRefs.push({ ref: md.ref, member: m });
    });
  });

  // trips ของแต่ละ member (parallel)
  const tripSnaps = await Promise.all(
    memberRefs.map(mr => mr.ref.collection('trips').get({ source: 'server' }))
  );
  tripSnaps.forEach((tSnap, i) => {
    tSnap.docs.forEach(td => {
      const t = td.data(); delete t._device; delete t._syncedAt;
      memberRefs[i].member.trips.push(t);
    });
  });

  households.forEach(hh => {
    hh.members.sort((a, b) => (a.seq || 0) - (b.seq || 0));
    hh.members.forEach(m => m.trips.sort((a, b) => (a.seq || 0) - (b.seq || 0)));
  });
  return households;
}

async function pullRoadside() {
  const stSnap = await db.collection('roadside_stations').get({ source: 'server' });
  const map = {};
  stSnap.docs.forEach(d => {
    const x = d.data(); delete x._device; delete x._syncedAt;
    x.interviews = []; map[d.id] = x;
  });
  const ivSnaps = await Promise.all(
    stSnap.docs.map(d => d.ref.collection('interviews').get({ source: 'server' }))
  );
  ivSnaps.forEach((snap, i) => {
    const stId = stSnap.docs[i].id;
    snap.docs.forEach(d => {
      const x = d.data(); delete x._device; delete x._syncedAt;
      map[stId].interviews.push(x);
    });
  });
  return Object.values(map);
}

// ── DERIVED DATA ──────────────────────────────────────────────────────────────
function allTrips() {
  return households.flatMap(hh =>
    (hh.members || []).flatMap(m =>
      (m.trips || []).map(t => ({ ...t, _hh: hh, _member: m }))
    )
  );
}

function allInterviews() {
  return stations.flatMap(st =>
    (st.interviews || []).map(iv => ({ ...iv, _station: st }))
  );
}

function allMembers() {
  return households.flatMap(hh => (hh.members || []).map(m => ({ ...m, _hh: hh })));
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
const COLORS = [
  '#3b82f6','#22c55e','#f59e0b','#ef4444','#8b5cf6',
  '#06b6d4','#f97316','#ec4899','#14b8a6','#a3e635',
  '#64748b','#6366f1','#d946ef','#0ea5e9','#84cc16'
];

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function countBy(arr, fn) {
  const m = {};
  arr.forEach(x => { const k = fn(x) || '(ไม่ระบุ)'; m[k] = (m[k] || 0) + 1; });
  return m;
}

function topN(obj, n = 10) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
}

function makeChart(id, type, data, options = {}) {
  if (charts[id]) { try { charts[id].destroy(); } catch (_) {} delete charts[id]; }
  const ctx = document.getElementById(id);
  if (!ctx) return null;
  const darkScales = {
    x: { ticks: { color: '#64748b', font: { family: 'Sarabun' } }, grid: { color: '#1e293b' } },
    y: { ticks: { color: '#64748b', font: { family: 'Sarabun' } }, grid: { color: '#1e293b' } }
  };
  charts[id] = new Chart(ctx, {
    type,
    data,
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: '#94a3b8', font: { family: 'Sarabun', size: 12 } } }
      },
      scales: (type === 'pie' || type === 'doughnut') ? undefined : darkScales,
      ...options,
    }
  });
  return charts[id];
}

// ── KPI BAR ───────────────────────────────────────────────────────────────────
function renderKPIs() {
  const members = allMembers();
  const trips   = allTrips();
  const ivs     = allInterviews();
  const pax     = ivs.reduce((s, iv) => s + (+iv.passengerCount || 0), 0);

  // Home
  set('kpiHH',       households.length.toLocaleString());
  set('kpiMembers',  members.length.toLocaleString());
  set('kpiTripRate', members.length ? (trips.length / members.length).toFixed(2) : '—');
  // Road
  set('kpiIV',       ivs.length.toLocaleString());
  set('kpiRoadPax',  pax.toLocaleString());
  set('kpiRoadOcc',  ivs.length ? (pax / ivs.length).toFixed(2) : '—');
}

function set(id, val) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = val;
}

// ── TAB: ติดตามงาน ─────────────────────────────────────────────────────────────
// ขั้นต่ำ/คน — 100% = QUOTA × จำนวนผู้สำรวจในทีม/จุด
const HOME_QUOTA_PER_PERSON = 12;  // บ้าน/คน
const ROAD_QUOTA_PER_PERSON = 80;  // คัน/คน

function statusChip(pct, actual, target) {
  const cls = pct >= 100 ? 'chip-ok' : pct >= 50 ? 'chip-warn' : 'chip-err';
  return `<span class="chip ${cls}">${pct}%</span>`
       + ` <span style="color:var(--muted);font-size:11px">${actual}/${target}</span>`;
}

function renderProgress() {
  // ═══ HOME: จัดกลุ่มตามผู้ควบคุม (= ทีม) ═══
  const teams = {};
  households.forEach(hh => {
    const sup = hh.supervisorName || '(ไม่ระบุผู้ควบคุม)';
    const t = teams[sup] || (teams[sup] = { hhs: 0, members: 0, trips: 0, people: new Set() });
    t.hhs++;
    if (hh.surveyorName) t.people.add(hh.surveyorName);
    (hh.members || []).forEach(m => { t.members++; t.trips += (m.trips || []).length; });
  });
  const teamRows = Object.entries(teams).sort((a, b) => b[1].hhs - a[1].hhs);
  set('badgeHomeSurveyor', teamRows.length + ' ทีม');
  set('homeSurveyorTable', `
    <table class="data-table">
      <thead><tr><th>ผู้ควบคุม</th><th>บ้าน</th><th>คน</th><th>เที่ยว</th><th>สถานะ</th></tr></thead>
      <tbody>${teamRows.map(([name, d]) => {
        const people = Math.max(d.people.size, 1);
        const target = HOME_QUOTA_PER_PERSON * people;
        const pct = Math.round(d.hhs / target * 100);
        return `<tr>
          <td>${esc(name)} <span style="color:var(--muted);font-size:11px">(${d.people.size} คน)</span></td>
          <td style="font-weight:700">${d.hhs}</td><td>${d.members}</td><td>${d.trips}</td>
          <td>${statusChip(pct, d.hhs, target)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`);

  // ═══ ROAD: จัดกลุ่มตามจุดสำรวจ ═══
  set('badgeRoadsideStation', stations.length + ' จุด');
  const stRows = stations.map(st => {
    const ivs = st.interviews || [];
    const people = new Set(ivs.map(iv => iv.surveyorName).filter(Boolean));
    const pax = ivs.reduce((s, iv) => s + (+iv.passengerCount || 0), 0);
    const target = ROAD_QUOTA_PER_PERSON * Math.max(people.size, 1);
    const pct = Math.round(ivs.length / target * 100);
    return { st, count: ivs.length, pax, people: people.size, target, pct };
  }).sort((a, b) => b.count - a.count);
  set('roadsideStationTable', `
    <table class="data-table">
      <thead><tr><th>จุดสำรวจ</th><th>ผู้ควบคุม</th><th>สำรวจ</th><th>คนในรถ</th><th>สถานะ</th></tr></thead>
      <tbody>${stRows.map(r => `
        <tr>
          <td>${esc(r.st.stationName || r.st.stationCode || r.st.id)} <span style="color:var(--muted);font-size:11px">(${r.people} คน)</span></td>
          <td>${esc(r.st.supervisorName || '—')}</td>
          <td style="font-weight:700">${r.count}</td>
          <td>${r.pax}</td>
          <td>${statusChip(r.pct, r.count, r.target)}</td>
        </tr>`).join('')}</tbody>
    </table>`);

  // ═══ กราฟ Home: บ้านแยกตามผู้ควบคุม ═══
  makeChart('chartHomeBySupervisor', 'bar', {
    labels: teamRows.map(([n]) => n),
    datasets: [{ label: 'บ้าน', data: teamRows.map(([, d]) => d.hhs), backgroundColor: '#3b82f6' }]
  }, { plugins: { legend: { display: false } } });

  // ═══ กราฟ Road: รถแยกตามจุดสำรวจ ═══
  makeChart('chartRoadByStation', 'bar', {
    labels: stRows.map(r => r.st.stationName || r.st.stationCode || r.st.id),
    datasets: [{ label: 'คัน', data: stRows.map(r => r.count), backgroundColor: '#22c55e' }]
  }, { plugins: { legend: { display: false } } });

  // Incomplete records
  const incomplete = households.filter(hh =>
    !hh.coordinates || !hh.surveyorName ||
    !(hh.members || []).length ||
    (hh.members || []).some(m => !m.gender || !m.age || !(m.trips || []).length)
  );
  set('badgeIncomplete', incomplete.length);
  if (!incomplete.length) {
    set('incompleteTable', '<p style="color:var(--success);padding:8px 0">✓ ไม่พบข้อมูลที่ไม่ครบ</p>');
  } else {
    set('incompleteTable', `
      <table class="data-table">
        <thead><tr><th>ID</th><th>ผู้สำรวจ</th><th>วันที่</th><th>ปัญหาที่พบ</th></tr></thead>
        <tbody>${incomplete.slice(0, 30).map(hh => {
          const issues = [];
          if (!hh.coordinates) issues.push('ไม่มีพิกัด');
          if (!hh.surveyorName) issues.push('ไม่มีชื่อผู้สำรวจ');
          if (!(hh.members || []).length) issues.push('ไม่มีสมาชิก');
          else if ((hh.members || []).some(m => !(m.trips || []).length)) issues.push('สมาชิกบางคนไม่มีเที่ยว');
          return `<tr>
            <td style="font-family:monospace;font-size:11px">${esc(hh.id)}</td>
            <td>${esc(hh.surveyorName || '—')}</td>
            <td>${esc(hh.surveyDate || '—')}</td>
            <td><span class="chip chip-warn">${esc(issues.join(', '))}</span></td>
          </tr>`;
        }).join('')}</tbody>
      </table>
      ${incomplete.length > 30 ? `<p style="color:var(--muted);font-size:12px;margin-top:8px">... และอีก ${incomplete.length - 30} รายการ</p>` : ''}`);
  }
}

// ── TAB: OD MATRIX ─────────────────────────────────────────────────────────────
function buildODPairs(source) {
  const pairs = [];
  if (source === 'home' || source === 'all') {
    allTrips().forEach(t => {
      pairs.push({
        o: assignZone(parseCoords(t.originCoords)),
        d: assignZone(parseCoords(t.destinationCoords))
      });
    });
  }
  if (source === 'roadside' || source === 'all') {
    allInterviews().forEach(iv => {
      pairs.push({
        o: assignZone(parseCoords(iv.originCoords)),
        d: assignZone(parseCoords(iv.destinationCoords))
      });
    });
  }
  return pairs;
}

function renderODMatrix(source) {
  const features = zFeatures();
  const zNames   = features.map(f => zName(f));
  const allZones = ['(ไม่มีพิกัด)', '(นอกพื้นที่)', ...zNames];

  const pairs = buildODPairs(source);

  // Build matrix
  const matrix = {};
  allZones.forEach(o => { matrix[o] = {}; allZones.forEach(d => { matrix[o][d] = 0; }); });
  pairs.forEach(({ o, d }) => {
    const oz = matrix[o] ? o : '(นอกพื้นที่)';
    const dz = matrix[d] ? d : '(นอกพื้นที่)';
    matrix[oz][dz]++;
  });

  // Summary — แยก "ไม่มีพิกัด" (ข้อมูลไม่ครบ) ออกจากการจัดประเภท in/out
  let internal = 0, incoming = 0, outgoing = 0, passthrough = 0, noCoord = 0;
  const inArea = z => z !== '(นอกพื้นที่)' && z !== '(ไม่มีพิกัด)';
  pairs.forEach(({ o, d }) => {
    if (o === '(ไม่มีพิกัด)' || d === '(ไม่มีพิกัด)') { noCoord++; return; }
    const oi = inArea(o), di = inArea(d);
    if (oi && di) internal++;
    else if (!oi && di) incoming++;
    else if (oi && !di) outgoing++;
    else passthrough++;
  });
  const withCoord = pairs.length - noCoord;
  const pctNo = pairs.length ? Math.round(noCoord / pairs.length * 100) : 0;

  set('odSummary', `
    <table class="data-table">
      <tr><td>ในพื้นที่ (Internal)</td><td style="text-align:right;font-weight:700;color:#3b82f6">${internal}</td></tr>
      <tr><td>เข้าพื้นที่ (Incoming)</td><td style="text-align:right;font-weight:700;color:#22c55e">${incoming}</td></tr>
      <tr><td>ออกพื้นที่ (Outgoing)</td><td style="text-align:right;font-weight:700;color:#f59e0b">${outgoing}</td></tr>
      <tr><td>นอกพื้นที่ล้วน (External)</td><td style="text-align:right;font-weight:700;color:#64748b">${passthrough}</td></tr>
      <tr><td>⚠️ ไม่มีพิกัด (ข้อมูลไม่ครบ)</td><td style="text-align:right;font-weight:700;color:#ef4444">${noCoord} <span style="color:var(--muted);font-weight:400;font-size:11px">(${pctNo}%)</span></td></tr>
      <tr><td><strong>รวมทั้งหมด</strong></td><td style="text-align:right;font-weight:700">${pairs.length} <span style="color:var(--muted);font-weight:400;font-size:11px">(มีพิกัด ${withCoord})</span></td></tr>
    </table>`);

  // Top 10 pairs
  const pairCounts = {};
  pairs.forEach(({ o, d }) => {
    const k = `${o} → ${d}`;
    pairCounts[k] = (pairCounts[k] || 0) + 1;
  });
  const top10 = topN(pairCounts, 10);
  set('odTop10', `
    <table class="data-table">
      <thead><tr><th>#</th><th>คู่ O-D</th><th>จำนวน</th></tr></thead>
      <tbody>${top10.map(([pair, cnt], i) => `
        <tr>
          <td style="color:var(--muted)">${i + 1}</td>
          <td style="font-size:12px">${esc(pair)}</td>
          <td style="font-weight:700;color:#3b82f6">${cnt}</td>
        </tr>`).join('')}</tbody>
    </table>`);

  // Matrix table — only zones with any activity
  const maxVal = Math.max(1, ...Object.values(matrix).flatMap(row => Object.values(row)));
  const active = allZones.filter(z =>
    Object.values(matrix[z] || {}).some(v => v > 0) ||
    allZones.some(o => (matrix[o] || {})[z] > 0)
  );

  const cellCls = v => {
    if (!v) return 'od-cell-0';
    const r = v / maxVal;
    if (r < 0.1) return 'od-cell-low';
    if (r < 0.4) return 'od-cell-mid';
    return 'od-cell-high';
  };

  const shortName = (s, max = 14) => s.length > max ? s.slice(0, max) + '…' : s;

  set('odMatrixWrap', active.length === 0
    ? '<p style="color:var(--muted);padding:12px">ยังไม่มีข้อมูล OD</p>'
    : `<table class="od-table">
        <thead>
          <tr>
            <th style="min-width:100px">ต้นทาง ╲ ปลายทาง</th>
            ${active.map(z => `<th title="${esc(z)}">${esc(shortName(z))}</th>`).join('')}
            <th>รวม</th>
          </tr>
        </thead>
        <tbody>
          ${active.map(o => {
            const rowTotal = active.reduce((s, d) => s + (matrix[o][d] || 0), 0);
            return `<tr>
              <td class="od-row-header" title="${esc(o)}">${esc(shortName(o, 16))}</td>
              ${active.map(d => { const v = matrix[o][d] || 0; return `<td class="${cellCls(v)}">${v || ''}</td>`; }).join('')}
              <td style="font-weight:700">${rowTotal || ''}</td>
            </tr>`;
          }).join('')}
          <tr style="font-weight:700">
            <td class="od-row-header">รวม</td>
            ${active.map(d => { const t = active.reduce((s, o) => s + (matrix[o][d] || 0), 0); return `<td>${t || ''}</td>`; }).join('')}
            <td>${pairs.length}</td>
          </tr>
        </tbody>
      </table>`);
}

// ── TAB: MAP ──────────────────────────────────────────────────────────────────
function initLeafletMap() {
  if (leafletMap) return;
  leafletMap = L.map('leafletMap').setView([CENTER.lat, CENTER.lon], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors', maxZoom: 19
  }).addTo(leafletMap);
  // layer order: zones (bottom) → desire lines → choropleth (top)
  zoneLayer   = L.layerGroup().addTo(leafletMap);
  desireLayer = L.layerGroup().addTo(leafletMap);
  choroLayer  = L.layerGroup().addTo(leafletMap);
}

// Build pairMap from source (cached until source changes)
function buildPairMap(source) {
  const pairMap   = {};  // key → { count, oZ, dZ, oLatSum, oLonSum, dLatSum, dLonSum, extN }
  const processPair = (oCoords, dCoords) => {
    if (!oCoords || !dCoords) return;
    const oZ = assignZone(oCoords), dZ = assignZone(dCoords);
    if (oZ === dZ) return;
    const key = `${oZ}|${dZ}`;
    if (!pairMap[key]) pairMap[key] = { count: 0, oZ, dZ, oLatS: 0, oLonS: 0, dLatS: 0, dLonS: 0, oExtN: 0, dExtN: 0 };
    const p = pairMap[key];
    p.count++;
    if (oZ === '(นอกพื้นที่)') { p.oLatS += oCoords.lat; p.oLonS += oCoords.lon; p.oExtN++; }
    if (dZ === '(นอกพื้นที่)') { p.dLatS += dCoords.lat; p.dLonS += dCoords.lon; p.dExtN++; }
  };
  if (source === 'home' || source === 'all')
    allTrips().forEach(t => processPair(parseCoords(t.originCoords), parseCoords(t.destinationCoords)));
  if (source === 'roadside' || source === 'all')
    allInterviews().forEach(iv => processPair(parseCoords(iv.originCoords), parseCoords(iv.destinationCoords)));
  return pairMap;
}

function pairEndpoint(p, side, centroids) {
  const z = side === 'o' ? p.oZ : p.dZ;
  if (centroids[z]) return centroids[z];
  return side === 'o'
    ? { lat: p.oLatS / (p.oExtN || 1), lon: p.oLonS / (p.oExtN || 1) }
    : { lat: p.dLatS / (p.dExtN || 1), lon: p.dLonS / (p.dExtN || 1) };
}

function renderMap(mode, source) {
  if (!leafletMap) initLeafletMap();
  desireLayer.clearLayers();
  choroLayer.clearLayers();
  zoneLayer.clearLayers();
  cachedPairMap = null;

  const features  = zFeatures();
  const centroids = allCentroids();

  if (mode === 'choropleth') {
    selectedZone = null;
    _hideZonePanel();

    const generated = {}, attracted = {};
    features.forEach(f => { const n = zName(f); generated[n] = 0; attracted[n] = 0; });
    buildODPairs(source).forEach(({ o, d }) => {
      if (generated[o] !== undefined) generated[o]++;
      if (attracted[d] !== undefined) attracted[d]++;
    });
    const maxGen = Math.max(1, ...Object.values(generated));

    features.forEach(f => {
      const n = zName(f);
      const cnt = generated[n] || 0;
      const alpha = (0.1 + (cnt / maxGen) * 0.75).toFixed(2);
      featureRings(f).forEach(ring => {
        L.polygon(ring.map(c => [c[1], c[0]]), {
          color: '#3b82f6', weight: 1.5,
          fillColor: '#3b82f6', fillOpacity: parseFloat(alpha)
        }).bindTooltip(`<b>${n}</b><br>สร้าง: ${cnt} เที่ยว<br>ดึงดูด: ${attracted[n] || 0} เที่ยว`, { sticky: true })
          .addTo(choroLayer);
      });
    });

  } else {
    // ── Desire Lines mode ──
    selectedZone = null;
    _hideZonePanel();
    cachedPairMap = buildPairMap(source);
    const pairs = Object.values(cachedPairMap);
    const maxCount = Math.max(1, ...pairs.map(p => p.count));

    // Draw clickable zone polygons
    features.forEach(f => {
      const n = zName(f);
      const poly = L.polygon(
        featureRings(f).flatMap(ring => [ring.map(c => [c[1], c[0]])]),
        { color: '#475569', weight: 1, fillColor: '#1e293b', fillOpacity: 0.15, className: 'zone-poly' }
      );
      poly.on('click', () => {
        if (selectedZone === n) { App.clearZoneSelect(); return; }
        App.selectZone(n);
      });
      poly.bindTooltip(n, { sticky: true, className: 'zone-tooltip' });
      poly.addTo(zoneLayer);
      poly._zoneName = n;
    });

    _drawDesireLines(pairs, maxCount, centroids);
  }
}

// Draw desire lines — filtered by selectedZone if set
function _drawDesireLines(pairs, maxCount, centroids) {
  desireLayer.clearLayers();
  if (!centroids) centroids = allCentroids();
  if (!pairs)     pairs = Object.values(cachedPairMap || {});
  if (!maxCount)  maxCount = Math.max(1, ...pairs.map(p => p.count));

  pairs.forEach(p => {
    const { oZ, dZ, count } = p;
    const isSelected = selectedZone !== null;
    const outgoing   = oZ === selectedZone;
    const incoming   = dZ === selectedZone;
    const related    = outgoing || incoming;

    if (isSelected && !related) return; // hide unrelated lines when zone selected

    const oC = pairEndpoint(p, 'o', centroids);
    const dC = pairEndpoint(p, 'd', centroids);
    const w  = Math.max(1, Math.round((count / maxCount) * 12));
    const color = !isSelected ? '#3b82f6'
                : outgoing    ? '#f59e0b'   // orange = ออก
                :               '#22c55e';  // green  = เข้า
    const op = !isSelected
      ? Math.min(0.8, 0.15 + (count / maxCount) * 0.65)
      : 0.85;

    L.polyline([[oC.lat, oC.lon], [dC.lat, dC.lon]], { color, weight: w, opacity: op })
      .bindTooltip(`<b>${oZ}</b> → <b>${dZ}</b><br>${count} เที่ยว`)
      .addTo(desireLayer);
  });
}

// Update zone polygon styles based on selection
function _styleZonePolygons() {
  zoneLayer.eachLayer(poly => {
    const n = poly._zoneName;
    if (!selectedZone) {
      poly.setStyle({ color: '#475569', weight: 1, fillColor: '#1e293b', fillOpacity: 0.15 });
    } else if (n === selectedZone) {
      poly.setStyle({ color: '#ffffff', weight: 2.5, fillColor: '#3b82f6', fillOpacity: 0.25 });
    } else {
      poly.setStyle({ color: '#334155', weight: 1, fillColor: '#0f172a', fillOpacity: 0.35 });
    }
  });
}

function _showZonePanel(zoneName) {
  document.getElementById('mapZoneDetail').style.display = 'flex';
  document.getElementById('mapZoneEmpty').style.display  = 'none';

  set('mapZoneName', esc(zoneName));

  const pairs  = Object.values(cachedPairMap || {});
  const outMap = {}, inMap = {};
  pairs.forEach(({ oZ, dZ, count }) => {
    if (oZ === zoneName && dZ !== zoneName) outMap[dZ] = (outMap[dZ] || 0) + count;
    if (dZ === zoneName && oZ !== zoneName) inMap[oZ]  = (inMap[oZ]  || 0) + count;
  });

  const totalOut = Object.values(outMap).reduce((s, v) => s + v, 0);
  const totalIn  = Object.values(inMap).reduce((s, v) => s + v, 0);

  const renderList = (map, total, emptyMsg) => {
    const rows = topN(map, 8);
    if (!rows.length) return `<p style="color:var(--muted);font-size:12px">${emptyMsg}</p>`;
    return `<p style="font-size:12px;color:var(--muted);margin-bottom:6px">รวม ${total} เที่ยว</p>
      <table class="data-table" style="font-size:12px">
        ${rows.map(([z, cnt]) => `
          <tr>
            <td style="padding:5px 8px">${esc(z)}</td>
            <td style="padding:5px 8px;text-align:right;font-weight:700">${cnt}</td>
          </tr>`).join('')}
      </table>`;
  };

  set('mapZoneOut', renderList(outMap, totalOut, 'ไม่มีเที่ยวออก'));
  set('mapZoneIn',  renderList(inMap,  totalIn,  'ไม่มีเที่ยวเข้า'));
}

function _hideZonePanel() {
  document.getElementById('mapZoneDetail').style.display = 'none';
  document.getElementById('mapZoneEmpty').style.display  = 'flex';
  // clear search
  const inp = document.getElementById('zoneSearchInput');
  if (inp) inp.value = '';
  const res = document.getElementById('zoneSearchResults');
  if (res) res.style.display = 'none';
}

// ── TAB: ชั่วโมงเร่งด่วน ───────────────────────────────────────────────────────
function renderPeakHour(source) {
  const counts = new Array(24).fill(0);

  const parseHour = t => {
    if (!t) return -1;
    const m = String(t).match(/^(\d{1,2})[:.]/);
    return m ? parseInt(m[1]) : -1;
  };

  if (source === 'home' || source === 'all')
    allTrips().forEach(t => { const h = parseHour(t.departureTime); if (h >= 0 && h < 24) counts[h]++; });
  if (source === 'roadside' || source === 'all')
    allInterviews().forEach(iv => { const h = parseHour(iv.interviewTime); if (h >= 0 && h < 24) counts[h]++; });

  const total = counts.reduce((s, c) => s + c, 0);
  const peak  = counts.indexOf(Math.max(...counts));

  makeChart('chartPeak', 'bar', {
    labels: Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`),
    datasets: [{
      label: 'จำนวนเที่ยว',
      data: counts,
      backgroundColor: counts.map((_, i) => i === peak ? '#f59e0b' : '#3b82f6')
    }]
  }, { plugins: { legend: { display: false } } });

  // AM/PM summary
  const amH = [5,6,7,8,9,10,11], pmH = [14,15,16,17,18,19,20];
  const amPeak = amH.reduce((mx, h) => counts[h] > counts[mx] ? h : mx, 5);
  const pmPeak = pmH.reduce((mx, h) => counts[h] > counts[mx] ? h : mx, 14);
  const amTotal = amH.reduce((s, h) => s + counts[h], 0);
  const pmTotal = pmH.reduce((s, h) => s + counts[h], 0);
  const pct = (v) => total > 0 ? ((v / total) * 100).toFixed(1) + '%' : '—';

  set('peakAMSummary', `
    <div style="font-size:28px;font-weight:700;color:#3b82f6">${String(amPeak).padStart(2,'0')}:00–${String(amPeak+1).padStart(2,'0')}:00</div>
    <div style="color:var(--muted);font-size:13px;margin-top:6px">${counts[amPeak]} เที่ยว · ${pct(counts[amPeak])} ของทั้งหมด</div>
    <div style="color:var(--muted);font-size:12px;margin-top:4px">รวม 5:00–11:00: ${amTotal} เที่ยว</div>`);

  set('peakPMSummary', `
    <div style="font-size:28px;font-weight:700;color:#f59e0b">${String(pmPeak).padStart(2,'0')}:00–${String(pmPeak+1).padStart(2,'0')}:00</div>
    <div style="color:var(--muted);font-size:13px;margin-top:6px">${counts[pmPeak]} เที่ยว · ${pct(counts[pmPeak])} ของทั้งหมด</div>
    <div style="color:var(--muted);font-size:12px;margin-top:4px">รวม 14:00–20:00: ${pmTotal} เที่ยว</div>`);

  // Trip rate by income
  const byIncome = {}, byVehicle = { 'มีรถ': { m: 0, t: 0 }, 'ไม่มีรถ': { m: 0, t: 0 } };
  households.forEach(hh => {
    const inc = hh.householdIncome || '(ไม่ระบุ)';
    if (!byIncome[inc]) byIncome[inc] = { m: 0, t: 0 };
    const hasV = ['มี','yes','Y','1','true'].includes(String(hh.hasVehicle));
    const vk = hasV ? 'มีรถ' : 'ไม่มีรถ';
    (hh.members || []).forEach(mem => {
      byIncome[inc].m++;  byIncome[inc].t  += (mem.trips || []).length;
      byVehicle[vk].m++;  byVehicle[vk].t  += (mem.trips || []).length;
    });
  });

  const rateRow = ([k, { m, t }]) =>
    `<tr><td>${esc(k)}</td><td>${m}</td><td>${t}</td>
     <td style="font-weight:700;color:#3b82f6">${m > 0 ? (t/m).toFixed(2) : '—'}</td></tr>`;

  set('tripRateTable', `
    <div class="grid-2">
      <div>
        <p style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:8px">แยกตามรายได้ครัวเรือน (บาท/เดือน)</p>
        <table class="data-table">
          <thead><tr><th>รายได้</th><th>สมาชิก</th><th>เที่ยว</th><th>เที่ยว/คน</th></tr></thead>
          <tbody>${Object.entries(byIncome).sort().map(rateRow).join('')}</tbody>
        </table>
      </div>
      <div>
        <p style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:8px">แยกตามการมีรถ</p>
        <table class="data-table">
          <thead><tr><th>การมีรถ</th><th>สมาชิก</th><th>เที่ยว</th><th>เที่ยว/คน</th></tr></thead>
          <tbody>${Object.entries(byVehicle).map(rateRow).join('')}</tbody>
        </table>
      </div>
    </div>`);
}

// ── TAB: สถิติ ─────────────────────────────────────────────────────────────────
function renderStats() {
  const members = allMembers();
  const trips   = allTrips();
  const ivs     = allInterviews();

  // Modal split (Home trips — segment modes)
  const modeCount = {};
  trips.forEach(t => {
    (t.segments || []).forEach(s => { const m = s.mode || '(ไม่ระบุ)'; modeCount[m] = (modeCount[m] || 0) + 1; });
  });
  const modeE = topN(modeCount, 12);
  if (modeE.length) {
    makeChart('chartModalSplit', 'doughnut', {
      labels: modeE.map(e => e[0]),
      datasets: [{ data: modeE.map(e => e[1]), backgroundColor: COLORS }]
    }, { plugins: { legend: { position: 'right', labels: { color: '#94a3b8', font: { size: 11 } } } } });
  } else {
    set('chartModalSplitMsg', '<p style="color:var(--muted)">ยังไม่มีข้อมูล modal split</p>');
  }

  // Vehicle type (Roadside)
  const vtE = topN(countBy(ivs, iv => iv.vehicleType), 9);
  makeChart('chartVehicleType', 'bar', {
    labels: vtE.map(e => e[0]),
    datasets: [{ label: 'จำนวน', data: vtE.map(e => e[1]), backgroundColor: COLORS }]
  }, {
    indexAxis: 'y',
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } },
      y: { ticks: { color: '#64748b', font: { size: 11 } }, grid: { color: '#1e293b' } }
    }
  });

  // Purpose charts
  const phE = topN(countBy(trips, t => t.purpose), 10);
  makeChart('chartPurposeHome', 'pie', {
    labels: phE.map(e => e[0]),
    datasets: [{ data: phE.map(e => e[1]), backgroundColor: COLORS }]
  }, { plugins: { legend: { position: 'right', labels: { color: '#94a3b8', font: { size: 11 } } } } });

  const prE = topN(countBy(ivs, iv => iv.purpose), 10);
  makeChart('chartPurposeRoadside', 'pie', {
    labels: prE.map(e => e[0]),
    datasets: [{ data: prE.map(e => e[1]), backgroundColor: COLORS }]
  }, { plugins: { legend: { position: 'right', labels: { color: '#94a3b8', font: { size: 11 } } } } });

  // Population pyramid
  const ageGroups = ['0–9','10–19','20–29','30–39','40–49','50–59','60–69','70+'];
  const maleD = new Array(8).fill(0), femD = new Array(8).fill(0);
  members.forEach(m => {
    const age = parseInt(m.age) || 0;
    const idx = Math.min(7, Math.floor(age / 10));
    const gend = String(m.gender || '').trim();
    if (['ชาย','male','M','m'].includes(gend)) maleD[idx]++;
    else if (['หญิง','female','F','f'].includes(gend)) femD[idx]++;
  });
  makeChart('chartPyramid', 'bar', {
    labels: ageGroups,
    datasets: [
      { label: 'ชาย', data: maleD.map(v => -v), backgroundColor: '#3b82f6' },
      { label: 'หญิง', data: femD, backgroundColor: '#ec4899' }
    ]
  }, {
    indexAxis: 'y',
    plugins: { legend: { labels: { color: '#94a3b8' } } },
    scales: {
      x: { ticks: { color: '#64748b', callback: v => Math.abs(v) }, grid: { color: '#1e293b' } },
      y: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } }
    }
  });

  // Household income
  const incOrder = ['< 5,000','5,001–10,000','10,001–20,000','20,001–30,000','30,001–50,000','> 50,000'];
  const incCount = countBy(households, hh => hh.householdIncome);
  const incE = Object.entries(incCount).sort((a, b) => {
    const ai = incOrder.indexOf(a[0]), bi = incOrder.indexOf(b[0]);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
  });
  makeChart('chartIncome', 'bar', {
    labels: incE.map(e => e[0]),
    datasets: [{ label: 'ครัวเรือน', data: incE.map(e => e[1]), backgroundColor: '#22c55e' }]
  }, { plugins: { legend: { display: false } } });

  // Education
  const eduE = topN(countBy(members, m => m.education), 8);
  makeChart('chartEducation', 'bar', {
    labels: eduE.map(e => e[0]),
    datasets: [{ label: 'จำนวน', data: eduE.map(e => e[1]), backgroundColor: '#8b5cf6' }]
  }, {
    indexAxis: 'y',
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } },
      y: { ticks: { color: '#64748b', font: { size: 11 } }, grid: { color: '#1e293b' } }
    }
  });

  // Cargo table
  const cargoIVs = ivs.filter(iv => ['มี','yes','Y','1','true'].includes(String(iv.hasCargo)));
  if (!cargoIVs.length) {
    set('cargoTable', '<p style="color:var(--muted);font-size:13px">ไม่พบข้อมูลสินค้าขนส่ง</p>');
  } else {
    const totalW = cargoIVs.reduce((s, iv) => s + (parseFloat(iv.cargoWeight) || 0), 0);
    const cargoE = topN(countBy(cargoIVs, iv => iv.cargoType || '(ไม่ระบุ)'), 15);
    set('cargoTable', `
      <p style="color:var(--muted);font-size:12px;margin-bottom:8px">รถบรรทุก ${cargoIVs.length} คัน · น้ำหนักรวม ${totalW.toLocaleString()} กก.</p>
      <table class="data-table">
        <thead><tr><th>ประเภทสินค้า</th><th>จำนวน</th></tr></thead>
        <tbody>${cargoE.map(([t, c]) => `<tr><td>${esc(t)}</td><td style="font-weight:700">${c}</td></tr>`).join('')}</tbody>
      </table>`);
  }
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
const App = {
  _tab:        'progress',
  _odSrc:      'home',
  _mapMode:    'desire',
  _mapSrc:     'home',
  _peakSrc:    'home',

  init() {
    fbInit();
    // Chart.js global defaults
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = 'Sarabun';

    auth.onAuthStateChanged(user => {
      if (user) {
        document.getElementById('loginOverlay').style.display = 'none';
        document.getElementById('dashboardMain').style.display = 'block';
        set('headerUser', user.email.replace('@banphai.local', ''));
        this.loadData();
      } else {
        document.getElementById('loginOverlay').style.display = 'flex';
        document.getElementById('dashboardMain').style.display = 'none';
      }
    });

    ['loginUsername', 'loginPassword'].forEach(id => {
      document.getElementById(id)?.addEventListener('keydown', e => {
        if (e.key === 'Enter') this.login();
      });
    });
  },

  async login() {
    const user = document.getElementById('loginUsername').value.trim();
    const pass = document.getElementById('loginPassword').value;
    const errEl = document.getElementById('loginError');
    const btn   = document.getElementById('loginBtn');
    errEl.style.display = 'none';
    if (!user || !pass) {
      errEl.textContent = 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน';
      errEl.style.display = 'block';
      return;
    }
    btn.disabled = true; btn.textContent = 'กำลังเข้าสู่ระบบ...';
    try {
      await loginAdmin(user, pass);
    } catch (e) {
      errEl.textContent = 'เข้าสู่ระบบไม่สำเร็จ: ' + (e.message || e);
      errEl.style.display = 'block';
      btn.disabled = false; btn.textContent = 'เข้าสู่ระบบ';
    }
  },

  logout() { auth.signOut(); },

  async loadData() {
    this._showLoading('กำลังโหลดข้อมูล Home...');
    try {
      households = await pullHouseholds();
      this._setStatus('โหลด Home แล้ว · กำลังโหลด Roadside...');
      stations   = await pullRoadside();
      const ivCnt = allInterviews().length;
      this._setStatus(`✓ ${households.length} ครัวเรือน · ${stations.length} จุดสำรวจ · ${ivCnt} สัมภาษณ์`);
      this._statusDot(true);
      this._hideLoading();
      this._renderAll();
    } catch (e) {
      console.error('[Dashboard]', e);
      this._setStatus('❌ โหลดข้อมูลไม่สำเร็จ: ' + e.message);
      this._statusDot(false);
      this._hideLoading();
    }
  },

  refresh() { return this.loadData(); },

  _renderAll() {
    renderKPIs();
    renderProgress();
    renderODMatrix(this._odSrc);
    renderPeakHour(this._peakSrc);
    renderStats();
    if (this._tab === 'map') renderMap(this._mapMode, this._mapSrc);
  },

  switchTab(tab) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach((b, i) => {
      b.classList.toggle('active', ['progress','od','map','peak','stats'][i] === tab);
    });
    document.getElementById('panel-' + tab)?.classList.add('active');
    this._tab = tab;
    if (tab === 'map') {
      setTimeout(() => {
        if (!leafletMap) {
          initLeafletMap();
          renderMap(this._mapMode, this._mapSrc);
        } else {
          leafletMap.invalidateSize();
        }
      }, 100);
    }
  },

  setODSource(src) {
    this._odSrc = src;
    ['home','roadside','all'].forEach(s => {
      const btn = document.getElementById('odToggle' + s[0].toUpperCase() + s.slice(1));
      btn?.classList.toggle('active', s === src);
    });
    renderODMatrix(src);
  },

  selectZone(zoneName) {
    selectedZone = zoneName;
    _styleZonePolygons();
    _drawDesireLines();
    _showZonePanel(zoneName);
    // update search input to reflect selected zone
    const inp = document.getElementById('zoneSearchInput');
    if (inp) inp.value = zoneName;
    const res = document.getElementById('zoneSearchResults');
    if (res) res.style.display = 'none';
  },

  clearZoneSelect() {
    selectedZone = null;
    _styleZonePolygons();
    _drawDesireLines();
    _hideZonePanel();
  },

  filterZoneSearch(query) {
    const res = document.getElementById('zoneSearchResults');
    if (!res) return;
    const q = query.trim();
    if (!q) { res.style.display = 'none'; return; }

    const names = zFeatures().map(f => zName(f));
    const matched = names.filter(n => n.toLowerCase().includes(q.toLowerCase()));

    if (!matched.length) {
      res.innerHTML = `<div style="padding:10px 14px;font-size:12px;color:var(--muted)">ไม่พบโซนที่ตรงกัน</div>`;
      res.style.display = 'block';
      return;
    }

    res.innerHTML = matched.map(n => `
      <div onclick="App.selectZone('${n.replace(/'/g, "\\'")}')"
           style="padding:9px 14px;font-size:13px;cursor:pointer;border-bottom:1px solid var(--border);
                  transition:background .1s"
           onmouseover="this.style.background='var(--surface)'"
           onmouseout="this.style.background=''">
        ${esc(n)}
      </div>`).join('');
    res.style.display = 'block';
  },

  setMapMode(mode) {
    this._mapMode = mode;
    document.getElementById('mapToggleDesire')?.classList.toggle('active', mode === 'desire');
    document.getElementById('mapToggleChoropleth')?.classList.toggle('active', mode === 'choropleth');
    renderMap(mode, this._mapSrc);
  },

  setMapSource(src) {
    this._mapSrc = src;
    ['home','roadside','all'].forEach(s => {
      document.getElementById('mapSrc' + s[0].toUpperCase() + s.slice(1))?.classList.toggle('active', s === src);
    });
    renderMap(this._mapMode, src);
  },

  setPeakSource(src) {
    this._peakSrc = src;
    ['home','roadside','all'].forEach(s => {
      document.getElementById('peakToggle' + s[0].toUpperCase() + s.slice(1))?.classList.toggle('active', s === src);
    });
    renderPeakHour(src);
  },

  _showLoading(msg) {
    document.getElementById('loadingOverlay').classList.add('show');
    set('loadingMsg', msg || 'กำลังโหลด...');
  },
  _hideLoading() { document.getElementById('loadingOverlay').classList.remove('show'); },
  _setStatus(text) {
    set('statusText', text);
    set('statusRight', new Date().toLocaleTimeString('th-TH'));
  },
  _statusDot(ok) {
    const dot = document.getElementById('statusDot');
    if (dot) dot.classList.toggle('dot-off', !ok);
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
