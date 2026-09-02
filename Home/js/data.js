// ===== DATA LAYER ===== (v2)

// ===== นาฬิกา: ใช้เวลาเซิร์ฟเวอร์เป็นหลัก =====
// createdAt เดิมมาจาก new Date() ของเครื่อง — เครื่องที่ตั้งเวลาผิดจะสแตมป์วันที่ผิดตามไป
// App._checkClock() วัดส่วนต่างจาก header ของเซิร์ฟเวอร์แล้วเก็บไว้ตรงนี้
// ทุกจุดที่ประทับเวลาจะหักส่วนต่างออก → ได้เวลาจริงแม้นาฬิกาเครื่องเพี้ยน
// ยังไม่เคยวัด (ออฟไลน์ตั้งแต่ต้น) → skew = 0 = ใช้เวลาเครื่องเหมือนเดิม ไม่พังกว่าเดิม
const CLOCK = {
  KEY: '_clock_skew_ms', KEY_AT: '_clock_synced_at',
  MAX_AGE: 60 * 60 * 1000,          // เทียบไว้เกิน 1 ชม. = เก่า ต้องวัดใหม่
  skew() { try { return +(localStorage.getItem(this.KEY) || 0) || 0; } catch { return 0; } },
  set(ms)  { try { localStorage.setItem(this.KEY, String(Math.round(ms)));
                   localStorage.setItem(this.KEY_AT, String(Date.now())); } catch {} },
  // อายุของค่าที่วัดไว้ — เทียบ Date.now() กับ Date.now() ด้วยกัน drift หักล้างกันเอง
  syncedAt() { try { return +(localStorage.getItem(this.KEY_AT) || 0) || 0; } catch { return 0; } },
  verified() { return this.syncedAt() > 0; },                          // เคยเทียบกับเซิร์ฟเวอร์แล้ว
  fresh()    { return this.verified() && Date.now() - this.syncedAt() < this.MAX_AGE; },
  now()    { return new Date(Date.now() - this.skew()); },
  nowISO() { return this.now().toISOString(); },
  // วันที่แบบเวลาท้องถิ่น (ไม่ใช่ UTC) — ของเดิมใช้ toISOString().split('T')[0]
  // ซึ่งงานช่วงตี 1–7 โมงเช้าจะได้วันที่ย้อนไป 1 วัน
  todayLocal() {
    const d = this.now();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
};

// ---- IndexedDB store: ที่เก็บหลักแทน localStorage (รับข้อมูลได้ระดับ GB) ----
// เก็บ _data ทั้งก้อนเป็น record เดียว ใน object store 'kv' คีย์ 'data'
const IDBStore = {
  DB_NAME: 'hi_survey_idb',
  STORE:   'kv',
  _dbp:    null,
  open() {
    if (this._dbp) return this._dbp;
    this._dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.STORE)) db.createObjectStore(this.STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
    return this._dbp;
  },
  async get(key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(this.STORE, 'readonly').objectStore(this.STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  },
  async set(key, val) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, 'readwrite');
      tx.objectStore(this.STORE).put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  },
  async del(key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, 'readwrite');
      tx.objectStore(this.STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  }
};

