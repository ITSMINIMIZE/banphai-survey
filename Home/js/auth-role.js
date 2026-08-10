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
  current: null,                // { uid, email, username, role, supervisorName, displayName, nickname }

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
      // normalize ตั้งแต่ต้นทาง — ระเบียนสำรวจเก็บชื่อผ่าน normName() เสมอ
      // ถ้าปล่อยดิบไว้ ช่องว่างเกิน/อักขระล่องหนในบัญชีจะทำให้จับคู่ทีมไม่เจอแบบเงียบๆ
      supervisorName: String(d.supervisorName ?? '').normalize('NFC')
                        .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g,'').trim().replace(/\s+/g,' '),
      displayName:    d.displayName || d.username || '',
      // ชื่อเล่น — ใช้แสดงผลอย่างเดียว ไม่เคยเอาไปบันทึกลงระเบียน
      nickname:       d.nickname || ''
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
  //
  // key  = ชื่อ-นามสกุล — ค่าที่บันทึกลงระเบียนจริง ใช้จับคู่ทีมทุกที่ (ห้ามเปลี่ยนตามชื่อเล่น)
  // name = ชื่อเล่น (ถ้าไม่ได้ตั้ง = ชื่อ-นามสกุล) — ตัวที่ผู้สำรวจเห็นเท่านั้น
  _key(x) { return x.key || x.name || ''; },
  optionsHTML(currentValue, escFn) {
    const esc  = escFn || (s => String(s ?? ''));
    const cur  = String(currentValue || '');
    const list = this.list();
    const has  = list.some(x => this._key(x) === cur);
    let html = `<option value="">— เลือกผู้ควบคุม —</option>`;
    html += list.map(x => {
      const k = this._key(x);
      return `<option value="${esc(k)}"${k === cur ? ' selected' : ''}>${esc(x.name || k)}</option>`;
    }).join('');
    if (cur && !has) html += `<option value="${esc(cur)}" selected>${esc(cur)} (ข้อมูลเดิม)</option>`;
    return html;
  },

  // ชื่อเล่นของผู้ควบคุมคนหนึ่ง — ใช้ตอนแสดงผลอย่างเดียว ไม่ใช้บันทึก
  displayName(fullName) {
    const cur = String(fullName || '');
    const hit = this.list().find(x => this._key(x) === cur);
    return (hit && hit.name) || cur;
  }
};

// ===== รอบเก็บข้อมูล — กันข้อมูลเก่าย้อนกลับเข้าระบบ =====
// admin ตั้ง config/data_round.since (ISO) ผ่าน tools/data-round.html
// ระเบียนที่ createdAt < since = "ข้อมูลเก่าก่อนรอบนี้" → ไม่ส่งขึ้น cloud
// since ว่าง/ไม่มี doc = ไม่กรองอะไรเลย (พฤติกรรมเดิม)
const DataRound = {
  CACHE_KEY: '_data_round_v1',
  _r: null,

  // อ่านแบบ sync (ใช้ตอน render/sync) — คืน { since, label }
  get() {
    if (this._r) return this._r;
    try {
      const raw = localStorage.getItem(this.CACHE_KEY);
      this._r = raw ? JSON.parse(raw) : { since: '', label: '' };
    } catch (_) { this._r = { since: '', label: '' }; }
    return this._r;
  },
  since() { return this.get().since || ''; },
  label() { return this.get().label || ''; },

  async load(db) {
    try {
      if (!db) return this.get();
      const snap = await db.collection('config').doc('data_round').get();
      const d = snap.exists ? snap.data() : {};
      this._r = { since: d.since || '', label: d.label || '' };
      try { localStorage.setItem(this.CACHE_KEY, JSON.stringify(this._r)); } catch (_) {}
    } catch (_) { /* ออฟไลน์ → ใช้ cache เดิม */ }
    return this.get();
  },

  // ระเบียนนี้เก่ากว่ารอบปัจจุบันหรือไม่ (ไม่มี createdAt = ถือว่าเก่า)
  isOld(rec) {
    const s = this.since();
    if (!s) return false;
    if (!rec) return false;
    return String(rec.createdAt || '') < s;
  },

  // นาฬิกาเครื่องนี้ผิดหรือเปล่า — ถ้าเวลาปัจจุบันยังไม่ถึงวันเริ่มรอบ
  // ข้อมูลที่บันทึกใหม่จะถูกสแตมป์เป็นเวลาเก่าแล้วโดนกรองทิ้งเงียบๆ
  clockLooksWrong() {
    const s = this.since();
    return !!s && new Date().toISOString() < s;
  }
};

// ===== คำสั่งล้างข้อมูลในเครื่องจากส่วนกลาง =====
// ผู้ดูแลกดสั่งครั้งเดียวที่ tools/data-round.html แล้วทุกเครื่องล้างให้เองตอนเปิดแอปครั้งถัดไป
// ไม่ต้องเดินไล่เก็บเครื่องทีละเครื่อง
//
// ⚠️ ข้อจำกัดที่ต้องรู้: คำสั่งนี้ทำงานในแอป — เครื่องที่ยังใช้เวอร์ชันเก่ากว่าที่มีโค้ดนี้
//    จะไม่รู้จักคำสั่ง และไม่ล้างให้ ต้องอัปเดตแอปก่อน
//
// mode 'old' = ล้างเฉพาะข้อมูลก่อนรอบปัจจุบัน (ปลอดภัย ของรอบนี้ไม่ถูกแตะ)
// mode 'all' = ล้างทั้งเครื่อง (ข้อมูลที่ยังไม่ได้ sync จะหายถาวร)
const WipeCommand = {
  DONE_KEY: '_wipe_done_at',

  async check(db, DBRef, onDone) {
    try {
      if (!db) return false;
      const snap = await db.collection('config').doc('wipe_command').get();
      if (!snap.exists) return false;
      const cmd = snap.data() || {};
      if (!cmd.at) return false;

      let done = '';
      try { done = localStorage.getItem(this.DONE_KEY) || ''; } catch (_) {}
      if (done >= cmd.at) return false;            // เครื่องนี้ทำคำสั่งนี้ไปแล้ว

      const mode = cmd.mode === 'all' ? 'all' : 'old';
      let removed = 0;
      if (mode === 'all') {
        removed = -1;                               // ล้างหมด ไม่ต้องนับ
        await DBRef.clearAll();
      } else {
        const since = (typeof DataRound !== 'undefined') ? DataRound.since() : '';
        if (!since) return false;                   // ยังไม่ได้ตั้งรอบ → ไม่รู้ว่าอะไรเก่า ไม่ทำอะไร
        removed = DBRef.countOlderThan(since);
        if (removed > 0) DBRef.clearOlderThan(since);
      }
      try { localStorage.setItem(this.DONE_KEY, cmd.at); } catch (_) {}
      if (onDone) onDone({ mode, removed, note: cmd.note || '', at: cmd.at });
      return true;
    } catch (_) { return false; }   // ออฟไลน์/อ่านไม่ได้ → ไว้เช็คใหม่รอบหน้า
  }
};
