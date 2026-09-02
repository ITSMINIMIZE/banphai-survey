// ชุดทดสอบกฎตรวจสอบข้อมูล (Issues) ของ Home Interview
//
// ทำไมต้องมี: กฎพวกนี้คือสิ่งที่ทำให้ข้อมูลสำรวจเชื่อถือได้ และแก้มาหลายรอบจากบั๊กหน้างานจริง
// ถ้าเผลอทำหายตอนแก้อย่างอื่น จะไม่มีอะไรฟ้อง — แอปยังเปิดได้ปกติ แค่เลิกเตือนเงียบ ๆ
//
//   รัน:  node tools/test/rules.test.js

const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '../../Home/js/data.js'), 'utf8');
const ctx = {
  console,
  indexedDB:    { open() { throw new Error('ไม่ควรถูกเรียกในเทสต์นี้'); } },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} }
};
vm.createContext(ctx);
// const ระดับบนสุดของสคริปต์ไม่ไปอยู่บน global object — ต้องต่อบรรทัดส่งออกเอง
vm.runInContext(src + '\n;globalThis.__x = { Issues, OPT, DB, gridBucket, needOther, validCoords };',
  ctx, { filename: 'data.js' });
const { Issues, OPT } = ctx.__x;

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log('  ✅ ' + name); }
  catch (e) { fail++; console.log('  ❌ ' + name + '\n       ' + e.message); }
};
const eq = (g, w, what) => { if (g !== w) throw new Error(`${what||''} ได้ ${JSON.stringify(g)} ต้องการ ${JSON.stringify(w)}`); };
const has = (arr, sub, what) => {
  if (!arr.some(x => x.includes(sub))) throw new Error(`${what||''} ไม่พบ "${sub}" · มี: ${JSON.stringify(arr)}`);
};

const trip = (o = {}) => ({
  id: o.id || 'T1', seq: o.seq || 1,
  origin: 'บ้าน', originCoords: '16.05, 102.73', originType: 'ที่พัก / บ้านของตัวเอง',
  destination: 'ที่ทำงาน', destinationCoords: '16.06, 102.74',
  destinationType: 'บริษัทเอกชน / ห้าง / ธนาคาร',
  departureTime: '08:00', arrivalTime: '08:30', purpose: 'ไปทำงาน',
  segments: [{ mode: 'เดิน', duration: '30', fare: '' }], ...o
});
const member = (o = {}) => ({
  id: o.id || 'M1', seq: o.seq || 1, gender: 'ชาย', age: '30',
  homeStatus: 'เจ้าบ้านผู้ชาย', workStatus: 'ทำงาน',
  occupation: 'พนักงานบริษัท / ห้างร้าน / ธนาคาร', education: 'ปริญญาตรี',
  workplaceName: 'บริษัท', workplaceCoords: '16.06, 102.74', income: '20000',
  trips: o.trips || [], ...o
});
const roundTrip = () => [
  trip({ id: 'T1', seq: 1, purpose: 'ไปทำงาน' }),
  trip({ id: 'T2', seq: 2, purpose: 'กลับบ้าน',
         originCoords: '16.06, 102.74', destinationCoords: '16.05, 102.73',
         destinationType: 'ที่พัก / บ้านของตัวเอง' })
];
const household = (o = {}) => ({
  id: 'HH1', coordinates: '16.05, 102.73',
  surveyorName: 'ทดสอบ ระบบ', supervisorName: 'หัวหน้า ทีม',
  subdistrict: 'เทศบาลเมืองบ้านไผ่', houseNo: '1', residentialType: 'บ้านเดี่ยว',
  memberGrid: o.memberGrid || { m_work: 1 },
  householdIncome: '20000', hasVehicle: 'ไม่มี', vehicles: {},
  members: o.members || [], ...o
});

console.log('\n═══ สมาชิกที่ไม่มีการเดินทาง ═══');

t('สมาชิกไม่มีเที่ยวเลย = ต้องแก้ (ระดับคน)', () => {
  const r = Issues.member(member({ trips: [] }));
  has(r.hard, 'เดินทาง', 'สมาชิก 0 เที่ยว');
});

