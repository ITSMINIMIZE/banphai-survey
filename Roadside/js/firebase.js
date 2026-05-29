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

  async syncAll() {
    if (!this.db) throw new Error('Firebase ไม่พร้อม');
    const sts = DB.getStations();
    if (!sts.length) throw new Error('ไม่มีข้อมูลจุดสำรวจ');
    const device = this.deviceId();
    const syncedAt = new Date().toISOString();
    const CHUNK = 400;
    for (let i = 0; i < sts.length; i += CHUNK) {
      const batch = this.db.batch();
      for (const st of sts.slice(i, i + CHUNK)) {
        const ref = this.db.collection(this.COLLECTION).doc(st.id);
        batch.set(ref, { ...st, _device: device, _syncedAt: syncedAt });
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
    const merged  = Object.values({ ...localMap, ...remoteMap });
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
      if (d.surveyorName !== surveyorName) {
        d.interviews = []; // เห็นจุดสำรวจแต่ไม่เห็นข้อมูลของคนอื่น
      }
      remoteMap[d.id] = d;
    });
    const local = DB.load();
    const localMap = {};
    // ข้อมูลของตัวเองในเครื่องมีสิทธิ์เขียนทับ remote (merge ให้ local ชนะ)
    local.stations.forEach(s => {
      if (s.surveyorName === surveyorName) localMap[s.id] = s;
    });
    const merged  = Object.values({ ...remoteMap, ...localMap });
    const newData = { stations: merged };
    localStorage.setItem(DB.KEY, JSON.stringify(newData));
    DB._data = newData;
    return merged.length;
  }
};

if (typeof firebase !== 'undefined') FB.init();
