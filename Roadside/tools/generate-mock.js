// ===== ROADSIDE MOCK DATA GENERATOR =====
// วางใน browser console ตอนเปิดแอป Roadside แล้วกด ☁️ Sync
// สร้างข้อมูลจำลอง: 4 จุดสำรวจ × ~40 คัน = ~160 สัมภาษณ์
// ⚠️ ค่าทุก field อ้างอิงรายการจริงใน data.js (OPT):
//    vehicleType = key (motorcycle/car/truck6...) · type/purpose/cargo = ข้อความตรง OPT เป๊ะ
// แนวคิดพื้นที่: roadside = รถวิ่งผ่านจุดสำรวจ "เข้า/ออก" พื้นที่ศึกษา → ปลายทางกระจายหลายจังหวัด

(function () {
  const R  = (a) => a[Math.floor(Math.random() * a.length)];
  const RI = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;
  const RF = (lo, hi, dec = 6) => +(lo + Math.random() * (hi - lo)).toFixed(dec);
  const uid = () => Math.random().toString(36).slice(2, 10);
  const jitter = (c, s) => `${RF(c[0] - s, c[0] + s)}, ${RF(c[1] - s, c[1] + s)}`;

  // ── พิกัดในพื้นที่ศึกษา (บ้านไผ่ · lat 15.876–16.189, lon 102.638–102.902) ──
  const ZONE_CENTERS = [
    [16.032, 102.770], [15.994, 102.751], [16.020, 102.770], [15.958, 102.777],
    [15.909, 102.764], [16.063, 102.745], [15.975, 102.730], [16.095, 102.780],
    [16.045, 102.810], [15.940, 102.810], [16.110, 102.730], [15.920, 102.730],
    [16.070, 102.810], [15.970, 102.800], [16.150, 102.760], [15.885, 102.780],
    [16.130, 102.800], [15.897, 102.700], [16.005, 102.810], [16.075, 102.700],
    [15.960, 102.680], [16.100, 102.690], [15.920, 102.850], [16.050, 102.860],
  ];

  // ── จังหวัดปลายทางนอกพื้นที่ศึกษา — กระจายหลายจังหวัด (เดินทางเข้า/ออก) ──
  const PROVINCES = [
    { p: 'ขอนแก่น',        c: [16.439, 102.835] },
    { p: 'มหาสารคาม',      c: [16.184, 103.300] },
    { p: 'กาฬสินธุ์',       c: [16.433, 103.506] },
    { p: 'ร้อยเอ็ด',        c: [16.054, 103.653] },
    { p: 'ชัยภูมิ',         c: [15.806, 102.031] },
    { p: 'นครราชสีมา',     c: [14.979, 102.098] },
    { p: 'อุดรธานี',        c: [17.413, 102.787] },
    { p: 'หนองบัวลำภู',    c: [17.204, 102.440] },
    { p: 'บุรีรัมย์',        c: [14.993, 103.104] },
    { p: 'อุบลราชธานี',    c: [15.244, 104.848] },
    { p: 'เลย',             c: [17.486, 101.722] },
    { p: 'กรุงเทพมหานคร',  c: [13.756, 100.502] },
  ];

  // ── ประเภทสถานที่ (ตรง OPT.locationType ของ Roadside เป๊ะ) ──
  const T = {
    home:    'ที่พัก / บ้านของตัวเอง',
    school:  'โรงเรียน / สถานศึกษา',
    gov:     'สถานที่ราชการ / โรงพยาบาล',
    biz:     'บริษัทเอกชน / ห้าง / ธนาคาร',
    shop:    'ร้านค้า / ร้านอาหาร / ที่รับจ้างหรือบริการต่าง ๆ',
    factory: 'โรงงาน / โกดัง / คลังสินค้า',
    farm:    'ที่ทำงานเกษตรกรรม / สวน / ไร่ / นา / กสิกรรม',
    tour:    'สถานที่ท่องเที่ยว / ออกกำลังกาย',
    temple:  'วัด / โบสถ์ / มัสยิด / ศาลเจ้า',
    otherHome: 'บ้านที่ไม่ใช่ของตัวเอง',
    other:   'อื่น ๆ',
  };

  // สถานที่ในพื้นที่ศึกษา (บ้านไผ่)
  const PLACES_IN = [
    { n: 'ตลาดบ้านไผ่',                 c: '16.0612, 102.7298', t: T.shop },
    { n: 'โรงพยาบาลบ้านไผ่',            c: '16.0601, 102.7287', t: T.gov },
    { n: 'สถานีรถไฟบ้านไผ่',            c: '16.0540, 102.7365', t: T.other },
    { n: 'โรงงานนิคมอุตสาหกรรมบ้านไผ่', c: '16.0480, 102.7420', t: T.factory },
    { n: 'ตลาดชุมชนบ้านลาน',            c: '15.9820, 102.7930', t: T.shop },
    { n: 'เทศบาลเมืองบ้านไผ่',          c: '16.0595, 102.7320', t: T.gov },
    { n: 'โรงเรียนบ้านไผ่',             c: '16.0578, 102.7334', t: T.school },
    { n: 'ไร่อ้อยเขตบ้านไผ่',           c: null,                t: T.farm },
    { n: 'บ้านพักในอำเภอบ้านไผ่',       c: null,                t: T.home },
    { n: 'วัดในเขตบ้านไผ่',             c: null,                t: T.temple },
  ];

  // ชนิดสถานที่ทั่วไปสำหรับปลายทางนอกพื้นที่ (จับคู่ชื่อ + type ที่ตรง OPT)
  const OUT_KINDS = [
    { pre: 'ตลาด',           t: T.shop },
    { pre: 'โรงงาน',          t: T.factory },
    { pre: 'ที่ทำงาน',        t: T.biz },
    { pre: 'ศาลากลางจังหวัด', t: T.gov },
    { pre: 'มหาวิทยาลัย',     t: T.school },
    { pre: 'ไร่/สวนเกษตร',    t: T.farm },
    { pre: 'บ้านญาติ',        t: T.otherHome },
  ];

  const inAreaCoord = () => jitter(R(ZONE_CENTERS), 0.015);
  const placeIn  = () => { const p = R(PLACES_IN); return { name: p.n, coords: p.c || inAreaCoord(), type: p.t }; };
  const placeOut = () => {
    const pv = R(PROVINCES), k = R(OUT_KINDS);
    return { name: `${k.pre} จ.${pv.p}`, coords: jitter(pv.c, 0.05), type: k.t };
  };
  // pIn = โอกาสที่ปลายทางอยู่ในพื้นที่ศึกษา (ที่เหลือ = นอกพื้นที่ กระจายจังหวัด)
  const endpoint = (pIn) => Math.random() < pIn ? placeIn() : placeOut();

  // ── ข้อมูลอ้างอิง ──
  const SURVEYORS   = ['ไมค์ สุวรรณ', 'บาส ทรงพล', 'สมชาย บุญมา', 'สุดา แสนดี'];
  const SUPERVISORS = ['ผศ.ดร.วิชัย ศรีสวัสดิ์', 'รศ.สมศรี ใจดี'];

  // vehicleType = key จริงจาก OPT.vehicleTypes (ถ่วงน้ำหนักให้สมจริง)
  const VEH_POOL = [
    'motorcycle', 'motorcycle', 'motorcycle', 'motorcycle',
    'car', 'car', 'car', 'car',
    'truck4', 'truck4', 'truck6', 'truck6',
    'bus_sm', 'bus_lg', 'tuk3', 'bicycle2', 'bicycle3',
  ];

  // purpose ตรง OPT.purpose (ยกเว้นจะ override เป็นขนส่งสำหรับรถบรรทุก)
  const PURP = [
    'กลับบ้าน', 'ไปทำงาน', 'ไปเรียนหนังสือ', 'ติดต่อราชการต่าง ๆ / ธุรกิจ',
    'ไปโรงพยาบาล / คลินิก / อนามัย', 'รับส่งคน หรือ สินค้า', 'ช้อปปิ้ง / ซื้อของใช้ต่าง ๆ',
    'รับประทานอาหาร', 'ท่องเที่ยว / พักผ่อน / ออกกำลังกาย', 'ทำกิจกรรมทางศาสนา',
  ];
  // cargoType ตรง OPT.cargoTypes
  const CARGO = [
    'ข้าว', 'ข้าวเปลือก', 'อ้อย', 'น้ำตาล', 'มันสำปะหลังและผลิตภัณฑ์', 'ผลไม้',
    'ปุ๋ย', 'วัสดุก่อสร้าง', 'ดิน/หิน/ทราย', 'เครื่องจักร', 'สินค้าเบ็ดเตล็ด', 'ยานยนต์',
  ];

  // ทิศทางจริงต่อแกนถนน (ตรง OPT.directionsByAxis)
  const DIRS = {
    'เหนือ–ใต้':          ['มุ่งทิศเหนือ', 'มุ่งทิศใต้'],
    'ตะวันออก–ตะวันตก': ['มุ่งทิศตะวันออก', 'มุ่งทิศตะวันตก'],
  };

  // ── จุดสำรวจ 4 จุด (บนถนนสายหลักในพื้นที่) ──
  const STATIONS = [
    { code: 'RS-01', name: 'จุดสำรวจ ทล.23 บ้านไผ่-มหาสารคาม', road: 'ทางหลวง 23',      coords: '16.058500, 102.740000', sub: 'บ้านไผ่',   axis: 'ตะวันออก–ตะวันตก' },
    { code: 'RS-02', name: 'จุดสำรวจ ทล.229 บ้านไผ่-บัวใหญ่',  road: 'ทางหลวง 229',     coords: '15.970000, 102.770000', sub: 'แคนเหนือ',  axis: 'เหนือ–ใต้' },
    { code: 'RS-03', name: 'จุดสำรวจ ทล.2 ขอนแก่น-นครราชสีมา', road: 'ทางหลวง 2',       coords: '16.045000, 102.810000', sub: 'หินตั้ง',   axis: 'เหนือ–ใต้' },
    { code: 'RS-04', name: 'จุดสำรวจ ทางหลวงชนบท สาย กข.4025', road: 'ทล.ชนบท กข.4025', coords: '15.920000, 102.730000', sub: 'เมืองเพีย', axis: 'ตะวันออก–ตะวันตก' },
  ];

  const makeTime = (hStart, hEnd) => {
    const h = RI(hStart, hEnd);
    const m = R(['00', '10', '15', '20', '30', '40', '45', '50']);
    return `${String(h).padStart(2, '0')}:${m}`;
  };

  const makeInterview = (stId, seq, surveyorName, date, axis) => {
    const veh     = R(VEH_POOL);
    const isTruck = veh.startsWith('truck');
    const isBus   = veh.startsWith('bus');
    const isLocal = veh === 'motorcycle' || veh.startsWith('bicycle') || veh === 'tuk3';

    // รถใหญ่/รถโดยสาร = เดินทางไกล/ข้ามจังหวัดมากกว่า · รถเล็ก = ในพื้นที่มากกว่า
    const pIn    = isTruck ? 0.25 : isBus ? 0.30 : isLocal ? 0.70 : 0.45;
    const origin = endpoint(pIn);
    const dest   = endpoint(pIn);

    const hasCargo = (isTruck || Math.random() < 0.12) ? 'มีสินค้า' : 'ไม่มีสินค้า';

    return {
      id:                'IV-mock-' + uid(),
      stationId:         stId,
      seq,
      surveyorName,
      interviewDate:     date,
      interviewTime:     makeTime(6, 18),
      vehicleType:       veh,
      passengerCount:    String(isBus ? RI(5, 30) : isTruck ? RI(1, 2) : RI(1, 4)),
      travelDirection:   R(DIRS[axis]),
      originType:        origin.type,
      originName:        origin.name,
      originCoords:      origin.coords,
      destinationType:   dest.type,
      destinationName:   dest.name,
      destinationCoords: dest.coords,
      purpose:           isTruck ? 'รับส่งคน หรือ สินค้า' : R(PURP),
      hasCargo,
      cargoType:         hasCargo === 'มีสินค้า' ? R(CARGO) : '',
      cargoWeight:       hasCargo === 'มีสินค้า' ? String(RI(500, 20000)) : '',
      driverIncome:      isTruck ? String(RI(9000, 30000)) : '',
      createdAt:         new Date().toISOString(),
    };
  };

  // ── Build stations + interviews ──
  const SURVEY_DATES = ['2026-05-20', '2026-05-21', '2026-05-22', '2026-05-23'];
  const newStations = STATIONS.map((s, si) => {
    const date     = SURVEY_DATES[si % SURVEY_DATES.length];
    const surveyor = SURVEYORS[si % SURVEYORS.length];
    const ivCount  = RI(35, 50);
    const interviews = Array.from({ length: ivCount }, (_, j) =>
      makeInterview('RS-mock-' + s.code, j + 1, surveyor, date, s.axis)
    );
    return {
      id:             'RS-mock-' + s.code,
      surveyDate:     date,
      surveyorName:   surveyor,
      supervisorName: R(SUPERVISORS),
      stationName:    s.name,
      stationCode:    s.code,
      road:           s.road,
      direction:      DIRS[s.axis].join(' / '),
      coordinates:    s.coords,
      subdistrict:    s.sub,
      district:       'บ้านไผ่',
      province:       'ขอนแก่น',
      deviceId:       'mock-gen-001',
      clientIp:       '0.0.0.0',
      createdAt:      new Date().toISOString(),
      interviews,
    };
  });

  // Merge with existing (ลบ mock เก่าออก)
  let db = { stations: [] };
  try { db = JSON.parse(localStorage.getItem('ri_survey_v1') || '{"stations":[]}'); } catch {}
  db.stations = db.stations.filter(s => !s.id.startsWith('RS-mock-'));
  db.stations.push(...newStations);
  localStorage.setItem('ri_survey_v1', JSON.stringify(db));

  const totalIV = newStations.reduce((s, st) => s + st.interviews.length, 0);
  console.log(`✅ สร้าง ${newStations.length} จุดสำรวจ · ${totalIV} สัมภาษณ์`);
  console.log('👉 login admin แล้วกด ☁️ Sync เพื่ออัปโหลดขึ้น Firebase');
  if (typeof App !== 'undefined' && typeof DB !== 'undefined') { DB._data = null; DB.load(); App.navigate('home'); }
})();
