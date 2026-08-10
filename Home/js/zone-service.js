// ===== ZONE SERVICE =====
// ดึงโซนจากระบบ (Firestore: config/zones ที่อัปโหลดผ่าน tools/import-zones.html)
// แล้วจับพิกัด lat,lon เข้าโซนด้วย point-in-polygon — ใช้ตอน Export Excel
const ZoneService = {
  _features: null,   // cache ต่อ session

  // โหลดโซนจากระบบ (ครั้งเดียว แล้ว cache)
  async load() {
    if (this._features) return this._features;
    if (!FB.db) FB.init();
    if (!FB.db) throw new Error('Firebase ไม่พร้อม');
    const meta = await FB.db.collection('config').doc('zones').get();
    if (!meta.exists || !(meta.data().chunks > 0))
      throw new Error('ยังไม่มีข้อมูลโซนในระบบ (อัปโหลดผ่าน tools → Import Zones)');
    const n = meta.data().chunks;
    const docs = await Promise.all(
      Array.from({ length: n }, (_, i) => FB.db.collection('config').doc('zones_c' + i).get())
    );
    if (docs.some(d => !d.exists)) throw new Error('ข้อมูลโซนในระบบไม่ครบชุด');
    const gj = JSON.parse(docs.map(d => d.data().data).join(''));
    this._features = gj.features || [];
    return this._features;
  },

  // ray casting — ring เป็น GeoJSON [lon,lat]
  _inRing(lat, lon, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi))
        inside = !inside;
    }
    return inside;
  },

  // กรอบสี่เหลี่ยมที่ครอบรูปนั้นพอดี — คิดครั้งเดียวต่อรูป แล้วเก็บไว้กับตัว feature
  // ไฟล์โซนมี 232 รูป จุดยอดรวม ~758,000 จุด ถ้าไล่จุดยอดทุกรูปต่อ 1 พิกัด
  // การ export ข้อมูลเต็มจะใช้เวลาหลายนาทีและหน้าจอค้าง
  _bbox(f) {
    if (f.__bb) return f.__bb;
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    const scan = ring => ring.forEach(([lon, lat]) => {
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
    });
    const g = f.geometry;
    if (g && g.type === 'Polygon') g.coordinates.forEach(scan);
    else if (g && g.type === 'MultiPolygon') g.coordinates.forEach(p => p.forEach(scan));
    return (f.__bb = { minLat, maxLat, minLon, maxLon });
  },

  _inFeature(lat, lon, f) {
    const g = f.geometry;
    if (!g) return false;
    // อยู่นอกกรอบ = อยู่นอกรูปแน่นอน ข้ามได้โดยไม่ต้องไล่จุดยอด (231 จาก 232 รูปเข้าทางนี้)
    const b = this._bbox(f);
    if (lat < b.minLat || lat > b.maxLat || lon < b.minLon || lon > b.maxLon) return false;
    if (g.type === 'Polygon') return this._inRing(lat, lon, g.coordinates[0]);
    if (g.type === 'MultiPolygon') return g.coordinates.some(p => this._inRing(lat, lon, p[0]));
    return false;
  },

  // จำผลการหาโซนต่อพิกัด — ข้อมูลจริงมีพิกัดซ้ำเยอะ (บ้านเดียวกัน จุดสำรวจเดียวกัน)
  _memo: new Map(),

  // "16.05, 102.73" → เลขโซน (number เช่น 108) | "(นอกพื้นที่)" | "(ไม่มีพิกัด)"
  // ถ้ายังไม่ได้ load() สำเร็จ → คืน '' (คอลัมน์ว่าง)
  assign(coordStr) {
    if (!this._features) return '';
    const p = String(coordStr || '').split(',').map(s => parseFloat(s.trim()));
    if (p.length !== 2 || isNaN(p[0]) || isNaN(p[1])) return '(ไม่มีพิกัด)';
    const key = p[0] + ',' + p[1];
    if (this._memo.has(key)) return this._memo.get(key);
    const hit = this._find(p[0], p[1]);
    this._memo.set(key, hit);
    return hit;
  },

  _find(lat, lon) {
    for (const f of this._features) {
      if (this._inFeature(lat, lon, f)) {
        const pr = f.properties || {};
        const n = +pr.N;
        return isNaN(n) ? (pr.name || 'ไม่ระบุ') : n;   // เลขล้วน — Excel มองเป็น number
      }
    }
    return '(นอกพื้นที่)';
  }
};
