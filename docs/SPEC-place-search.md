# SPEC: Self-Growing Place Search — Banphai Survey

> Handoff สำหรับ session ใหม่ · เขียน 2026-06-06
> งาน: ระบบค้นหาสถานที่ multi-provider + auto-learn database

---

## 🎯 เป้าหมาย

ระบบค้นหาสถานที่สำหรับช่องต้นทาง/ปลายทาง ที่:
1. ค้น Local DB (Firestore) ก่อน → เร็ว ฟรี
2. ไม่เจอ → Longdo Search
3. ไม่เจอ → Google Places (เตรียม slot ปิดไว้)
4. ผู้ใช้เลือกผล → ปักหมุด → ลากแก้ได้ → กดยืนยัน
5. **ตอนกดยืนยัน → auto-save เข้า Local DB** (shared ทุก surveyor)
   → ครั้งหน้าใครค้นคำเดิมเจอใน Local ทันที (ยิ่งใช้ยิ่งฉลาด)

---

## ✅ ข้อตกลงที่ confirm แล้ว

| # | ประเด็น | ตกลง |
|---|---|---|
| 1 | Local DB เก็บที่ไหน | **Firestore collection `places`** — shared ทุกคน หาครั้งเดียวทุกคนเจอ |
| 2 | Longdo POI | ใช้ key เดิม `4ffd5bcaa8a5941163c24dbe2a4401e8` · free tier พอ (Local cache ลดการเรียก) · เจ้าของมีบัญชี Longdo |
| 3 | Auto-save ตอนไหน | **ตอนกดยืนยัน** (ได้พิกัดสุดท้ายหลังลากหมุด) |
| - | Tile แผนที่ | **คง Leaflet + OSM** (ดีพอ ฟรี) — เปลี่ยนแค่ search engine |
| - | ลากหมุด | ต้องมี (เผื่อแก้ แม้ปกติ surveyor ไม่ค่อยลาก) |

---

## 📂 สถานะระบบปัจจุบัน (วิเคราะห์แล้ว)

- **Stack:** Vanilla JS · Firebase Firestore · localStorage · GitHub Pages
- **Repo:** github.com/ITSMINIMIZE/banphai-survey
- **Live:** https://itsminimize.github.io/banphai-survey/
- **2 แอป:** Home (ครัวเรือน) · Roadside (ริมทาง OD)

### Map ปัจจุบัน
```
Roadside/js/map-leaflet.js  (220)  ← ACTIVE (Leaflet+OSM tile, Nominatim search)
Roadside/js/map.js          (313)  ← Longdo backup (ใน comment block B ของ index.html)
Home/js/map-leaflet.js      (220)  ← ACTIVE
Home/js/map.js              (310)  ← Longdo backup
```

### Interface กลาง (ห้ามเปลี่ยน signature)
```js
MapPicker.open(currentCoords, (coords, name) => { ... })
// coords = "16.0612, 102.7340"  ·  name = "ชื่อสถานที่"
```
- เรียกจาก Roadside wizard step 4-5 + Home trip form
- ทั้ง Longdo และ Leaflet ใช้ interface นี้เหมือนกัน → สลับได้ไม่แตะ app.js

### ปัญหาปัจจุบัน
- **Nominatim ค้นสถานที่ไทย/ชนบทบ้านไผ่ไม่เจอ** → ต้นเหตุที่ต้องทำงานนี้
- ไม่มี Local place DB (มีแค่ `OPT.locationType` = ประเภท 11 แบบ ไม่ใช่ชื่อจริง)

### _reverseGeocode (GPS button)
- `Roadside/js/app.js` + `Home/js/app.js` ใช้ Nominatim reverse → fill ตำบล/อำเภอ/จังหวัด
- คงไว้ได้ ไม่เกี่ยวกับงานนี้โดยตรง

---

## 🏗️ สิ่งที่ต้องสร้าง

