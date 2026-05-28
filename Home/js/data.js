// ===== DATA LAYER ===== (v2)
const DB = {
  KEY: 'hi_survey_v2',
  _data: null,

  load() {
    if (this._data) return this._data;
    try {
      const raw = localStorage.getItem(this.KEY);
      this._data = raw ? JSON.parse(raw) : { households: [] };
    } catch { this._data = { households: [] }; }
    return this._data;
  },

  save() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this._data)); } catch {}
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

  stats() {
    const hhs = this.getHouseholds();
    const members = hhs.flatMap(h => h.members);
    const trips = members.flatMap(m => m.trips);
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

  income: [
    'ไม่มีรายได้',
    'น้อยกว่า 2,000 บาท',
    '2,000–2,999 บาท',
    '3,000–4,999 บาท',
    '5,000–7,499 บาท',
    '7,500–9,999 บาท',
    '10,000–12,499 บาท',
    '12,500–14,999 บาท',
    '15,000–17,499 บาท',
    '17,500–19,999 บาท',
    '20,000–24,999 บาท',
    '25,000–29,999 บาท',
    '30,000–49,999 บาท',
    '50,000–70,000 บาท',
    'มากกว่า 70,000 บาท'
  ],

  // icon + label สำหรับยานพาหนะ
  vehicleTypes: [
    { key: 'bicycle2',   label: 'รถจักรยานสองล้อ',       icon: '🚲' },
    { key: 'bicycle3',   label: 'รถจักรยานสามล้อ',       icon: '🛵' },
    { key: 'motorcycle', label: 'รถจักรยานยนต์',          icon: '🏍️' },
    { key: 'tuk3',       label: 'รถสามล้อเครื่อง',        icon: '🛺' },
    { key: 'car',        label: 'รถยนต์นั่งส่วนบุคคล',     icon: '🚗' },
    { key: 'minibus',    label: 'รถโดยสารขนาดเล็ก–กลาง', icon: '🚐' },
    { key: 'bus',        label: 'รถโดยสารขนาดใหญ่',       icon: '🚌' },
    { key: 'pickup',     label: 'รถปิ๊กอัพ',              icon: '🛻' },
    { key: 'truck6',     label: 'รถบรรทุก 6 ล้อขึ้นไป',  icon: '🚛' },
    { key: 'other',      label: 'อื่น ๆ',                 icon: '🚘' }
  ],

  homeStatus: [
    'พ่อบ้าน', 'แม่บ้าน', 'ลูก', 'ญาติ', 'ผู้อยู่อาศัย / ลูกจ้าง', 'อื่น ๆ'
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

  locationType: [
    'ที่พักอาศัย / บ้าน',
    'สำนักงาน / ที่ทำงาน',
    'โรงเรียน / สถาบันการศึกษา',
    'โรงพยาบาล / คลินิก',
    'ตลาด / ร้านค้า',
    'ห้างสรรพสินค้า / ศูนย์การค้า',
    'สถานที่ราชการ',
    'โรงงาน / นิคมอุตสาหกรรม',
    'วัด / ศาสนสถาน',
    'สถานีขนส่ง / สถานีรถไฟ',
    'สถานที่ท่องเที่ยว / นันทนาการ',
    'อื่น ๆ'
  ],

  purpose: [
    'ทำงาน',
    'เรียนหนังสือ',
    'ซื้อของ / ธุรกรรม',
    'พบแพทย์ / รักษาพยาบาล',
    'นันทนาการ / ท่องเที่ยว',
    'เยี่ยมญาติ / พบปะสังสรรค์',
    'รับ–ส่งบุคคล',
    'กลับบ้าน',
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
