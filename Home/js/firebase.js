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
      this.db   = firebase.firestore();
      this.auth = firebase.auth();
      // เปิด offline persistence — Firebase queue offline writes ให้
      this.db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
    } catch (e) {
      console.error('[FB] init error:', e);
    }
  },

  // ===== AUTH =====
  async loginAdmin(username, password) {
    if (!this.auth) throw new Error('Firebase Auth ไม่พร้อม');
    const email = username.trim().toLowerCase().replace(/\s+/g, '') + this.EMAIL_DOMAIN;
    const cred  = await this.auth.signInWithEmailAndPassword(email, password);
    return cred.user;
  },
  async logoutAdmin() { if (this.auth) await this.auth.signOut(); },
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

  // ===== SYNC =====
  // admin: sync ทุก household ใน local (รวม nested) ขึ้น cloud
  // surveyor: sync เฉพาะ household ของตัวเอง
  async syncAll(surveyorName) {
    if (!this.db) throw new Error('Firebase ไม่พร้อม');
    let hhs = DB.getHouseholds();
    if (surveyorName) hhs = hhs.filter(h => h.surveyorName === surveyorName);
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
    return `${hhCount} ครัวเรือน · ${mCount} สมาชิก · ${tCount} เที่ยว`;
  },

  // ===== PULL =====
  // โหลด household + nested members + nested trips
  async _loadNested(hhDocs) {
    const hhMap = {};
    hhDocs.forEach(doc => {
      const d = this._strip(doc.data());
      d.members = [];
      hhMap[doc.id] = d;
    });

    // pull members ของแต่ละ household แบบ parallel
    const memberSnaps = await Promise.all(hhDocs.map(doc =>
      this._withTimeout(doc.ref.collection('members').get({ source: 'server' }))
    ));

    // จัดเก็บ member doc refs + reset trips
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

    // pull trips ของแต่ละ member แบบ parallel
    const tripSnaps = await Promise.all(allMemberDocs.map(({ ref }) =>
      this._withTimeout(ref.collection('trips').get({ source: 'server' }))
    ));
    tripSnaps.forEach((snap, i) => {
      snap.docs.forEach(tDoc => {
        allMemberDocs[i].mRef.trips.push(this._strip(tDoc.data()));
      });
    });

    // sort
    Object.values(hhMap).forEach(hh => {
      hh.members.sort((a,b) => (a.seq||0) - (b.seq||0));
      hh.members.forEach(m => m.trips.sort((a,b) => (a.seq||0) - (b.seq||0)));
    });
    return Object.values(hhMap);
  },

  async pullAll() {
    if (!this.db) throw new Error('Firebase ไม่พร้อม');
    const snap = await this._withTimeout(
      this.db.collection(this.COLLECTION).get({ source: 'server' })
    );
    if (snap.empty) throw new Error('ไม่มีข้อมูลใน Firestore');
    const households = await this._loadNested(snap.docs);
    const newData = { households };
    localStorage.setItem(DB.KEY, JSON.stringify(newData));
    DB._data = newData;
    return households.length;
  },

  // surveyor: pull เฉพาะ household ของตัวเอง (where ที่ root)
  async pullBySurveyor(surveyorName) {
    if (!this.db) throw new Error('Firebase ไม่พร้อม');
    const snap = await this._withTimeout(
      this.db.collection(this.COLLECTION)
        .where('surveyorName', '==', surveyorName)
        .get({ source: 'server' })
    );
    const remote = await this._loadNested(snap.docs);
    const remoteMap = {};
    remote.forEach(h => { remoteMap[h.id] = h; });

    // merge: เก็บ local household/member/trip ที่ยังไม่ sync เพิ่มเข้า
    const local = DB.load();
    local.households.forEach(lh => {
      if (lh.surveyorName !== surveyorName) return; // ของคนอื่น — ไม่ต้องเอามาด้วย
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
    localStorage.setItem(DB.KEY, JSON.stringify(newData));
    DB._data = newData;
    return households.length;
  }
};

if (typeof firebase !== 'undefined') FB.init();