const DB = {
  KEY:     'hi_survey_v2',   // localStorage เดิม (ใช้ migrate ครั้งแรก + สำรอง sync ข้อมูลเล็ก)
  IDB_KEY: 'data',
  _data:   null,
  _ready:  false,

  // เรียกครั้งเดียวตอนเปิดแอป (async) — โหลดจาก IndexedDB; ครั้งแรก migrate จาก localStorage
  async init() {
    if (this._ready) return this._data;
    try {
      let data = await IDBStore.get(this.IDB_KEY);
      if (!data) {
        // ครั้งแรกหลังอัปเดต: ย้ายข้อมูลเดิม localStorage → IndexedDB (ไม่ลบ localStorage ทิ้ง เผื่อ rollback)
        const raw = localStorage.getItem(this.KEY);
        if (raw) { data = JSON.parse(raw); await IDBStore.set(this.IDB_KEY, data); }
      }
      this._data = data || { households: [] };
    } catch (e) {
      console.warn('[DB] IndexedDB init ล้มเหลว ใช้ localStorage แทน:', e);
      try { const raw = localStorage.getItem(this.KEY); this._data = raw ? JSON.parse(raw) : { households: [] }; }
      catch { this._data = { households: [] }; }
    }
    this._ready = true;
    return this._data;
  },

  load() {
    if (this._data) return this._data;
    // fallback (เผื่อ getter ถูกเรียกก่อน init เสร็จ) — อ่าน localStorage แบบ sync
    try {
      const raw = localStorage.getItem(this.KEY);
      this._data = raw ? JSON.parse(raw) : { households: [] };
    } catch { this._data = { households: [] }; }
    return this._data;
  },

  save() {
    // ที่เก็บหลัก = IndexedDB (async, background) — ไม่มีเพดาน 5MB
    IDBStore.set(this.IDB_KEY, this._data).catch(e => console.warn('[DB] IndexedDB save ล้มเหลว:', e));
    // สำรอง sync ลง localStorage เฉพาะข้อมูลไม่ใหญ่ (เครื่องผู้สำรวจ) — เต็มก็ข้าม IDB คือหลัก
    try { localStorage.setItem(this.KEY, JSON.stringify(this._data)); } catch {}
  },

  // แทนที่ข้อมูลทั้งก้อน (ใช้ตอน pull จาก cloud) — persist ลง IndexedDB
  async replaceAll(newData) {
    this._data = newData;
    this._ready = true;
    await IDBStore.set(this.IDB_KEY, newData);
    try { localStorage.setItem(this.KEY, JSON.stringify(newData)); } catch {}
  },

  // ล้างข้อมูลในเครื่อง (IndexedDB + localStorage เดิม)
  async clearAll() {
    this._data = { households: [] };
    try { await IDBStore.del(this.IDB_KEY); } catch {}
    try { localStorage.removeItem(this.KEY); } catch {}
  },

  // ===== HOUSEHOLDS =====
  // ===== SOFT DELETE (ถังขยะ) =====
  // _deleted:true = admin ลบออกจากระบบแล้ว — ซ่อนทุกที่ที่แสดงผล/นับ/export แต่ยังกู้คืนได้
  // ตัดออกทั้ง household, member, trip (ลบบ้าน = สมาชิก+เที่ยวข้างในหายตามไปด้วย)
  _pruneDeleted(hhs) {
    // fast path: ไม่มีอะไรถูกลบ → คืน array เดิม ไม่ต้อง copy (เรียกทุก render)
    const hasDeleted = hhs.some(h =>
      h._deleted ||
      (h.members || []).some(m => m._deleted || (m.trips || []).some(t => t._deleted))
    );
    if (!hasDeleted) return hhs;
    return hhs.filter(h => !h._deleted).map(h => ({
      ...h,
      members: (h.members || []).filter(m => !m._deleted).map(m => ({
        ...m,
        trips: (m.trips || []).filter(t => !t._deleted)
      }))
    }));
  },

  // ใช้แสดงผล/นับ/export — ไม่รวมที่ลบแล้ว
  getHouseholds() { return this._pruneDeleted(this.load().households); },
  // ใช้กับถังขยะ + sync (ต้องเห็นของที่ลบแล้วด้วย เพื่อส่ง flag ขึ้น cloud)
  getHouseholdsRaw() { return this.load().households; },
  // ⚠️ คืน reference จริง (ยังมีรายการที่ลบแล้ว) — ใช้กับการแก้ข้อมูล/ถังขยะเท่านั้น
  getHousehold(id) { return this.load().households.find(h => h.id === id) || null; },
  // ใช้ "แสดงผล" หน้าบ้าน — ตัดสมาชิก/เที่ยวที่ลบออกจากระบบแล้วออก
  getHouseholdView(id) {
    const hh = this.getHousehold(id);
    if (!hh) return null;
    const dirty = (hh.members || []).some(m => m._deleted || (m.trips || []).some(t => t._deleted));
    if (!dirty) return hh;   // fast path
    return { ...hh, members: hh.members.filter(m => !m._deleted)
      .map(m => ({ ...m, trips: (m.trips || []).filter(t => !t._deleted) })) };
  },
  // ใช้ "แสดงผล" หน้าสมาชิก — ตัดเที่ยวที่ลบออกจากระบบแล้วออก
  getMemberView(hhId, mid) {
    const m = this.getMember(hhId, mid);
    if (!m) return null;
    if (!(m.trips || []).some(t => t._deleted)) return m;   // fast path
    return { ...m, trips: m.trips.filter(t => !t._deleted) };
  },

  addHousehold(data) {
    const hh = {
      id: 'HH-' + Date.now(),
      surveyDate:      data.surveyDate      || CLOCK.todayLocal(),
      travelDate:      data.travelDate      || '',
      surveyorName:    data.surveyorName    || '',
      supervisorName:  data.supervisorName  || '',
      subdistrict:     data.subdistrict     || '',
      district:        data.district        || 'บ้านไผ่',
      province:        data.province        || 'ขอนแก่น',
      areaCode:        data.areaCode        || '',
      houseNo:         data.houseNo         || '',
      moo:             data.moo             || '',
      alley:           data.alley           || '',
      road:            data.road            || '',
      phone:           data.phone           || '',
      coordinates:     data.coordinates     || '',
      residentialType: data.residentialType || '',
      residentialTypeOther: data.residentialTypeOther || '',   // บังคับกรอกเมื่อเลือก 'อื่น ๆ'
      memberGrid:      data.memberGrid      || {},
      householdIncome: data.householdIncome || '',
      hasVehicle:      data.hasVehicle      || '',
      vehicles:        data.vehicles        || {},
      deviceId:        data.deviceId        || '',
      clientIp:        data.clientIp        || '',
      createdAt: CLOCK.nowISO(),
      // ยังไม่เคยเทียบเวลากับเซิร์ฟเวอร์ตอนสร้าง → ติดธงไว้ให้ตามหาได้ทีหลัง
      ...(CLOCK.verified() ? {} : { _clockUnverified: true }),
      members: []
    };
    this.load().households.push(hh);
    this.save();
    return hh;
  },

  // ประทับเวลาแก้ไขล่าสุดที่ระดับบ้าน — สมาชิก/เที่ยวเปลี่ยนก็ถือว่าบ้านถูกแก้
  // createdAt ไม่เคยถูกแตะ (เวลาที่ทำแบบสำรวจจริง) — ตัวนี้เป็นคนละตัวกัน
  _touch(hhId) {
    const hh = this.getHousehold(hhId);
    if (hh) { hh.updatedAt = CLOCK.nowISO(); this.save(); }
    return hh;
  },

  updateHousehold(id, data) {
    const hh = this.getHousehold(id);
    if (!hh) return null;
    // ไม่อัพเดต id, createdAt, members — createdAt ต้องคงเดิมตลอดอายุระเบียน
    const { id: _id, createdAt: _ca, updatedAt: _ua, members: _m, ...rest } = data;
    Object.assign(hh, rest);
    hh.updatedAt = CLOCK.nowISO();
    this.save();
    return hh;
  },

  deleteHousehold(id) {
    const d = this.load();
    d.households = d.households.filter(h => h.id !== id);
    this.save();
  },

  // ===== MEMBERS =====
  getMember(hhId, mid) {
    const hh = this.getHousehold(hhId);
    return hh ? hh.members.find(m => m.id === mid) || null : null;
  },

  addMember(hhId, data) {
    const hh = this.getHousehold(hhId);
    if (!hh) return null;
    const m = {
      id: 'M-' + Date.now(),
      seq: hh.members.length + 1,
      gender:               data.gender               || '',
      age:                  data.age                  || '',
      homeStatus:           data.homeStatus           || '',
      homeStatusOther:      data.homeStatusOther      || '',   // บังคับกรอกเมื่อเลือก 'อื่น ๆ'
      workStatus:           data.workStatus           || '',
      workStatusOther:      data.workStatusOther      || '',
      occupation:           data.occupation           || '',
      occupationOther:      data.occupationOther      || '',
      education:            data.education            || '',
      workplaceName:        data.workplaceName        || '',
      workplaceCoords:      data.workplaceCoords      || '',
      workplaceAlley:       data.workplaceAlley       || '',
      workplaceRoad:        data.workplaceRoad        || '',
      workplaceSubdistrict: data.workplaceSubdistrict || '',
      workplaceDistrict:    data.workplaceDistrict    || '',
      workplaceProvince:    data.workplaceProvince    || '',
      income:               data.income               || '',
      trips: []
    };
    hh.members.push(m);
    this._touch(hhId);
    return m;
  },

  updateMember(hhId, mid, data) {
    const m = this.getMember(hhId, mid);
    if (!m) return null;
    Object.assign(m, data);
    this._touch(hhId);
    return m;
  },

  deleteMember(hhId, mid) {
    const hh = this.getHousehold(hhId);
    if (!hh) return;
    hh.members = hh.members.filter(m => m.id !== mid);
    hh.members.forEach((m, i) => { m.seq = i + 1; });
    this._touch(hhId);
  },

  // ===== TRIPS =====
  addTrip(hhId, mid, data) {
    const m = this.getMember(hhId, mid);
    if (!m) return null;
    const trip = {
      id: 'T-' + Date.now(),
      seq: m.trips.length + 1,
      origin:            data.origin            || '',
      originCoords:      data.originCoords      || '',
      originType:        data.originType        || '',
      originTypeOther:   data.originTypeOther   || '',   // บังคับกรอกเมื่อเลือก 'อื่น ๆ'
      departureTime:     data.departureTime     || '',
      destination:       data.destination       || '',
      destinationCoords: data.destinationCoords || '',
      destinationType:   data.destinationType   || '',
      destinationTypeOther: data.destinationTypeOther || '',
      arrivalTime:       data.arrivalTime       || '',
      purpose:           data.purpose           || '',
      purposeOther:      data.purposeOther      || '',
      segments:          data.segments          || [{ mode:'', duration:'', fare:'' }],
      parkingLocation:   data.parkingLocation   || '',
      parkingFee:        data.parkingFee        || ''
    };
    m.trips.push(trip);
    this._touch(hhId);
    return trip;
  },

  updateTrip(hhId, mid, tripId, data) {
    const m = this.getMember(hhId, mid);
    if (!m) return null;
    const trip = m.trips.find(t => t.id === tripId);
    if (!trip) return null;
    Object.assign(trip, data);
    this._touch(hhId);
    return trip;
  },

  deleteTrip(hhId, mid, tripId) {
    const m = this.getMember(hhId, mid);
    if (!m) return;
    m.trips = m.trips.filter(t => t.id !== tripId);
    m.trips.forEach((t, i) => { t.seq = i + 1; });
    this._touch(hhId);
  },

  // ===== ถังขยะ: ลบออกจากระบบ (soft) / กู้คืน =====
  // คืน entity ที่เปลี่ยน เพื่อให้ App push ขึ้น cloud ต่อได้
  _mark(obj, deleted, by) {
    if (!obj) return null;
    if (deleted) {
      obj._deleted   = true;
      obj._deletedAt = CLOCK.nowISO();
      obj._deletedBy = by || '';
    } else {
      obj._deleted   = false;   // false ไม่ใช่ delete field — ให้ merge:true ทับค่าเดิมบน cloud ได้
      obj._deletedAt = '';
      obj._deletedBy = '';
    }
    this.save();
    return obj;
  },

  softDeleteHousehold(id, by)  { return this._mark(this.getHousehold(id), true,  by); },
  restoreHousehold(id)         { return this._mark(this.getHousehold(id), false); },
  softDeleteMember(hhId, mid, by) { return this._mark(this.getMember(hhId, mid), true,  by); },
  restoreMember(hhId, mid)        { return this._mark(this.getMember(hhId, mid), false); },
  softDeleteTrip(hhId, mid, tid, by) {
    const m = this.getMember(hhId, mid);
    return this._mark(m && m.trips.find(t => t.id === tid), true, by);
  },
  restoreTrip(hhId, mid, tid) {
    const m = this.getMember(hhId, mid);
    return this._mark(m && m.trips.find(t => t.id === tid), false);
  },

  // รายการในถังขยะ — flatten ทุกระดับให้ UI แสดง/กู้คืนได้
  // team (ไม่บังคับ) = ชื่อผู้ควบคุม · ส่งมาเมื่อไหร่จะเห็นเฉพาะของทีมนั้น (ใช้กับ staff)
  getTrash(team) {
    const out = [];
    const norm = s => String(s ?? '').normalize('NFC').replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, '').trim().replace(/\s+/g, ' ');
    const want = team ? norm(team) : '';
    this.load().households.filter(hh => !want || norm(hh.supervisorName) === want).forEach(hh => {
      if (hh._deleted) {
        out.push({ kind: 'household', hhId: hh.id, label: `บ้าน ${hh.houseNo || hh.id}`,
                   sub: `${(hh.members||[]).length} สมาชิก · ผู้สำรวจ ${hh.surveyorName || '—'}`,
                   at: hh._deletedAt, by: hh._deletedBy });
        return;   // ลบทั้งบ้านแล้ว ไม่ต้องแสดงลูกซ้ำ
      }
      (hh.members || []).forEach(m => {
        if (m._deleted) {
          out.push({ kind: 'member', hhId: hh.id, mId: m.id,
                     label: `สมาชิกที่ ${m.seq} (บ้าน ${hh.houseNo || hh.id})`,
                     sub: `${(m.trips||[]).length} เที่ยว`, at: m._deletedAt, by: m._deletedBy });
          return;
        }
        (m.trips || []).forEach(t => {
          if (t._deleted) {
            out.push({ kind: 'trip', hhId: hh.id, mId: m.id, tId: t.id,
                       label: `เที่ยวที่ ${t.seq} — สมาชิกที่ ${m.seq} (บ้าน ${hh.houseNo || hh.id})`,
                       sub: `${t.origin || '—'} → ${t.destination || '—'}`,
                       at: t._deletedAt, by: t._deletedBy });
          }
        });
      });
    });
    return out.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  },

  // ล้างเฉพาะข้อมูลเก่าก่อนรอบเก็บข้อมูลปัจจุบัน (createdAt < since) — ของใหม่ไม่แตะ
  clearOlderThan(sinceIso) {
    if (!sinceIso) return 0;
    const d = this.load();
    const before = d.households.length;
    d.households = d.households.filter(h => String(h.createdAt || '') >= sinceIso);
    this.save();
    return before - d.households.length;
  },

  // จำนวนบ้านเก่าที่ยังค้างในเครื่อง
  countOlderThan(sinceIso) {
    if (!sinceIso) return 0;
    return this.load().households.filter(h => String(h.createdAt || '') < sinceIso).length;
  },

  clearMyData(surveyorName) {
    const d = this.load();
    d.households = d.households.filter(h => h.surveyorName !== surveyorName);
    this.save();
  },

  stats(surveyorName) {
    let hhs = this.getHouseholds();
    if (surveyorName) hhs = hhs.filter(h => h.surveyorName === surveyorName);
    const members = hhs.flatMap(h => h.members || []);
    const trips = members.flatMap(m => m.trips || []);
    return { households: hhs.length, members: members.length, trips: trips.length };
  },

  // export = ข้อมูลที่ใช้จริง (ไม่รวมที่ลบออกจากระบบแล้ว)
  exportJSON() { return JSON.stringify({ ...this.load(), households: this.getHouseholds() }, null, 2); }
};


