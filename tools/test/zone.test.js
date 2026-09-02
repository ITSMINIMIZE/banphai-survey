// ชุดทดสอบการจัดโซนของบ้าน (ZoneService)
//
// เส้นแบ่ง "ในพื้นที่ / นอกพื้นที่" ต้องตรงกับที่ Dashboard ใช้เสมอ (config/zones.internalMax)
// ถ้าไม่ตรง แอปกับรายงานจะบอกคนละเรื่องว่าบ้านหลังไหนอยู่นอกพื้นที่
//
//   รัน:  node tools/test/zone.test.js

const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = { console, FB: { db: null, init() {} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../Home/js/zone-service.js'), 'utf8') +
  '\n;globalThis.__x = { ZoneService };', ctx, { filename: 'zone-service.js' });
const Z = ctx.__x.ZoneService;

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log('  ✅ ' + name); }
  catch (e) { fail++; console.log('  ❌ ' + name + '\n       ' + e.message); }
};
const eq = (g, w, what) => { if (g !== w) throw new Error(`${what||''} ได้ ${JSON.stringify(g)} ต้องการ ${JSON.stringify(w)}`); };

// รูปโซนสมมติ: สี่เหลี่ยมสองรูป — รูปหนึ่งในพื้นที่ อีกรูปนอกพื้นที่
const box = (n, name, minLat, maxLat, minLon, maxLon) => ({
  properties: { N: n, D_NAME: name, name: 'โซน ' + n },
  geometry: { type: 'Polygon', coordinates: [[
    [minLon, minLat], [maxLon, minLat], [maxLon, maxLat], [minLon, maxLat], [minLon, minLat]
  ]]}
});
function setup(internalMax) {
  Z._features = [ box(10, 'บ้านไผ่', 16.0, 16.1, 102.7, 102.8),
                  box(135, 'นครราชสีมา', 14.9, 15.1, 102.0, 102.2) ];
  Z.internalMax = internalMax;
  Z._memo = new Map(); Z._infoMemo = new Map();
}

console.log('\n═══ จัดบ้านเข้าโซน ═══');

t('พิกัดในโซน → ได้เลขโซนกับชื่อพื้นที่', () => {
  setup(131);
  const i = Z.info('16.05, 102.75');
  eq(i.known, true); eq(i.n, 10); eq(i.district, 'บ้านไผ่'); eq(i.outside, false);
});

t('โซนเลขเกินเส้นแบ่ง = นอกพื้นที่ศึกษา', () => {
  setup(131);
  const i = Z.info('15.0, 102.1');
  eq(i.n, 135); eq(i.outside, true, 'โซน 135 > 131');
  eq(i.district, 'นครราชสีมา');
});

t('พิกัดที่ไม่ตกในรูปไหนเลย = นอกพื้นที่ด้วย', () => {
  setup(131);
  const i = Z.info('13.75, 100.50');
  eq(i.known, true); eq(i.n, null); eq(i.outside, true);
});

t('ไม่มีพิกัด / พิกัดใช้ไม่ได้ = ไม่รู้จัก (ไม่ต้องแสดงป้าย)', () => {
  setup(131);
  eq(Z.info('').known, false);
  eq(Z.info('ไม่มี').known, false);
  eq(Z.info(null).known, false);
});

t('ยังไม่โหลดโซน = ไม่รู้จัก (แอปต้องไม่พัง)', () => {
  Z._features = null; Z._infoMemo = new Map();
  eq(Z.info('16.05, 102.75').known, false);
});

console.log('\n═══ เส้นแบ่งต้องปรับตามชุดโซนได้ ═══');

t('เปลี่ยน internalMax แล้วผลเปลี่ยนตาม', () => {
  setup(140);                       // ขยับเส้นแบ่งให้ 135 กลายเป็นในพื้นที่
  eq(Z.info('15.0, 102.1').outside, false, 'โซน 135 เมื่อเส้นแบ่ง = 140');
  setup(5);                         // ลดเส้นแบ่งจน 10 กลายเป็นนอกพื้นที่
  eq(Z.info('16.05, 102.75').outside, true, 'โซน 10 เมื่อเส้นแบ่ง = 5');
});

console.log('\n═══ assign() เดิมต้องไม่ถอยหลัง (Export ใช้อยู่) ═══');

t('assign คืนเลขโซนเหมือนเดิม', () => {
  setup(131);
  eq(Z.assign('16.05, 102.75'), 10);
});

t('assign คืน (นอกพื้นที่) เมื่อไม่ตกรูปไหน', () => {
  setup(131);
  eq(Z.assign('13.75, 100.50'), '(นอกพื้นที่)');
});

t('assign คืน (ไม่มีพิกัด) เมื่อพิกัดใช้ไม่ได้', () => {
  setup(131);
  eq(Z.assign(''), '(ไม่มีพิกัด)');
});

console.log(`\n${'─'.repeat(46)}\nผ่าน ${pass} · ไม่ผ่าน ${fail}\n`);
process.exit(fail ? 1 : 0);
