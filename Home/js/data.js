// ===== DATA LAYER ===== (v2)

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
  getHouseholds() { return this.load().households; },
  getHousehold(id) { return this.load().households.find(h => h.id === id) || null; },

  addHousehold(data) {
    const hh = {
      id: 'HH-' + Date.now(),
      surveyDate:      data.surveyDate      || new Date().toISOString().split('T')[0],
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
      memberGrid:      data.memberGrid      || {},
      householdIncome: data.householdIncome || '',
      hasVehicle:      data.hasVehicle      || '',
      vehicles:        data.vehicles        || {},
      deviceId:        data.deviceId        || '',
      clientIp:        data.clientIp        || '',
      createdAt: new Date().toISOString(),
      members: []
    };
    this.load().households.push(hh);
    this.save();
    return hh;
  },

  updateHousehold(id, data) {
    const hh = this.getHousehold(id);
    if (!hh) return null;
    // ไม่อัพเดต id, createdAt, members
    const { id: _id, createdAt: _ca, members: _m, ...rest } = data;
    Object.assign(hh, rest);
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
      workStatus:           data.workStatus           || '',
      occupation:           data.occupation           || '',
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
    this.save();
    return m;
  },

  updateMember(hhId, mid, data) {
    const m = this.getMember(hhId, mid);
    if (!m) return null;
    Object.assign(m, data);
    this.save();
    return m;
  },

  deleteMember(hhId, mid) {
    const hh = this.getHousehold(hhId);
    if (!hh) return;
    hh.members = hh.members.filter(m => m.id !== mid);
    hh.members.forEach((m, i) => { m.seq = i + 1; });
    this.save();
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
      departureTime:     data.departureTime     || '',
      destination:       data.destination       || '',
      destinationCoords: data.destinationCoords || '',
      destinationType:   data.destinationType   || '',
      arrivalTime:       data.arrivalTime       || '',
      purpose:           data.purpose           || '',
      segments:          data.segments          || [{ mode:'', duration:'', fare:'' }],
      parkingLocation:   data.parkingLocation   || '',
      parkingFee:        data.parkingFee        || ''
    };
    m.trips.push(trip);
    this.save();
    return trip;
  },

  updateTrip(hhId, mid, tripId, data) {
    const m = this.getMember(hhId, mid);
    if (!m) return null;
    const trip = m.trips.find(t => t.id === tripId);
    if (!trip) return null;
    Object.assign(trip, data);
    this.save();
    return trip;
  },

  deleteTrip(hhId, mid, tripId) {
    const m = this.getMember(hhId, mid);
    if (!m) return;
    m.trips = m.trips.filter(t => t.id !== tripId);
    m.trips.forEach((t, i) => { t.seq = i + 1; });
    this.save();
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

  exportJSON() { return JSON.stringify(this.load(), null, 2); }
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
