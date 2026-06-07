# HANDOFF — Banphai Survey (place search + optimization)

> ส่งต่อให้ session ใหม่ · อัปเดต 2026-06-07
> งานที่ทำเสร็จ: ระบบค้นหาสถานที่ multi-provider + auto-learn + optimize สำหรับ 40-100 คนพร้อมกัน

---

## 1. ภาพรวมระบบ
- **Stack:** Vanilla JS · Firebase (Firestore + Auth) · localStorage · PWA (Service Worker)
- **Hosting:** GitHub Pages (static) — `https://itsminimize.github.io/banphai-survey/`
- **Repo:** github.com/ITSMINIMIZE/banphai-survey · branch `main` (deploy = push main)
- **2 แอป:** `Roadside/` (ธีมส้ม #d97706 · สัมภาษณ์ริมทาง OD) · `Home/` (ธีมน้ำเงิน #2563eb · ครัวเรือน)
- **Dashboard/** = การ์ด "เร็วๆ นี้" ในหน้าแรก (ยังไม่ทำ · ไม่ลิงก์)
- **ไม่มี backend server ของเราเอง** — แอป static คุยตรงกับ Firebase + Longdo/Google API จากเบราว์เซอร์

### โหลดที่คาดไว้ (งานจริง)
- Roadside: ~50-60 คนพร้อมกัน · ~100 คัน/คน/วัน · 1-3 วัน
- Home: ~100 คนพร้อมกัน · ~15 บ้าน/คน/วัน · 2 วัน
- ทุกคนทำพร้อมกัน (concurrency สูง)

---

## 2. ไฟล์สำคัญ
```
{Roadside,Home}/js/place-service.js   ← เหมือนกันเป๊ะทั้ง 2 (cp ไป Home) · search + auto-learn + config + cache
{Roadside,Home}/js/map-leaflet.js     ← MapPicker · ต่างกันแค่ธีม (ACCENT/HOVER/comment บรรทัด 1)
{Roadside,Home}/js/app.js             ← แอปหลัก · _reverseGeocode/_useGPS/_openIvMap/_openHhMap/ฟอร์ม
{Roadside,Home}/js/firebase.js        ← FB sync (syncAll/pull)
{Roadside,Home}/js/data.js            ← OPT (ประเภท/วัตถุประสงค์ ฯลฯ)
{Roadside,Home}/{index.html,sw.js,manifest.json,css/}
index.html (root)                     ← เมนู + ไอคอน ⚙ มุมล่างขวา → tools/
tools/index.html                      ← รายการเครื่องมือ (gate รหัส adminbanphai)
tools/config.html                     ← admin แก้ API key (login) → Firestore config/app
tools/seed-places.html                ← pre-seed สถานที่ (Excel import)
tools/seed-roadside.html, seed-home.html, cleanup-seed.html
```
**แก้ไฟล์คู่:** place-service → `cp Roadside/js/place-service.js Home/js/place-service.js`
map-leaflet → แก้ Roadside แล้ว:
```
sed -e 's/Roadside theme ส้ม/Home theme น้ำเงิน/' -e "s/ACCENT: '#d97706'/ACCENT: '#2563eb'/" \
    -e "s/HOVER:  '#fef3c7'/HOVER:  '#dbeafe'/" -e 's/ธีมส้ม/ธีมน้ำเงิน/' \
    Roadside/js/map-leaflet.js > Home/js/map-leaflet.js
```
**ทุกครั้งที่แก้ JS แอป → bump `CACHE_VERSION` ใน sw.js ทั้ง 2** (ปัจจุบัน `ri-v13-delta` / `hi-v13-delta`)

---

## 3. PlaceService (หัวใจระบบค้นหา) — `place-service.js`
**ค้นหาแบบ staged (ประหยัด API):**
- `searchLocal(q)` → ค้นใน cache เท่านั้น (พิมพ์สด · ไม่ยิง API)
- `searchLongdo(q)` → local + Longdo รวมกัน (กดปุ่ม "ค้นหา"/Enter)
- `searchGoogle(q)` → Google เท่านั้น (กดปุ่ม "🌐 ค้นเพิ่มใน Google" — เรียกเมื่อ Longdo ไม่เจอที่ต้องการ)
- **เลิกใช้ Nominatim ทั้งระบบ** (ติด throttle 1req/s)

**Auto-learn:** `savePlace({place_name,latitude,longitude,source,user_adjusted,created_by})`
- เรียกตอน MapPicker.confirm() → upsert เข้า Firestore `places` (shared ทุกคน)
- dedupe: ชื่อตรง (name_lower) + พิกัดใกล้ <150m → use_count++ · ไม่งั้น create ใหม่ (id=PL-ts)
- อัปเดต `_cache` ในเครื่องทันที (คนเพิ่มเห็นเลย)

**Cache (delta-sync + safety net) — `loadCache()`:**
- เปิดแอป/cache ว่าง (ไม่มี localStorage) → **full read** (snapshot ครบ = safety net)
- หลังจากนั้นทุก 15 นาที (CACHE_TTL) → **delta**: `where('updated_at','>', lastSync - 30min)` อ่านเฉพาะของใหม่
- error/offline → คง cache เดิม (search ไม่พัง) · localStorage เก็บ cache + lastSync (เครื่องเคยเปิด → reload เป็น delta ไม่ใช่ full)
- → read โตตาม "ของใหม่" ไม่ใช่ขนาดทั้งหมด · base ที่ pre-seed ไม่ถูกอ่านซ้ำ

**API key (`loadConfig()`):**
- ฝังในโค้ด: `LONGDO_KEY='4ffd5bcaa8a5941163c24dbe2a4401e8'`, `GOOGLE_KEY='AIzaSyAJzTlYmUTDCspYgcZ3ceebnAHeaHhbe0w'`
- override ได้จาก Firestore `config/app` (อ่าน **ครั้งเดียว/เซสชัน**) — แก้ผ่าน tools/config.html
- Google = Places API (New) `places.googleapis.com/v1/places:searchText` (CORS ได้) · referrer-restricted (itsminimize.github.io/* + localhost:5500/*) + Places API (New) เท่านั้น

---

## 4. MapPicker — `map-leaflet.js`
- **Signature เดิม ห้ามเปลี่ยน:** `MapPicker.open(currentCoords, (coords, name) => {})`
- **Lazy-load แผนที่:** เปิด picker → เห็นช่องค้นหา + ผลลัพธ์ (ยังไม่โหลด tiles) · แผนที่ render เฉพาะตอนกด "เปิดแผนที่/ปักหมุดเอง" / "ดู-ปรับบนแผนที่" (หลังเลือกผล) / "เพิ่มสถานที่ใหม่" → `_openMapView()`
- เลือกผลค้นหา → ได้พิกัดเลย ยืนยันได้โดยไม่ต้องเปิดแผนที่ (ส่วนใหญ่ = 0 tiles)
- tiles = **OSM** (`tile.openstreetmap.org`) — เก็บแยกจาก Longdo (ไม่แย่ง 60/นาที กับ search)
- default view = ประเทศไทย (13.5, 100.9 zoom 5) + ลอง GPS พื้นหลังเงียบๆ · MARKER_ZOOM=16
- confirm() → savePlace (best-effort) ก่อน callback · created_by = App._role==='admin'? _adminUsername : _surveyorName

---

## 5. app.js — GPS / reverse / map buttons
- `_reverseGeocode(lat,lon)` → **Longdo address API** (`api.longdo.com/map/services/address`) เติม ตำบล/อำเภอ/จังหวัด (ตัด prefix ต./อ./จ.) · Home=m_*, Roadside=s_* (station)
- `_useGPS(coordsId)` → high-accuracy ก่อน, timeout/หาไม่เจอ → retry แบบผ่อนปรน (ha:false, 20s, ใช้ค่าล่าสุด) · error message ตรงสาเหตุ (บล็อก/ปิด GPS/timeout)
- ปุ่มแผนที่ในฟอร์ม: Roadside `_openStationMap`(station) + `_openIvMap`(ต้น/ปลายทาง interview) · Home `_openHhMap`(ครัวเรือน) + `_openMap`(trip dest)
- reverse ใช้ตอนสำรวจจริง: **Home ครัวเรือน** (เยอะ) · Roadside แค่ตอน admin ตั้ง station (ไม่กระทบ concurrency)

---

## 6. Firestore
**Collections:** `households/{}/members/{}/trips/{}` · `roadside_stations/{}/interviews/{}` · `places/{}` · `config/{}`

**Rules (✅ publish แล้วใน Console — ใช้งานอยู่):**
```
rules_version='2';
service cloud.firestore { match /databases/{database}/documents {
  function isSeed(id){ return id.matches('.*SEED.*'); }
  match /households/{hhId} {
    allow read:if true; allow create,update:if true; allow delete:if isSeed(hhId);
    match /members/{mId} {
      allow read:if true; allow create,update:if true; allow delete:if isSeed(hhId)||isSeed(mId);
      match /trips/{tId} { allow read:if true; allow create,update:if true; allow delete:if isSeed(hhId)||isSeed(mId)||isSeed(tId); }
    }
  }
  match /roadside_stations/{stId} {
    allow read:if true; allow create,update:if true; allow delete:if isSeed(stId);
    match /interviews/{ivId} { allow read:if true; allow create,update:if true; allow delete:if isSeed(stId)||isSeed(ivId); }
  }
  match /places/{placeId} { allow read:if true; allow create,update:if true; allow delete:if false; }
  match /config/{docId} { allow read:if true; allow write:if request.auth!=null; }
}}
```
(delete = เฉพาะ doc ที่ id มี "SEED" → tools/cleanup-seed ลบ test ได้โดยไม่ต้องแก้ rule · config เขียนเฉพาะ admin login)

**places schema:** `{id, place_name, name_lower, keywords[], latitude, longitude, source, confidence, user_adjusted, use_count, created_at, created_by, updated_at}`
**config/app:** `{google_places_key, longdo_key, updated_at, updated_by}` (ว่าง = ใช้ key ในโค้ด)

**Firebase config:** apiKey `AIzaSyA_f0UniGXeSRRn4VjD-56Gp9Xb0M-I8kQ` · project `banphai-survey` · EMAIL_DOMAIN `@banphai.local`

---

## 7. Quota / scale (จัดการแล้ว)
- **Firestore:** ไป Blaze (ถูกมาก ~$1-3 สำหรับงานนี้) · delta-sync ทำให้ read โตตามของใหม่ · **ต้องตั้ง budget alert**
- **Longdo free:** service 100k/เดือน · **60 req/นาที + 5,000 req/วัน** (ตัวบีบ) · tiles 800k (ไม่ใช้ — เราใช้ OSM)
  → staged search + pre-seed (warm cache) ทำให้อยู่ใต้ limit
- **Google Places:** จ่ายตามใช้ · เรียกเฉพาะกด "ค้นเพิ่ม" → ถูกมาก · referrer-locked
- **OSM tiles:** lazy-load → โหลดน้อยลงมาก (เปิดแผนที่เฉพาะเมื่อจำเป็น)
- **GitHub Pages:** static CDN + SW cache → รับ concurrency สบาย ไม่ใช่คอขวด

---

## 8. Tools (gate รหัส: `adminbanphai`)
- **config.html** — admin login แก้ Longdo/Google key (เก็บ config/app = มีผลทั้งระบบ ตอนเปิดแอปใหม่)
- **seed-places.html** — pre-seed สถานที่ก่อนสำรวจ:
  - นำเข้า .xlsx/.csv (SheetJS) · 4 คอลัมน์ (header row): `place_name, latitude, longitude, keywords`(optional) · map ตามชื่อหัว สลับลำดับได้
  - ปุ่มดาวน์โหลด template · พิมพ์เองในกล่องก็ได้
  - ซ้ำ (ชื่อ+ใกล้<150m) = **merge** (คง use_count · รวม keywords · ไม่งอก) · **สลับ lat/lon ให้อัตโนมัติ** (ช่วงไทย lat5-21/lon96-106) · พิกัดนอกไทย = ข้าม
- **cleanup-seed.html** — ลบ doc ที่ id มี SEED (ใช้ rule ใหม่ได้เลย ไม่ต้องแก้ชั่วคราว)
- **seed-roadside/home.html** — สร้าง test data

---

## 9. TODO ฝั่งผู้ใช้
✅ Publish Firestore rules (ข้อ 6) — **ทำแล้ว (ใช้งานอยู่)** · ✅ ลบ test docs เก่า — **ทำแล้ว**

เหลือก่อนสำรวจจริง:
1. **Pre-seed places** สถานที่ยอดฮิตในพื้นที่ (⚙ → Pre-seed Places) → warm cache ลดยิง Longdo/Google
2. **Flip Blaze + ตั้ง budget alert** (กันเงินบานปลาย)

---

## 10. ข้อห้าม / gotchas
- **ห้ามเปลี่ยน signature** `MapPicker.open(coords, cb(coords,name))` — app.js เรียกผ่านนี้
- place-service.js ต้องเหมือนกันเป๊ะ 2 แอป · map-leaflet ต่างแค่ธีม → ใช้ cp/sed (ข้อ 2)
- bump SW version ทุกครั้งที่แก้ JS แอป
- ทุก vanilla JS · ห้ามเพิ่ม lib นอกจาก Leaflet + SheetJS (tools) + Firebase (มีแล้ว)
- key ฝั่ง browser เปิดเผยได้เสมอ — กันด้วย referrer/API restriction ใน Google Cloud (ตั้งแล้ว)
- ทดสอบใน local: `npx serve -l 5500 INTERVIEW` แล้วเปิด `/Roadside/` หรือ `/Home/` (ต้องมี trailing slash) · tools ที่ `/tools/`

## 11. Log การตัดสินใจสำคัญ (ที่ผ่านมา)
- ค้นหา staged (ไม่ยิง Google ทุกครั้ง · พิมพ์ไม่ยิง API) — ประหยัด Longdo/Google
- reverse → Longdo (ไทยแม่น ได้ตำบล) แทน Nominatim (throttle)
- key ฝังโค้ด + override จาก config (ผู้ใช้เลือก "ฝังในโค้ด")
- places: delta-sync (ผู้ใช้กังวลซับซ้อน → ทำ safety net: full read ตอนเปิดแอป + error คง cache)
- lazy-load tiles (เก็บ OSM แยกจาก Longdo ไม่แย่ง rate limit)
- hosting: คง GitHub Pages (ไม่ย้าย Firebase Hosting)
