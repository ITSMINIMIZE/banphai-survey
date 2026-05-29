// ===== FIREBASE SYNC — Roadside Interview =====
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

  _withTimeout(promise, ms = 15000) {
    return Promise.race([
      promise,
      new Promise((_,reject) =>
        setTimeout(() => reject(new Error(`หมดเวลา (${ms/1000}s)`)), ms)
      )
    ]);
  },

  async syncAll(surveyorName) {
    if (!this.db) throw new Error('Firebase ไม่พร้อม');
    const sts = DB.getStations();
    if (!sts.length) throw new Error('ไม่มีข้อมูลจุดสำรวจ');
    const device   = this.deviceId();
    const syncedAt = new Date().toISOString();
    const isAdmin  = !surveyorName;
    const CHUNK = 400;

    if (isAdmin) {
      // admin sync ทุก station ตรงๆ
      for (let i = 0; i < sts.length; i += CHUNK) {
        const batch = this.db.batch();
        for (const st of sts.slice(i, i + CHUNK)) {
          const ref = this.db.collection(this.COLLECTION).doc(st.id);
          batch.set(ref, { ...st, _device: device, _syncedAt: syncedAt });
        }
        await this._withTimeout(batch.commit());
      }
    } else {
      // surveyor: ดึง remote ก่อน แล้ว merge interview ของตัวเองเข้าไป
      const snap = await this._withTimeout(
        this.db.collection(this.COLLECTION).get(), 20000
      );
      const remoteMap = {};
      snap.docs.forEach(doc => { remoteMap[doc.id] = doc.data(); });

      const batch = this.db.batch();
      for (const st of sts) {
        const remote = remoteMap[st.id];
        if (remote) {
          // เอา interview คนอื่นจาก remote + interview ของตัวเองจาก local
          const othersIvs = (remote.interviews || []).filter(iv => iv.surveyorName !== surveyorName);
          const myIvs     = (st.interviews     || []).filter(iv => iv.surveyorName === surveyorName);
          const merged = [...othersIvs, ...myIvs];
          const ref = this.db.collection(this.COLLECTION).doc(st.id);
          batch.update(ref, { interviews: merged, _device: device, _syncedAt: syncedAt });
        }
        // ถ้าไม่มี remote → ไม่สร้างใหม่ (station สร้างโดย admin เท่านั้น)
      }
      await this._withTimeout(batch.commit());
    }

    localStorage.setItem('_ri_last_sync', syncedAt);
    return sts.length;
  },

  async pullAll() {
    if (!this.db) throw new Error('Firebase ไม่พร้อม');
    const snap = await this._withTimeout(
      this.db.collection(this.COLLECTION).get(), 20000
    );
    if (snap.empty) throw new Error('ไม่มีข้อมูลใน Firestore');
    const remoteMap = {};
    snap.docs.forEach(doc => {
      const d = doc.data();
      delete d._device; delete d._syncedAt;
      remoteMap[d.id] = d;
    });
    const local = DB.load();
    const localMap = {};
    local.stations.forEach(s => { localMap[s.id] = s; });
    const merged = Object.values({ ...localMap, ...remoteMap });
    // migrate: interviews เก่าที่ไม่มี surveyorName ให้ใช้ surveyorName ของ station
    merged.forEach(st => {
      (st.interviews || []).forEach(iv => {
        if (!iv.surveyorName) iv.surveyorName = st.surveyorName || '';
      });
    });
    const newData = { stations: merged };
    localStorage.setItem(DB.KEY, JSON.stringify(newData));
    DB._data = newData;
    return merged.length;
  },

  async pullBySurveyor(surveyorName) {
    if (!this.db) throw new Error('Firebase ไม่พร้อม');
    // ดึงทุกจุดสำรวจ (เพื่อให้เห็นว่ามีจุดไหนบ้าง)
    // แต่สำหรับจุดที่ไม่ใช่ของตัวเอง ล้าง interviews ออก
    const snap = await this._withTimeout(
      this.db.collection(this.COLLECTION).get(),
      20000
    );
    if (snap.empty) throw new Error('ไม่มีข้อมูลใน Firestore');
    const remoteMap = {};
    snap.docs.forEach(doc => {
      const d = doc.data();
      delete d._device; delete d._syncedAt;
      // migrate: interviews เก่าที่ไม่มี surveyorName ให้ใช้ surveyorName ของ station
      (d.interviews || []).forEach(iv => {
        if (!iv.surveyorName) iv.surveyorName = d.surveyorName || '';
      });
      // เห็นรายละเอียดจุดสำรวจทุกจุด แต่เห็น interview เฉพาะของตัวเอง
      d.interviews = d.interviews.filter(iv => iv.surveyorName === surveyorName);
      remoteMap[d.id] = d;
    });
    const local = DB.load();
    // merge: รวม interview ของตัวเองจาก local เข้ากับ remote (ป้องกันข้อมูลหาย)
    const localMap = {};
    local.stations.forEach(s => {
      const remote = remoteMap[s.id];
      if (remote) {
        // รวม interview จาก local ที่ยังไม่มีใน remote
        const remoteIds = new Set(remote.interviews.map(iv => iv.id));
        const localOnly = (s.interviews || []).filter(iv =>
          iv.surveyorName === surveyorName && !remoteIds.has(iv.id)
        );
        remote.interviews = [...remote.interviews, ...localOnly];
      } else {
        localMap[s.id] = s;
      }
    });
    const merged  = Object.values({ ...remoteMap, ...localMap });
    const newData = { stations: merged };
    localStorage.setItem(DB.KEY, JSON.stringify(newData));
    DB._data = newData;
    return merged.length;
  }
};

if (typeof firebase !== 'undefined') FB.init();
