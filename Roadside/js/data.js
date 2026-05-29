// ===== DATA LAYER — Roadside Interview =====
const DB = {
  KEY: 'ri_survey_v1',
  _data: null,

  load() {
    if (this._data) return this._data;
    try {
      const raw = localStorage.getItem(this.KEY);
      this._data = raw ? JSON.parse(raw) : { stations: [] };
    } catch { this._data = { stations: [] }; }
    return this._data;
  },

  save() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this._data)); } catch {}
  },

  // ===== STATIONS =====
  getStations() { return this.load().stations; },
  getStation(id) { return this.load().stations.find(s => s.id === id) || null; },

  addStation(data) {
    const st = {
      id:              'RS-' + Date.now(),
      surveyDate:      data.surveyDate      || new Date().toISOString().split('T')[0],
      surveyorName:    data.surveyorName    || '',
      supervisorName:  data.supervisorName  || '',
      stationName:     data.stationName     || '',
      stationCode:     data.stationCode     || '',
      road:            data.road            || '',
      direction:       data.direction       || '',
      coordinates:     data.coordinates     || '',
      subdistrict:     data.subdistrict     || '',
      district:        data.district        || '',
      province:        data.province        || '',
      deviceId:        data.deviceId        || '',
      clientIp:        data.clientIp        || '',
      createdAt:       new Date().toISOString(),
      interviews:      []
    };
    this.load().stations.push(st);
    this.save();
    return st;
  },

  updateStation(id, data) {
    const st = this.getStation(id);
    if (!st) return null;
    const { id: _id, createdAt: _ca, interviews: _iv, ...rest } = data;
    Object.assign(st, rest);
    this.save();
    return st;
  },

  deleteStation(id) {
    const d = this.load();
    d.stations = d.stations.filter(s => s.id !== id);
    this.save();
  },

  // ===== INTERVIEWS =====
  getInterview(stId, ivId) {
    const st = this.getStation(stId);
    return st ? st.interviews.find(iv => iv.id === ivId) || null : null;
  },

  addInterview(stId, data) {
    const st = this.getStation(stId);
    if (!st) return null;
    const iv = {
      id:                   'IV-' + Date.now(),
      seq:                  st.interviews.length + 1,
      surveyorName:         data.surveyorName         || '',
      interviewTime:        data.interviewTime        || '',
      vehicleType:          data.vehicleType          || '',
      licensePlate:         data.licensePlate         || '',
      licensePlateProvince: data.licensePlateProvince || '',
      passengerCount:       data.passengerCount       || '',
      // origin
      origin:               data.origin               || '',
      originVillage:        data.originVillage        || '',
      originLandmark:       data.originLandmark       || '',
      originCoords:         data.originCoords         || '',
      originType:           data.originType           || '',
      // destination
      destination:          data.destination          || '',
      destVillage:          data.destVillage          || '',
      destLandmark:         data.destLandmark         || '',
      destinationCoords:    data.destinationCoords    || '',
      destinationType:      data.destinationType      || '',
      travelDirection:      data.travelDirection      || '',
      purpose:              data.purpose              || '',
      tripFrequency:        data.tripFrequency        || '',
      // cargo (รถบรรทุก)
      hasCargo:             data.hasCargo             || '',
      cargoType:            data.cargoType            || '',
      cargoWeight:          data.cargoWeight          || '',
      // driver
      driverGender:         data.driverGender         || '',
      driverAge:            data.driverAge            || '',
      driverOccupation:     data.driverOccupation     || '',
      driverIncome:         data.driverIncome         || '',
      createdAt:            new Date().toISOString()
    };
    st.interviews.push(iv);
    this.save();
    return iv;
  },

  updateInterview(stId, ivId, data) {
    const iv = this.getInterview(stId, ivId);
    if (!iv) return null;
    Object.assign(iv, data);
    this.save();
    return iv;
  },

  deleteInterview(stId, ivId) {
    const st = this.getStation(stId);
    if (!st) return;
    st.interviews = st.interviews.filter(iv => iv.id !== ivId);
    st.interviews.forEach((iv, i) => { iv.seq = i + 1; });
    this.save();
  },

  clearMyInterviews(surveyorName) {
    this.load().stations.forEach(st => {
      st.interviews = st.interviews.filter(iv => iv.surveyorName !== surveyorName);
      st.interviews.forEach((iv, i) => { iv.seq = i + 1; });
    });
    this.save();
  },

  stats() {
    const sts = this.getStations();
    const ivs = sts.flatMap(s => s.interviews);
    return { stations: sts.length, interviews: ivs.length };
  },

  exportJSON() { return JSON.stringify(this.load(), null, 2); }
};

