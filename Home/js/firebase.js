// ===== FIREBASE SYNC (v1) =====
const FB = {
  db: null,
  COLLECTION: 'households',

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
      this.db = firebase.firestore();
      console.log('[FB] initialized');
    } catch (e) {
      console.error('[FB] init error:', e);
    }
  },

  // Device ID — ระบุว่าข้อมูลมาจากเครื่องไหน
  deviceId() {
    let id = localStorage.getItem('_device_id');
    if (!id) {
      id = 'DEV-' + Date.now();
      localStorage.setItem('_device_id', id);
    }
    return id;
  },

  lastSync() {
    return localStorage.getItem('_last_sync') || null;
  },

  // Timeout helper — reject ถ้าเกิน ms มิลลิวินาที
  _withTimeout(promise, ms = 15000) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`หมดเวลา (${ms/1000}s) — ตรวจสอบ Firestore Rules และอินเทอร์เน็ต`)), ms)
      )
    ]);
  },

  // Sync ครัวเรือนทั้งหมดขึ้น Firestore
  async syncAll() {
    if (!this.db) throw new Error('Firebase ไม่พร้อม');
    const hhs = DB.getHouseholds();
    if (!hhs.length) throw new Error('ไม่มีข้อมูลครัวเรือน');

    const device = this.deviceId();
    const syncedAt = new Date().toISOString();

    // Firestore batch สูงสุด 500 ops — แบ่งเป็น chunk
    const CHUNK = 400;
    for (let i = 0; i < hhs.length; i += CHUNK) {
      const batch = this.db.batch();
      for (const hh of hhs.slice(i, i + CHUNK)) {
        const ref = this.db.collection(this.COLLECTION).doc(hh.id);
        batch.set(ref, { ...hh, _device: device, _syncedAt: syncedAt });
      }
      await this._withTimeout(batch.commit());
    }

    localStorage.setItem('_last_sync', syncedAt);
    return hhs.length;
  },

  // ดึงข้อมูลจาก Firestore → merge กับ localStorage (ไม่ลบข้อมูลในเครื่อง)
  async pullAll() {
    if (!this.db) throw new Error('Firebase ไม่พร้อม');

    const snap = await this._withTimeout(
      this.db.collection(this.COLLECTION).get(),
      20000
    );

    if (snap.empty) throw new Error('ไม่มีข้อมูลใน Firestore');

    // map ข้อมูลจาก Firebase (ลบ field ที่ Firebase เพิ่มเอง)
    const remoteMap = {};
    snap.docs.forEach(doc => {
      const d = doc.data();
      delete d._device;
      delete d._syncedAt;
      remoteMap[d.id] = d;
    });

    // merge: remote ชนะถ้า ID ซ้ำกัน
    const local = DB.load();
    const localMap = {};
    local.households.forEach(h => { localMap[h.id] = h; });

    const merged = Object.values({ ...localMap, ...remoteMap });
    const newData = { households: merged };
    localStorage.setItem(DB.KEY, JSON.stringify(newData));
    DB._data = newData;

    return merged.length;
  },

  // Realtime subscription — fires onChange({ count, syncedAt }) whenever
  // the Firestore collection changes. Merges remote data into localStorage
  // (remote wins on ID conflict) and returns an unsubscribe function.
  subscribe(onChange, onError) {
    if (!this.db) {
      if (onError) onError(new Error('Firebase ไม่พร้อม'));
      return function () {};
    }

    return this.db.collection(this.COLLECTION).onSnapshot(
      snap => {
        const remoteMap = {};
        snap.docs.forEach(doc => {
          const d = doc.data();
          delete d._device;
          delete d._syncedAt;
          remoteMap[d.id] = d;
        });

        // merge: remote wins on ID collision (same policy as pullAll)
        const local = DB.load();
        const localMap = {};
        local.households.forEach(h => { localMap[h.id] = h; });
        const merged = Object.values({ ...localMap, ...remoteMap });

        const newData = { households: merged };
        localStorage.setItem(DB.KEY, JSON.stringify(newData));
        DB._data = newData;

        const syncedAt = new Date().toISOString();
        localStorage.setItem('_last_sync', syncedAt);

        if (onChange) onChange({ count: merged.length, syncedAt });
      },
      err => {
        console.error('[FB] subscribe error:', err);
        if (onError) onError(err);
      }
    );
  }
};

// Auto-init เมื่อ SDK พร้อม
if (typeof firebase !== 'undefined') FB.init();
