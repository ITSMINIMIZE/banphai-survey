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

const CENTER = { lat: 16.0587, lon: 102.7355 }; // อ.บ้านไผ่ (fallback เมื่อไม่มีโซน)

// ── STATE ─────────────────────────────────────────────────────────────────────
let db = null, auth = null;
let households = [];
let stations   = [];
let charts = {};
let ME = null;
let ROUND = { since: '', label: '' };   // รอบเก็บข้อมูลปัจจุบัน (config/data_round)          // บัญชีที่ login: { uid, role, supervisorName, displayName }
let leafletMap = null;
let rawRenderer = null;   // canvas renderer สำหรับโหมดพิกัดจริง
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

// โซนจากระบบ (Firestore, อัปโหลดผ่าน tools/import-zones.html) — ถ้ามีให้ใช้ก่อนไฟล์ zones.js ที่ฝังมา
let ZONES_CLOUD = null;
function zFeatures() {
  if (ZONES_CLOUD && ZONES_CLOUD.features) return ZONES_CLOUD.features;
  return (typeof ZONES_GEOJSON !== 'undefined' && ZONES_GEOJSON.features) ? ZONES_GEOJSON.features : [];
}

// โหลดโซนจาก Firestore: config/zones = meta {chunks}, config/zones_c0..n = ชิ้น JSON
async function loadCloudZones() {
  try {
    const meta = await db.collection('config').doc('zones').get();
    if (!meta.exists || !(meta.data().chunks > 0)) return false;
    // เส้นแบ่ง "ในพื้นที่ / นอกพื้นที่" เก็บคู่กับชุดโซน — ไม่ตั้งไว้ก็ใช้ค่าปริยาย
    const im = +meta.data().internalMax;
    if (im > 0) ZONE_INTERNAL_MAX = im;
    const n = meta.data().chunks;
    const docs = await Promise.all(
      Array.from({ length: n }, (_, i) => db.collection('config').doc('zones_c' + i).get())
    );
    if (docs.some(d => !d.exists)) return false; // ชุดไม่ครบ (อัปโหลดค้าง) — ใช้ไฟล์ฝังแทน
    const parsed = JSON.parse(docs.map(d => d.data().data).join(''));
    if (!parsed.features || !parsed.features.length) return false;
    ZONES_CLOUD = parsed;
    resetZoneCaches();              // โซนชุดใหม่ → เลขโซน/ชื่ออำเภอที่ cache ไว้ใช้ไม่ได้แล้ว
    didFitZones = false;            // ให้แผนที่ fit รอบโซนชุดใหม่
    return true;
  } catch (e) {
    console.warn('[zones] โหลดโซนจากระบบไม่ได้ — ใช้ไฟล์ฝัง:', e.message);
    return false;
  }
}

function zName(f) {
  const p = f.properties || {};
  return p.name || p.Name || p.NAME || p.TAMBON_T || p.tambon || 'ไม่ระบุ';
}

// กรอบสี่เหลี่ยมของแต่ละ feature — เช็คก่อน point-in-polygon
// shp มี 232 รูป ถ้าไล่จุดยอดทุกรูปทุกครั้งจะช้ามาก (วัดได้ ~10 วิ ต่อการคำนวณ 1 รอบ)
function featureBBox(f) {
  if (f.__bbox) return f.__bbox;
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  featureRings(f).forEach(ring => ring.forEach(([lon, lat]) => {
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
  }));
  return (f.__bbox = { minLat, maxLat, minLon, maxLon });
}

function assignZone(coords) {
  if (!coords) return '(ไม่มีพิกัด)';            // ข้อมูลไม่มีพิกัด — แยกจาก "นอกพื้นที่" จริง
  const { lat, lon } = coords;
  for (const f of zFeatures()) {
    const b = featureBBox(f);
    if (lat < b.minLat || lat > b.maxLat || lon < b.minLon || lon > b.maxLon) continue;
    if (ptInFeature(lat, lon, f)) return zName(f);
  }
  return '(นอกพื้นที่)';                          // มีพิกัดแต่อยู่นอกโซนที่กำหนด
}

// ═══ ในพื้นที่ / นอกพื้นที่ ═══
// shp ใส่เลขโซนไว้ที่ properties.N — โซนเลขน้อยคือพื้นที่ศึกษา เลขมากคือจังหวัดรอบนอก
// เส้นแบ่งตั้งเองได้ที่แท็บ OD (เก็บใน config/zones.internalMax) เผื่อชุดโซนเปลี่ยน
let ZONE_INTERNAL_MAX = 131;

// ชื่อโซน → เลขโซน (สร้างครั้งเดียว ล้างเมื่อโหลดโซนชุดใหม่)
function zNum(zoneName) {
  if (!zNum._map) {
    const m = {};
    zFeatures().forEach(f => {
      const n = +((f.properties || {}).N);
      if (!isNaN(n)) m[zName(f)] = n;
    });
    zNum._map = m;
  }
  return zNum._map[zoneName] || 0;
}
// โซนนอกพื้นที่ศึกษา (จังหวัดรอบนอก) — ไม่ใช่ '(นอกพื้นที่)' ที่แปลว่าตกนอกทุกโซน
function isExternalZone(z) { const n = zNum(z); return n > 0 && n > ZONE_INTERNAL_MAX; }
// อยู่ในพื้นที่ศึกษาจริงหรือไม่ — ต้องตัดทั้งโซนรอบนอกและกรณีไม่มีพิกัดออก
function isInStudyArea(z) {
  return z !== '(นอกพื้นที่)' && z !== '(ไม่มีพิกัด)' && !isExternalZone(z);
}
// ล้าง cache ที่ผูกกับชุดโซน — เรียกเมื่อโหลดโซนใหม่
function resetZoneCaches() { zNum._map = null; zDistrict._map = null; studyZoneList._v = null; resetODCache(); }