// ===== ปัญหาข้อมูล — นิยามที่เดียว ใช้ทั้งหน้าจอและไฟล์ Excel =====
// ถ้าแยกกันเขียน หน้าจอกับไฟล์จะบอกไม่ตรงกัน แล้วไม่มีใครรู้ว่าอันไหนถูก
//   hard = ทำให้ใช้วิเคราะห์ไม่ได้ (ต้องแก้ก่อนส่งงาน)
//   soft = ใช้ได้แต่คุณภาพลด
// เพศ + สถานะการทำงาน → ช่องในตารางสรุปครัวเรือน (ส่วนที่ 1)
// 'อื่น ๆ' ไม่มีช่องรองรับในตาราง → คืน '' = แมปไม่ได้
function gridBucket(gender, workStatus) {
  const g = gender === 'ชาย' ? 'm' : gender === 'หญิง' ? 'f' : '';
  if (!g) return '';
  if (workStatus === 'ทำงาน')        return g + '_work';
  if (workStatus === 'เรียนหนังสือ') return g + '_study';
  if (workStatus === 'ว่างงาน (ยังหางานทำไม่ได้)' ||
      workStatus === 'ไม่ทำงาน (อยู่บ้านเฉย ๆ)')   return g + '_notw';
  return '';
}

// ── ต้นทาง–ปลายทางเป็นหมุดเดียวกันไหม ────────────────────────────────────────
// เคสจริง: กด "กลับบ้าน" แล้วระบบเติมพิกัดบ้านให้เป็นปลายทางอัตโนมัติ
// พอเปลี่ยนแค่วัตถุประสงค์ พิกัดที่เติมไว้ยังค้างอยู่ → ต้นทางกับปลายทางเป็นจุดเดียวกัน
// พิกัดถูกคัดลอกมาตรง ๆ จึงเทียบตัวอักษรได้เลย ไม่ต้องคำนวณระยะ
// (คนละที่ที่ปักหมุดเองจะไม่มีทางได้สตริงเท่ากันอยู่แล้ว)
const samePin = (c1, c2) => {
  const a = String(c1 || '').trim(), b = String(c2 || '').trim();
  return !!a && a === b;
};

