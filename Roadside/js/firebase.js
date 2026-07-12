// ===== FIREBASE SYNC — Roadside Interview =====
// Schema (cloud):
//   roadside_stations/{stId}                      ← station document
//   roadside_stations/{stId}/interviews/{ivId}    ← one doc per interview
//
// Delete: ไม่มีการลบจากเว็บเลย (rules: allow delete: if false)
// ปุ่ม "ลบ" ในเว็บลบเฉพาะ local cache เท่านั้น

const FB = {
  db:   null,
  auth: null,
  COLLECTION:   'roadside_stations',
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
      // เปิด offline persistence — Firebase จัด queue offline writes ให้
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
  async loginAdmin(username, password) {
    if (!this.auth) throw new Error('Firebase Auth ไม่พร้อม');
    const email = username.trim().toLowerCase().replace(/\s+/g,'') + this.EMAIL_DOMAIN;
    const cred  = await this.auth.signInWithEmailAndPassword(email, password);
    return cred.user;
  },

  async logoutAdmin() {
    if (this.auth) await this.auth.signOut();
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

  lastSync() { return localStorage.getItem('_ri_last_sync') || null; },

  _withTimeout(promise, ms = 20000) {
    return Promise.race([
      promise,
      new Promise((_,reject) =>
        setTimeout(() => reject(new Error(`หมดเวลา (${ms/1000}s)`)), ms)
      )
    ]);
  },

  // strip Firestore internal fields from doc data
  _stripInternal(d) {
    delete d._device; delete d._syncedAt;
    return d;
  },

  // ===== SYNC =====
  // admin: sync ทุก station + interview ที่อยู่ใน local
  // surveyor: sync เฉพาะ interview ของตัวเอง (ไม่แตะ station)
  async syncAll(surveyorName) {
    if (!this.db) throw new Error('Firebase ไม่พร้อม');
    const sts = DB.getStations();
    if (!sts.length) throw new Error('ไม่มีข้อมูลในเครื่อง');
    const device   = this.deviceId();
    const syncedAt = new Date().toISOString();
    const isAdmin  = !surveyorName;
    const CHUNK    = 400;

    let stCount = 0;
    let ivCount = 0;

    const batches = [];
    let batch    = this.db.batch();
    let ops      = 0;
    const flush = () => {
      if (ops > 0) batches.push(batch);
      batch = this.db.batch();
      ops   = 0;
    };
    const addOp = (ref, payload) => {
      batch.set(ref, payload, { merge: true });
      ops++;
      if (ops >= CHUNK) flush();
    };

    for (const st of sts) {
      const stRef = this.db.collection(this.COLLECTION).doc(st.id);

      // 1) เขียน station (เฉพาะ admin)
      if (isAdmin) {
        const { interviews, ...stData } = st;
        addOp(stRef, { ...stData, _device: device, _syncedAt: syncedAt });
        stCount++;
      }

      // 2) เขียน interviews (idempotent — doc id = iv.id)
      for (const iv of (st.interviews || [])) {
        if (!isAdmin && iv.surveyorName !== surveyorName) continue;
        const ivRef = stRef.collection('interviews').doc(iv.id);
        addOp(ivRef, { ...iv, _device: device, _syncedAt: syncedAt });
        ivCount++;
      }
    }
    flush();

    if (stCount === 0 && ivCount === 0) {
      throw new Error('ไม่มีข้อมูลใหม่ที่จะ sync');
    }

    for (const b of batches) {
      await this._withTimeout(b.commit());
    }

    localStorage.setItem('_ri_last_sync', syncedAt);
    return isAdmin ? `${stCount} จุด · ${ivCount} ราย` : `${ivCount} ราย`;
  },

  // ===== PULL: admin =====
  async pullAll() {
    if (!this.db) throw new Error('Firebase ไม่พร้อม');
    // 1) ดึง stations
    const stSnap = await this._withTimeout(
      this.db.collection(this.COLLECTION).get({ source: 'server' })
    );
    if (stSnap.empty) throw new Error('ไม่มีข้อมูลใน Firestore');

    const stationMap = {};
    stSnap.docs.forEach(doc => {
      const d = this._stripInternal(doc.data());
      d.interviews = [];
      stationMap[doc.id] = d;
    });

    // 2) ดึง interview ของแต่ละ station แบบ parallel (ไม่ใช้ collectionGroup กัน index)
    const ivSnaps = await Promise.all(stSnap.docs.map(doc =>
      this._withTimeout(doc.ref.collection('interviews').get({ source: 'server' }))
    ));
    ivSnaps.forEach((snap, i) => {
      const stId = stSnap.docs[i].id;
      snap.docs.forEach(d => {
        stationMap[stId].interviews.push(this._stripInternal(d.data()));
      });
    });

    Object.values(stationMap).forEach(st => {
      st.interviews.sort((a,b) => (a.seq||0) - (b.seq||0));
    });

    const stations = Object.values(stationMap);
    const newData  = { stations };
    await DB.replaceAll(newData);
    return stations.length;
  },

  // ===== PULL: surveyor =====
  // เห็นทุก station แต่ดึง interview เฉพาะของตัวเอง (where ที่ subcollection ไม่ต้อง index)
  async pullBySurveyor(surveyorName) {
    if (!this.db) throw new Error('Firebase ไม่พร้อม');

    const stSnap = await this._withTimeout(
      this.db.collection(this.COLLECTION).get({ source: 'server' })
    );
    if (stSnap.empty) throw new Error('ไม่มีข้อมูลใน Firestore');

    const stationMap = {};
    stSnap.docs.forEach(doc => {
      const d = this._stripInternal(doc.data());
      d.interviews = [];
      stationMap[doc.id] = d;
    });

    // ดึง interview subcollection ของแต่ละ station แบบ parallel
    // ใช้ where ที่ระดับ subcollection (single-collection query — ไม่ต้องสร้าง composite index)
    const ivSnaps = await Promise.all(stSnap.docs.map(doc =>
      this._withTimeout(
        doc.ref.collection('interviews')
          .where('surveyorName', '==', surveyorName)
          .get({ source: 'server' })
      )
    ));
    ivSnaps.forEach((snap, i) => {
      const stId = stSnap.docs[i].id;
      snap.docs.forEach(d => {
        stationMap[stId].interviews.push(this._stripInternal(d.data()));
      });
    });

    Object.values(stationMap).forEach(st => {
      st.interviews.sort((a,b) => (a.seq||0) - (b.seq||0));
    });

    // merge: เก็บ interview ของฉันใน local ที่ยังไม่ได้ sync เพิ่มเข้าไป
    const local = DB.load();
    local.stations.forEach(ls => {
      const remote = stationMap[ls.id];
      if (!remote) return;
      const remoteIds = new Set(remote.interviews.map(iv => iv.id));
      const localOnly = (ls.interviews || []).filter(iv =>
        iv.surveyorName === surveyorName && !remoteIds.has(iv.id)
      );
      if (localOnly.length) {
        remote.interviews = [...remote.interviews, ...localOnly]
          .sort((a,b) => (a.seq||0) - (b.seq||0));
      }
    });

    const stations = Object.values(stationMap);
    const newData  = { stations };
    await DB.replaceAll(newData);
    return stations.length;
  }
};

if (typeof firebase !== 'undefined') FB.init();
