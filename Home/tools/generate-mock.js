// ===== MOCK DATA GENERATOR =====
// วางใน browser console ตอนเปิดแอป แล้วกด ☁️ Sync
// สร้างข้อมูลจำลอง 100 ครัวเรือน ในพื้นที่บ้านไผ่ จ.ขอนแก่น

(function () {
  const R = (a) => a[Math.floor(Math.random() * a.length)];
  const RI = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;
  const uid = () => Math.random().toString(36).slice(2, 10);

  // พิกัดจริงจาก zone boundary (lat 15.876–16.189, lon 102.638–102.902)
  // ใช้ zone centroid แล้วบวก offset เล็กน้อย เพื่อให้จุดอยู่ในโซนจริง
  const ZONE_CENTERS = [
    [16.032,102.770],[15.994,102.751],[16.020,102.770],[15.958,102.777],[15.909,102.764],
    [16.063,102.745],[15.975,102.730],[16.095,102.780],[16.045,102.810],[15.940,102.810],
    [16.110,102.730],[15.920,102.730],[16.070,102.810],[15.970,102.800],[16.150,102.760],
    [15.885,102.780],[16.130,102.800],[15.897,102.700],[16.005,102.810],[16.075,102.700],
    [15.960,102.680],[16.100,102.690],[15.920,102.850],[16.050,102.860],[16.000,102.680],
  ];
  const coord = (s = 0.015) => {
    const [clat, clon] = ZONE_CENTERS[Math.floor(Math.random() * ZONE_CENTERS.length)];
    return `${(clat + (Math.random() - .5) * s * 2).toFixed(6)}, ${(clon + (Math.random() - .5) * s * 2).toFixed(6)}`;
  };

  const SURVEYORS   = ['ไมค์ สุวรรณ', 'บาส ทรงพล', 'สมชาย บุญมา', 'สุดา แสนดี'];
  const SUPERVISORS = ['ผศ.ดร.วิชัย ศรีสวัสดิ์', 'รศ.สมศรี ใจดี', 'ดร.ประภา ทองคำ'];
  const SUBS   = ['บ้านไผ่','ในเมือง','เมืองเพีย','บ้านลาน','แคนเหนือ','ภูเหล็ก','ป่าปอ','หินตั้ง','หนองน้ำใส','ขามเรียง'];
  const RTYPES = ['บ้านเดี่ยว','ตึกแถว','ทาวน์เฮ้าส์'];
  // ⚠️ ทุกค่าอ้างอิงรายการจริงใน data.js (OPT) เป๊ะ — ห้ามแต่งเอง ไม่งั้นแอปจับคู่ไม่ได้
  const WSTAT  = ['ทำงาน','เรียนหนังสือ','ไม่ทำงาน (อยู่บ้านเฉย ๆ)'];                                 // OPT.workStatus
  const OCC    = ['เกษตรกร / ประมง / เลี้ยงสัตว์','ข้าราชการ / รัฐวิสาหกิจ','พนักงานบริษัท / ห้างร้าน / ธนาคาร','ลูกจ้าง / คนงาน / พนักงานโรงงาน','นักเรียน / นักศึกษา']; // OPT.occupation
  const EDU    = ['ประถมศึกษา (ป.1–ป.6)','มัธยมศึกษา (ม.1–ม.6)','อนุปริญญา / ปวช. / ปวส.','ปริญญาตรี']; // OPT.education
  const PURP   = ['ทำงาน','เรียนหนังสือ','ซื้อของ / ธุรกรรม','พบแพทย์ / รักษาพยาบาล','นันทนาการ / ท่องเที่ยว','เยี่ยมญาติ / พบปะสังสรรค์']; // OPT.purpose (ยกเว้น 'กลับบ้าน')
  const MODES  = ['รถจักรยานยนต์ส่วนตัว','รถยนต์นั่งส่วนบุคคล (รถเก๋ง / ปิ๊กอัพ)','เดิน','รถจักรยานยนต์รับจ้าง','รถสองแถว / รถประจำทาง']; // OPT.tripMode
  const FARE_MODES = ['รถจักรยานยนต์รับจ้าง','รถสองแถว / รถประจำทาง'];
  // ปลายทางในพื้นที่ศึกษา (บ้านไผ่) — Home: การเดินทางส่วนใหญ่อยู่ในพื้นที่ · type ตรง OPT.locationType
  const DESTS  = [
    { n: 'ตลาดบ้านไผ่',           c: '16.061200, 102.729800', t: 'ตลาด / ร้านค้า' },
    { n: 'โรงเรียนบ้านไผ่',       c: '16.057800, 102.733400', t: 'โรงเรียน / สถาบันการศึกษา' },
    { n: 'โรงพยาบาลบ้านไผ่',     c: '16.060100, 102.728700', t: 'โรงพยาบาล / คลินิก' },
    { n: 'เทศบาลเมืองบ้านไผ่',   c: '16.059500, 102.732000', t: 'สถานที่ราชการ' },
    { n: 'สถานีรถไฟบ้านไผ่',     c: '16.054000, 102.736500', t: 'สถานีขนส่ง / สถานีรถไฟ' },
    { n: 'วัดบ้านไผ่',             c: '16.056800, 102.730100', t: 'วัด / ศาสนสถาน' },
    { n: 'โรงงานในนิคมอุตสาหกรรม', c: '16.048000, 102.742000', t: 'โรงงาน / นิคมอุตสาหกรรม' },
    { n: 'ตลาดชุมชนบ้านลาน',      c: '15.982000, 102.793000', t: 'ตลาด / ร้านค้า' },
    { n: 'โรงเรียนแคนเหนือ',       c: '15.940000, 102.770000', t: 'โรงเรียน / สถาบันการศึกษา' },
    { n: 'วัดหินตั้ง',             c: '16.095000, 102.780000', t: 'วัด / ศาสนสถาน' },
    { n: 'อบต.เมืองเพีย',          c: '15.910000, 102.810000', t: 'สถานที่ราชการ' },
    { n: 'ตลาดป่าปอ',              c: '16.075000, 102.700000', t: 'ตลาด / ร้านค้า' },
    { n: 'ร้านค้าในหมู่บ้าน',     c: null, t: 'ตลาด / ร้านค้า' },
    { n: 'ที่ทำงานในตำบล',         c: null, t: 'สำนักงาน / ที่ทำงาน' },
    { n: 'โรงเรียนในตำบล',         c: null, t: 'โรงเรียน / สถาบันการศึกษา' },
  ];

  const addMin = (t, m) => {
    const [h, mn] = t.split(':').map(Number);
    const tot = h * 60 + mn + m;
    return `${String(Math.floor(tot / 60) % 24).padStart(2,'0')}:${String(tot % 60).padStart(2,'0')}`;
  };

  const makeTrips = (homeAddr, homeCoord) => {
    const n = RI(2, 4);
    const trips = [];
    let time = `${RI(6, 8)}:${R(['00','15','30','45'])}`;
    let orgAddr = homeAddr, orgCoord = homeCoord, orgType = 'ที่พักอาศัย / บ้าน';

    for (let i = 0; i < n; i++) {
      const isLast = i === n - 1;
      const purp = isLast ? 'กลับบ้าน' : R(PURP);
      const d = isLast
        ? { n: homeAddr, c: homeCoord, t: 'ที่พักอาศัย / บ้าน' }
        : { ...R(DESTS), c: R(DESTS).c || coord(0.02) };
      const mode = R(MODES);
      const dur  = RI(5, 40);
      const fare = FARE_MODES.includes(mode) ? String(R([20,30,40,50,60])) : '';
      const arr  = addMin(time, dur);
      trips.push({
        id: 'T-' + uid(),
        origin: orgAddr, originCoords: orgCoord, originType: orgType,
        departureTime: time,
        destination: d.n, destinationCoords: d.c, destinationType: d.t,
        arrivalTime: arr,
        purpose: purp,
        segments: [{ mode, duration: String(dur), fare }],
        parkingLocation: '', parkingFee: ''
      });
      time = addMin(arr, RI(30, 180));
      orgAddr = d.n; orgCoord = d.c; orgType = d.t;
    }
    return trips;
  };

  const makeHH = (i) => {
    const sub = R(SUBS), moo = RI(1,12);
    const houseNo = `${RI(1,300)}`;
    const c = coord();
    const homeAddr = `บ้านเลขที่ ${houseNo} ม.${moo} ต.${sub}`;
    const nMem = RI(1, 4);
    const grid = { m_study:0, m_work:0, m_notw:0, f_study:0, f_work:0, f_notw:0, m_child:0, f_child:0 };

    const members = Array.from({ length: nMem }, (_, j) => {
      const g = R(['ชาย','หญิง']);
      const key = g === 'ชาย' ? R(['m_work','m_work','m_study','m_notw']) : R(['f_work','f_work','f_study','f_notw']);
      grid[key]++;
      const inc = RI(1,8) * 5000;
      return {
        id: 'M-' + uid(), seq: j + 1,
        gender: g, age: RI(15, 65),
        homeStatus: R(['พ่อบ้าน','แม่บ้าน','ลูก','ญาติ']),
        workStatus: R(WSTAT), occupation: R(OCC), education: R(EDU),
        income: String(inc),
        workplaceName:'', workplaceAlley:'', workplaceRoad:'',
        workplaceSubdistrict:'', workplaceDistrict:'', workplaceProvince:'',
        trips: makeTrips(homeAddr, c)
      };
    });

    const memIncome = members.reduce((s,m) => s + (+m.income||0), 0);
    const hasV = Math.random() > .25 ? 'มี' : 'ไม่มี';
    const vehicles = hasV === 'มี'
      ? { motorcycle: { private: RI(1,2), company:0, gov:0 } }
      : {};

    return {
      id: `HH-mock-${String(i).padStart(3,'0')}-${uid()}`,
      surveyDate: '2026-05-23', travelDate: '2026-05-23',
      surveyorName: R(SURVEYORS), supervisorName: R(SUPERVISORS),
      subdistrict: sub, district: 'บ้านไผ่', province: 'ขอนแก่น',
      areaCode: '', houseNo, moo: String(moo), alley: '', road: '',
      phone: `08${RI(0,9)}${RI(1000000,9999999)}`,
      coordinates: c, residentialType: R(RTYPES),
      memberGrid: grid, householdIncome: memIncome,
      hasVehicle: hasV, vehicles,
      deviceId: 'mock-gen-001', clientIp: '0.0.0.0',
      createdAt: new Date().toISOString(), members
    };
  };

  // สร้าง 100 ครัวเรือน
  const newHHs = Array.from({ length: 100 }, (_, i) => makeHH(i + 1));
  let db = { households: [] };
  try { db = JSON.parse(localStorage.getItem('hi_survey_v2') || '{"households":[]}'); } catch {}
  // ลบ mock เก่าออกก่อน แล้วใส่ใหม่
  db.households = db.households.filter(h => !h.id.startsWith('HH-mock-'));
  db.households.push(...newHHs);
  localStorage.setItem('hi_survey_v2', JSON.stringify(db));

  console.log(`✅ สร้าง 100 ครัวเรือนจำลอง — รวม ${db.households.length} ครัวเรือน`);
  console.log('👉 กด ☁️ Sync เพื่ออัปโหลดขึ้น Firebase');
  if (typeof App !== 'undefined') { DB.load(); App.navigate('home'); }
})();
