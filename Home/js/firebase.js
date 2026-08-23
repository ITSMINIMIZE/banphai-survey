// ===== FIREBASE SYNC — Home Interview (v2) =====
// Schema (cloud):
//   households/{hhId}                                ← household document
//   households/{hhId}/members/{mId}                  ← one doc per member
//   households/{hhId}/members/{mId}/trips/{tId}      ← one doc per trip
//
// Delete: rules forbid — ปุ่มลบในเว็บลบเฉพาะ local cache เท่านั้น
// Surveyor: เห็นเฉพาะข้อมูลของตัวเอง (where surveyorName == name ที่ root)
// Admin: เห็นทุก household
const FB = {
  db:   null,
  auth: null,
  COLLECTION:   'households',
  EMAIL_DOMAIN: '@banphai.local',

  init() {
    try {
      const cfg = {
        apiKey:            'AIzaSyA_f0UniGXeSRRn4VjD-56Gp9Xb0M-I8kQ',
        authDomain:        'banphai-survey.firebaseapp.com',
        projectId:         'banphai-survey',
        storageBucket:     'banphai-survey.firebasestorage.app',
        messagingSenderId: '755175522135',
        appId:             '1:755175522135:web:da20ccae36e1d1e9210812'
      };
      if (!firebase.apps.length) firebase.initializeApp(cfg);
      this.projectId = cfg.projectId;      // ใช้กับ REST (อ่าน createTime ที่ SDK compat ไม่เปิดให้)
      this.db   = firebase.firestore();
      this.auth = firebase.auth();
      // เปิด offline persistence — Firebase queue offline writes ให้
      this.db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
      // ทุกเครื่องได้ token อัตโนมัติแบบ anonymous (ผู้สำรวจไม่ต้องสมัคร/ไม่รู้สึกอะไร)
      // ถ้ายังไม่มีใคร login → เซ็นชื่อ anonymous ไว้เขียน Firestore (curl ภายนอกไม่มี token → เขียนไม่ได้)
      this.auth.onAuthStateChanged(u => {
        if (!u) this.auth.signInAnonymously().catch(e => console.warn('[FB] anon signin:', e.code || e));
      });
    } catch (e) {
      console.error('[FB] init error:', e);
    }
  },

  // ===== AUTH =====
  // รับได้ทั้ง username (admin — ต่อ @banphai.local ให้) และอีเมลจริง (staff/ผู้ควบคุม)
  async loginAdmin(username, password) {
    if (!this.auth) throw new Error('Firebase Auth ไม่พร้อม');
    const u     = username.trim().toLowerCase().replace(/\s+/g, '');
    const email = u.includes('@') ? u : u + this.EMAIL_DOMAIN;
    const cred  = await this.auth.signInWithEmailAndPassword(email, password);
    return cred.user;
  },
  async logoutAdmin() { if (this.auth) await this.auth.signOut(); },
  // ส่งลิงก์ตั้งรหัสผ่านใหม่ — ใช้ได้เฉพาะบัญชีที่เป็นอีเมลจริง
  async sendPasswordReset(email) {
    if (!this.auth) throw new Error('Firebase Auth ไม่พร้อม');
    await this.auth.sendPasswordResetEmail(email);
  },
  onAuthStateChanged(cb) {
    if (!this.auth) { cb(null); return; }
    return this.auth.onAuthStateChanged(cb);
  },

  deviceId() {
    let id = localStorage.getItem('_device_id');
    if (!id) { id = 'DEV-' + Date.now(); localStorage.setItem('_device_id', id); }
    return id;
  },
  lastSync() { return localStorage.getItem('_hi_last_sync') || null; },

  _withTimeout(promise, ms = 20000) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`หมดเวลา (${ms/1000}s)`)), ms)
      )
    ]);
  },

  _strip(d) { delete d._device; delete d._syncedAt; return d; },

  // ระเบียนนี้เป็นของรอบก่อนหรือไม่
  // เฉพาะ household เท่านั้นที่มี createdAt — member/trip ไม่มี จึงต้องดูที่บ้านต้นสังกัด
  _isOldHH(hh) {
    return typeof DataRound !== 'undefined' && !!DataRound.since() && DataRound.isOld(hh);
  },
  _isOldById(hhId) {
    if (typeof DataRound === 'undefined' || !DataRound.since()) return false;
    return DataRound.isOld(DB.getHousehold(hhId));
  },
  // แจ้งครั้งเดียวพอ ไม่ให้ toast ถล่มตอนแก้หลายช่องติดกัน
  _warnOld() {
    const now = Date.now();
    if (this._warnedAt && now - this._warnedAt < 8000) return;
    this._warnedAt = now;
    if (typeof App !== 'undefined' && App.toast)
      App.toast('ระเบียนนี้เป็นข้อมูลรอบก่อน — แก้ในเครื่องได้ แต่จะไม่ส่งขึ้นระบบ', 'warning');
  },

  // ===== AUTO-PUSH (per-doc, บันทึกทีละรายการ) =====
  // เขียน doc เดียวแบบ fire-and-forget — ไม่มี _withTimeout เพื่อให้ offline persistence
  // คิวงานเองตอนเน็ตหลุด (promise ค้าง ส่งเมื่อออนไลน์) แล้ว badge อัปเดตเมื่อ server ack จริง
  _hhData(hh)    { const { members, createdAtServer, ...d } = hh; return d; },
  _memberData(m) { const { trips, ...d }  = m;  return d; },

  // onErr (ไม่บังคับ) — ใช้กับการลบ/กู้คืนที่ต้องรู้ผลจริง
  // ถ้า rules ปฏิเสธแล้วเงียบ ผู้ใช้จะเห็นว่า "ลบแล้ว" ทั้งที่บนระบบยังอยู่ → ต้องบอกและย้อนสถานะกลับ
  _pushDoc(ref, data, onErr) {
    if (!this.db) return;
    const syncedAt = new Date().toISOString();
    ref.set({ ...data, _device: this.deviceId(), _syncedAt: syncedAt }, { merge: true })
      .then(() => {
        localStorage.setItem('_hi_last_sync', syncedAt);
        if (typeof App !== 'undefined' && App._refreshSyncBadge) App._refreshSyncBadge();
      })
      .catch(e => {
        console.warn('[FB] auto-push:', e.code || e);   // การแก้ทั่วไปยังเงียบเหมือนเดิม
        if (onErr) onErr(e);
      });
  },

  // หมายเหตุ: auto-push (แก้ไขทีละรายการ) ส่งขึ้นเสมอ แม้เป็นระเบียนรอบก่อน
  // — การแก้ไขคือเจตนาชัดเจนของผู้ใช้ ต้อง sync ทับใน DB ได้
  // ส่วนการกด Sync ทั้งก้อนยังกรองข้อมูลเก่าออก (กันข้อมูลทดสอบไหลกลับทีละมากๆ)
  pushHousehold(hh, onErr) {
    if (!hh) return;
    if (this._isOldHH(hh)) { this._warnOld(); return; }
    this._pushDoc(this.db.collection(this.COLLECTION).doc(hh.id), this._hhData(hh), onErr);
  },
  pushMember(hhId, m, onErr) {
    if (!m) return;
    if (this._isOldById(hhId)) { this._warnOld(); return; }
    this._pushDoc(this.db.collection(this.COLLECTION).doc(hhId).collection('members').doc(m.id), this._memberData(m), onErr);
  },
  pushTrip(hhId, mId, t, onErr) {
    if (!t) return;
    if (this._isOldById(hhId)) { this._warnOld(); return; }
    this._pushDoc(this.db.collection(this.COLLECTION).doc(hhId).collection('members').doc(mId).collection('trips').doc(t.id), t, onErr);
  },

  // ===== SYNC =====
  // admin: sync ทุก household ใน local (รวม nested) ขึ้น cloud
  // surveyor: sync เฉพาะ household ของตัวเอง
  // value = null → ทั้งหมด (admin) · field: 'surveyorName' (ผู้สำรวจ) | 'supervisorName' (ผู้ควบคุม)
  async syncAll(value, field = 'surveyorName') {
    if (!this.db) throw new Error('Firebase ไม่พร้อม');
    let hhs = DB.getHouseholdsRaw();   // raw: ต้องส่ง flag _deleted ขึ้น cloud ด้วย
    if (value) hhs = hhs.filter(h => h[field] === value);
    // กันข้อมูลเก่าก่อนรอบเก็บข้อมูลปัจจุบันย้อนขึ้น cloud
    let skippedOld = 0;
    if (typeof DataRound !== 'undefined' && DataRound.since()) {
      const before = hhs.length;
      hhs = hhs.filter(h => !DataRound.isOld(h));
      skippedOld = before - hhs.length;
    }
    if (!hhs.length && skippedOld) throw new Error(`ข้อมูลในเครื่องเป็นข้อมูลเก่าก่อนรอบนี้ทั้งหมด (${skippedOld} หลัง) — ไม่มีอะไรให้ส่ง`);
    if (!hhs.length) throw new Error('ไม่มีข้อมูลที่จะ sync');

    const device   = this.deviceId();
    const syncedAt = new Date().toISOString();
    const CHUNK    = 400;

    const batches = [];
    let batch = this.db.batch();
    let ops   = 0;
    const flush = () => { if (ops > 0) batches.push(batch); batch = this.db.batch(); ops = 0; };
    const addOp = (ref, payload) => {
      batch.set(ref, payload, { merge: true });
      ops++;
      if (ops >= CHUNK) flush();
    };

    let hhCount = 0, mCount = 0, tCount = 0;

    for (const hh of hhs) {
      const hhRef = this.db.collection(this.COLLECTION).doc(hh.id);
      // เขียน household เฉพาะ field ของมัน (ไม่รวม members ใน array)
      const { members, ...hhData } = hh;
      addOp(hhRef, { ...hhData, _device: device, _syncedAt: syncedAt });
      hhCount++;

      for (const m of (members || [])) {
        const mRef = hhRef.collection('members').doc(m.id);
        const { trips, ...mData } = m;
        addOp(mRef, { ...mData, _device: device, _syncedAt: syncedAt });
        mCount++;

        for (const t of (trips || [])) {
          const tRef = mRef.collection('trips').doc(t.id);
          addOp(tRef, { ...t, _device: device, _syncedAt: syncedAt });
          tCount++;
        }
      }
    }
    flush();

    for (const b of batches) {
      await this._withTimeout(b.commit());
    }
    localStorage.setItem('_hi_last_sync', syncedAt);
    return `${hhCount} ครัวเรือน · ${mCount} สมาชิก · ${tCount} เที่ยว`
         + (skippedOld ? ` · ข้ามข้อมูลเก่า ${skippedOld} หลัง` : '');
  },

  // ===== PULL =====
  // โหลด household + nested members + nested trips
  // ตัดระเบียนของรอบก่อนออกตั้งแต่ต้นทาง — ไม่ให้เข้ามาในเครื่องเลย
  // ถ้าไม่ตัด กด "ดึงข้อมูล" ทีเดียวข้อมูลเก่าจะกลับเข้ามาทั้งชุด
  _filterRound(docs) {
    if (typeof DataRound === 'undefined' || !DataRound.since()) return { docs, skipped: 0 };
    const keep = docs.filter(d => !DataRound.isOld(d.data()));
    return { docs: keep, skipped: docs.length - keep.length };
  },

  // ── เวลาสร้างจริงจากเซิร์ฟเวอร์ ────────────────────────────────────────────
  // Firestore ประทับ createTime ให้ทุก document เอง เครื่องผู้สำรวจปลอมไม่ได้
  // SDK compat ไม่เปิดให้อ่าน ต้องผ่าน REST — rules บังคับสิทธิ์เหมือนกันทุกประการ
  // ใช้ mask ขอมาแค่ฟิลด์เดียว ตัวที่ต้องการจริงคือ createTime ที่ติดมากับ response
  async _serverCreateTimes(ids) {
    const out = {};
    const user = this.auth && this.auth.currentUser;
    if (!user || !ids.length || !this.projectId) return out;
    try {
      const token = await user.getIdToken();
      const base  = `projects/${this.projectId}/databases/(default)/documents`;
      for (let i = 0; i < ids.length; i += 250) {          // batchGet รับได้จำกัด แบ่งเป็นก้อน
        const chunk = ids.slice(i, i + 250);
        const res = await this._withTimeout(fetch(`https://firestore.googleapis.com/v1/${base}:batchGet`, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            documents: chunk.map(id => `${base}/${this.COLLECTION}/${id}`),
            mask: { fieldPaths: ['createdAt'] }
          })
        }));
        if (!res.ok) return out;                            // สิทธิ์ไม่พอ/เน็ตพัง → ใช้ค่าเดิม ไม่ทำ pull ล้ม
        (await res.json()).forEach(r => {
          if (r.found && r.found.name && r.found.createTime)
            out[r.found.name.split('/').pop()] = r.found.createTime;
        });
      }
    } catch (e) { console.warn('[FB] createTime:', e.code || e.message || e); }
    return out;
  },

  async _loadNested(hhDocs) {
    const hhMap = {};
    hhDocs.forEach(doc => {
      const d = this._strip(doc.data());
      d.members = [];
      hhMap[doc.id] = d;
    });

    // ── ทางเร็ว: 2 คำขอครอบคลุมสมาชิกและเที่ยวทั้งหมด ──
    // ของเดิมยิง 1 คำขอต่อบ้าน แล้วอีก 1 ต่อสมาชิก — ที่ 2,000 บ้านคือหลายพันคำขอพร้อมกัน
    // เบราว์เซอร์คิวไม่ไหว ชนกำแพง timeout 20 วิ แล้ว Promise.all พังทั้งก้อน = ดึงข้อมูลไม่ผ่านเลย
    // rules เปิด collectionGroup ให้เฉพาะบัญชีจริง (ผู้ดูแล/ผู้ควบคุม) ผู้สำรวจ anonymous ใช้ไม่ได้
    // จึงต้องมีทางถอยไว้ — แต่ผู้สำรวจดึงเฉพาะบ้านตัวเอง จำนวนน้อย ทางถอยจึงไหว
    let fast = false;
    try {
      const [memSnap, tripSnap] = await Promise.all([
        this._withTimeout(this.db.collectionGroup('members').get({ source: 'server' }), 60000),
        this._withTimeout(this.db.collectionGroup('trips').get({ source: 'server' }), 60000),
      ]);
      const memByPath = {};
      memSnap.docs.forEach(d => {
        const p = d.ref.path.split('/');          // households/{hhId}/members/{mId}
        const hh = hhMap[p[1]];
        if (!hh) return;                          // นอกขอบเขตของบทบาทนี้
        const m = this._strip(d.data());
        m.trips = [];
        hh.members.push(m);
        memByPath[p[1] + '/' + p[3]] = m;
      });
      tripSnap.docs.forEach(d => {
        const p = d.ref.path.split('/');          // households/{hh}/members/{m}/trips/{t}
        const m = memByPath[p[1] + '/' + p[3]];
        if (!m) return;
        m.trips.push(this._strip(d.data()));
      });
      fast = true;
    } catch (e) {
      console.warn('[FB] collectionGroup ใช้ไม่ได้ ใช้วิธีเดิมแทน:', e.code || e.message || e);
      Object.values(hhMap).forEach(hh => { hh.members = []; });   // ล้างของที่อาจใส่ไปแล้วบางส่วน
    }

    if (!fast) {
      // ── ทางถอย: ไล่ทีละบ้าน แต่จำกัดจำนวนที่ยิงพร้อมกัน ──
      // ไม่ยิงทีเดียวทั้งหมดเหมือนเดิม ไม่งั้นชน timeout พร้อมกันหมด
      const chunk = async (items, size, fn) => {
        const out = [];
        for (let i = 0; i < items.length; i += size) {
          out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
        }
        return out;
      };
      const memberSnaps = await chunk(hhDocs, 25, doc =>
        this._withTimeout(doc.ref.collection('members').get({ source: 'server' }), 30000));

      const allMemberDocs = [];
      memberSnaps.forEach((snap, i) => {
        const hhId = hhDocs[i].id;
        snap.docs.forEach(mDoc => {
          const m = this._strip(mDoc.data());
          m.trips = [];
          hhMap[hhId].members.push(m);
          allMemberDocs.push({ hhId, mId: mDoc.id, ref: mDoc.ref, mRef: m });
        });
      });

      const tripSnaps = await chunk(allMemberDocs, 25, ({ ref }) =>
        this._withTimeout(ref.collection('trips').get({ source: 'server' }), 30000));
      tripSnaps.forEach((snap, i) => {
        snap.docs.forEach(tDoc => {
          allMemberDocs[i].mRef.trips.push(this._strip(tDoc.data()));
        });
      });
    }

    // sort
    Object.values(hhMap).forEach(hh => {
      hh.members.sort((a,b) => (a.seq||0) - (b.seq||0));
      hh.members.forEach(m => m.trips.sort((a,b) => (a.seq||0) - (b.seq||0)));
    });
    // แนบเวลาสร้างจริงจากเซิร์ฟเวอร์ — ทั้ง pullAll และ _pullByField ผ่านตรงนี้ทางเดียว
    const ct = await this._serverCreateTimes(Object.keys(hhMap));
    Object.keys(ct).forEach(id => { if (hhMap[id]) hhMap[id].createdAtServer = ct[id]; });
    return Object.values(hhMap);
  },

  async pullAll() {
    if (!this.db) throw new Error('Firebase ไม่พร้อม');
    const snap = await this._withTimeout(
      this.db.collection(this.COLLECTION).get({ source: 'server' })
    );
    if (snap.empty) throw new Error('ไม่มีข้อมูลใน Firestore');
    const f = this._filterRound(snap.docs);
    this.lastSkippedOld = f.skipped;
    const households = await this._loadNested(f.docs);
    const newData = { households };
    await DB.replaceAll(newData);
    return households.length;
  },

  // surveyor: pull เฉพาะ household ของตัวเอง (where ที่ root)
  pullBySurveyor(surveyorName) { return this._pullByField('surveyorName', surveyorName); },
  // staff (ผู้ควบคุม): pull เฉพาะ household ของทีมตัวเอง
  pullBySupervisor(supervisorName) { return this._pullByField('supervisorName', supervisorName); },

  async _pullByField(field, value) {
    if (!this.db) throw new Error('Firebase ไม่พร้อม');
    const snap = await this._withTimeout(
      this.db.collection(this.COLLECTION)
        .where(field, '==', value)
        .get({ source: 'server' })
    );
    const f = this._filterRound(snap.docs);
    this.lastSkippedOld = f.skipped;
    const remote = await this._loadNested(f.docs);
    const remoteMap = {};
    remote.forEach(h => { remoteMap[h.id] = h; });

    // merge: เก็บ local household/member/trip ที่ยังไม่ sync เพิ่มเข้า
    const local = DB.load();
    local.households.forEach(lh => {
      if (lh[field] !== value) return; // นอกขอบเขตของบทบาทนี้ — ไม่ต้องเอามาด้วย
      const r = remoteMap[lh.id];
      if (!r) { remoteMap[lh.id] = lh; return; }
      // merge members
      const rmIds = new Set(r.members.map(m => m.id));
      (lh.members || []).forEach(lm => {
        if (!rmIds.has(lm.id)) { r.members.push(lm); return; }
        // merge trips ของ member ที่มีทั้งสองข้าง
        const rm = r.members.find(x => x.id === lm.id);
        const rtIds = new Set(rm.trips.map(t => t.id));
        (lm.trips || []).forEach(lt => {
          if (!rtIds.has(lt.id)) rm.trips.push(lt);
        });
      });
      r.members.sort((a,b) => (a.seq||0) - (b.seq||0));
      r.members.forEach(m => m.trips.sort((a,b) => (a.seq||0) - (b.seq||0)));
    });

    const households = Object.values(remoteMap);
    const newData = { households };
    await DB.replaceAll(newData);
    return households.length;
  }
};

if (typeof firebase !== 'undefined') FB.init();