// ชื่อแสดงระดับอำเภอของโซน — ใช้ field DISTRICT/D_NAME ถ้ามีใน shp
// ไม่งั้น fallback เป็นชื่อโซน (เช่น "โซน 5") ตามข้อมูลปัจจุบัน
function zDistrict(zoneName) {
  if (!zDistrict._map) {
    const m = {};
    zFeatures().forEach(f => {
      const p  = f.properties || {};
      const nm = p.D_NAME || p.d_name || p.DISTRICT_T || '';
      const cd = (p.DISTRICT != null && p.DISTRICT !== '') ? p.DISTRICT
               : (p.district != null && p.district !== '' ? p.district : '');
      m[zName(f)] = nm ? (cd !== '' && String(cd) !== String(nm) ? `${nm} (${cd})` : nm)
                       : (cd !== '' ? String(cd) : zName(f));
    });
    zDistrict._map = m;
  }
  return zDistrict._map[zoneName] || zoneName;  // (ไม่มีพิกัด)/(นอกพื้นที่) คืนค่าเดิม
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

// อ่านสิทธิ์จาก users/{uid} — null = ไม่มีสิทธิ์/ถูกปิด
async function resolveRole(user) {
  try {
    const snap = await db.collection('users').doc(user.uid).get();
    if (!snap.exists) return null;
    const d = snap.data();
    if (d.disabled === true) return null;
    if (d.role !== 'admin' && d.role !== 'staff') return null;
    return { uid: user.uid, email: user.email || '', username: d.username || '',
             role: d.role, supervisorName: normName(d.supervisorName),   // ต้อง normalize — where() เทียบตรงตัว
             displayName: d.displayName || d.username || '',
             nickname: normName(d.nickname) };   // ชื่อเล่น — แสดงผลอย่างเดียว
  } catch (e) { return null; }
}
const isStaff = () => !!ME && ME.role === 'staff';
// ระเบียนเก่ากว่ารอบเก็บข้อมูลปัจจุบัน → ไม่นับเข้ารายงาน
const isOldRec = r => !!ROUND.since && String(r.createdAt || '') < ROUND.since;

// ═══ ชื่อเล่นผู้ควบคุม — ใช้ "แสดงผล" อย่างเดียว ═══
// ระเบียนทุกใบเก็บชื่อ-นามสกุลเต็มเสมอ (เป็นคีย์จับคู่ทีม) ตรงนี้แค่แปลงตอนเอาขึ้นจอ
// Dashboard ไม่ได้ include auth-role.js เลยต้องอ่าน config/supervisors เอง
let SUPNICK = {};
async function loadSupNicks() {
  try {
    const snap = await db.collection('config').doc('supervisors').get();
    const list = (snap.exists && snap.data().list) || [];
    SUPNICK = {};
    list.forEach(x => {
      const full = normName(x.key || x.name);
      if (full) SUPNICK[nameKey(full)] = normName(x.name) || full;
    });
  } catch (_) { SUPNICK = {}; }   // อ่านไม่ได้ → ใช้ชื่อเต็มไปก่อน ไม่ทำหน้าพัง
}
// ชื่อที่เอาขึ้นจอ — ไม่รู้จักก็คืนชื่อเดิม (ระเบียนเก่าที่ชื่อหลุดจากรายชื่อ)
function supLabel(s) {
  const n = normName(s);
  if (!n) return '';
  return SUPNICK[nameKey(n)] || n;
}

async function loadRound() {
  try {
    const snap = await db.collection('config').doc('data_round').get();
    const d = snap.exists ? snap.data() : {};
    ROUND = { since: d.since || '', label: d.label || '' };
  } catch (e) { ROUND = { since: '', label: '' }; }
}

// staff เห็นทีมเดียว → เปลี่ยนมุมมองกราฟ Home เป็น "แยกตามผู้สำรวจ" แทนการเทียบข้ามทีม
// (เดิมซ่อนทั้งคอลัมน์ ทำให้ข้อมูลฝั่ง Home หายไปหมด)
function applyRoleUI() {
  const staff = isStaff();
  set('titleHomeChart', staff ? '🏠 Home — บ้านที่สำรวจแยกตามผู้สำรวจ'
                              : '🏠 Home — บ้านที่สำรวจแยกตามผู้ควบคุม');
  set('titleHomeTable', staff ? '📋 สรุปทีมของคุณ' : '📋 สรุปตามผู้ควบคุม (ทีม)');
}

async function loginAdmin(username, password) {
  const u = username.trim().toLowerCase().replace(/\s+/g, '');
  // ถ้าพิมพ์ email เต็ม (มี @) ใช้ตรงๆ — มิฉะนั้นต่อ @banphai.local
  const email = u.includes('@') ? u : u + '@banphai.local';
  await auth.signInWithEmailAndPassword(email, password);
}

// ── DATA PULL ─────────────────────────────────────────────────────────────────
// nested schema: households/{}/members/{}/trips/{} → ประกอบเป็น hh.members[].trips[]
//
// มีสองทาง:
//   ทางเร็ว  — collectionGroup ดึง members/trips ทั้งฐานด้วยคำขอละ 1 ครั้ง (รวม 3 คำขอ)
//   ทางถอย  — ยิง subcollection ทีละ doc (1 + บ้าน + สมาชิก คำขอ) ใช้เมื่อ rules ยังไม่เปิด
// ทางถอยช้าแบบไม่เป็นเส้นตรง: วัดจริงไว้ที่ 2,001 คำขอ = 58 วินาที และงานจริง
// 2,000 ครัวเรือนต้องใช้ราว 7,760 คำขอ — จึงต้องเปิดทางเร็วก่อนเก็บข้อมูลจริง
let PULL_MODE = '';
let ORPHAN_IV = 0;   // interview ที่จุดสำรวจต้นสังกัดถูกลบไปแล้ว (มองไม่เห็นจากที่อื่น)   // 'fast' | 'slow' — โชว์ในแถบสถานะเพื่อให้ตรวจได้ว่าใช้ทางไหนอยู่

// collectionGroup ไม่บอกว่า doc อยู่ใต้ใคร — อ่านจาก path ของ doc เอง
// households/{hhId}/members/{mId}/trips/{tId}
function pathParts(ref) { return ref.path.split('/'); }

async function pullHouseholds() {
  // staff = ดึงเฉพาะทีมตัวเอง (ประหยัดค่าอ่านจริง — เดิมดึงทุกบ้าน + subcollection ต่อบ้าน)
  let q = db.collection('households');
  if (isStaff()) q = q.where('supervisorName', '==', ME.supervisorName);
  const snap = await q.get({ source: 'server' });

  const hhById = {};
  const households = snap.docs.map(d => {
    const x = d.data(); delete x._device; delete x._syncedAt;
    x.members = [];
    hhById[d.id] = x;
    return x;
  });

  try {
    // ── ทางเร็ว: 2 คำขอ ครอบคลุมสมาชิกและเที่ยวทั้งหมด ──
    const [memSnap, tripSnap] = await Promise.all([
      db.collectionGroup('members').get({ source: 'server' }),
      db.collectionGroup('trips').get({ source: 'server' })
    ]);

    // สมาชิก — ผูกกลับเข้าบ้านด้วย hhId จาก path
    // (ผู้ควบคุมจะได้สมาชิกของทุกทีมมาด้วย ตัวที่ไม่ใช่ทีมตัวเองจะไม่มีบ้านรองรับ → ตกไปเอง)
    const memById = {};
    memSnap.docs.forEach(d => {
      const [, hhId] = pathParts(d.ref);
      const hh = hhById[hhId];
      if (!hh) return;
      const m = d.data(); delete m._device; delete m._syncedAt;
      m.trips = [];
      hh.members.push(m);
      memById[hhId + '/' + d.id] = m;
    });

    // เที่ยว — ผูกกลับเข้าสมาชิกด้วย hhId + mId จาก path
    tripSnap.docs.forEach(d => {
      const p = pathParts(d.ref);              // [households, hhId, members, mId, trips, tId]
      const m = memById[p[1] + '/' + p[3]];
      if (!m) return;
      const t = d.data(); delete t._device; delete t._syncedAt;
      m.trips.push(t);
    });
    PULL_MODE = 'fast';
  } catch (e) {
    // permission-denied = rules ยังไม่มีบล็อก {path=**} · failed-precondition = ยังไม่มี index
    console.warn('[Dashboard] collectionGroup ใช้ไม่ได้ ใช้วิธีเดิมแทน:', e.code || e.message);
    PULL_MODE = 'slow';
    households.forEach(hh => { hh.members = []; });   // ล้างของค้างจากทางเร็วที่ล้มกลางคัน
    await fillNestedSlow(snap.docs, households);
  }

  // เรียงด้วย seq แล้วตัดสินเสมอด้วย id — ข้อมูลจริงมี seq ซ้ำ (สมาชิกคนเดียวมีเที่ยว seq=1 สองอัน
  // จากการ merge ตอน pull) ถ้าเทียบแค่ seq ลำดับจะขึ้นกับลำดับที่ Firestore ส่งมา = ไม่นิ่งข้ามการโหลด
  const bySeq = (a, b) => (a.seq || 0) - (b.seq || 0) || String(a.id).localeCompare(String(b.id));
  households.forEach(hh => {
    hh.members.sort(bySeq);
    hh.members.forEach(m => m.trips.sort(bySeq));
  });
  // ตัดรายการที่ admin ลบออกจากระบบแล้ว (_deleted) ออกทุกระดับ — ครอบคลุมทุกแท็บในหน้าเดียว
  return households.filter(hh => !hh._deleted && !isOldRec(hh)).map(hh => {
    hh.members = hh.members.filter(m => !m._deleted);
    hh.members.forEach(m => { m.trips = m.trips.filter(t => !t._deleted); });
    return hh;
  });
}

// ทางถอย — ยิง subcollection ทีละ doc (พฤติกรรมเดิมก่อนมี collectionGroup)
async function fillNestedSlow(hhDocs, households) {
  const memSnaps = await Promise.all(
    hhDocs.map(d => d.ref.collection('members').get({ source: 'server' }))
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
  const tripSnaps = await Promise.all(
    memberRefs.map(mr => mr.ref.collection('trips').get({ source: 'server' }))
  );
  tripSnaps.forEach((tSnap, i) => {
    tSnap.docs.forEach(td => {
      const t = td.data(); delete t._device; delete t._syncedAt;
      memberRefs[i].member.trips.push(t);
    });
  });
}

async function pullRoadside() {
  let q = db.collection('roadside_stations');
  if (isStaff()) q = q.where('supervisorName', '==', ME.supervisorName);
  const stSnap = await q.get({ source: 'server' });
  const map = {};
  stSnap.docs.forEach(d => {
    const x = d.data(); delete x._device; delete x._syncedAt;
    x.interviews = []; map[d.id] = x;
  });

  try {
    // ── ทางเร็ว: 1 คำขอ ครอบคลุมสัมภาษณ์ทุกจุด ──
    const ivSnap = await db.collectionGroup('interviews').get({ source: 'server' });
    // ─ ข้อมูลผี: interview ที่อยู่ใต้จุดสำรวจซึ่งไม่มี document แล้ว ─
    // Firestore ยอมให้เขียน subcollection ใต้ doc ที่ไม่มีตัวตน
    // collection().get() ไม่คืน parent พวกนี้ แอปกับหน้าอื่นจึงมองไม่เห็น
    // ก่อนหน้านี้เราทิ้งเงียบ — ตอนนี้นับไว้แล้วขึ้นเตือน จะได้รู้ว่ามีของค้าง
    const liveIds = new Set(stSnap.docs.map(d => d.id));
    ORPHAN_IV = 0;
    ivSnap.docs.forEach(d => {
      const [, stId] = pathParts(d.ref);       // [roadside_stations, stId, interviews, ivId]
      if (!liveIds.has(stId)) { ORPHAN_IV++; return; }   // จุดถูกลบไปแล้ว = ข้อมูลผี
      const st = map[stId];
      if (!st) return;                         // จุดสำรวจนอกขอบเขตของบทบาทนี้
      const x = d.data(); delete x._device; delete x._syncedAt;
      st.interviews.push(x);
    });
  } catch (e) {
    console.warn('[Dashboard] collectionGroup(interviews) ใช้ไม่ได้ ใช้วิธีเดิมแทน:', e.code || e.message);
    PULL_MODE = 'slow';
    Object.values(map).forEach(st => { st.interviews = []; });
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
  }
  // ตัดรายการที่ admin ลบออกจากระบบแล้ว (_deleted) ออก
  return Object.values(map).filter(st => !st._deleted && !isOldRec(st)).map(st => {
    st.interviews = st.interviews.filter(iv => !iv._deleted && !isOldRec(iv));
    return st;
  });
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

// โทนสีตามแอปต้นทาง — Roadside = ส้ม/อำพัน (--primary #d97706) · Home = ฟ้า (--primary #2563eb)
// ปรับให้สว่างขึ้นจากแอปจริง เพราะ dashboard เป็นพื้นเข้ม สีเดิมจะจมไปกับพื้นหลัง
const C_RS = '#f59e0b', C_RS_DIM = 'rgba(245,158,11,.78)';
const C_HM = '#3b82f6', C_HM_DIM = 'rgba(59,130,246,.78)';
const C_NA = '#64748b';   // "(ไม่ระบุ)" — เทา ไม่ให้ปนกับชั้นข้อมูลจริง

// สร้างเฉดตามจำนวนที่ต้องใช้จริง — ไม่ต้องกลัวสีวนซ้ำเมื่อหมวดเยอะกว่าลิสต์
// สลับความสว่างเล็กน้อย (jitter) เพื่อให้ชิ้นที่ติดกันในโดนัทแยกออกจากกันด้วยตา
const rampOf = (n, h0, h1, jitter = 6) => Array.from({ length: Math.max(n, 1) }, (_, i) => {
  const t = n > 1 ? i / (n - 1) : 0;
  const h = h0 + (h1 - h0) * t;
  const l = 66 + (42 - 66) * t + (i % 2 ? -jitter : jitter);
  return `hsl(${h.toFixed(0)} 82% ${Math.max(30, Math.min(76, l)).toFixed(0)}%)`;
});
const rampRS = n => rampOf(n, 45, 18);     // อำพัน → ส้มแดง (โทน Roadside)
const rampHM = n => rampOf(n, 214, 186);   // น้ำเงิน → ฟ้าคราม (โทน Home)

// key ประเภทรถของ Roadside → ชื่อไทย (Roadside/js/data.js OPT.vehicleTypes)
// ข้อมูลบน cloud เก็บเป็น key ('truck6') ถ้าไม่แปลง แกนกราฟจะขึ้นเป็นภาษาอังกฤษ
const VEH_LABEL = {
  bicycle2:   'จักรยาน 2 ล้อ',
  bicycle3:   'จักรยาน 3 ล้อ',
  motorcycle: 'รถจักรยานยนต์',
  tuk3:       'รถสามล้อเครื่อง',
  car:        'รถยนต์นั่งส่วนบุคคล',
  bus_sm:     'รถโดยสารเล็ก–กลาง',
  bus_lg:     'รถโดยสารขนาดใหญ่',
  truck4:     'รถบรรทุกเล็ก (4 ล้อ)',
  truck6:     'รถบรรทุก 6 ล้อขึ้นไป'
};
const vehLabel = k => VEH_LABEL[k] || (k ? String(k) : '(ไม่ระบุ)');
const VEH_ORDER = Object.keys(VEH_LABEL);   // ลำดับตามแบบฟอร์ม: ส่วนบุคคล → โดยสาร → บรรทุก

// จำนวนคนในรถ (รวมคนขับ) — คืน 0 ถ้ายังไม่ได้กรอก เพื่อให้แยก "ไม่ได้กรอก" ออกจาก "กรอกว่า 0" ได้
const paxOf = iv => { const n = Number(String(iv.passengerCount ?? '').replace(/[, ]/g, '')); return Number.isFinite(n) && n > 0 ? n : 0; };

// ชุดวัตถุประสงค์ — ทั้งสองแอปใช้ชุดเดียวกัน 11 ค่า (ตั้งใจให้ aggregate ข้ามแอปได้)
const PURPOSES = [
  'กลับบ้าน','ไปทำงาน','ไปเรียนหนังสือ','ติดต่อราชการต่าง ๆ / ธุรกิจ',
  'ไปโรงพยาบาล / คลินิก / อนามัย','รับส่งคน หรือ สินค้า',
  'ช้อปปิ้ง / ซื้อของใช้ต่าง ๆ','รับประทานอาหาร',
  'ท่องเที่ยว / พักผ่อน / ออกกำลังกาย','ทำกิจกรรมทางศาสนา','อื่น ๆ'
];

// ระดับการศึกษาเรียงจากต่ำไปสูง (Home/js/data.js OPT.education) — ใช้จัดลำดับแกนกราฟ
const EDU_ORDER = [
  'ต่ำกว่าประถมศึกษา / ไม่ได้เรียน','ประถมศึกษา (ป.1–ป.6)','มัธยมศึกษา (ม.1–ม.6)',
  'อนุปริญญา / ปวช. / ปวส.','ปริญญาตรี','สูงกว่าปริญญาตรี'
];

// ค่า hasCargo ที่แปลว่า "มีสินค้า" — Roadside เก็บเป็น 'มีสินค้า' (Roadside/js/app.js)
// ค่าอื่นเผื่อข้อมูลนำเข้า/รุ่นเก่า
const CARGO_YES = ['มีสินค้า','มี','yes','y','1','true'];
const hasCargo  = iv => CARGO_YES.includes(String(iv.hasCargo ?? '').trim().toLowerCase())
                     || CARGO_YES.includes(String(iv.hasCargo ?? '').trim());

// ── รายได้: ฟอร์มเก็บเป็น "ตัวเลขล้วน" (Home/js/app.js: +m_income) ต้องจัดชั้นเอง
const INCOME_BANDS = [
  { max: 5000,     label: 'ไม่เกิน 5,000' },
  { max: 10000,    label: '5,001–10,000' },
  { max: 20000,    label: '10,001–20,000' },
  { max: 30000,    label: '20,001–30,000' },
  { max: 50000,    label: '30,001–50,000' },
  { max: Infinity, label: 'มากกว่า 50,000' }
];
const INCOME_ORDER = INCOME_BANDS.map(b => b.label);
// ข้อมูลจากฟอร์มรุ่นก่อน (เคยเป็น dropdown ชั้นรายได้) — map เข้าชั้นใหม่ ไม่ให้ตกเป็น "ไม่ระบุ"
const LEGACY_INCOME = {
  '< 5,000': 'ไม่เกิน 5,000', '5,001–10,000': '5,001–10,000',
  '10,001–20,000': '10,001–20,000', '20,001–30,000': '20,001–30,000',
  '30,001–50,000': '30,001–50,000', '> 50,000': 'มากกว่า 50,000'
};
function incomeBand(v) {
  const raw = String(v ?? '').trim();
  if (!raw) return '(ไม่ระบุ)';
  if (LEGACY_INCOME[raw]) return LEGACY_INCOME[raw];
  const n = Number(raw.replace(/[, ]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return '(ไม่ระบุ)';
  return INCOME_BANDS.find(b => n <= b.max).label;
}
const incRank = l => { const i = INCOME_ORDER.indexOf(l); return i < 0 ? 99 : i; };   // "(ไม่ระบุ)" ไปท้ายสุด
const numOf = v => { const n = Number(String(v ?? '').replace(/[, ]/g, '')); return Number.isFinite(n) ? n : 0; };

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// รวมชื่อผู้สำรวจ/ผู้ควบคุมที่ควรเป็นคนเดียวกัน
// - normalize NFC (สระ/วรรณยุกต์ไทยเรียงลำดับให้เท่ากัน)
// - ตัดอักขระล่องหน (zero-width / directional marks) ที่แทรกจากการ copy หรือคีย์บอร์ด
// - ตัดช่องว่างหน้า-หลัง + ยุบช่องว่างซ้อน
function normName(s) {
  return String(s ?? '')
    .normalize('NFC')
    .replace(/[​-‏‪-‮⁠﻿]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}
// key สำหรับจัดกลุ่ม (case-insensitive) — ให้ "สมชาย" กับ "สมชาย " กับ "ส มชาย" (พิมพ์ต่างเคส) รวมเป็นแถวเดียว
function nameKey(s) {
  return normName(s).toLowerCase();
}

function countBy(arr, fn) {
  const m = {};
  arr.forEach(x => { const k = fn(x) || '(ไม่ระบุ)'; m[k] = (m[k] || 0) + 1; });
  return m;
}

function topN(obj, n = 10) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
}

// เหมือน topN แต่ "ม้วน" ส่วนที่เกินเป็นก้อนเดียว แทนที่จะตัดทิ้งเงียบ ๆ
// จำเป็นกับกราฟสัดส่วน (modal split / วัตถุประสงค์) — ถ้าตัดทิ้ง วงกลมจะรวมกันไม่ครบ 100%
// ตั้งชื่อก้อนให้บอกจำนวน เพื่อไม่ให้สับสนกับตัวเลือก 'อื่น ๆ' ที่มีอยู่จริงในแบบสอบถาม
function topNRoll(obj, n = 10) {
  const e = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  if (e.length <= n) return e;
  const head = e.slice(0, n - 1);
  const tail = e.slice(n - 1);
  return [...head, [`อื่น ๆ (รวม ${tail.length} รายการ)`, tail.reduce((s, x) => s + x[1], 0)]];
}

// วาดกราฟ หรือขึ้นข้อความ "ยังไม่มีข้อมูล" — และล้างข้อความทิ้งเมื่อข้อมูลมาแล้ว
// (ของเดิมตั้งข้อความไว้แล้วไม่เคยล้าง ทำให้ค้างใต้กราฟหลังกด refresh)
function chartOrMsg(canvasId, msgId, hasData, build) {
  const cv = document.getElementById(canvasId);
  const ms = document.getElementById(msgId);
  if (!hasData) {
    if (charts[canvasId]) { try { charts[canvasId].destroy(); } catch (_) {} delete charts[canvasId]; }
    if (cv) cv.style.display = 'none';
    if (ms) ms.innerHTML = '<p style="color:var(--muted);font-size:13px;padding:8px 0">ยังไม่มีข้อมูล</p>';
    return false;
  }
  if (cv) cv.style.display = '';
  if (ms) ms.innerHTML = '';
  build();
  return true;
}

// tooltip แสดง % ของยอดรวม — ใช้กับกราฟสัดส่วน
const pctTooltip = {
  callbacks: {
    label(ctx) {
      const arr = ctx.dataset.data || [];
      const sum = arr.reduce((s, v) => s + Math.abs(+v || 0), 0);
      const raw = (ctx.parsed && typeof ctx.parsed === 'object')
        ? (ctx.parsed.x ?? ctx.parsed.y ?? 0) : ctx.parsed;
      const n = Math.abs(+raw || 0);
      const name = ctx.dataset.label ? `${ctx.dataset.label} · ${ctx.label}` : ctx.label;
      return `${name}: ${n.toLocaleString()} (${sum ? (n / sum * 100).toFixed(1) : 0}%)`;
    }
  }
};

function makeChart(id, type, data, options = {}) {
  if (charts[id]) { try { charts[id].destroy(); } catch (_) {} delete charts[id]; }
  const ctx = document.getElementById(id);
  if (!ctx) return null;
  const darkScales = {
    x: { ticks: { color: '#64748b', font: { family: 'Sarabun' } }, grid: { color: '#1e293b' } },
    y: { ticks: { color: '#64748b', font: { family: 'Sarabun' } }, grid: { color: '#1e293b' } }
  };
  const basePlugins = { legend: { labels: { color: '#94a3b8', font: { family: 'Sarabun', size: 12 } } } };
  const baseScales  = (type === 'pie' || type === 'doughnut') ? undefined : darkScales;
  charts[id] = new Chart(ctx, {
    type,
    data,
    options: {
      responsive: true,
      ...options,
      // merge ทีละคีย์ — ของเดิม ...options ทับทั้งก้อน ทำให้ค่าปริยาย (ฟอนต์ไทย/tooltip) หายไป
      plugins: { ...basePlugins, ...(options.plugins || {}) },
      scales:  options.scales ?? baseScales,
    }
  });
  return charts[id];
}

// ── KPI BAR ───────────────────────────────────────────────────────────────────
function renderKPIs() {
  const members = allMembers();
  const trips   = allTrips();
  const ivs     = allInterviews();
  const paxIVs  = ivs.filter(iv => paxOf(iv) > 0);            // นับเฉพาะคันที่กรอกจำนวนคนแล้ว
  const pax     = paxIVs.reduce((s, iv) => s + paxOf(iv), 0);

  // Home
  set('kpiHH',       households.length.toLocaleString());
  set('kpiMembers',  members.length.toLocaleString());
  set('kpiTripRate', members.length ? (trips.length / members.length).toFixed(2) : '—');
  // Road
  set('kpiIV',       ivs.length.toLocaleString());
  set('kpiRoadPax',  pax.toLocaleString());
  // หารด้วยคันที่กรอกจริง ไม่ใช่คันทั้งหมด — ไม่งั้นคันที่ยังไม่กรอกจะถ่วงค่าเฉลี่ยให้ต่ำกว่าความจริง
  set('kpiRoadOcc',  paxIVs.length ? (pax / paxIVs.length).toFixed(2) : '—');
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

// ── บ้านที่สำรวจแล้ว แยกตามโซน (จากพิกัดบ้าน) ────────────────────────────────
// point-in-polygon แพง (โซนจริง 232 รูป) — cache ไว้ ล้างพร้อม OD เมื่อข้อมูล/ชุดโซนเปลี่ยน
let HOME_ZONE_CACHE = null;
function homeByZone() {
  if (HOME_ZONE_CACHE) return HOME_ZONE_CACHE;
  const per = {};
  households.forEach(hh => {
    const z = assignZone(parseCoords(hh.coordinates));
    const r = per[z] || (per[z] = { hhs: 0, members: 0, trips: 0 });
    r.hhs++;
    (hh.members || []).forEach(m => { r.members++; r.trips += (m.trips || []).length; });
  });
  HOME_ZONE_CACHE = per;
  return per;
}

// รายชื่อโซนในพื้นที่ศึกษา เรียงตามเลขโซน (ชื่อซ้ำเก็บครั้งเดียว ใช้เลขน้อยสุด)
function studyZoneList() {
  if (studyZoneList._v) return studyZoneList._v;
  const seen = new Map();
  zFeatures().forEach(f => {
    const n = zName(f), num = zNum(n);
    if (!seen.has(n) || num < seen.get(n)) seen.set(n, num);
  });
  studyZoneList._v = [...seen.entries()]
    .filter(([n]) => !isExternalZone(n))
    .sort((a, b) => (a[1] || 9e9) - (b[1] || 9e9))
    .map(([n]) => n);
  return studyZoneList._v;
}

let _zoneSort = 'zone';      // 'zone' = ตามเลขโซน · 'count' = บ้านมาก→น้อย
let _zoneOnlyEmpty = false;  // แสดงเฉพาะโซนที่ยังไม่มีข้อมูล

function renderHomeZoneTable() {
  const per      = homeByZone();
  const internal = studyZoneList();
  const q        = (document.getElementById('zoneCovSearch')?.value || '').trim().toLowerCase();

  // โซนนอกพื้นที่ศึกษา แสดงเฉพาะที่มีข้อมูลจริง (ไม่งั้นตารางจะยาวด้วยจังหวัดรอบนอกที่ว่างเปล่า)
  const extras = Object.keys(per)
    .filter(z => !internal.includes(z) && z !== NO_COORD && z !== OUT_AREA)
    .sort((a, b) => (zNum(a) || 9e9) - (zNum(b) || 9e9));

  const done  = internal.filter(z => (per[z]?.hhs || 0) > 0).length;
  const empty = internal.length - done;
  const noCo  = per[NO_COORD]?.hhs || 0;
  const outAr = per[OUT_AREA]?.hhs || 0;
  const inArea = internal.reduce((n, z) => n + (per[z]?.hhs || 0), 0);
  const pctZone = internal.length ? Math.round(done / internal.length * 100) : 0;

  set('badgeZoneCov', internal.length ? `${done}/${internal.length} โซน` : '—');
  set('zoneCovStrip', `
    <div class="stat-strip">
      <div><span class="stat-num" style="color:${C_HM}">${done}</span><span class="stat-lbl">โซนที่เก็บแล้ว (${pctZone}%)</span></div>
      <div><span class="stat-num" style="color:${empty ? '#f59e0b' : '#22c55e'}">${empty}</span><span class="stat-lbl">โซนที่ยังไม่มีข้อมูล</span></div>
      <div><span class="stat-num" style="color:${C_HM}">${inArea.toLocaleString()}</span><span class="stat-lbl">บ้านในพื้นที่ศึกษา</span></div>
      ${outAr ? `<div><span class="stat-num" style="color:#94a3b8">${outAr.toLocaleString()}</span><span class="stat-lbl">พิกัดตกนอกทุกโซน</span></div>` : ''}
      ${noCo ? `<div><span class="stat-num" style="color:#ef4444">${noCo.toLocaleString()}</span><span class="stat-lbl">บ้านที่ไม่มีพิกัด</span></div>` : ''}
    </div>`);

  let rows = internal.map(z => ({ z, ...(per[z] || { hhs: 0, members: 0, trips: 0 }), tag: 'in' }))
    .concat(extras.map(z => ({ z, ...per[z], tag: 'ext' })));

  if (_zoneOnlyEmpty) rows = rows.filter(r => r.hhs === 0);
  if (q) rows = rows.filter(r => (r.z + ' ' + zDistrict(r.z)).toLowerCase().includes(q));
  if (_zoneSort === 'count') rows.sort((a, b) => b.hhs - a.hhs || (zNum(a.z) || 9e9) - (zNum(b.z) || 9e9));

  // แถวสรุปท้ายตาราง — พิกัดมีปัญหา ต้องเห็นคู่กับตัวเลขโซน ไม่ใช่ซ่อนไว้ที่อื่น
  const special = [];
  if (!_zoneOnlyEmpty && !q) {
    if (outAr) special.push([OUT_AREA, 'พิกัดอยู่นอกทุกโซนที่กำหนด', per[OUT_AREA]]);
    if (noCo)  special.push([NO_COORD, 'ยังไม่ได้ปักพิกัดบ้าน — จัดโซนไม่ได้', per[NO_COORD]]);
  }

  if (!rows.length && !special.length) {
    set('zoneCovTable', '<p style="color:var(--muted);padding:8px 0">ไม่พบโซนที่ตรงกับเงื่อนไข</p>');
    return;
  }
  const maxHh = Math.max(1, ...rows.map(r => r.hhs));
  // ชุดโซนที่ไม่มีฟิลด์อำเภอ zDistrict จะคืนชื่อโซนเดิม — คอลัมน์ซ้ำ ซ่อนทิ้ง
  const hasGroup = rows.some(r => zDistrict(r.z) !== r.z);
  set('zoneCovTable', `
    <div style="max-height:420px;overflow-y:auto">
    <table class="data-table">
      <thead><tr>
        <th>โซน</th>${hasGroup ? '<th>กลุ่ม / อำเภอ</th>' : ''}
        <th style="text-align:right">บ้าน</th><th style="text-align:right">คน</th>
        <th style="text-align:right">เที่ยว</th><th style="text-align:right">คน/บ้าน</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr${r.hhs === 0 ? ' style="background:rgba(245,158,11,.07)"' : ''}>
            <td><span class="mini-bar mini-bar-hm" style="width:${(r.hhs / maxHh * 100).toFixed(0)}%"></span><span class="mini-lbl">${esc(r.z)}${r.tag === 'ext' ? ' <span style="color:#f59e0b;font-size:11px">นอกพื้นที่ศึกษา</span>' : ''}</span></td>
            ${hasGroup ? `<td style="color:var(--muted)">${esc(zDistrict(r.z))}</td>` : ''}
            <td style="text-align:right;font-weight:700${r.hhs === 0 ? ';color:#f59e0b' : ''}">${r.hhs === 0 ? 'ยังไม่มี' : r.hhs.toLocaleString()}</td>
            <td style="text-align:right">${r.members ? r.members.toLocaleString() : '—'}</td>
            <td style="text-align:right">${r.trips ? r.trips.toLocaleString() : '—'}</td>
            <td style="text-align:right;color:var(--muted)">${r.hhs ? (r.members / r.hhs).toFixed(1) : '—'}</td>
          </tr>`).join('')}
        ${special.map(([z, note, d]) => `
          <tr style="background:rgba(239,68,68,.07)">
            <td style="font-weight:700;color:#f87171">${esc(z)}${hasGroup ? '' : ` <span style="font-weight:400;color:var(--muted);font-size:11px">${note}</span>`}</td>
            ${hasGroup ? `<td style="color:var(--muted)">${note}</td>` : ''}
            <td style="text-align:right;font-weight:700">${d.hhs.toLocaleString()}</td>
            <td style="text-align:right">${d.members.toLocaleString()}</td>
            <td style="text-align:right">${d.trips.toLocaleString()}</td>
            <td style="text-align:right;color:var(--muted)">${d.hhs ? (d.members / d.hhs).toFixed(1) : '—'}</td>
          </tr>`).join('')}
      </tbody>
    </table></div>`);
}

function renderProgress() {
  // ═══ HOME: จัดกลุ่มตามผู้ควบคุม (= ทีม) ═══
  const teams = {};
  households.forEach(hh => {
    const sup = normName(hh.supervisorName) || '(ไม่ระบุผู้ควบคุม)';
    const t = teams[sup] || (teams[sup] = { hhs: 0, members: 0, trips: 0, people: new Set() });
    t.hhs++;
    const pk = nameKey(hh.surveyorName);
    if (pk) t.people.add(pk);
    (hh.members || []).forEach(m => { t.members++; t.trips += (m.trips || []).length; });
  });
  const teamRows = Object.entries(teams).sort((a, b) => b[1].hhs - a[1].hhs);
  set('badgeHomeSurveyor', isStaff() ? teamRows.reduce((n, [, d]) => n + d.people.size, 0) + ' คน'
                                     : teamRows.length + ' ทีม');
  set('homeSurveyorTable', `
    <table class="data-table">
      <thead><tr><th>ผู้ควบคุม</th><th>บ้าน</th><th>คน</th><th>เที่ยว</th><th>สถานะ</th></tr></thead>
      <tbody>${teamRows.map(([name, d]) => {
        const people = Math.max(d.people.size, 1);
        const target = HOME_QUOTA_PER_PERSON * people;
        const pct = Math.round(d.hhs / target * 100);
        return `<tr>
          <td>${esc(supLabel(name))} <span style="color:var(--muted);font-size:11px">(${d.people.size} คน)</span></td>
          <td style="font-weight:700">${d.hhs}</td><td>${d.members}</td><td>${d.trips}</td>
          <td>${statusChip(pct, d.hhs, target)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`);

  // ═══ ROAD: จัดกลุ่มตามจุดสำรวจ ═══
  set('badgeRoadsideStation', stations.length + ' จุด');
  const stRows = stations.map(st => {
    const ivs = st.interviews || [];
    const people = new Set(ivs.map(iv => nameKey(iv.surveyorName)).filter(Boolean));
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
          <td>${esc(supLabel(r.st.supervisorName) || '—')}</td>
          <td style="font-weight:700">${r.count}</td>
          <td>${r.pax}</td>
          <td>${statusChip(r.pct, r.count, r.target)}</td>
        </tr>`).join('')}</tbody>
    </table>`);

  // ═══ กราฟ Home: admin = แยกตามผู้ควบคุม · staff = แยกตามผู้สำรวจ (ทีมเดียวจะเหลือแท่งเดียว) ═══
  let homeChartRows = teamRows.map(([n, d]) => [supLabel(n), d.hhs]);
  if (isStaff()) {
    const per = {};
    households.forEach(hh => {
      const n = normName(hh.surveyorName) || '(ไม่ระบุผู้สำรวจ)';
      per[n] = (per[n] || 0) + 1;
    });
    homeChartRows = Object.entries(per).sort((a, b) => b[1] - a[1]);
  }
  makeChart('chartHomeBySupervisor', 'bar', {
    labels: homeChartRows.map(r => r[0]),
    datasets: [{ label: 'บ้าน', data: homeChartRows.map(r => r[1]), backgroundColor: C_HM, borderRadius: 4 }]
  }, { plugins: { legend: { display: false } } });

  // ═══ กราฟ Road: รถแยกตามจุดสำรวจ ═══
  makeChart('chartRoadByStation', 'bar', {
    labels: stRows.map(r => r.st.stationName || r.st.stationCode || r.st.id),
    datasets: [{ label: 'คัน', data: stRows.map(r => r.count), backgroundColor: C_RS, borderRadius: 4 }]
  }, { plugins: { legend: { display: false } } });

  const emptySurv = '<p style="color:var(--muted);padding:8px 0">ยังไม่มีข้อมูล</p>';

  // ═══ สรุปรายผู้สำรวจ — Home (ตาม surveyorName ของครัวเรือน) ═══
  const homeSurv = {};
  households.forEach(hh => {
    const key = nameKey(hh.surveyorName);
    if (!key) return;
    const s = homeSurv[key] || (homeSurv[key] = { name: normName(hh.surveyorName), sup: '', hhs: 0, members: 0, trips: 0 });
    s.hhs++;
    if (!s.sup && hh.supervisorName) s.sup = normName(hh.supervisorName);
    (hh.members || []).forEach(m => { s.members++; s.trips += (m.trips || []).length; });
  });
  const homeSurvRows = Object.values(homeSurv).sort((a, b) => b.hhs - a.hhs);
  set('badgeHomeSurv', homeSurvRows.length + ' คน');
  set('homePersonTable', homeSurvRows.length === 0 ? emptySurv
    : `<table class="data-table">
        <thead><tr><th>ผู้สำรวจ</th><th>ผู้ควบคุม</th><th>บ้าน</th><th>คน</th><th>เที่ยว</th><th>สถานะ</th></tr></thead>
        <tbody>${homeSurvRows.map(s => {
          const pct = Math.round(s.hhs / HOME_QUOTA_PER_PERSON * 100);
          // ค้นหาให้เจอทั้งชื่อเล่นและชื่อ-นามสกุลเต็ม
          return `<tr data-name="${esc((s.name + ' ' + s.sup + ' ' + supLabel(s.sup)).toLowerCase())}">
            <td style="font-weight:600">${esc(s.name)}</td>
            <td style="color:var(--muted)">${esc(supLabel(s.sup) || '—')}</td>
            <td style="font-weight:700">${s.hhs}</td><td>${s.members}</td><td>${s.trips}</td>
            <td>${statusChip(pct, s.hhs, HOME_QUOTA_PER_PERSON)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`);

  // ═══ สรุปรายผู้สำรวจ — Road (ตาม surveyorName ของ interview) ═══
  const roadSurv = {};
  stations.forEach(st => (st.interviews || []).forEach(iv => {
    const key = nameKey(iv.surveyorName);
    if (!key) return;
    const s = roadSurv[key] || (roadSurv[key] = { name: normName(iv.surveyorName), sup: '', ivs: 0, pax: 0 });
    s.ivs++;
    s.pax += (+iv.passengerCount || 0);
    if (!s.sup && st.supervisorName) s.sup = normName(st.supervisorName);
  }));
  const roadSurvRows = Object.values(roadSurv).sort((a, b) => b.ivs - a.ivs);
  set('badgeRoadSurv', roadSurvRows.length + ' คน');
  set('roadPersonTable', roadSurvRows.length === 0 ? emptySurv
    : `<table class="data-table">
        <thead><tr><th>ผู้สำรวจ</th><th>ผู้ควบคุม</th><th>คัน</th><th>คนในรถ</th><th>สถานะ</th></tr></thead>
        <tbody>${roadSurvRows.map(s => {
          const pct = Math.round(s.ivs / ROAD_QUOTA_PER_PERSON * 100);
          // ค้นหาให้เจอทั้งชื่อเล่นและชื่อ-นามสกุลเต็ม
          return `<tr data-name="${esc((s.name + ' ' + s.sup + ' ' + supLabel(s.sup)).toLowerCase())}">
            <td style="font-weight:600">${esc(s.name)}</td>
            <td style="color:var(--muted)">${esc(supLabel(s.sup) || '—')}</td>
            <td style="font-weight:700">${s.ivs}</td><td>${s.pax}</td>
            <td>${statusChip(pct, s.ivs, ROAD_QUOTA_PER_PERSON)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`);

  // ═══ บ้านที่สำรวจแล้ว แยกตามโซน (จากพิกัดบ้าน) ═══
  renderHomeZoneTable();

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
// ผลการหาโซนเปลี่ยนก็ต่อเมื่อข้อมูลหรือชุดโซนเปลี่ยน — ไม่ใช่ตอนสลับระดับตาราง
// ถ้าไม่ cache ไว้ ทุกครั้งที่กดปุ่มจะคำนวณ point-in-polygon ใหม่ทั้งชุด (วัดได้ ~10 วิ)
let OD_CACHE = {};
function resetODCache() { OD_CACHE = {}; HOME_ZONE_CACHE = null; }

function buildODPairs(source) {
  if (OD_CACHE[source]) return OD_CACHE[source];
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
  OD_CACHE[source] = pairs;
  return pairs;
}

const NO_COORD = '(ไม่มีพิกัด)', OUT_AREA = '(นอกพื้นที่)';

// แกนของตาราง OD ตามระดับที่เลือก
//   'zone'  = ทีละโซน (โซน 1..N)
//   'group' = รวมเป็นกลุ่ม — ในพื้นที่รวมตาม อปท. · นอกพื้นที่รวมตามจังหวัด (ใช้ D_NAME)
// เรียง: ในพื้นที่ (ตามเลขโซน) → นอกพื้นที่ (ตามเลขโซน) → นอกทุกโซน → ไม่มีพิกัด
function odAxis(level) {
  const seen = new Map();                       // label -> เลขโซนน้อยสุดที่เจอ (ใช้เรียง)
  zFeatures().forEach(f => {
    const zn    = zName(f);
    const label = level === 'group' ? zDistrict(zn) : zn;
    const n     = zNum(zn) || 9e6;
    if (!seen.has(label) || n < seen.get(label)) seen.set(label, n);
  });
  const labels = [...seen.keys()].sort((a, b) => seen.get(a) - seen.get(b));
  return [...labels, OUT_AREA, NO_COORD];
}
// แปลงชื่อโซนของ pair ให้เป็น label บนแกน
function odLabel(z, level) {
  if (z === NO_COORD || z === OUT_AREA) return z;
  return level === 'group' ? zDistrict(z) : z;
}
// label นี้อยู่ในพื้นที่ศึกษาไหม (ใช้กับ label ทั้งสองระดับ)
function odInStudy(label, level) {
  if (label === NO_COORD || label === OUT_AREA) return false;
  if (level !== 'group') return isInStudyArea(label);
  // ระดับกลุ่ม: ดูจากโซนแรกที่อยู่ในกลุ่มนั้น
  if (!odInStudy._m) {
    const m = {};
    zFeatures().forEach(f => {
      const zn = zName(f), g = zDistrict(zn);
      if (!(g in m)) m[g] = isInStudyArea(zn);
    });
    odInStudy._m = m;
  }
  return !!odInStudy._m[label];
}

function renderODMatrix(source, level, onlyActive) {
  level = level || 'group';
  odInStudy._m = null;                         // ผูกกับชุดโซน/เส้นแบ่งปัจจุบัน
  const allZones = odAxis(level);              // ไม่ซ้ำแล้ว — โซนหนึ่งมีได้หลายรูปใน shp

  const pairs = buildODPairs(source).map(({ o, d }) => ({
    o: odLabel(o, level), d: odLabel(d, level),
    oRaw: o, dRaw: d
  }));

  // Build matrix
  const matrix = {};
  allZones.forEach(o => { matrix[o] = {}; allZones.forEach(d => { matrix[o][d] = 0; }); });
  pairs.forEach(({ o, d }) => {
    const oz = matrix[o] ? o : OUT_AREA;
    const dz = matrix[d] ? d : OUT_AREA;
    matrix[oz][dz]++;
  });

  // Summary — "ในพื้นที่" นับเฉพาะโซน 1..ZONE_INTERNAL_MAX
  // โซนรอบนอก (จังหวัดอื่น) ต้องนับเป็นนอกพื้นที่ ไม่งั้นขอนแก่น→ขอนแก่น จะกลายเป็น Internal
  let internal = 0, incoming = 0, outgoing = 0, passthrough = 0, noCoord = 0;
  pairs.forEach(({ oRaw, dRaw }) => {
    if (oRaw === NO_COORD || dRaw === NO_COORD) { noCoord++; return; }
    const oi = isInStudyArea(oRaw), di = isInStudyArea(dRaw);
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

  // Top 10 pairs — ตัดรายการที่ไม่มีพิกัดออก เพราะไม่ใช่การเดินทางจริง เป็นข้อมูลไม่ครบ
  // (ถ้าไม่ตัด "(ไม่มีพิกัด) → (ไม่มีพิกัด)" จะขึ้นเป็นอันดับต้นๆ แล้วบังคู่จริง)
  const pairCounts = {};
  let top10Skipped = 0;
  pairs.forEach(({ o, d }) => {
    if (o === NO_COORD || d === NO_COORD) { top10Skipped++; return; }
    const k = `${o} → ${d}`;
    pairCounts[k] = (pairCounts[k] || 0) + 1;
  });
  const top10 = topN(pairCounts, 10);
  set('odTop10', `
    <table class="data-table">
      <thead><tr><th>#</th><th>คู่ ${level === 'group' ? 'กลุ่ม' : 'โซน'} (O-D)</th><th>จำนวน</th></tr></thead>
      <tbody>${top10.map(([pair, cnt], i) => `
        <tr>
          <td style="color:var(--muted)">${i + 1}</td>
          <td style="font-size:12px">${esc(pair)}</td>
          <td style="font-weight:700;color:#3b82f6">${cnt}</td>
        </tr>`).join('')}</tbody>
    </table>
    ${top10Skipped ? `<p style="color:var(--muted);font-size:11px;margin-top:8px">
       ไม่นับ ${top10Skipped} คู่ที่ยังไม่มีพิกัด</p>` : ''}`);

  // Matrix table — ปริยายแสดงทุกโซน (ตารางต้องครบเพื่อเอาไปใช้ต่อ)
  // ติ๊ก "เฉพาะที่มีข้อมูล" เพื่อซ่อนแถว/คอลัมน์ที่ยังว่าง ตอนอยากดูเฉพาะที่เก็บแล้ว
  const hasData = z =>
    Object.values(matrix[z] || {}).some(v => v > 0) ||
    allZones.some(o => (matrix[o] || {})[z] > 0);
  const active = onlyActive ? allZones.filter(hasData) : allZones;

  // สเกลสี: คิดจากช่องที่เป็นการเดินทางจริงเท่านั้น
  // ถ้าเอาช่อง "ไม่มีพิกัด" มาคิดด้วย ช่องนั้นมักใหญ่สุดจนช่องอื่นจางหมดทั้งตาราง
  // และใช้สเกล log เพราะช่อง internal ของเมืองมักโตกว่าคู่อื่นหลายเท่า
  const realVals = [];
  active.forEach(o => active.forEach(d => {
    if (o === NO_COORD || d === NO_COORD) return;
    const v = matrix[o][d] || 0;
    if (v > 0) realVals.push(v);
  }));
  const maxVal = Math.max(1, ...realVals);
  const cellCls = v => {
    if (!v) return 'od-cell-0';
    const r = Math.log(v + 1) / Math.log(maxVal + 1);
    if (r < 0.34) return 'od-cell-low';
    if (r < 0.67) return 'od-cell-mid';
    return 'od-cell-high';
  };

  // ย่อคำนำหน้าหน่วยราชการ ไม่งั้นหัวคอลัมน์จะขึ้น "องค์การบริหารส…" เหมือนกันหมดจนแยกไม่ออก
  const ABBR = [
    ['องค์การบริหารส่วนตำบล', 'อบต.'],
    ['องค์การบริหารส่วนจังหวัด', 'อบจ.'],
    ['เทศบาลตำบล', 'ทต.'],
    ['เทศบาลเมือง', 'ทม.'],
    ['เทศบาลนคร', 'ทน.'],
  ];
  const abbrev = s => ABBR.reduce((t, [long, sh]) => t.replace(long, sh), String(s));
  const shortName = (s, max = 16) => {
    const t = abbrev(s).replace(/\s*\(\d+\)\s*$/, '');   // ตัดรหัสท้ายชื่อออก (ยังดูได้จาก tooltip)
    return t.length > max ? t.slice(0, max) + '…' : t;
  };

  set('odMatrixWrap', active.length === 0
    ? '<p style="color:var(--muted);padding:12px">ยังไม่มีข้อมูล OD</p>'
    : `<table class="od-table">
        <thead>
          <tr>
            <th style="min-width:100px">ต้นทาง ╲ ปลายทาง</th>
            ${active.map(z => `<th title="${esc(z)}" class="${odInStudy(z, level) ? '' : 'od-ext'}">${esc(shortName(z))}</th>`).join('')}
            <th>รวม</th>
          </tr>
        </thead>
        <tbody>
          ${active.map(o => {
            const rowTotal = active.reduce((s, d) => s + (matrix[o][d] || 0), 0);
            return `<tr>
              <td class="od-row-header ${odInStudy(o, level) ? '' : 'od-ext'}" title="${esc(o)}">${esc(shortName(o, 16))}</td>
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
  // canvas renderer สำหรับโหมดพิกัดจริง — เส้นหลักพันเส้นลื่นกว่า SVG มาก
  rawRenderer = L.canvas({ padding: 0.4 });
  // layer order: zones (bottom) → desire lines → choropleth (top)
  zoneLayer   = L.layerGroup().addTo(leafletMap);
  desireLayer = L.layerGroup().addTo(leafletMap);
  choroLayer  = L.layerGroup().addTo(leafletMap);
  fitMapToZones(); // default view = ครอบเขต shp ที่นำเข้าไว้
}

// ซูมให้ครอบทุกโซนจาก shp ที่นำเข้า (ถ้าไม่มีโซน คงไว้ที่ CENTER)
let didFitZones = false;
function fitMapToZones() {
  const features = zFeatures();
  if (!leafletMap || !features.length || didFitZones) return;
  if (!leafletMap.getSize().x) return; // container ยังไม่แสดงผล — switchTab จะเรียกซ้ำเมื่อมองเห็น
  try {
    const b = L.geoJSON({ type: 'FeatureCollection', features }).getBounds();
    if (b.isValid()) { leafletMap.fitBounds(b, { padding: [16, 16] }); didFitZones = true; }
  } catch (e) { /* geometry เพี้ยน — คงมุมมองเดิม */ }
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

  } else if (mode === 'raw') {
    // ── โหมดพิกัดจริง: วาดทุกเที่ยวจาก origin → destination ตาม lat/long จริง ──
    selectedZone = null;
    _hideZonePanel();

    // เส้นขอบโซนบาง ๆ เป็นบริบท (ไม่ interactive)
    features.forEach(f => {
      L.polygon(
        featureRings(f).flatMap(ring => [ring.map(c => [c[1], c[0]])]),
        { color: '#475569', weight: 1, fill: false, opacity: 0.5, interactive: false }
      ).addTo(zoneLayer);
    });

    _drawRawTrips(source);

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

// วาดเส้นทางตามพิกัดจริง (ไม่จับเป็นโซน) — 1 เส้น = 1 เที่ยว, จุดกลม = ปลายทาง
function _drawRawTrips(source) {
  const drawSet = (items, name, color, label) => {
    let n = 0;
    items.forEach(it => {
      const o = parseCoords(it.originCoords), d = parseCoords(it.destinationCoords);
      if (!o || !d) return;
      n++;
      L.polyline([[o.lat, o.lon], [d.lat, d.lon]],
        { renderer: rawRenderer, color, weight: 1.5, opacity: 0.45 })
        .bindTooltip(`<b>${esc(name(it, 'o') || '—')}</b> → <b>${esc(name(it, 'd') || '—')}</b><br>${label}`, { sticky: true })
        .addTo(desireLayer);
      L.circleMarker([d.lat, d.lon],
        { renderer: rawRenderer, radius: 2.5, color: '#fff', weight: 0.8, fillColor: color, fillOpacity: 0.9 })
        .addTo(desireLayer);
    });
    return n;
  };

  let nHome = 0, nRoad = 0;
  if (source === 'home' || source === 'all')
    nHome = drawSet(allTrips(), (t, s) => s === 'o' ? t.origin : t.destination, '#3b82f6', '🏠 Home');
  if (source === 'roadside' || source === 'all')
    nRoad = drawSet(allInterviews(), (iv, s) => s === 'o' ? iv.originName : iv.destinationName, '#f59e0b', '🚗 Roadside');

  // สรุปจำนวนเส้นในแผงข้าง (แทนข้อความ "คลิกโซน" ซึ่งไม่เกี่ยวกับโหมดนี้)
  const el = document.getElementById('mapZoneEmpty');
  if (el) el.innerHTML = `
    <div style="font-size:12px;line-height:2;color:var(--muted)">
      <div style="font-weight:700;color:var(--text);margin-bottom:4px">📌 เส้นทางตามพิกัดจริง</div>
      ${(source === 'home' || source === 'all') ? `<div><span style="color:#3b82f6">━</span> Home ${nHome} เที่ยว</div>` : ''}
      ${(source === 'roadside' || source === 'all') ? `<div><span style="color:#f59e0b">━</span> Roadside ${nRoad} เที่ยว</div>` : ''}
      <div style="font-size:11px;margin-top:6px">จุดกลม = ปลายทาง<br>ชี้ที่เส้นเพื่อดูชื่อสถานที่</div>
    </div>`;
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
  const empty = document.getElementById('mapZoneEmpty');
  empty.style.display = 'flex';
  // ข้อความ default (โหมด raw จะเขียนสรุปทับทีหลัง)
  empty.innerHTML = '<p style="color:var(--muted);font-size:12px;line-height:1.6">คลิกโซนบนแผนที่<br>หรือค้นหาชื่อโซน<br>เพื่อดูการเดินทาง</p>';
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

  // โทนสีตามแหล่งข้อมูลที่เลือก — ให้ตรงกับแท็บสถิติ
  const peakBase = source === 'roadside' ? 'rgba(245,158,11,.55)'
                 : source === 'home'     ? 'rgba(59,130,246,.55)' : 'rgba(139,92,246,.55)';
  const peakHi   = source === 'roadside' ? '#fbbf24'
                 : source === 'home'     ? '#60a5fa' : '#a78bfa';
  makeChart('chartPeak', 'bar', {
    labels: Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`),
    datasets: [{
      label: 'จำนวนเที่ยว',
      data: counts,
      backgroundColor: counts.map((_, i) => i === peak ? peakHi : peakBase)
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
    const inc = incomeBand(hh.householdIncome);   // รายได้เป็นตัวเลขล้วน — ต้องจัดชั้นก่อน ไม่งั้นได้แถวละครัวเรือน
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
          <tbody>${Object.entries(byIncome)
            .sort((a, b) => incRank(a[0]) - incRank(b[0]))   // เรียงตามชั้นรายได้ ไม่ใช่ตามตัวอักษร ("(ไม่ระบุ)" ไว้ท้ายสุด)
            .map(rateRow).join('')}</tbody>
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
// ผังหน้า: ซ้าย = Roadside (โทนส้ม) · ขวา = Home (โทนฟ้า) · ข้อมูลที่เทียบกันได้ = การ์ดใหญ่ตรงกลาง
function renderStats() {
  const members = allMembers();
  const trips   = allTrips();
  const ivs     = allInterviews();

  /* ══ ซ้าย · Roadside — ประเภทยานพาหนะ ══════════════════════════════════════ */
  // ข้อมูลเก็บเป็น key ('truck6') ต้องแปลงเป็นชื่อไทยก่อน ไม่งั้นแกนกราฟขึ้นภาษาอังกฤษ
  const vtCount = countBy(ivs, iv => vehLabel(iv.vehicleType));
  const vtE = Object.entries(vtCount).sort((a, b) => b[1] - a[1]);   // ประเภทมีแค่ 9 — แสดงครบ ไม่ตัด
  set('vehicleTypeSub', ivs.length
    ? `${ivs.length.toLocaleString()} สัมภาษณ์ · ${vtE.length} ประเภท`
    : '');
  chartOrMsg('chartVehicleType', 'chartVehicleTypeMsg', vtE.length, () => {
    makeChart('chartVehicleType', 'bar', {
      labels: vtE.map(e => e[0]),
      datasets: [{ label: 'คัน', data: vtE.map(e => e[1]), backgroundColor: rampRS(vtE.length), borderRadius: 4 }]
    }, {
      indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: pctTooltip },
      scales: {
        x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(245,158,11,.12)' } },
        y: { ticks: { color: '#cbd5e1', font: { size: 11, family: 'Sarabun' } }, grid: { display: false } }
      }
    });
  });

  /* ══ ขวา · Home — Modal Split ══════════════════════════════════════════════ */
  const modeCount = {};
  let segTotal = 0;
  trips.forEach(t => {
    (t.segments || []).forEach(s => {
      const m = (s.mode || '').trim() || '(ไม่ระบุ)';
      modeCount[m] = (modeCount[m] || 0) + 1;
      segTotal++;
    });
  });
  // ม้วนส่วนที่เกินเป็น "อื่น ๆ" แทนการตัดทิ้ง — modal split ต้องรวมกันได้ 100%
  const modeE = topNRoll(modeCount, 12);
  set('modalSplitSub', segTotal
    ? `${segTotal.toLocaleString()} ช่วงการเดินทาง · ${Object.keys(modeCount).length} รูปแบบ`
    : '');
  chartOrMsg('chartModalSplit', 'chartModalSplitMsg', modeE.length, () => {
    makeChart('chartModalSplit', 'doughnut', {
      labels: modeE.map(e => e[0]),
      datasets: [{ data: modeE.map(e => e[1]), backgroundColor: rampHM(modeE.length), borderColor: '#1e293b', borderWidth: 2 }]
    }, {
      plugins: {
        legend: { position: 'right', labels: { color: '#cbd5e1', font: { size: 11, family: 'Sarabun' }, boxWidth: 12 } },
        tooltip: pctTooltip
      }
    });
  });

  /* ══ กลาง · การ์ดใหญ่ — วัตถุประสงค์ เทียบสองแหล่ง ════════════════════════ */
  // เทียบเป็น % ภายในแหล่งตัวเอง เพราะขนาดตัวอย่างต่างกันมาก (เที่ยว Home vs สัมภาษณ์ Roadside)
  // ถ้าเทียบด้วยจำนวนดิบ แท่งฝั่งที่ตัวอย่างเยอะจะกลบอีกฝั่งจนอ่านไม่ได้
  const rsP = countBy(ivs,   iv => (iv.purpose || '').trim());
  const hmP = countBy(trips, t  => (t.purpose  || '').trim());
  const cats = [...PURPOSES, ...Object.keys({ ...rsP, ...hmP }).filter(k => !PURPOSES.includes(k))];
  const rsTot = ivs.length, hmTot = trips.length;
  const rsN = cats.map(c => rsP[c] || 0), hmN = cats.map(c => hmP[c] || 0);
  set('purposeCmpSub', (rsTot || hmTot)
    ? `Roadside ${rsTot.toLocaleString()} สัมภาษณ์ · Home ${hmTot.toLocaleString()} เที่ยว — แสดงเป็น % ภายในแต่ละแหล่ง`
    : '');
  chartOrMsg('chartPurposeCmp', 'chartPurposeCmpMsg', rsTot + hmTot > 0, () => {
    makeChart('chartPurposeCmp', 'bar', {
      labels: cats,
      datasets: [
        { label: '🚛 Roadside', data: rsN.map(n => rsTot ? +(n / rsTot * 100).toFixed(2) : 0),
          backgroundColor: C_RS_DIM, borderColor: C_RS, borderWidth: 1, borderRadius: 4, _raw: rsN },
        { label: '🏠 Home',     data: hmN.map(n => hmTot ? +(n / hmTot * 100).toFixed(2) : 0),
          backgroundColor: C_HM_DIM, borderColor: C_HM, borderWidth: 1, borderRadius: 4, _raw: hmN }
      ]
    }, {
      indexAxis: 'y',
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { color: '#cbd5e1', font: { size: 12, family: 'Sarabun' }, boxWidth: 14 } },
        tooltip: { callbacks: { label: c => {
          const raw = c.dataset._raw?.[c.dataIndex] ?? 0;
          return `${c.dataset.label}: ${(+c.parsed.x).toFixed(1)}%  (${raw.toLocaleString()} รายการ)`;
        } } }
      },
      scales: {
        x: { ticks: { color: '#94a3b8', callback: v => v + '%' }, grid: { color: '#1e293b' }, title: { display: true, text: 'สัดส่วนภายในแหล่งข้อมูล (%)', color: '#64748b', font: { size: 11, family: 'Sarabun' } } },
        y: { ticks: { color: '#cbd5e1', font: { size: 11, family: 'Sarabun' } }, grid: { display: false } }
      }
    });
  });

  /* ══ ซ้าย · Roadside — สินค้าขนส่ง ════════════════════════════════════════ */
  // ค่าจริงที่แอปเก็บคือ 'มีสินค้า' (ของเดิมกรองด้วย 'มี' จึงได้ 0 เสมอ)
  const cargoIVs = ivs.filter(hasCargo);
  if (!cargoIVs.length) {
    const anyTruck = ivs.filter(iv => String(iv.vehicleType || '').startsWith('truck')).length;
    set('cargoTable', `<p style="color:var(--muted);font-size:13px">ยังไม่มีรายการที่ระบุว่า "มีสินค้า"`
      + (anyTruck ? ` (มีรถบรรทุก ${anyTruck} คันที่ยังไม่ได้กรอกช่องสินค้า)` : '') + `</p>`);
  } else {
    const totalW = cargoIVs.reduce((s, iv) => s + numOf(iv.cargoWeight), 0);
    const byType = {};
    cargoIVs.forEach(iv => {
      // 'อื่น ๆ (ระบุ)' + ช่องระบุ — ของเดิมยุบรวมเป็นก้อนเดียว รายละเอียดที่ผู้สำรวจพิมพ์หายไป
      const t = (iv.cargoType || '').trim() === 'อื่น ๆ (ระบุ)' && (iv.cargoTypeOther || '').trim()
        ? `อื่น ๆ: ${iv.cargoTypeOther.trim()}`
        : ((iv.cargoType || '').trim() || '(ไม่ระบุชนิด)');
      if (!byType[t]) byType[t] = { n: 0, w: 0 };
      byType[t].n++; byType[t].w += numOf(iv.cargoWeight);
    });
    const rows = Object.entries(byType).sort((a, b) => b[1].n - a[1].n);
    const maxN = rows[0][1].n;
    set('cargoTable', `
      <div class="stat-strip">
        <div><span class="stat-num" style="color:${C_RS}">${cargoIVs.length.toLocaleString()}</span><span class="stat-lbl">คันที่บรรทุกสินค้า</span></div>
        <div><span class="stat-num" style="color:${C_RS}">${totalW.toLocaleString()}</span><span class="stat-lbl">น้ำหนักรวม (กก.)</span></div>
        <div><span class="stat-num" style="color:${C_RS}">${rows.length}</span><span class="stat-lbl">ชนิดสินค้า</span></div>
      </div>
      <table class="data-table">
        <thead><tr><th>ชนิดสินค้า</th><th style="text-align:right">คัน</th><th style="text-align:right">น้ำหนัก (กก.)</th></tr></thead>
        <tbody>${rows.map(([t, v]) => `
          <tr><td><span class="mini-bar" style="width:${(v.n / maxN * 100).toFixed(0)}%"></span><span class="mini-lbl">${esc(t)}</span></td>
              <td style="text-align:right;font-weight:700">${v.n}</td>
              <td style="text-align:right;color:var(--muted)">${v.w ? v.w.toLocaleString() : '—'}</td></tr>`).join('')}</tbody>
      </table>`);
  }

  /* ══ ขวา · Home — Pyramid ประชากร ═════════════════════════════════════════ */
  const ageGroups = ['0–9','10–19','20–29','30–39','40–49','50–59','60–69','70+'];
  const maleD = new Array(8).fill(0), femD = new Array(8).fill(0);
  let noAge = 0, noSex = 0;
  members.forEach(m => {
    // ของเดิมใช้ parseInt(...) || 0 — คนที่ไม่กรอกอายุถูกนับเป็นกลุ่ม 0–9 ทำให้ฐานพีระมิดบวม
    const age = parseInt(String(m.age ?? '').replace(/[^\d]/g, ''), 10);
    if (!Number.isFinite(age) || age < 0 || age > 120) { noAge++; return; }
    const idx  = Math.min(7, Math.floor(age / 10));
    const gend = normName(m.gender);
    if (['ชาย','male','M','m'].includes(gend))        maleD[idx]++;
    else if (['หญิง','female','F','f'].includes(gend)) femD[idx]++;
    else noSex++;
  });
  const inChart = maleD.reduce((a, b) => a + b, 0) + femD.reduce((a, b) => a + b, 0);
  set('pyramidNote', members.length
    ? `<span class="note">อยู่ในกราฟ ${inChart.toLocaleString()} คน`
      + (noAge  ? ` · ไม่ระบุ/อายุไม่ถูกต้อง ${noAge.toLocaleString()} คน`  : '')
      + (noSex  ? ` · ไม่ระบุเพศ ${noSex.toLocaleString()} คน`             : '')
      + (noAge + noSex ? ' — ไม่นับรวมในกราฟ' : '') + `</span>`
    : '');
  chartOrMsg('chartPyramid', 'chartPyramidMsg', inChart > 0, () => {
    makeChart('chartPyramid', 'bar', {
      labels: ageGroups,
      datasets: [
        { label: 'ชาย',  data: maleD.map(v => -v), backgroundColor: C_HM,      borderRadius: 3, _raw: maleD },
        { label: 'หญิง', data: femD,               backgroundColor: '#f472b6', borderRadius: 3, _raw: femD }
      ]
    }, {
      indexAxis: 'y',
      plugins: {
        legend: { labels: { color: '#cbd5e1', font: { family: 'Sarabun' } } },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${(c.dataset._raw?.[c.dataIndex] ?? 0).toLocaleString()} คน` } }
      },
      scales: {
        x: { stacked: true, ticks: { color: '#94a3b8', callback: v => Math.abs(v) }, grid: { color: '#1e293b' } },
        y: { stacked: true, ticks: { color: '#cbd5e1', font: { family: 'Sarabun' } }, grid: { display: false } }
      }
    });
  });

  /* ══ ซ้าย · Roadside — คนต่อคัน (occupancy) ═══════════════════════════════ */
  // occupancy = คนในรถ (รวมคนขับ) ต่อคัน — ตัวเลขที่ใช้แปลง "เที่ยวรถ" เป็น "เที่ยวคน" ตอนทำ OD
  const occ = {};
  ivs.forEach(iv => {
    const n = paxOf(iv);
    if (!n) return;                                   // ยังไม่กรอก — ไม่นับ ทั้งตัวตั้งและตัวหาร
    const k = iv.vehicleType || '(ไม่ระบุ)';
    if (!occ[k]) occ[k] = { n: 0, sum: 0 };
    occ[k].n++; occ[k].sum += n;
  });
  const occKeys = [
    ...VEH_ORDER.filter(k => occ[k]),
    ...Object.keys(occ).filter(k => !VEH_ORDER.includes(k))    // ค่าแปลกปลอม/ไม่ระบุ ต่อท้าย
  ];
  const occIVs  = ivs.filter(iv => paxOf(iv) > 0);
  const paxAll  = occIVs.reduce((s, iv) => s + paxOf(iv), 0);
  set('occSub', ivs.length
    ? `กรอกจำนวนคนแล้ว ${occIVs.length.toLocaleString()} / ${ivs.length.toLocaleString()} คัน`
      + (occIVs.length ? ` · เฉลี่ยรวม ${(paxAll / occIVs.length).toFixed(2)} คน/คัน` : '')
    : '');
  set('occStrip', occIVs.length ? `
    <div class="stat-strip">
      <div><span class="stat-num" style="color:${C_RS}">${(paxAll / occIVs.length).toFixed(2)}</span><span class="stat-lbl">คน/คัน เฉลี่ย</span></div>
      <div><span class="stat-num" style="color:${C_RS}">${paxAll.toLocaleString()}</span><span class="stat-lbl">คนในรถรวม</span></div>
      <div><span class="stat-num" style="color:${C_RS}">${occKeys.length}</span><span class="stat-lbl">ประเภทที่มีข้อมูล</span></div>
    </div>` : '');
  chartOrMsg('chartOccupancy', 'chartOccupancyMsg', occKeys.length, () => {
    makeChart('chartOccupancy', 'bar', {
      labels: occKeys.map(vehLabel),
      datasets: [{
        label: 'คน/คัน', borderRadius: 4, backgroundColor: rampRS(occKeys.length),
        data: occKeys.map(k => +(occ[k].sum / occ[k].n).toFixed(2)),
        _n:   occKeys.map(k => occ[k].n)
      }]
    }, {
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c =>
          `เฉลี่ย ${(+c.parsed.x).toFixed(2)} คน/คัน  (จาก ${(c.dataset._n?.[c.dataIndex] ?? 0).toLocaleString()} คัน)` } }
      },
      scales: {
        x: { beginAtZero: true, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(245,158,11,.12)' },
             title: { display: true, text: 'คน/คัน (รวมคนขับ)', color: '#64748b', font: { size: 11, family: 'Sarabun' } } },
        y: { ticks: { color: '#cbd5e1', font: { size: 11, family: 'Sarabun' } }, grid: { display: false } }
      }
    });
  });

  /* ══ ซ้าย · Roadside — รายได้ผู้ขับขี่ ════════════════════════════════════ */
  // ช่องนี้กรอกได้ไม่บังคับ (Roadside/js/app.js: "เว้นว่างได้") สัดส่วนที่กรอกจึงต้องบอกให้ชัด
  const dincCount = countBy(ivs, iv => incomeBand(iv.driverIncome));
  const dincLabels = [...INCOME_ORDER, ...(dincCount['(ไม่ระบุ)'] ? ['(ไม่ระบุ)'] : [])];
  const dincData   = dincLabels.map(l => dincCount[l] || 0);
  const dincVals   = ivs.map(iv => numOf(iv.driverIncome)).filter(n => n > 0).sort((a, b) => a - b);
  const dincMed    = dincVals.length ? dincVals[Math.floor(dincVals.length / 2)] : 0;
  set('driverIncomeSub', ivs.length
    ? `กรอกรายได้แล้ว ${dincVals.length.toLocaleString()} / ${ivs.length.toLocaleString()} ราย`
      + (dincMed ? ` · มัธยฐาน ${dincMed.toLocaleString()} บาท/เดือน` : '')
      + ' — ช่องนี้ไม่บังคับกรอก'
    : '');
  chartOrMsg('chartDriverIncome', 'chartDriverIncomeMsg', ivs.length > 0, () => {
    makeChart('chartDriverIncome', 'bar', {
      labels: dincLabels,
      datasets: [{ label: 'ราย', data: dincData, borderRadius: 4,
                   backgroundColor: dincLabels.map(l => l === '(ไม่ระบุ)' ? C_NA : C_RS) }]
    }, {
      plugins: { legend: { display: false }, tooltip: pctTooltip },
      scales: {
        x: { ticks: { color: '#cbd5e1', font: { size: 10, family: 'Sarabun' } }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: '#94a3b8', precision: 0 }, grid: { color: 'rgba(245,158,11,.12)' } }
      }
    });
  });

  /* ══ ล่าง · Home — รายได้ครัวเรือน ════════════════════════════════════════ */
  // ฟอร์มเก็บรายได้เป็นตัวเลขล้วน ต้องจัดชั้นเอง (ของเดิมจับกลุ่มด้วยชื่อชั้น → ได้แท่งละ 1 ครัวเรือน)
  const incCount = countBy(households, hh => incomeBand(hh.householdIncome));
  const incLabels = [...INCOME_ORDER, ...(incCount['(ไม่ระบุ)'] ? ['(ไม่ระบุ)'] : [])];
  const incData   = incLabels.map(l => incCount[l] || 0);
  const withInc   = households.length - (incCount['(ไม่ระบุ)'] || 0);
  const incVals   = households.map(hh => numOf(hh.householdIncome)).filter(n => n > 0).sort((a, b) => a - b);
  const median    = incVals.length ? incVals[Math.floor(incVals.length / 2)] : 0;
  set('incomeSub', households.length
    ? `กรอกรายได้แล้ว ${withInc.toLocaleString()} / ${households.length.toLocaleString()} ครัวเรือน`
      + (median ? ` · มัธยฐาน ${median.toLocaleString()} บาท/เดือน` : '')
    : '');
  chartOrMsg('chartIncome', 'chartIncomeMsg', households.length > 0, () => {
    makeChart('chartIncome', 'bar', {
      labels: incLabels,
      datasets: [{ label: 'ครัวเรือน', data: incData, borderRadius: 4,
                   backgroundColor: incLabels.map(l => l === '(ไม่ระบุ)' ? C_NA : C_HM) }]
    }, {
      plugins: { legend: { display: false }, tooltip: pctTooltip },
      scales: {
        x: { ticks: { color: '#cbd5e1', font: { size: 10, family: 'Sarabun' } }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: '#94a3b8', precision: 0 }, grid: { color: '#1e293b' } }
      }
    });
  });

  /* ══ ล่าง · Home — ระดับการศึกษา ══════════════════════════════════════════ */
  // การศึกษาเป็นข้อมูลมีลำดับ — เรียงตามระดับ ไม่ใช่ตามจำนวน จะได้อ่านเป็นการกระจายตัวได้
  const eduCount = countBy(members, m => (m.education || '').trim());
  const eduKeys  = [
    ...EDU_ORDER.filter(k => eduCount[k]),
    ...Object.keys(eduCount).filter(k => !EDU_ORDER.includes(k) && k !== '(ไม่ระบุ)'),
    ...(eduCount['(ไม่ระบุ)'] ? ['(ไม่ระบุ)'] : [])
  ];
  const eduE = eduKeys.map(k => [k, eduCount[k]]);
  const eduKnown = members.length - (eduCount['(ไม่ระบุ)'] || 0);
  set('educationSub', members.length
    ? `${members.length.toLocaleString()} คน · ระบุการศึกษาแล้ว ${eduKnown.toLocaleString()} คน` : '');
  chartOrMsg('chartEducation', 'chartEducationMsg', eduE.length, () => {
    makeChart('chartEducation', 'bar', {
      labels: eduE.map(e => e[0]),
      datasets: [{ label: 'คน', data: eduE.map(e => e[1]), borderRadius: 4,
                   backgroundColor: (() => { const r = rampHM(eduE.length);
                     return eduE.map((e, i) => e[0] === '(ไม่ระบุ)' ? C_NA : r[i]); })() }]
    }, {
      indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: pctTooltip },
      scales: {
        x: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } },
        y: { ticks: { color: '#cbd5e1', font: { size: 11, family: 'Sarabun' } }, grid: { display: false } }
      }
    });
  });
}
// ── MAIN APP ──────────────────────────────────────────────────────────────────
const App = {
  _tab:        'progress',
  _odSrc:      'home',
  _odLevel:    'group',   // 'group' = รวมตาม อปท./จังหวัด · 'zone' = ทีละโซน
  _odOnlyActive: false,   // true = ซ่อนแถว/คอลัมน์ที่ยังไม่มีข้อมูล
  _mapMode:    'desire',
  _mapSrc:     'home',
  _peakSrc:    'home',

  init() {
    fbInit();
    // Chart.js global defaults
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = 'Sarabun';

    auth.onAuthStateChanged(async user => {
      const showLogin = (errText) => {
        ME = null;
        document.getElementById('loginOverlay').style.display = 'flex';
        document.getElementById('dashboardMain').style.display = 'none';
        const el = document.getElementById('loginError');
        if (el && errText) { el.textContent = errText; el.style.display = 'block'; }
        const btn = document.getElementById('loginBtn');
        if (btn) { btn.disabled = false; btn.textContent = 'เข้าสู่ระบบ'; }
      };
      // ⚠️ ต้องเช็ค isAnonymous — session ผู้สำรวจใช้ origin เดียวกัน ถ้าเช็คแค่ truthy จะหลุดเข้ามาได้
      if (!user || user.isAnonymous) { showLogin(); return; }
      const me = await resolveRole(user);
      if (!me) { await auth.signOut().catch(() => {});
                 showLogin('บัญชีนี้ยังไม่ได้รับสิทธิ์ หรือถูกปิดการใช้งาน — ติดต่อผู้ดูแลระบบ'); return; }
      ME = me;
      document.getElementById('loginOverlay').style.display = 'none';
      document.getElementById('dashboardMain').style.display = 'block';
      // ผู้ควบคุมเห็นชื่อเล่นตัวเอง (ตอนนี้ SUPNICK ยังไม่โหลด ใช้ค่าจากบัญชีตรงๆ)
      set('headerUser', (me.nickname || me.displayName || me.username) + (me.role === 'staff' ? ' · ผู้ควบคุม' : ''));
      applyRoleUI();
      this.loadData();
    });

    ['loginUsername', 'loginPassword'].forEach(id => {
      document.getElementById(id)?.addEventListener('keydown', e => {
        if (e.key === 'Enter') this.login();
      });
    });

    // Esc = ออกจากแผนที่เต็มจอ
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && document.getElementById('mapCard')?.classList.contains('map-fs'))
        this.toggleMapFullscreen();
    });
  },

  async login() {
    const user = document.getElementById('loginUsername').value.trim();
    const pass = document.getElementById('loginPassword').value;
    const errEl = document.getElementById('loginError');
    const btn   = document.getElementById('loginBtn');
    errEl.style.display = 'none';
    if (!user || !pass) {
      errEl.textContent = 'กรุณากรอกอีเมลและรหัสผ่าน';
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

  logout() { ME = null; auth.signOut(); },

  // เปลี่ยนรหัสผ่านตัวเอง (ทำได้ทุกบทบาท)
  async changePassword() {
    const pw = prompt('ตั้งรหัสผ่านใหม่ (อย่างน้อย 8 ตัว)');
    if (pw === null) return;
    if (pw.length < 8) { alert('รหัสผ่านต้องยาวอย่างน้อย 8 ตัว'); return; }
    if (prompt('พิมพ์รหัสผ่านใหม่อีกครั้งเพื่อยืนยัน') !== pw) { alert('รหัสผ่านไม่ตรงกัน'); return; }
    try {
      await auth.currentUser.updatePassword(pw);
      alert('เปลี่ยนรหัสผ่านแล้ว');
    } catch (e) {
      alert(e.code === 'auth/requires-recent-login'
        ? 'เพื่อความปลอดภัย ต้องออกจากระบบแล้วเข้าใหม่ก่อนเปลี่ยนรหัสผ่าน'
        : 'เปลี่ยนไม่สำเร็จ: ' + e.message);
    }
  },

  // ลืมรหัสผ่าน — ส่งลิงก์ไปอีเมล (ใช้ได้เฉพาะบัญชีที่เป็นอีเมลจริง = staff)
  async forgotPassword() {
    const email = (document.getElementById('loginUsername').value || '').trim().toLowerCase();
    if (!email.includes('@')) {
      alert('กรอกอีเมลของคุณในช่องด้านบนก่อน\n\n(บัญชีผู้ดูแลที่ใช้ชื่อผู้ใช้ ส่งอีเมลไม่ได้ — ติดต่อผู้ดูแลระบบ)');
      return;
    }
    try {
      await auth.sendPasswordResetEmail(email);
      alert('ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่ ' + email + ' แล้ว\nถ้าไม่เจอ ให้ดูในกล่องจดหมายขยะ (spam)');
    } catch (e) { alert('ส่งไม่สำเร็จ: ' + e.message); }
  },

  async loadData() {
    this._showLoading('กำลังโหลดข้อมูล Home...');
    try {
      await loadCloudZones();   // โซนจากระบบ (ถ้าเคยอัปโหลดผ่าน import-zones)
      await loadRound();        // รอบเก็บข้อมูล — กรองข้อมูลเก่าออกจากรายงาน
      await loadSupNicks();     // ชื่อเล่นผู้ควบคุม (แสดงผลอย่างเดียว)
      households = await pullHouseholds();
      this._setStatus('โหลด Home แล้ว · กำลังโหลด Roadside...');
      stations   = await pullRoadside();
      const ivCnt = allInterviews().length;
      this._setStatus(`✓ ${households.length} ครัวเรือน · ${stations.length} จุดสำรวจ · ${ivCnt} สัมภาษณ์`
        + (isStaff() ? ' · เฉพาะทีมของคุณ' : '')
        + (ROUND.since ? ` · รอบ: ${ROUND.label || new Date(ROUND.since).toLocaleDateString('th-TH')}` : '')
        // เตือนให้เห็นชัดว่ายังใช้ทางถอยอยู่ — ที่ปริมาณงานจริงทางถอยจะช้าจนใช้ไม่ได้
        + (PULL_MODE === 'slow' ? ' · ⚠️ โหลดแบบเดิม (ยังไม่เปิด collection group ใน rules)' : '')
        // ข้อมูลผีไม่ขึ้นที่ไหนเลยถ้าไม่บอกตรงนี้
        + (ORPHAN_IV ? ` · 👻 พบข้อมูลผี ${ORPHAN_IV} ราย (จุดสำรวจถูกลบแล้ว)` : ''));
      resetODCache();                 // ข้อมูลชุดใหม่ → ต้องหาโซนใหม่
      const imEl = document.getElementById('odInternalMax');
      if (imEl && !imEl.value) imEl.value = ZONE_INTERNAL_MAX;
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
    renderODMatrix(this._odSrc, this._odLevel, this._odOnlyActive);
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
        fitMapToZones(); // ครั้งแรกที่แผนที่มองเห็นจริง — default view รอบ shp
      }, 100);
    }
  },

  // ── ตารางบ้านรายโซน ──
  setZoneSort(mode) {
    _zoneSort = mode;
    ['zone', 'count'].forEach(m =>
      document.getElementById('zoneSort' + m)?.classList.toggle('active', m === mode));
    renderHomeZoneTable();
  },
  toggleZoneEmpty(on) { _zoneOnlyEmpty = !!on; renderHomeZoneTable(); },
  filterZoneTable() { renderHomeZoneTable(); },

  filterTable(tableId, q) {
    const query = (q || '').trim().toLowerCase();
    document.querySelectorAll('#' + tableId + ' tbody tr').forEach(tr => {
      const name = tr.getAttribute('data-name') || '';
      tr.style.display = (!query || name.includes(query)) ? '' : 'none';
    });
  },

  // สลับระดับตาราง OD — กลุ่ม (อปท./จังหวัด) หรือ ทีละโซน
  setODLevel(level) {
    this._odLevel = level;
    ['group', 'zone'].forEach(l =>
      document.getElementById('odLevel' + l[0].toUpperCase() + l.slice(1))
        ?.classList.toggle('active', l === level));
    renderODMatrix(this._odSrc, level, this._odOnlyActive);
  },

  setODOnlyActive(on) {
    this._odOnlyActive = !!on;
    renderODMatrix(this._odSrc, this._odLevel, this._odOnlyActive);
  },

  // เส้นแบ่ง "ในพื้นที่ / นอกพื้นที่" — เก็บคู่กับชุดโซนใน config/zones
  // เขียนได้เฉพาะผู้ดูแล (rules) · ผู้ควบคุมกดแล้วจะขึ้นว่าไม่มีสิทธิ์
  async saveInternalMax() {
    const el  = document.getElementById('odInternalMax');
    const msg = document.getElementById('odInternalMsg');
    const v   = parseInt(el?.value, 10);
    if (!(v > 0)) { if (msg) { msg.textContent = 'ใส่เลขโซนที่มากกว่า 0'; msg.style.color = '#ef4444'; } return; }
    if (msg) { msg.textContent = 'กำลังบันทึก...'; msg.style.color = 'var(--muted)'; }
    try {
      await db.collection('config').doc('zones').set({ internalMax: v }, { merge: true });
      ZONE_INTERNAL_MAX = v;
      if (msg) { msg.textContent = `✓ โซน 1–${v} = ในพื้นที่`; msg.style.color = '#22c55e'; }
      this._renderAll();
    } catch (e) {
      if (msg) {
        msg.textContent = e.code === 'permission-denied'
          ? 'เฉพาะผู้ดูแลระบบเท่านั้นที่ตั้งค่านี้ได้' : 'บันทึกไม่สำเร็จ: ' + (e.message || '');
        msg.style.color = '#ef4444';
      }
    }
  },

  setODSource(src) {
    this._odSrc = src;
    ['home','roadside','all'].forEach(s => {
      const btn = document.getElementById('odToggle' + s[0].toUpperCase() + s.slice(1));
      btn?.classList.toggle('active', s === src);
    });
    renderODMatrix(src, this._odLevel, this._odOnlyActive);
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

  // ขยาย/ย่อแผนที่เต็มจอ — Esc ก็ย่อได้
  toggleMapFullscreen() {
    const card = document.getElementById('mapCard');
    if (!card) return;
    const on = card.classList.toggle('map-fs');
    const btn = document.getElementById('mapFsBtn');
    if (btn) { btn.textContent = on ? '✕ ย่อ' : '⛶ เต็มจอ'; btn.classList.toggle('active', on); }
    document.body.style.overflow = on ? 'hidden' : '';
    // ให้ Leaflet คำนวณขนาดใหม่หลัง layout เปลี่ยน
    setTimeout(() => { if (leafletMap) leafletMap.invalidateSize(); }, 80);
  },

  setMapMode(mode) {
    this._mapMode = mode;
    document.getElementById('mapToggleDesire')?.classList.toggle('active', mode === 'desire');
    document.getElementById('mapToggleChoropleth')?.classList.toggle('active', mode === 'choropleth');
    document.getElementById('mapToggleRaw')?.classList.toggle('active', mode === 'raw');
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