### 1. Firestore Schema — collection `places`
```js
{
  id: 'PL-{timestamp}',
  place_name: 'โรงพยาบาลบ้านไผ่',
  name_lower: 'โรงพยาบาลบ้านไผ่',     // lowercase สำหรับ match
  keywords: ['รพ บ้านไผ่','hospital banphai'], // optional alias
  latitude: 16.0612,
  longitude: 102.7340,
  source: 'longdo',          // local | longdo | google | manual
  confidence: 0.9,           // local=1.0, longdo=0.9, google=0.95, manual=1.0
  user_adjusted: false,      // ลากหมุดแก้ → true
  use_count: 1,              // ยอดถูกเลือก (popularity → ranking + dedupe)
  created_at: '2026-06-06T...',
  created_by: 'สมชาย ใจดี',
  updated_at: '2026-06-06T...'
}
```

### 2. Firestore Rules — เพิ่ม block `places`
```
match /places/{placeId} {
  allow read: if true;
  allow create, update: if true;   // auto-learn ต้อง write ได้โดยไม่ login
  allow delete: if false;          // ลบผ่าน Firebase Console เท่านั้น
}
```
⚠️ ผู้ใช้ต้อง publish rules นี้เพิ่มเองใน Firebase Console ก่อนทดสอบ

### 3. ไฟล์ใหม่: `js/place-service.js` (ทำ 1 ชุด แล้ว copy ไป 2 แอป)
```js
const PlaceService = {
  _cache: [],            // localStorage cache ของ places (ลด Firestore read)
  CACHE_KEY: 'bp_places_cache',
  CACHE_TTL: 30*60*1000, // 30 นาที refresh

  // โหลด places จาก Firestore → cache (เรียกตอน init / TTL หมด)
  async loadCache() { ... },

  // ===== SEARCH ORCHESTRATOR =====
  // คืน [{place_name, latitude, longitude, source, confidence}]
  async search(query) {
    // [1] Local (จาก _cache — substring/keyword match, เรียง use_count)
    const local = this._searchLocal(query);
    if (local.length) return local;        // เจอ → จบ ไม่เรียก API

    // [2] Longdo POI search
    const longdo = await this._searchLongdo(query);
    if (longdo.length) return longdo;

    // [3] Google Places (slot เตรียมไว้ — return [] ตอนนี้)
    // const google = await this._searchGoogle(query);
    // if (google.length) return google;

    // [4] fallback Nominatim (ของเดิม — กันไม่มีอะไรเลย)
    return await this._searchNominatim(query);
  },

  _searchLocal(q) { ... },     // filter _cache
  async _searchLongdo(q) {     // https://search.longdo.com/mapsearch/json/search?keyword=...&key=...
    // endpoint POI: https://api.longdo.com/POI/json/search?... (เช็ค endpoint จริง)
  },
  async _searchGoogle(q) { return []; },  // STUB — เตรียม Google Places ภายหลัง
  async _searchNominatim(q) { ... },      // ของเดิม

  // ===== AUTO-LEARN =====
  // เรียกตอนกดยืนยันหมุด — upsert เข้า Firestore places
  async savePlace({ place_name, latitude, longitude, source, user_adjusted, created_by }) {
    // 1) หา place เดิมที่ name_lower ตรง + พิกัดใกล้ (<150m) → ถ้ามี: use_count++ , update
    // 2) ไม่มี → create ใหม่ (id=PL-timestamp, confidence ตาม source)
    // 3) อัปเดต _cache ทันที (ครั้งหน้าเจอเลยโดยไม่รอ Firestore)
    // ถ้า source='local' (เลือกจาก local อยู่แล้ว) → แค่ use_count++
  }
};
```

**Longdo POI endpoint หมายเหตุ:**
- ลองใช้: `https://api.longdo.com/POI/json/search?keyword={q}&key={KEY}&limit=10&span=50km&lon=102.7313&lat=16.0590`
- หรือ map.js เดิมมี `_search()` ที่เรียก Longdo อยู่แล้ว (บรรทัด ~243-272) — ดู pattern จากตรงนั้น
- ระวัง CORS — ถ้าโดนบล็อก ต้องหา endpoint ที่ browser เรียกได้ หรือใช้ JSONP แบบ map.js เดิม

### 4. แก้ `map-leaflet.js` — `_search()` ให้เรียก PlaceService
- เปลี่ยนจากเรียก Nominatim ตรงๆ → `PlaceService.search(q)`
- แสดง badge source ในผลลัพธ์ (📍local / 🔍longdo / 🌐google) ให้รู้ที่มา
- `confirm()` → เรียก `PlaceService.savePlace(...)` ก่อน callback (auto-learn)
- ส่ง `created_by` = App._surveyorName || App._adminUsername