// ── พิกัดที่ใช้งานได้จริง ────────────────────────────────────────────────────
// ช่องพิกัดบ้านพิมพ์เองได้ ของจริงที่เจอคือกรอก "ชื่อ" ลงไปแทนพิกัด
// (ชื่อหมู่บ้าน · บ้านเลขที่ · จดโน้ตไว้ก่อนว่าจะกลับมาปักทีหลัง)
// เดิมทุกที่เช็คแค่ "ไม่ว่าง" → ข้อความพวกนี้ผ่านหมด บ้านขึ้นเขียวว่าครบ
// แต่ตอน Export โซนออกมาเป็น "(ไม่มีพิกัด)" และวาดบนแผนที่ไม่ได้เลย
// กติกา: ต้องเป็น "lat, lng" ที่เป็นตัวเลข อยู่ในช่วงที่เป็นไปได้ และไม่ใช่ 0,0
// (0,0 = กลางทะเลนอกทวีปแอฟริกา = ค่าที่หลุดมาจากที่อ่าน GPS ไม่ได้ ไม่ใช่จุดที่ตั้งใจปัก)
const parseCoords = (s) => {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(String(s || ''));
  if (!m) return null;
  const lat = +m[1], lon = +m[2];
  if (!isFinite(lat) || !isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (lat === 0 && lon === 0) return null;
  return { lat, lon };
};
const validCoords = (s) => !!parseCoords(s);
// มีข้อความอยู่ แต่ไม่ใช่พิกัด — แยกจาก "ว่างเปล่า" เพื่อบอกเหตุผลให้ตรงเรื่อง
const badCoords = (s) => !!String(s || '').trim() && !validCoords(s);
// ตัดข้อความยาว ๆ ก่อนเอาไปต่อในข้อความเตือน
const coordSnip = (s) => { const v = String(s || '').trim(); return v.length > 24 ? v.slice(0, 24) + '…' : v; };
// ข้อความปัญหาของช่องพิกัดหนึ่งช่อง — ผ่าน = คืน '' (ใช้ร่วมกันทุกช่องจะได้พูดเหมือนกัน)
const coordIssue = (val, label) =>
  validCoords(val) ? ''
  : badCoords(val) ? `${label}ไม่ใช่พิกัด — กรอกไว้ว่า "${coordSnip(val)}" (ต้องเป็น lat, lng)`
  : `ไม่มี${label}`;

// เลือก 'อื่น ๆ' แล้วไม่พิมพ์ระบุ — ผู้สำรวจชอบกดผ่านเพื่อความเร็ว เท่ากับไม่ได้ตอบ
const OTHER = 'อื่น ๆ';
const needOther = (val, other) => val === OTHER && !String(other || '').trim();

const Issues = {
  household(hh) {
    const hard = [], soft = [];
    if (!hh) return { hard, soft };
    { const c = coordIssue(hh.coordinates, 'พิกัดบ้าน'); if (c) hard.push(c); }
    if (!hh.surveyorName)   hard.push('ไม่มีชื่อผู้สำรวจ');
    if (!hh.supervisorName) hard.push('ไม่มีชื่อผู้ควบคุม');
    if (!(hh.members || []).length)                          hard.push('ยังไม่มีสมาชิกเลย');
    else if (!hh.members.some(m => (m.trips || []).length))   hard.push('ไม่มีสมาชิกคนไหนเดินทางเลย');
    // เลือก "อื่น ๆ" แล้วไม่พิมพ์ระบุ = เท่ากับไม่ได้ตอบ
    if (needOther(hh.residentialType, hh.residentialTypeOther)) hard.push('เลือกประเภทที่อยู่ "อื่น ๆ" แต่ไม่ได้ระบุ');
    // ── สมาชิกที่บันทึกไว้ ต้องไม่เกินตารางสรุป ──
    // ตอนกดบันทึกสมาชิกมีตัวบล็อกอยู่แล้ว แต่ระเบียนที่บันทึกไปก่อนหน้านั้น
    // หรือที่หลุดมาเพราะแก้ตารางสรุปทีหลัง จะนั่งอยู่เฉย ๆ โดยไม่มีอะไรเตือน
    // กฎนี้จับของที่บันทึกไปแล้ว จะได้เห็นในการ์ดและตัวกรอง "ไม่สมบูรณ์"
    {
      const grid = hh.memberGrid || {};
      const mem  = (hh.members || []).filter(m => !m._deleted);
      const over = [];
      // เกินรายช่อง (เพศ × สถานะ)
      OPT.memberGridRows.forEach(row => {
        if (row.key.endsWith('_child')) return;          // เด็กต่ำกว่า 6 ปี ไม่ถูกสัมภาษณ์ ไม่มีระเบียน
        const got = mem.filter(m => gridBucket(m.gender, m.workStatus) === row.key).length;
        const want = +(grid[row.key] || 0);
        if (got > want) over.push(`${row.label} ${got}/${want} คน`);
      });
      // เกินยอดรวมรายเพศ (จับกรณีสถานะเป็น 'อื่น ๆ' ที่แมปช่องไม่ได้ด้วย)
      [['ชาย', ['m_study','m_work','m_notw']], ['หญิง', ['f_study','f_work','f_notw']]].forEach(([g, keys]) => {
        const got  = mem.filter(m => m.gender === g).length;
        const want = keys.reduce((a, k) => a + (+(grid[k] || 0)), 0);
        if (got > want) over.push(`${g}รวม ${got}/${want} คน`);
      });
      if (over.length) hard.push('สมาชิกเกินตารางสรุป — ' + over.join(' · '));
    }
    if (!hh.houseNo)         soft.push('ไม่มีบ้านเลขที่');
    if (!hh.householdIncome) soft.push('ไม่มีรายได้ครัวเรือน');
    if (!hh.residentialType) soft.push('ไม่มีประเภทที่อยู่อาศัย');
    return { hard, soft };
  },
  member(m) {
    const hard = [], soft = [];
    if (!m) return { hard, soft };
    if (!m.gender) hard.push('ไม่ระบุเพศ');
    if (!m.age)    hard.push('ไม่ระบุอายุ');
    if (needOther(m.homeStatus, m.homeStatusOther)) hard.push('เลือกสถานภาพในบ้าน "อื่น ๆ" แต่ไม่ได้ระบุ');
    if (needOther(m.workStatus, m.workStatusOther)) hard.push('เลือกสถานะการทำงาน "อื่น ๆ" แต่ไม่ได้ระบุ');
    if (needOther(m.occupation, m.occupationOther)) hard.push('เลือกอาชีพ "อื่น ๆ" แต่ไม่ได้ระบุ');
    if (!m.occupation) soft.push('ไม่ระบุอาชีพ');
    if (!m.education)  soft.push('ไม่ระบุการศึกษา');
    if (m.workStatus === 'ทำงาน' && !validCoords(m.workplaceCoords))
      soft.push(badCoords(m.workplaceCoords) ? 'พิกัดที่ทำงานไม่ใช่พิกัด — กรอกไว้ว่า "' + coordSnip(m.workplaceCoords) + '"'
                                            : 'ทำงานแต่ไม่มีพิกัดที่ทำงาน');
    // ลูกโซ่การเดินทางต้องปิด — วันหนึ่งเริ่มที่บ้าน ออกไปแล้วต้องมีขากลับ
    // จึงต้องมีอย่างน้อย 2 เที่ยว: มีเที่ยวเดียวแปลว่าเก็บขาไปหรือขากลับหายไปข้างหนึ่ง
    // (แม้เที่ยวเดียวนั้นจะเป็น 'กลับบ้าน' ก็ยังผิด เพราะยังไม่มีเที่ยวที่ออกจากบ้าน)
    const trips = m.trips || [];
    if (trips.length === 1) {
      hard.push('มีเที่ยวเดียว — ต้องมีทั้งขาไปและขากลับ');
    } else if (trips.length > 1) {
      // ── ลูกโซ่ต้องเรียงตาม "ลำดับที่กรอก" ไม่ใช่เวลา ──
      // เดิมใช้เวลาน้อยสุดเป็นเที่ยวแรก แต่คนที่ออกจากบ้านตอนเย็นแล้วกลับตอนเช้าอีกวัน
      // (ออก 19:00 · กลับ 06:00) เวลาน้อยสุดจะเป็นขากลับ → เตือนผิด
      // ลำดับที่ผู้สำรวจกรอกคือลำดับการเดินทางจริง ใช้ตัวนี้ตรงกว่าและไม่ต้องมีเวลาครบ
      // กฎที่ชี้เที่ยวเจาะจง (เที่ยวแรกกลับบ้าน · กลับบ้านซ้อน) ย้ายไปอยู่ที่ tripInChain()
      // เพื่อให้ระบายสีรายเที่ยวได้ และไม่ถูกนับซ้ำทั้งระดับคนและระดับเที่ยว
      // ยอมรับ 2 ทางที่ผู้สำรวจอาจบันทึกขากลับ (วัตถุประสงค์ หรือ ลักษณะปลายทาง) — กันขึ้นแดงผิดคน
      // ใช้ .some() ทั้งชุด ไม่ดู "เที่ยวสุดท้าย" เพราะ seq เรียงตามลำดับที่กรอก ไม่ใช่ตามเวลา
      if (!trips.some(t => t.purpose === 'กลับบ้าน' || t.destinationType === 'ที่พัก / บ้านของตัวเอง'))
        hard.push('ไม่มีเที่ยวกลับบ้าน');
    }
    return { hard, soft };
  },
  trip(t) {
    const hard = [], soft = [];
    if (!t) return { hard, soft };
    { const c = coordIssue(t.originCoords, 'พิกัดต้นทาง'); if (c) hard.push(c); }
    if (samePin(t.originCoords, t.destinationCoords))
      hard.push('ต้นทางกับปลายทางเป็นหมุดเดียวกัน');
    { const c = coordIssue(t.destinationCoords, 'พิกัดปลายทาง'); if (c) hard.push(c); }
    if (!t.purpose)           hard.push('ไม่ระบุวัตถุประสงค์');
    if (!t.departureTime)     hard.push('ไม่ระบุเวลาออกเดินทาง');
    if (!(t.segments || []).some(g => g && g.mode)) hard.push('ไม่ระบุวิธีเดินทาง');
    if (needOther(t.purpose, t.purposeOther))                  hard.push('เลือกวัตถุประสงค์ "อื่น ๆ" แต่ไม่ได้ระบุ');
    if (needOther(t.originType, t.originTypeOther))            hard.push('เลือกลักษณะต้นทาง "อื่น ๆ" แต่ไม่ได้ระบุ');
    if (needOther(t.destinationType, t.destinationTypeOther))  hard.push('เลือกลักษณะปลายทาง "อื่น ๆ" แต่ไม่ได้ระบุ');
    if (!t.origin)          soft.push('ไม่มีชื่อสถานที่ต้นทาง');
    if (!t.destination)     soft.push('ไม่มีชื่อสถานที่ปลายทาง');
    if (!t.originType)      soft.push('ไม่ระบุลักษณะสถานที่ต้นทาง');
    if (!t.destinationType) soft.push('ไม่ระบุลักษณะสถานที่ปลายทาง');
    return { hard, soft };
  },

  // ปัญหาของ "เที่ยวนี้" รวมกฎลูกโซ่ที่ชี้มาที่เที่ยวนี้โดยเฉพาะ
  // ใช้ระบายสีรายเที่ยว และให้แผงสรุปของบ้านชี้เลขเที่ยวตรงกับที่ระบายสีไว้
  tripInChain(m, t) {
    const r = this.trip(t);
    const hard = r.hard.slice(), soft = r.soft.slice();
    const seq = (m?.trips || []).slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));
    const i = seq.findIndex(x => x.id === t.id);
    if (i === 0 && t.purpose === 'กลับบ้าน')
      hard.push('เที่ยวแรกเป็น "กลับบ้าน" ไม่ได้ — ต้องออกจากบ้านก่อน');
    if (i > 0 && t.purpose === 'กลับบ้าน' && seq[i - 1].purpose === 'กลับบ้าน')
      hard.push('"กลับบ้าน" ซ้อนกับเที่ยวก่อนหน้า — ต้องออกจากบ้านก่อน');
    return { hard, soft, total: hard.length + soft.length };
  },

  // รวมของ "คนนี้" — ปัญหาของตัวเอง + ของทุกเที่ยวข้างใน
  // ใช้ระบายสีแถวสมาชิกในหน้าบ้าน ให้ตรงกับที่เห็นตอนกดเข้าไป
  forMember(m) {
    const own = this.member(m);
    const H = own.hard.slice(), S = own.soft.slice();
    (m?.trips || []).forEach(t => {
      const r = this.tripInChain(m, t);
      H.push(...r.hard); S.push(...r.soft);
    });
    // เรียง "ต้องแก้" ขึ้นก่อนเสมอ — บรรทัดสรุปบนแถวโชว์ได้แค่ 2 อย่าง
    // ถ้าเอา "ควรแก้" ขึ้นก่อน คนอ่านจะไม่เห็นตัวที่ต้องแก้จริง
    return { hard: H.length, soft: S.length, total: H.length + S.length, reasons: [...H, ...S] };
  },

  // รวมทั้งบ้าน (รวมสมาชิกและเที่ยวข้างใน) — ใช้ทำป้ายบนการ์ดและแผงสรุปในหน้าบ้าน
  forHousehold(hh) {
    let hard = 0, soft = 0;
    const details = [];
    const push = (where, r) => {
      hard += r.hard.length; soft += r.soft.length;
      if (r.hard.length || r.soft.length) details.push({ where, ...r });
    };
    push('ข้อมูลบ้าน', this.household(hh));
    (hh?.members || []).forEach(m => {
      push(`คนที่ ${m.seq || '?'}`, this.member(m));
      (m.trips || []).forEach(t => push(`คนที่ ${m.seq || '?'} · เที่ยวที่ ${t.seq || '?'}`, this.tripInChain(m, t)));
    });
    return { hard, soft, total: hard + soft, details };
  }
};