t('บ้านที่มีสมาชิกบางคนไม่เดินทาง ต้องขึ้นแดง', () => {
  // เคสจริงที่หลุด: บ้าน 2 คน คนแรกเดินทางครบ คนที่สองไม่มีเที่ยวเลย
  // กฎระดับบ้านเดิมใช้ .some() จึงผ่าน เพราะ "มีอย่างน้อยหนึ่งคนที่เดินทาง"
  const hh = household({
    memberGrid: { m_work: 2 },
    members: [ member({ id:'M1', seq:1, trips: roundTrip() }),
               member({ id:'M2', seq:2, trips: [] }) ]
  });
  const q = Issues.forHousehold(hh);
  if (!q.hard) throw new Error('บ้านไม่ขึ้นแดง ทั้งที่คนที่ 2 ไม่มีเที่ยวเลย');
});

t('ปัญหาชี้ไปที่ "คนที่ 2" ไม่ใช่บ้านรวม ๆ', () => {
  const hh = household({
    memberGrid: { m_work: 2 },
    members: [ member({ id:'M1', seq:1, trips: roundTrip() }),
               member({ id:'M2', seq:2, trips: [] }) ]
  });
  const d = Issues.forHousehold(hh).details.find(x => x.where.includes('คนที่ 2'));
  if (!d) throw new Error('ไม่มีรายละเอียดที่ชี้ไปคนที่ 2 · มี: ' +
    JSON.stringify(Issues.forHousehold(hh).details.map(x => x.where)));
  has(d.hard, 'เดินทาง', 'คนที่ 2');
});

t('ทุกคนไม่เดินทางเลย = ยังขึ้นแดง (ไม่ถอยหลัง)', () => {
  const hh = household({ members: [ member({ trips: [] }) ] });
  const q = Issues.forHousehold(hh);
  if (!q.hard) throw new Error('บ้านที่ไม่มีใครเดินทางเลยต้องขึ้นแดง');
});

t('ปัญหาเดียวต้องไม่ถูกนับสองครั้ง', () => {
  // บ้าน 1 คน ไม่มีเที่ยวเลย = ปัญหา 1 อย่าง ไม่ใช่ 2
  // (เดิมมีทั้งกฎระดับบ้านและระดับคนพูดเรื่องเดียวกัน เลขบนการ์ดจึงเฟ้อ)
  const hh = household({ members: [ member({ trips: [] }) ] });
  eq(Issues.forHousehold(hh).hard, 1, 'จำนวนปัญหา · ' +
     JSON.stringify(Issues.forHousehold(hh).details));
});

t('ไม่มีสมาชิกเลย = เตือนคนละเรื่องกัน', () => {
  has(Issues.household(household({ members: [] })).hard, 'ยังไม่มีสมาชิก');
});

console.log('\n═══ กฎเดิมต้องไม่ถอยหลัง ═══');

t('บ้านที่ข้อมูลครบ = ไม่มีปัญหาต้องแก้', () => {
  const hh = household({ members: [ member({ trips: roundTrip() }) ] });
  const q = Issues.forHousehold(hh);
  eq(q.hard, 0, 'ไม่ควรมีปัญหา · ' + JSON.stringify(q.details));
});

t('มีเที่ยวเดียว = ต้องแก้', () => {
  has(Issues.member(member({ trips: [trip()] })).hard, 'เที่ยวเดียว');
});

t('เที่ยวแรกเป็น "กลับบ้าน" ไม่ได้', () => {
  const m = member({ trips: [trip({ purpose: 'กลับบ้าน' })] });
  has(Issues.tripInChain(m, m.trips[0]).hard, 'เที่ยวแรก');
});

t('ต้นทาง–ปลายทางหมุดเดียวกัน = ต้องแก้', () => {
  const m = member({ trips: [trip({ originCoords: '16.05, 102.73', destinationCoords: '16.05, 102.73' })] });
  has(Issues.tripInChain(m, m.trips[0]).hard, 'หมุดเดียวกัน');
});

t('ไม่มีเที่ยวกลับบ้าน = ต้องแก้', () => {
  const m = member({ trips: [
    trip({ id:'T1', seq:1, purpose:'ไปทำงาน' }),
    trip({ id:'T2', seq:2, purpose:'ไปเรียนหนังสือ' })
  ]});
  has(Issues.member(m).hard, 'กลับบ้าน');
});

t('สมาชิกเกินตารางสรุป = ต้องแก้', () => {
  const hh = household({
    memberGrid: { m_work: 1 },
    members: [ member({ id:'M1', seq:1, trips: roundTrip() }),
               member({ id:'M2', seq:2, trips: roundTrip() }) ]
  });
  has(Issues.household(hh).hard, 'เกินตาราง');
});

console.log(`\n${'─'.repeat(46)}\nผ่าน ${pass} · ไม่ผ่าน ${fail}\n`);
process.exit(fail ? 1 : 0);