### 5. index.html ทั้ง 2 แอป — เพิ่ม `<script src="js/place-service.js">` ก่อน map-leaflet.js
- bump SW CACHE_VERSION (ri-v6 / hi-v6) + เพิ่ม place-service.js ใน CORE_ASSETS

---

## 🧪 Prototype ทดสอบแยก (ทำก่อน integrate)

สร้าง `tools/test-place-search.html` (standalone):
- ช่องค้นหา + ปุ่มค้น
- เรียก PlaceService.search() แสดงผล + badge source
- Leaflet map + click/drag หมุด
- แสดง lat/lon ที่แก้แล้ว
- ปุ่ม "ยืนยัน (จำลอง save)" → เรียก savePlace → log ผล
- ใส่ tools gate (password adminbanphai) เหมือน seed tools

→ ทดสอบ flow ครบโดยไม่แตะ production จนกว่าจะชัวร์

---

## ⚠️ ข้อห้าม / ความเสี่ยง

1. **ห้ามลบ** `map.js` (Longdo backup) · **ห้ามแตะ** signature `MapPicker.open()`
2. **ห้าม refactor** app.js ส่วนที่ไม่เกี่ยว
3. **ห้ามเพิ่ม library** นอกจาก Leaflet (มีแล้ว) — ทุกอย่าง vanilla JS
4. **CORS Longdo** — ถ้า browser เรียก POI API ตรงไม่ได้ ต้องดู pattern JSONP จาก map.js เดิม หรือ fallback Nominatim
5. **Firestore read cost** — ต้อง cache places ใน localStorage (TTL 30 นาที) ไม่ใช่ query ทุกครั้งที่พิมพ์
6. **Dedupe** — savePlace ต้องเช็คชื่อซ้ำ+พิกัดใกล้ ก่อน create ใหม่ (กัน DB รก)
7. **Backward compat** — interview เดิมเก็บแค่ coords+name · เพิ่ม field ใหม่ที่ระดับ places collection แยก ไม่กระทบ schema เดิม
8. Roadside ธีมส้ม #d97706 · Home ธีมน้ำเงิน #2563eb (badge/ปุ่มใน prototype ให้ตรงธีม)

---

## 📋 ลำดับงานแนะนำ

1. อ่าน `map-leaflet.js` + `map.js` (ดู _search เดิม) ให้เข้าใจ pattern
2. เขียน `place-service.js` (Local + Longdo + Nominatim fallback + savePlace)
3. สร้าง `tools/test-place-search.html` → ทดสอบ search + autolearn ครบ
4. ทดสอบ Longdo POI ว่าเรียกผ่าน browser ได้ไหม (CORS?)
5. ถ้าผ่าน → integrate เข้า map-leaflet.js (2 แอป)
6. เพิ่ม Firestore rules `places` (แจ้งผู้ใช้ publish)
7. bump SW version + เพิ่ม place-service.js ใน cache
8. ทดสอบ E2E จริงในแอป → commit + push

---

## 🔮 แผน Google Places อนาคต (เตรียม slot)

- `PlaceService._searchGoogle(q)` ตอนนี้ return [] (stub)
- เปิดใช้: ใส่ Google Maps API key + เปิด Places API ใน Google Cloud
- endpoint: Places Text Search / Autocomplete
- เพิ่มใน orchestrator ระหว่าง Longdo กับ Nominatim
- source='google', confidence=0.95
- ต้องผูก billing (free $200/mo ≈ 11,000 text searches) — Local cache ลดการเรียกมาก

---

## 🔑 ข้อมูลอ้างอิง

- Firebase project: `banphai-survey`
- Longdo key: `4ffd5bcaa8a5941163c24dbe2a4401e8`
- บ้านไผ่ center: lat 16.0590, lon 102.7313
- Tools password: `adminbanphai`
- Surveyor name: `App._surveyorName` · Admin: `App._adminUsername`
- Roadside collection: `roadside_stations/{id}/interviews/{id}`
- Home collection: `households/{id}/members/{id}/trips/{id}`
- เก็บ map provider สลับได้: index.html comment block A (Leaflet) / B (Longdo)
