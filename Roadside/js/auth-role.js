// ===== ROLE — อ่านสิทธิ์ของบัญชีจาก users/{uid} =====
// ระดับ: admin (ทำได้ทุกอย่าง) · staff (ผู้ควบคุม — เห็น/แก้เฉพาะทีมตัวเอง) · null (ผู้สำรวจ/ไม่มีสิทธิ์)
//
// ⚠️ cache เป็นแค่เรื่องความเร็ว (UX) ไม่ใช่ความปลอดภัย —
//    สิทธิ์จริงบังคับที่ Firestore rules ซึ่งอ่าน users/{uid} สดทุกครั้งที่เขียนของสำคัญ
//
// หมายเหตุ: ไฟล์นี้ถูก copy ไว้ทั้ง Home/js/ และ Roadside/js/ ให้เหมือนกัน
// (ต้องอยู่ใน scope ของ service worker แต่ละแอป ไม่งั้นใช้งาน offline ไม่ได้)
const Role = {
  CACHE_KEY: '_role_cache_v1',
  TTL_MS: 6 * 60 * 60 * 1000,   // 6 ชม. — เปลี่ยน role แล้วมีผลภายในกะงาน
  current: null,                // { uid, email, username, role, supervisorName, displayName }

  // คืน object สิทธิ์ หรือ null ถ้าไม่ใช่บัญชีจริง / ไม่มีสิทธิ์ / ถูกปิด
  // fresh = true → ข้าม cache (ใช้ตอนเพิ่ง login เพื่อให้เห็นสิทธิ์ล่าสุดทันที)
  async resolve(user, db, fresh) {
    if (!user || user.isAnonymous) { this.current = null; return null; }

    if (!fresh) {
      const c = this._cached(user.uid);
      if (c) { this.current = c; return c; }
    }
    let snap;
    try {
      snap = await db.collection('users').doc(user.uid).get();
    } catch (e) {
      // ออฟไลน์/อ่านไม่ได้ → ใช้ cache เดิมถ้ามี (แม้หมดอายุ) ดีกว่าเตะผู้ใช้ออกกลางงาน
      const stale = this._cached(user.uid, true);
      this.current = stale || null;
      return this.current;
    }
    if (!snap.exists) { this.clear(); return null; }         // บัญชีที่ยังไม่ได้รับสิทธิ์
    const d = snap.data();
    if (d.disabled === true) { this.clear(); return null; }  // ถูกปิดบัญชี

    this.current = {
      uid:            user.uid,
      email:          user.email || '',
      username:       d.username || (user.email || '').split('@')[0],
      role:           d.role || '',
      supervisorName: d.supervisorName || '',
      displayName:    d.displayName || d.username || ''
    };
    try {
      localStorage.setItem(this.CACHE_KEY, JSON.stringify({ ...this.current, at: Date.now() }));
    } catch (_) { /* โควตาเต็ม — ไม่เป็นไร แค่ต้องอ่านใหม่รอบหน้า */ }
    return this.current;
  },

  clear() {
    this.current = null;
    try { localStorage.removeItem(this.CACHE_KEY); } catch (_) {}
  },

  isAdmin() { return !!this.current && this.current.role === 'admin'; },
  isStaff() { return !!this.current && this.current.role === 'staff'; },

  _cached(uid, ignoreExpiry) {
    try {
      const raw = localStorage.getItem(this.CACHE_KEY);
      if (!raw) return null;
      const c = JSON.parse(raw);
      if (c.uid !== uid) return null;
      if (!ignoreExpiry && Date.now() - (c.at || 0) > this.TTL_MS) return null;
      delete c.at;
      return c;
    } catch (_) { return null; }
  }
};

// ===== รายชื่อผู้ควบคุม — ใช้ทำ dropdown ในแบบฟอร์ม =====
// มาจาก config/supervisors ที่ tools/users.html เขียนไว้ (ไม่เปิด users ให้ผู้สำรวจอ่าน)
// cache ลง localStorage เพื่อให้ใช้งานออฟไลน์ได้ — หน้างานต้องเลือกผู้ควบคุมได้เสมอ
const Supervisors = {
  CACHE_KEY: '_supervisors_v1',
  _list: null,

  // อ่านแบบ sync สำหรับตอน render ฟอร์ม (คืน [] ถ้ายังไม่เคยโหลด)
  list() {
    if (this._list) return this._list;
    try {
      const raw = localStorage.getItem(this.CACHE_KEY);
      this._list = raw ? JSON.parse(raw) : [];
    } catch (_) { this._list = []; }
    return this._list;
  },

  // โหลดสดจาก Firestore แล้ว cache (เรียกตอน boot — ไม่ throw ถ้าออฟไลน์)
  async load(db) {
    try {
      if (!db) return this.list();
      const snap = await db.collection('config').doc('supervisors').get();
      if (!snap.exists) return this.list();
      const arr = (snap.data().list || []).filter(x => x && x.name);
      if (!arr.length) return this.list();
      this._list = arr;
      try { localStorage.setItem(this.CACHE_KEY, JSON.stringify(arr)); } catch (_) {}
    } catch (_) { /* ออฟไลน์ → ใช้ cache เดิม */ }
    return this.list();
  },

  // สร้าง <option> — currentValue ที่ไม่อยู่ในรายชื่อ (ข้อมูลเก่า) จะถูกใส่ไว้ให้ด้วย
  // เพื่อไม่ให้แก้ระเบียนเก่าแล้วชื่อผู้ควบคุมถูกเขียนทับเงียบๆ
  optionsHTML(currentValue, escFn) {
    const esc  = escFn || (s => String(s ?? ''));
    const cur  = String(currentValue || '');
    const list = this.list();
    const has  = list.some(x => x.name === cur);
    let html = `<option value="">— เลือกผู้ควบคุม —</option>`;
    html += list.map(x =>
      `<option value="${esc(x.name)}"${x.name === cur ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
    if (cur && !has) html += `<option value="${esc(cur)}" selected>${esc(cur)} (ข้อมูลเดิม)</option>`;
    return html;
  }
};