// ===== OPTION LISTS =====
const OPT = {

  // แกนถนนของจุดสำรวจ → ใช้เลือกทิศทางจริงในการสำรวจแต่ละคัน
  roadAxis: ['เหนือ–ใต้', 'ตะวันออก–ตะวันตก'],

  // ทิศทางจริงแต่ละคัน — กำหนดตามแกนถนน
  directionsByAxis: {
    'เหนือ–ใต้':          ['มุ่งทิศเหนือ', 'มุ่งทิศใต้'],
    'ตะวันออก–ตะวันตก': ['มุ่งทิศตะวันออก', 'มุ่งทิศตะวันตก']
  },

  // ตรงตามแบบฟอร์ม RS — 9 ประเภท แบ่ง 3 กลุ่ม
  vehicleTypes: [
    // กลุ่มรถส่วนบุคคล (1–5)
    { key: 'bicycle2',   label: 'จักรยาน 2 ล้อ',                          icon: '🚲', group: 'personal' },
    { key: 'bicycle3',   label: 'จักรยาน 3 ล้อ',                          icon: '🛵', group: 'personal' },
    { key: 'motorcycle', label: 'รถจักรยานยนต์',                          icon: '🏍️', group: 'personal' },
    { key: 'tuk3',       label: 'รถสามล้อเครื่อง',                        icon: '🛺', group: 'personal' },
    { key: 'car',        label: 'รถยนต์นั่งส่วนบุคคล',                    icon: '🚗', group: 'personal' },
    // กลุ่มรถโดยสาร (6–7)
    { key: 'bus_sm',     label: 'รถโดยสารขนาดเล็ก–กลาง',                 icon: '🚐', group: 'bus' },
    { key: 'bus_lg',     label: 'รถโดยสารขนาดใหญ่',                       icon: '🚌', group: 'bus' },
    // กลุ่มรถบรรทุก (8–9)
    { key: 'truck4',     label: 'รถบรรทุกขนาดเล็ก (4 ล้อ)',              icon: '🚚', group: 'truck' },
    { key: 'truck6',     label: 'รถบรรทุกขนาดกลางขึ้นไป (6 ล้อขึ้นไป)', icon: '🚛', group: 'truck' }
  ],

  // ตรงตามแบบฟอร์ม RS — 11 ประเภทสถานที่
  locationType: [
    'ที่พัก / บ้านของตัวเอง',
    'โรงเรียน / สถานศึกษา',
    'สถานที่ราชการ / โรงพยาบาล',
    'บริษัทเอกชน / ห้าง / ธนาคาร',
    'ร้านค้า / ร้านอาหาร / ที่รับจ้างหรือบริการต่าง ๆ',
    'โรงงาน / โกดัง / คลังสินค้า',
    'ที่ทำงานเกษตรกรรม / สวน / ไร่ / นา / กสิกรรม',
    'สถานที่ท่องเที่ยว / ออกกำลังกาย',
    'วัด / โบสถ์ / มัสยิด / ศาลเจ้า',
    'บ้านที่ไม่ใช่ของตัวเอง',
    'อื่น ๆ'
  ],

  // ตรงตามแบบฟอร์ม RS — 11 วัตถุประสงค์
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

  tripFrequency: [
    'ทุกวัน',
    '5–6 วัน/สัปดาห์',
    '3–4 วัน/สัปดาห์',
    '1–2 วัน/สัปดาห์',
    '1–2 ครั้ง/เดือน',
    'ไม่บ่อย / ครั้งแรก'
  ],

  occupation: [
    'นักเรียน / นักศึกษา',
    'ครู / อาจารย์',
    'ข้าราชการ / รัฐวิสาหกิจ',
    'เจ้าของกิจการ / บริษัท',
    'พนักงานบริษัท / ห้างร้าน / ธนาคาร',
    'ลูกจ้าง / คนงาน / พนักงานโรงงาน',
    'พนักงานขับรถ / ขนส่ง',
    'เกษตรกร / ประมง / เลี้ยงสัตว์',
    'ช่างฝีมือ / ช่างผลิต',
    'ผู้ปฏิบัติงานวิชาชีพ',
    'แม่บ้าน / พ่อบ้าน',
    'ข้าราชการบำนาญ',
    'อยู่บ้านเฉย ๆ',
    'อื่น ๆ'
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

  // ตรงตามแบบฟอร์ม RS — 34 ชนิดสินค้า
  cargoTypes: [
    'สัตว์มีชีวิต',
    'อาหารสัตว์',
    'ปุ๋ย',
    'ข้าว',
    'ข้าวเปลือก',
    'ข้าวโพด',
    'อ้อย',
    'น้ำตาล',
    'มันสำปะหลังและผลิตภัณฑ์',
    'ยางพาราและผลิตภัณฑ์ยาง',
    'ไม้',
    'เครื่องดื่ม',
    'ผลิตภัณฑ์อาหาร',
    'ผลไม้',
    'แร่เชื้อเพลิง (ถ่านหิน)',
    'ผลิตภัณฑ์ปิโตรเลียม',
    'ยางมะตอย',
    'วัสดุก่อสร้าง',
    'ซีเมนต์',
    'โลหะก่อสร้าง',
    'ดิน/หิน/ทราย',
    'แร่ธาตุ',
    'เคมีภัณฑ์ (สารเคมี)',
    'พลาสติก',
    'ยานยนต์',
    'เครื่องจักร',
    'เครื่องมือ/อุปกรณ์/เครื่องใช้ครัวเรือน',
    'เครื่องใช้ไฟฟ้า/อิเล็กทรอนิกส์/คอมพิวเตอร์',
    'เสื้อผ้า สิ่งทอ',
    'สินค้าเบ็ดเตล็ด',
    'โลหะอื่น ๆ',
    'ผลผลิตเกษตรอื่น ๆ',
    'เครื่องบริโภคอื่น ๆ',
    'อื่น ๆ (ระบุ)'
  ],

  // การ์ดสถานที่ + ไอคอน (สำหรับ wizard)
  locationTypeCards: [
    { val: 'ที่พัก / บ้านของตัวเอง',                            icon: '🏠', short: 'บ้านตัวเอง' },
    { val: 'โรงเรียน / สถานศึกษา',                              icon: '🏫', short: 'โรงเรียน' },
    { val: 'สถานที่ราชการ / โรงพยาบาล',                         icon: '🏥', short: 'ราชการ/รพ.' },
    { val: 'บริษัทเอกชน / ห้าง / ธนาคาร',                       icon: '🏢', short: 'บริษัท/ห้าง' },
    { val: 'ร้านค้า / ร้านอาหาร / ที่รับจ้างหรือบริการต่าง ๆ', icon: '🛒', short: 'ร้านค้า' },
    { val: 'โรงงาน / โกดัง / คลังสินค้า',                       icon: '🏭', short: 'โรงงาน/โกดัง' },
    { val: 'ที่ทำงานเกษตรกรรม / สวน / ไร่ / นา / กสิกรรม',    icon: '🌾', short: 'เกษตร/ไร่นา' },
    { val: 'สถานที่ท่องเที่ยว / ออกกำลังกาย',                   icon: '🏖️', short: 'ท่องเที่ยว' },
    { val: 'วัด / โบสถ์ / มัสยิด / ศาลเจ้า',                    icon: '⛩️', short: 'ศาสนสถาน' },
    { val: 'บ้านที่ไม่ใช่ของตัวเอง',                             icon: '🏘️', short: 'บ้านผู้อื่น' },
    { val: 'อื่น ๆ',                                             icon: '📍', short: 'อื่น ๆ' }
  ],

  // การ์ดวัตถุประสงค์ + ไอคอน
  purposeCards: [
    { val: 'กลับบ้าน',                               icon: '🏠' },
    { val: 'ไปทำงาน',                                icon: '💼' },
    { val: 'ไปเรียนหนังสือ',                         icon: '📚' },
    { val: 'ติดต่อราชการต่าง ๆ / ธุรกิจ',           icon: '🏛️' },
    { val: 'ไปโรงพยาบาล / คลินิก / อนามัย',        icon: '🏥' },
    { val: 'รับส่งคน หรือ สินค้า',                   icon: '📦' },
    { val: 'ช้อปปิ้ง / ซื้อของใช้ต่าง ๆ',           icon: '🛒' },
    { val: 'รับประทานอาหาร',                         icon: '🍽️' },
    { val: 'ท่องเที่ยว / พักผ่อน / ออกกำลังกาย',   icon: '🏖️' },
    { val: 'ทำกิจกรรมทางศาสนา',                     icon: '⛩️' },
    { val: 'อื่น ๆ',                                 icon: '❓' }
  ],

  provinces: [
    'กรุงเทพมหานคร','กระบี่','กาญจนบุรี','กาฬสินธุ์','กำแพงเพชร',
    'ขอนแก่น','จันทบุรี','ฉะเชิงเทรา','ชลบุรี','ชัยนาท','ชัยภูมิ',
    'ชุมพร','เชียงราย','เชียงใหม่','ตรัง','ตราด','ตาก','นครนายก',
    'นครปฐม','นครพนม','นครราชสีมา','นครศรีธรรมราช','นครสวรรค์',
    'นนทบุรี','นราธิวาส','น่าน','บึงกาฬ','บุรีรัมย์','ปทุมธานี',
    'ประจวบคีรีขันธ์','ปราจีนบุรี','ปัตตานี','พระนครศรีอยุธยา',
    'พะเยา','พิจิตร','พิษณุโลก','เพชรบุรี','เพชรบูรณ์',
    'แพร่','พัทลุง','ภูเก็ต','มหาสารคาม','มุกดาหาร','แม่ฮ่องสอน',
    'ยโสธร','ยะลา','ร้อยเอ็ด','ระนอง','ระยอง','ราชบุรี','ลพบุรี',
    'ลำปาง','ลำพูน','เลย','ศรีสะเกษ','สกลนคร','สงขลา','สตูล',
    'สมุทรปราการ','สมุทรสงคราม','สมุทรสาคร','สระแก้ว','สระบุรี',
    'สิงห์บุรี','สุโขทัย','สุพรรณบุรี','สุราษฎร์ธานี','สุรินทร์',
    'หนองคาย','หนองบัวลำภู','อ่างทอง','อำนาจเจริญ','อุดรธานี',
    'อุตรดิตถ์','อุทัยธานี','อุบลราชธานี','อื่น ๆ (ต่างประเทศ)'
  ]
};
