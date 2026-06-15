// ===== ROADSIDE MOCK DATA GENERATOR =====
// วางใน browser console ตอนเปิดแอป Roadside แล้วกด ☁️ Sync
// สร้างข้อมูลจำลอง: 4 จุดสำรวจ × ~40 คัน = ~160 สัมภาษณ์

(function () {
  const R  = (a) => a[Math.floor(Math.random() * a.length)];
  const RI = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;
  const RF = (lo, hi, dec = 6) => +(lo + Math.random() * (hi - lo)).toFixed(dec);
  const uid = () => Math.random().toString(36).slice(2, 10);

  // ── พิกัดจากโซนจริง (lat 15.876–16.189, lon 102.638–102.902) ──
  const ZONE_CENTERS = [
    [16.032, 102.770], [15.994, 102.751], [16.020, 102.770], [15.958, 102.777],
    [15.909, 102.764], [16.063, 102.745], [15.975, 102.730], [16.095, 102.780],
    [16.045, 102.810], [15.940, 102.810], [16.110, 102.730], [15.920, 102.730],
    [16.070, 102.810], [15.970, 102.800], [16.150, 102.760], [15.885, 102.780],
    [16.130, 102.800], [15.897, 102.700], [16.005, 102.810], [16.075, 102.700],
    [15.960, 102.680], [16.100, 102.690], [15.920, 102.850], [16.050, 102.860],
  ];

  // พิกัดนอกพื้นที่ (จำลองต้นทาง-ปลายทางจากนอกอำเภอ)
  const EXTERNAL = [
    [16.440, 102.834], // ขอนแก่นเมือง
    [16.006, 103.127], // มหาสารคาม
    [15.680, 102.820], // บัวใหญ่
    [15.790, 102.560], // ชัยภูมิ
    [16.350, 103.000], // กาฬสินธุ์
    [15.500, 102.900], // นครราชสีมา (ทิศใต้)
  ];

  const randInZone  = (s = 0.015) => {
    const [clat, clon] = ZONE_CENTERS[RI(0, ZONE_CENTERS.length - 1)];
    return `${RF(clat - s, clat + s)}, ${RF(clon - s, clon + s)}`;
  };
  const randExternal = () => {
    const [lat, lon] = EXTERNAL[RI(0, EXTERNAL.length - 1)];
    return `${RF(lat - 0.05, lat + 0.05)}, ${RF(lon - 0.05, lon + 0.05)}`;
  };
  // 70% ในโซน, 30% นอกพื้นที่ (สมจริงกับ roadside)
  const randCoord = () => Math.random() < 0.70 ? randInZone() : randExternal();

  // ── สถานที่ใน/นอกพื้นที่ ──
  const PLACES_IN = [
    { n: 'ตลาดบ้านไผ่',              c: '16.0612, 102.7298', t: 'ตลาด / ร้านค้า' },
    { n: 'โรงพยาบาลบ้านไผ่',        c: '16.0601, 102.7287', t: 'สถานที่ราชการ' },
    { n: 'สถานีรถไฟบ้านไผ่',        c: '16.0540, 102.7365', t: 'สถานีขนส่ง' },
    { n: 'โรงงานนิคมอุตสาหกรรม',    c: '16.0480, 102.7420', t: 'ที่ทำงาน' },
    { n: 'ตลาดชุมชนบ้านลาน',         c: '15.9820, 102.7930', t: 'ตลาด / ร้านค้า' },
    { n: 'เทศบาลเมืองบ้านไผ่',       c: '16.0595, 102.7320', t: 'สถานที่ราชการ' },
    { n: 'โรงเรียนบ้านไผ่',          c: '16.0578, 102.7334', t: 'สถาบันการศึกษา' },
    { n: 'ไร่อ้อยใกล้บ้านไผ่',        c: null, t: 'เกษตรกรรม' },
    { n: 'ที่ทำงานในอำเภอ',           c: null, t: 'ที่ทำงาน' },
  ];
  const PLACES_OUT = [
    { n: 'ตลาดขอนแก่น',              c: '16.4400, 102.8340', t: 'ตลาด / ร้านค้า' },
    { n: 'มหาวิทยาลัยขอนแก่น',       c: '16.4700, 102.8200', t: 'สถาบันการศึกษา' },
    { n: 'โรงพยาบาลศรีนครินทร์',     c: '16.4760, 102.8160', t: 'สถานที่ราชการ' },
    { n: 'ตลาดมหาสารคาม',            c: '16.0060, 103.1270', t: 'ตลาด / ร้านค้า' },
    { n: 'ที่ทำงานในจังหวัด',         c: null, t: 'ที่ทำงาน' },
    { n: 'บ้านพักในต่างอำเภอ',        c: null, t: 'ที่พักอาศัย / บ้าน' },
  ];

  const randPlace = (forceExternal = false) => {
    const pool = forceExternal
      ? PLACES_OUT
      : (Math.random() < 0.65 ? PLACES_IN : PLACES_OUT);
    const p = R(pool);
    return { name: p.n, coords: p.c || randCoord(), type: p.t };
  };

  // ── ข้อมูลอ้างอิง ──
  const SURVEYORS   = ['ไมค์ สุวรรณ', 'บาส ทรงพล', 'สมชาย บุญมา', 'สุดา แสนดี'];
  const SUPERVISORS = ['ผศ.ดร.วิชัย ศรีสวัสดิ์', 'รศ.สมศรี ใจดี'];
  const VEH_TYPES   = [
    'รถจักรยานยนต์', 'รถยนต์นั่งส่วนบุคคล', 'รถกระบะ (ปิ๊กอัพ)',
    'รถตู้โดยสาร', 'รถบัส / รถโดยสารประจำทาง',
    'รถบรรทุก 4 ล้อ (เล็ก)', 'รถบรรทุก 6 ล้อ', 'รถบรรทุก 10 ล้อ+', 'รถพ่วง / เทรลเลอร์'
  ];
  const PURPOSES    = ['ทำงาน', 'เรียน', 'ธุระส่วนตัว', 'ซื้อของ / บริการ', 'ขนส่งสินค้า', 'พักผ่อน / ท่องเที่ยว', 'กลับบ้าน'];
  const CARGO_TYPES = ['ข้าวสาร / ข้าวเปลือก', 'อ้อย', 'มันสำปะหลัง', 'ผลไม้', 'สินค้าอุปโภคบริโภค', 'วัสดุก่อสร้าง', 'ปุ๋ย / เคมีเกษตร', 'เครื่องจักร / อุปกรณ์'];
  const DIRECTIONS  = ['ไปทาง ขอนแก่น', 'ไปทาง มหาสารคาม', 'ไปทาง บัวใหญ่', 'ไปทาง ชัยภูมิ'];

  // ── จุดสำรวจ 4 จุด (บนถนนสายหลักในพื้นที่) ──
  const STATIONS = [
    { code: 'RS-01', name: 'จุดสำรวจ ทล.23 บ้านไผ่-มหาสารคาม',   road: 'ทางหลวง 23',  coords: '16.058500, 102.740000', sub: 'บ้านไผ่', dir: 'ไปทาง มหาสารคาม / ไปทาง บ้านไผ่' },
    { code: 'RS-02', name: 'จุดสำรวจ ทล.229 บ้านไผ่-บัวใหญ่',    road: 'ทางหลวง 229', coords: '15.970000, 102.770000', sub: 'แคนเหนือ', dir: 'ไปทาง บัวใหญ่ / ไปทาง บ้านไผ่' },
    { code: 'RS-03', name: 'จุดสำรวจ ทล.2 ขอนแก่น-นครราชสีมา',   road: 'ทางหลวง 2',   coords: '16.045000, 102.810000', sub: 'หินตั้ง', dir: 'ไปทาง ขอนแก่น / ไปทาง นครราชสีมา' },
    { code: 'RS-04', name: 'จุดสำรวจ ทางหลวงชนบท สาย กข.4025',   road: 'ทล.ชนบท กข.4025', coords: '15.920000, 102.730000', sub: 'เมืองเพีย', dir: 'ไปทาง เมืองเพีย / ไปทาง ในเมือง' },
  ];

  const makeTime = (hStart, hEnd) => {
    const h = RI(hStart, hEnd);
    const m = R(['00','10','15','20','30','40','45','50']);
    return `${String(h).padStart(2,'0')}:${m}`;
  };

  const makeInterview = (stId, seq, surveyorName, date) => {
    const veh = R(VEH_TYPES);
    const isTruck = veh.includes('บรรทุก') || veh.includes('พ่วง');
    const isPassenger = ['รถบัส','รถตู้'].some(v => veh.includes(v));

    const origin = randPlace(Math.random() < 0.3);
    const dest   = randPlace(Math.random() < 0.3);

    const hasCargo = isTruck ? 'มี' : (Math.random() < 0.1 ? 'มี' : 'ไม่มี');

    return {
      id:                   'IV-mock-' + uid(),
      stationId:            stId,
      seq,
      surveyorName,
      interviewDate:        date,
      interviewTime:        makeTime(6, 18),
      vehicleType:          veh,
      passengerCount:       String(isPassenger ? RI(5, 30) : isTruck ? RI(1, 2) : RI(1, 4)),
      travelDirection:      R(DIRECTIONS),
      originType:           origin.type,
      originName:           origin.name,
      originCoords:         origin.coords,
      destinationType:      dest.type,
      destinationName:      dest.name,
      destinationCoords:    dest.coords,
      purpose:              isTruck ? 'ขนส่งสินค้า' : R(PURPOSES),
      hasCargo,
      cargoType:            hasCargo === 'มี' ? R(CARGO_TYPES) : '',
      cargoWeight:          hasCargo === 'มี' ? String(RI(500, 20000)) : '',
      driverIncome:         isTruck ? String(RI(500, 2000)) : '',
      createdAt:            new Date().toISOString(),
    };
  };

  // ── Build stations + interviews ──
  const SURVEY_DATES = ['2026-05-20', '2026-05-21', '2026-05-22', '2026-05-23'];
  const newStations = STATIONS.map((s, si) => {
    const date = SURVEY_DATES[si % SURVEY_DATES.length];
    const surveyor = SURVEYORS[si % SURVEYORS.length];
    const ivCount  = RI(35, 50);
    const interviews = Array.from({ length: ivCount }, (_, j) =>
      makeInterview('RS-mock-' + s.code, j + 1, surveyor, date)
    );
    return {
      id:             'RS-mock-' + s.code,
      surveyDate:     date,
      surveyorName:   surveyor,
      supervisorName: R(SUPERVISORS),
      stationName:    s.name,
      stationCode:    s.code,
      road:           s.road,
      direction:      s.dir,
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