// ===== OPTION LISTS =====
const OPT = {

  subdistricts: [
    'เทศบาลเมืองบ้านไผ่',
    'องค์การบริหารส่วนตำบลในเมือง',
    'องค์การบริหารส่วนตำบลเมืองเพีย',
    'องค์การบริหารส่วนตำบลบ้านลาน',
    'องค์การบริหารส่วนตำบลแคนเหนือ',
    'องค์การบริหารส่วนตำบลภูเหล็ก',
    'องค์การบริหารส่วนตำบลป่าปอ',
    'องค์การบริหารส่วนตำบลหินตั้ง',
    'องค์การบริหารส่วนตำบลหนองน้ำใส',
    'องค์การบริหารส่วนตำบลขามเรียง'
  ],

  residentialType: [
    'บ้านเดี่ยว', 'ตึกแถว', 'ทาวน์เฮ้าส์', 'คอนโดมิเนียม / แฟลต', 'อื่น ๆ'
  ],

  // icon + label สำหรับ grid จำนวนสมาชิก
  memberGridRows: [
    { key: 'm_study', label: 'ชาย — กำลังศึกษา',        icon: '👨‍🎓' },
    { key: 'm_work',  label: 'ชาย — ทำงานแล้ว',         icon: '👨‍💼' },
    { key: 'm_notw',  label: 'ชาย — ไม่ได้ทำงาน',       icon: '👨' },
    { key: 'f_study', label: 'หญิง — กำลังศึกษา',       icon: '👩‍🎓' },
    { key: 'f_work',  label: 'หญิง — ทำงานแล้ว',        icon: '👩‍💼' },
    { key: 'f_notw',  label: 'หญิง — ไม่ได้ทำงาน',      icon: '👩' },
    { key: 'm_child', label: 'ชาย — อายุต่ำกว่า 6 ปี',  icon: '👦' },
    { key: 'f_child', label: 'หญิง — อายุต่ำกว่า 6 ปี', icon: '👧' }
  ],

  // (เลิกใช้ income แบบชั้น — รายได้สมาชิก/ครัวเรือนเป็นช่องกรอกตัวเลข)

  // icon + label สำหรับยานพาหนะ
  vehicleTypes: [
    { key: 'bicycle2',   label: 'รถจักรยานสองล้อ',       icon: '🚲' },
    { key: 'bicycle3',   label: 'รถจักรยานสามล้อ',       icon: '🚲' },
    { key: 'motorcycle', label: 'รถจักรยานยนต์',          icon: '🛵' },
    { key: 'tuk3',       label: 'รถสามล้อเครื่อง',        icon: '🛺' },
    { key: 'car',        label: 'รถยนต์นั่งส่วนบุคคล',     icon: '🚗' },
    { key: 'minibus',    label: 'รถโดยสารขนาดเล็ก–กลาง', icon: '🚐' },
    { key: 'bus',        label: 'รถโดยสารขนาดใหญ่',       icon: '🚌' },
    { key: 'pickup',     label: 'รถปิ๊กอัพ',              icon: '🛻' },
    { key: 'truck6',     label: 'รถบรรทุก 6 ล้อขึ้นไป',  icon: '🚛' },
    { key: 'other',      label: 'อื่น ๆ',                 icon: '🚘' }
  ],

  homeStatus: [
    'เจ้าบ้านผู้ชาย', 'เจ้าบ้านผู้หญิง', 'ลูก', 'ญาติ', 'ผู้อยู่อาศัย / ลูกจ้าง', 'อื่น ๆ'
  ],

  workStatus: [
    'ทำงาน',
    'เรียนหนังสือ',
    'ว่างงาน (ยังหางานทำไม่ได้)',
    'ไม่ทำงาน (อยู่บ้านเฉย ๆ)',
    'อื่น ๆ'
  ],

  occupation: [
    'นักเรียน / นักศึกษา',
    'ครู / อาจารย์',
    'ข้าราชการ / รัฐวิสาหกิจ',
    'เจ้าของกิจการ / บริษัท',
    'พนักงานบริษัท / ห้างร้าน / ธนาคาร',
    'ลูกจ้าง / คนงาน / พนักงานโรงงาน',
    'พนักงานขับรถ',
    'เกษตรกร / ประมง / เลี้ยงสัตว์',
    'ช่างฝีมือ / ช่างผลิต',
    'ผู้ปฏิบัติงานวิชาชีพ',
    'แม่บ้าน / พ่อบ้าน',
    'ข้าราชการบำนาญ',
    'อยู่บ้านเฉย ๆ',
    'อื่น ๆ'
  ],

  education: [
    'ต่ำกว่าประถมศึกษา / ไม่ได้เรียน',
    'ประถมศึกษา (ป.1–ป.6)',
    'มัธยมศึกษา (ม.1–ม.6)',
    'อนุปริญญา / ปวช. / ปวส.',
    'ปริญญาตรี',
    'สูงกว่าปริญญาตรี'
  ],

  // ใช้ชุดเดียวกับ Roadside (11 ประเภท) เพื่อให้ aggregate ข้ามแอปได้
  locationType: [
    'ที่พัก / บ้านของตัวเอง',
    'โรงเรียน / สถานศึกษา',
    'สถานที่ราชการ / โรงพยาบาล',
    'บริษัทเอกชน / ห้าง / ธนาคาร',
    'ตลาด / ร้านค้า / ร้านอาหาร / ที่รับจ้างหรือบริการต่าง ๆ',
    'โรงงาน / โกดัง / คลังสินค้า',
    'ที่ทำงานเกษตรกรรม / สวน / ไร่ / นา / กสิกรรม',
    'สถานที่ท่องเที่ยว / ออกกำลังกาย',
    'วัด / โบสถ์ / มัสยิด / ศาลเจ้า',
    'บ้านที่ไม่ใช่ของตัวเอง',
    'อื่น ๆ'
  ],

  // ใช้ชุดเดียวกับ Roadside (11 วัตถุประสงค์) — คง 'กลับบ้าน' ไว้ (logic trip สุดท้ายใช้)
  purpose: [
    'กลับบ้าน',
    'ไปทำงาน',
    'ไปเรียนหนังสือ',
    'ติดต่อราชการต่าง ๆ / ธุรกิจ',
    'ไปโรงพยาบาล / คลินิก / อนามัย',
    'รับส่งคน หรือ สินค้า',
    'ช้อปปิ้ง / ซื้อของใช้ต่าง ๆ',
    'รับประทานอาหาร',
    'ท่องเที่ยว / พักผ่อน / ออกกำลังกาย',
    'ทำกิจกรรมทางศาสนา',
    'อื่น ๆ'
  ],

  // modes ที่ต้องมียานพาหนะประเภทนั้นในครัวเรือนจึงจะใช้ได้
  modeRequiresVehicle: {
    'รถจักรยานสองล้อถีบ':                        ['bicycle2'],
    'รถสามล้อถีบ':                                ['bicycle3'],
    'รถจักรยานยนต์ส่วนตัว':                       ['motorcycle'],
    'ซ้อนรถจักรยาน':                              ['bicycle2'],
    'ซ้อนรถจักรยานยนต์':                          ['motorcycle'],
    'รถยนต์นั่งส่วนบุคคล (รถเก๋ง / ปิ๊กอัพ)':    ['car', 'pickup'],
    'รถส่วนบุคคล 6 ล้อขึ้นไป':                    ['truck6'],
  },

  tripMode: [
    'เดิน',
    'รถจักรยานสองล้อถีบ',
    'รถสามล้อถีบ',
    'รถจักรยานยนต์ส่วนตัว',
    'รถจักรยานยนต์รับจ้าง',
    'รถสามล้อเครื่อง / แท็กซี่',
    'รถสองแถว / รถประจำทาง',
    'รถยนต์นั่งส่วนบุคคล (รถเก๋ง / ปิ๊กอัพ)',
    'ซ้อนรถจักรยาน',
    'ซ้อนรถจักรยานยนต์',
    'อาศัยไปกับรถยนต์ของผู้อื่น',
    'รถส่วนบุคคลรับจ้าง',
    'รถโรงเรียน',
    'รถบริษัท / ที่ทำงาน / ราชการ',
    'รถส่วนบุคคล 6 ล้อขึ้นไป',
    'รถไฟ',
    'อื่น ๆ'
  ]
};
