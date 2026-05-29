// ===== ROADSIDE INTERVIEW APP =====
const App = {
  page: 'home', stId: null, ivId: null,
  _clientIp: '',
  _role: null,
  _surveyorName: '',
  _adminUsername: '',
  // wizard state
  wizardStep: 1,
  wizardData: null,
  _wizardDirection: null,
  _wizardDone: false,

  init() {
    DB.load();
    fetch('https://api.ipify.org?format=json')
      .then(r => r.json())
      .then(d => { this._clientIp = d.ip || ''; })
      .catch(() => {});

    document.querySelector('.topbar').style.display = 'none';
    document.getElementById('app').innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;color:#94a3b8;font-size:14px;">กำลังโหลด...</div>';

    if (typeof firebase !== 'undefined' && firebase.apps?.length) {
      FB.onAuthStateChanged(user => {
        if (this._role) return;
        if (user) {
          this._adminUsername = user.email.replace(FB.EMAIL_DOMAIN, '');
          this._role = 'admin';
          this._enterApp();
        } else {
          this._showLoginGate();
        }
      });
    } else {
      this._showLoginGate();
    }
  },

  // ===================== LOGIN GATE =====================
  _showLoginGate() {
    document.querySelector('.topbar').style.display = 'none';
    document.getElementById('app').innerHTML = this._loginGateHTML();
  },

  _loginGateHTML() {
    return `
      <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;
                  justify-content:center;padding:24px;
                  background:linear-gradient(160deg,#fff7e6 0%,#fef3c7 40%,#f8fafc 100%);">
        <div style="width:100%;max-width:340px;">
          <div style="text-align:center;margin-bottom:36px;">
            <div style="font-size:56px;margin-bottom:16px;filter:drop-shadow(0 4px 8px rgba(217,119,6,.25));">🚦</div>
            <div style="font-size:24px;font-weight:800;color:var(--gray-900);letter-spacing:-.01em;">Roadside Interview</div>
            <div style="font-size:13px;color:var(--gray-500);margin-top:6px;line-height:1.5;">
              โครงการวางผังเมืองรวม<br>อำเภอบ้านไผ่ จ.ขอนแก่น
            </div>
          </div>
          <div style="background:var(--white);border-radius:var(--radius-lg);padding:24px;
                      box-shadow:0 8px 40px rgba(0,0,0,.1),0 1px 0 rgba(255,255,255,.8);
                      border:1px solid rgba(217,119,6,.15);">
            <div style="font-size:12px;font-weight:700;color:var(--gray-400);text-transform:uppercase;
                        letter-spacing:.06em;margin-bottom:14px;">เลือกบทบาทของคุณ</div>
            <div style="display:flex;flex-direction:column;gap:10px;">
              <button class="btn btn-primary" style="padding:14px 20px;font-size:15px;justify-content:flex-start;gap:12px;border-radius:var(--radius);"
                onclick="App.loginAsSurveyor()">
                <span style="font-size:20px;">📋</span>
                <span>เข้าใช้งานเป็นผู้สำรวจ</span>
              </button>
              <button class="btn btn-ghost" style="padding:14px 20px;font-size:15px;justify-content:flex-start;gap:12px;border-radius:var(--radius);"
                onclick="App.loginAsAdmin()">
                <span style="font-size:20px;">🔐</span>
                <span>เข้าสู่ระบบ (ผู้ดูแลระบบ)</span>
              </button>
            </div>
          </div>
        </div>
      </div>`;
  },

  loginAsSurveyor() {
    this.showModal('📋 เข้าใช้งานเป็นผู้สำรวจ', `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-row">
          <label class="form-label">ชื่อ</label>
          <input id="sv_fname" class="form-input" autocomplete="off" placeholder="ชื่อจริง" />
        </div>
        <div class="form-row">
          <label class="form-label">นามสกุล</label>
          <input id="sv_lname" class="form-input" autocomplete="off" placeholder="นามสกุล" />
        </div>
      </div>
      <p style="font-size:12px;color:var(--gray-400);margin-top:6px;">ไม่ต้องใส่คำนำหน้า · ต้องพิมพ์ชื่อให้ตรงกันทุกครั้งเพื่อดึงข้อมูลของคุณ</p>`,
      `<button class="btn btn-ghost" onclick="App.closeModal()">ยกเลิก</button>
       <button class="btn btn-primary" onclick="App.doSurveyorLogin()">เข้าใช้งาน</button>`
    );
    setTimeout(() => document.getElementById('sv_fname')?.focus(), 50);
  },

  doSurveyorLogin() {
    const fname = document.getElementById('sv_fname')?.value.trim();
    const lname = document.getElementById('sv_lname')?.value.trim();
    if (!fname) { this.toast('กรุณากรอกชื่อ', 'error'); return; }
    if (!lname) { this.toast('กรุณากรอกนามสกุล', 'error'); return; }
    this._surveyorName = `${fname} ${lname}`;
    this._role = 'surveyor';
    this.closeModal();
    this._enterApp();
  },

  loginAsAdmin() {
    this.showModal('🔐 เข้าสู่ระบบ (ผู้ดูแลระบบ)', `
      <div class="form-row">
        <label class="form-label">ชื่อผู้ใช้</label>
        <input id="adm_user" class="form-input" autocomplete="off" placeholder="username"
          onkeydown="if(event.key==='Enter')document.getElementById('adm_pass').focus()" />
      </div>
      <div class="form-row">
        <label class="form-label">รหัสผ่าน</label>
        <input id="adm_pass" class="form-input" type="password" placeholder="password"
          onkeydown="if(event.key==='Enter')App.doAdminLogin()" />
      </div>`,
      `<button class="btn btn-ghost" onclick="App.closeModal()">ยกเลิก</button>
       <button class="btn btn-primary" id="adminLoginBtn" onclick="App.doAdminLogin()">เข้าสู่ระบบ</button>`
    );
    setTimeout(() => document.getElementById('adm_user')?.focus(), 50);
  },

  async doAdminLogin() {
    const username = document.getElementById('adm_user')?.value.trim();
    const password = document.getElementById('adm_pass')?.value;
    if (!username || !password) { this.toast('กรุณากรอกให้ครบ', 'error'); return; }
    const btn = document.getElementById('adminLoginBtn');
    if (btn) { btn.textContent = '⌛ กำลังตรวจสอบ...'; btn.disabled = true; }
    try {
      if (!FB.db) FB.init();
      await FB.loginAdmin(username, password);
      this._adminUsername = username;
      this._role = 'admin';
      this.closeModal();
      this._enterApp();
    } catch {
      if (btn) { btn.textContent = 'เข้าสู่ระบบ'; btn.disabled = false; }
      this.toast('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', 'error');
    }
  },

  _enterApp() {
    document.querySelector('.topbar').style.display = '';
    const right = document.getElementById('topbarRight');
    if (right) {
      right.outerHTML = `<div id="topbarRight" style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
        <a href="../index.html"
          style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;
                 color:#64748b;text-decoration:none;padding:6px 12px;border-radius:8px;
                 border:1px solid #e2e8f0;transition:all .15s;"
          onmouseover="this.style.color='#1e293b';this.style.borderColor='#94a3b8';this.style.background='#f1f5f9'"
          onmouseout="this.style.color='#64748b';this.style.borderColor='#e2e8f0';this.style.background=''">
          ◈ เมนูหลัก
        </a>
        <span style="font-size:12px;color:#94a3b8;">|</span>
        <span style="font-size:12px;color:#64748b;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          ${this._role === 'admin' ? '🔐' : '👤'} ${this._role === 'admin' ? this._adminUsername : this._surveyorName}
        </span>
        <button onclick="App.logout()"
          style="font-size:12px;font-weight:600;color:#64748b;background:none;border:1px solid #e2e8f0;
                 border-radius:6px;padding:4px 10px;cursor:pointer;white-space:nowrap;font-family:inherit;">
          ออก
        </button>
      </div>`;
    }
    this.navigate('home');
  },

  logout() {
    if (!confirm('ออกจากระบบ?')) return;
    if (this._role === 'admin') FB.logoutAdmin().catch(() => {});
    this._role = null;
    this._surveyorName = '';
    this._adminUsername = '';
    const right = document.getElementById('topbarRight');
    if (right) {
      right.outerHTML = `<a href="../index.html" id="topbarRight"
        style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;
               color:#64748b;text-decoration:none;padding:6px 12px;border-radius:8px;
               border:1px solid #e2e8f0;transition:all .15s;"
        onmouseover="this.style.color='#1e293b';this.style.borderColor='#94a3b8';this.style.background='#f1f5f9'"
        onmouseout="this.style.color='#64748b';this.style.borderColor='#e2e8f0';this.style.background=''">
        ◈ เมนูหลัก
      </a>`;
    }
    this._showLoginGate();
  },

  navigate(page, stId, ivId) {
    this.page = page;
    if (stId !== undefined) this.stId = stId;
    if (ivId !== undefined) this.ivId = ivId;
    this.render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  goBack() {
    if (this.page === 'wizard') { this._wizardPrev(); }
    else if (this.page === 'interview') this.navigate('station');
    else this.navigate('home');
  },

  render() {
    const app  = document.getElementById('app');
    const back = document.getElementById('backBtn');
    const bc   = document.getElementById('breadcrumb');
    back.style.display = this.page === 'home' ? 'none' : 'block';

    if (this.page === 'wizard') {
      bc.className = 'breadcrumb';
      const _firstStep = this._wizardDirection ? 2 : 1;
      back.style.display = (!this._wizardDone && this.wizardStep > _firstStep) ? 'block' : 'none';
      app.innerHTML = this._wizardDone ? this._wDoneScreen() : this.pageWizard();
      return;
    }

    if (this.page === 'home') {
      bc.className = 'breadcrumb';
      app.innerHTML = this.pageHome();
    } else if (this.page === 'station') {
      const st = DB.getStation(this.stId);
      bc.className = 'breadcrumb visible';
      bc.innerHTML = `<a onclick="App.navigate('home')">หน้าหลัก</a> <span>›</span> ${st ? (st.stationName || st.id) : ''}`;
      app.innerHTML = this.pageStation();
    } else if (this.page === 'interview') {
      const st = DB.getStation(this.stId);
      const iv = DB.getInterview(this.stId, this.ivId);
      bc.className = 'breadcrumb visible';
      bc.innerHTML = `<a onclick="App.navigate('home')">หน้าหลัก</a> <span>›</span>
        <a onclick="App.navigate('station','${this.stId}')">${st ? (st.stationName || st.id) : ''}</a>
        <span>›</span> การสำรวจที่ ${iv ? iv.seq : ''}`;
      app.innerHTML = this.pageInterview();
    }
  },

  // ===================== PAGE: HOME =====================
  pageHome() {
    const isAdmin  = this._role === 'admin';
    const allSts   = DB.getStations();
    const mySts    = isAdmin ? allSts : allSts.filter(s => s.surveyorName === this._surveyorName);
    const otherSts = isAdmin ? [] : allSts.filter(s => s.surveyorName !== this._surveyorName);
    const ivCount  = mySts.reduce((s, st) => s + st.interviews.length, 0);

    const stationCard = (st, isMine) => {
      const dirTag = st.direction ? `<span class="tag tag-orange">↔ ${st.direction}</span>` : '';
      if (isMine) {
        return `<div class="hh-card" onclick="App.navigate('station','${st.id}')">
          <div class="hh-card-icon">🚦</div>
          <div class="hh-card-body">
            <div class="hh-card-id">${st.stationName || 'ไม่ระบุชื่อจุด'}</div>
            <div class="hh-card-addr">${[st.road, st.district, st.province].filter(Boolean).join(' · ') || 'ไม่ระบุสถานที่'}</div>
            <div class="hh-card-tags">
              <span class="tag tag-green">📋 ${st.interviews.length} ราย</span>
              ${dirTag}
              <span class="tag tag-gray">📅 ${st.surveyDate}</span>
            </div>
          </div>
          <div class="hh-card-arrow">›</div>
        </div>`;
      } else {
        return `<div class="hh-card" onclick="App.navigate('station','${st.id}')"
          style="opacity:.75;">
          <div class="hh-card-icon" style="background:var(--gray-100);border-color:var(--gray-200);">🚦</div>
          <div class="hh-card-body">
            <div class="hh-card-id">${st.stationName || 'ไม่ระบุชื่อจุด'}</div>
            <div class="hh-card-addr">${[st.road, st.district, st.province].filter(Boolean).join(' · ') || 'ไม่ระบุสถานที่'}</div>
            <div class="hh-card-tags">
              ${dirTag}
              <span class="tag tag-gray">📅 ${st.surveyDate}</span>
              <span class="tag tag-gray">👤 ${st.surveyorName || 'ไม่ระบุ'}</span>
            </div>
          </div>
          <div class="hh-card-arrow" style="font-size:12px;color:var(--gray-400);">ดู</div>
        </div>`;
      }
    };

    return `<div class="page container">
      <div class="dash-hero">
        <div class="dash-hero-text">
          <h1>🚦 Roadside Interview</h1>
          <p>โครงการวางผังเมืองรวมอำเภอบ้านไผ่ จ.ขอนแก่น</p>
        </div>
        <div class="dash-stats">
          <div class="dash-stat"><div class="dash-stat-val">${mySts.length}</div><div class="dash-stat-lbl">${isAdmin ? 'จุดสำรวจ' : 'จุดของฉัน'}</div></div>
          <div class="dash-stat"><div class="dash-stat-val">${ivCount}</div><div class="dash-stat-lbl">การสำรวจ</div></div>
          ${!isAdmin && otherSts.length > 0 ? `<div class="dash-stat"><div class="dash-stat-val">${otherSts.length}</div><div class="dash-stat-lbl">จุดอื่น</div></div>` : ''}
        </div>
      </div>

      <div class="sec-header">
        <div>
          <div class="sec-title">รายการจุดสำรวจ</div>
          <div class="sec-sub">พบ ${allSts.length} จุดสำรวจ${!isAdmin ? ` · ของฉัน ${mySts.length} จุด` : ''}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${isAdmin && allSts.length > 0 ? `<button class="btn btn-ghost btn-sm" onclick="App.exportData()">⬇ Export Excel</button>` : ''}
          ${mySts.length > 0 ? `<button class="btn btn-ghost btn-sm" id="syncBtn" onclick="App.syncToCloud()">☁️ Sync</button>` : ''}
          ${isAdmin && allSts.length > 0 ? `<button class="btn btn-danger btn-sm" onclick="App.confirmClearAll()">🗑 ล้างข้อมูล</button>` : ''}
          <button class="btn btn-ghost btn-sm" id="pullBtn" onclick="App.pullFromCloud()">☁️ ดึงข้อมูล</button>
          ${isAdmin ? `<button class="btn btn-primary" onclick="App.openAddStation()">+ เพิ่มจุดสำรวจ</button>` : ''}
        </div>
      </div>

      ${allSts.length === 0 ? `
        <div class="empty">
          <span class="empty-icon">🚦</span>
          <h3>ยังไม่มีจุดสำรวจ</h3>
          <p>${isAdmin ? 'กดปุ่มด้านบนเพื่อเริ่มบันทึกข้อมูล หรือดึงข้อมูลจาก Firebase' : 'กด "ดึงข้อมูล" เพื่อโหลดจุดสำรวจที่ admin สร้างไว้'}</p>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
            ${isAdmin ? `<button class="btn btn-primary" onclick="App.openAddStation()">+ เพิ่มจุดสำรวจแรก</button>` : ''}
            <button class="btn btn-ghost" id="pullBtn" onclick="App.pullFromCloud()">☁️ ดึงข้อมูลจาก Firebase</button>
          </div>
        </div>` : `
        <div class="hh-list">
          ${mySts.map(st => stationCard(st, true)).join('')}
          ${otherSts.length > 0 ? `
            <div class="section-label" style="margin-top:18px;">จุดสำรวจอื่น (ดูได้อย่างเดียว)</div>
            ${otherSts.map(st => stationCard(st, false)).join('')}
          ` : ''}
        </div>`}
    </div>`;
  },

  // ===================== PAGE: STATION =====================
  pageStation() {
    const st = DB.getStation(this.stId);
    if (!st) return '<div class="container"><p>ไม่พบข้อมูล</p></div>';
    const isAdmin = this._role === 'admin';
    const isMine  = isAdmin || st.surveyorName === this._surveyorName || !st.surveyorName;

    return `<div class="page container">
      <div class="hh-detail-header">
        <div class="hh-detail-icon">🚦</div>
        <div class="hh-detail-info">
          <div class="hh-detail-id">${st.stationName || 'ไม่ระบุชื่อจุด'}</div>
          <div class="hh-detail-addr">${[st.road, st.district, st.province].filter(Boolean).join(' · ') || ''}</div>
          <div class="hh-detail-tags">
            ${st.direction     ? `<span class="tag tag-orange">↔ ${st.direction}</span>`              : ''}
            ${st.stationCode   ? `<span class="tag tag-gray">รหัส: ${st.stationCode}</span>`           : ''}
            <span class="tag tag-gray">📅 ${st.surveyDate}</span>
            ${st.surveyorName  ? `<span class="tag tag-gray">🧑‍💼 ${st.surveyorName}</span>`          : ''}
            ${st.supervisorName? `<span class="tag tag-gray">👔 ${st.supervisorName}</span>`           : ''}
            ${st.coordinates   ? `<span class="tag tag-blue">📍 ${st.coordinates}</span>`              : ''}
          </div>
        </div>
        ${isMine ? `<div style="display:flex;gap:6px;flex-shrink:0;">
          <button class="btn btn-ghost btn-sm" onclick="App.openEditStation('${st.id}')">✏️ แก้ไข</button>
          ${isAdmin ? `<button class="btn btn-danger btn-sm" onclick="App.confirmDeleteStation('${st.id}')">ลบ</button>` : ''}
        </div>` : `<span class="tag tag-gray" style="flex-shrink:0;">👁 ดูอย่างเดียว</span>`}
      </div>

      <div class="sec-header">
        <div>
          <div class="sec-title">รายการการสำรวจ</div>
          <div class="sec-sub">${isMine ? `บันทึกทุกคัน/ทุกคนที่หยุดสำรวจ · พบ ${st.interviews.length} ราย` : 'ข้อมูลของผู้สำรวจท่านนี้'}</div>
        </div>
        ${isMine ? `<button class="btn btn-primary" onclick="App.openWizard()">+ เพิ่มการสำรวจ</button>` : ''}
      </div>

      ${st.interviews.length > 0 ? `
      <div style="background:#fefce8;border:1.5px solid #d97706;border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div style="font-size:13px;color:#92400e;font-weight:600;">✅ บันทึกแล้ว ${st.interviews.length} ราย</div>
        <button class="btn btn-primary btn-sm" onclick="App.openWizard()" style="white-space:nowrap;">+ เพิ่มรายถัดไป</button>
      </div>` : ''}

      ${st.interviews.length === 0 ? `
        <div class="empty">
          <span class="empty-icon">📋</span>
          <h3>ยังไม่มีข้อมูลการสำรวจ</h3>
          <p>เพิ่มข้อมูลยานพาหนะ / ผู้เดินทางที่ถูกสัมภาษณ์</p>
          <button class="btn btn-primary" onclick="App.openWizard()">+ เพิ่มการสำรวจ</button>
        </div>` :
        `<div class="member-list">${st.interviews.map(iv => {
          const vt = OPT.vehicleTypes.find(v => v.key === iv.vehicleType) || { icon: '🚘', label: iv.vehicleType || 'ไม่ระบุ' };
          const dotCls = (iv.origin && iv.destination && iv.purpose) ? 'dot-green' : (iv.origin || iv.destination) ? 'dot-amber' : 'dot-gray';
          const plateStr = [iv.licensePlate, iv.licensePlateProvince].filter(Boolean).join(' / ');
          return `<div class="member-card" onclick="App.navigate('interview','${st.id}','${iv.id}')">
            <div class="member-avatar av-o" style="font-size:20px;">${vt.icon}</div>
            <div class="member-info">
              <div class="member-name">รายที่ ${iv.seq} · ${vt.label}</div>
              <div class="member-detail">${iv.origin && iv.destination ? iv.origin + ' → ' + iv.destination : (plateStr || 'ยังไม่กรอกข้อมูล')}</div>
            </div>
            <div class="member-right">
              ${iv.interviewTime ? `<span class="tag tag-gray">🕐 ${iv.interviewTime}</span>` : ''}
              <div class="status-dot ${dotCls}"></div>
              <span style="color:var(--gray-300)">›</span>
            </div>
          </div>`;
        }).join('')}</div>`}
    </div>`;
  },

  // ===================== PAGE: INTERVIEW DETAIL =====================
  pageInterview() {
    const st = DB.getStation(this.stId);
    const iv = DB.getInterview(this.stId, this.ivId);
    if (!iv) return '<div class="container"><p>ไม่พบข้อมูล</p></div>';
    const vt = OPT.vehicleTypes.find(v => v.key === iv.vehicleType) || { icon: '🚘', label: iv.vehicleType || '—' };

    const row = (label, val) => `
      <div class="info-item">
        <div class="info-label">${label}</div>
        <div class="info-value ${val ? '' : 'info-empty'}">${val || '—'}</div>
      </div>`;

    return `<div class="page container">
      <div class="hh-detail-header" style="margin-bottom:20px;">
        <div class="member-avatar av-o" style="width:50px;height:50px;font-size:22px;border-radius:50%;flex-shrink:0;">${vt.icon}</div>
        <div class="hh-detail-info">
          <div class="hh-detail-id">รายที่ ${iv.seq} — ${vt.label}</div>
          <div class="hh-detail-addr">
            ${iv.interviewTime ? '🕐 ' + iv.interviewTime + ' · ' : ''}
            ${[iv.licensePlate, iv.licensePlateProvince].filter(Boolean).join(' / ') || 'ไม่ระบุทะเบียน'}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button class="btn btn-ghost btn-sm" onclick="App.openInterviewForm('${iv.id}')">✏️ แก้ไข</button>
          <button class="btn btn-danger btn-sm" onclick="App.confirmDeleteInterview('${iv.id}')">ลบ</button>
        </div>
      </div>

      <div class="card-box">
        <div class="card-box-title">🚗 ข้อมูลยานพาหนะ</div>
        <div class="info-grid">
          ${row('ประเภทยานพาหนะ', vt.icon + ' ' + vt.label)}
          ${iv.travelDirection ? row('ทิศทาง', iv.travelDirection) : ''}
          ${row('ทะเบียนรถ', iv.licensePlate)}
          ${row('จังหวัดทะเบียน', iv.licensePlateProvince)}
          ${row('จำนวนผู้โดยสาร (รวมคนขับ)', iv.passengerCount ? iv.passengerCount + ' คน' : '')}
          ${row('เวลาสำรวจ', iv.interviewTime)}
        </div>
      </div>

      <div class="card-box">
        <div class="card-box-title">🗺️ ต้นทาง–ปลายทาง</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:14px;">
          <div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:var(--radius-sm);padding:12px 14px;">
            <div style="font-size:11px;font-weight:700;color:var(--primary-dark);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">▶ ต้นทาง</div>
            <div class="info-label">ประเภทสถานที่</div><div class="info-value ${iv.originType?'':'info-empty'}" style="margin-bottom:6px;">${iv.originType||'—'}</div>
            <div class="info-label">สถานที่ / หมู่บ้าน</div><div class="info-value ${iv.origin?'':'info-empty'}" style="margin-bottom:6px;">${iv.origin||'—'}</div>
            ${iv.originLandmark ? `<div class="info-label">จุดสังเกต</div><div class="info-value" style="margin-bottom:6px;">${iv.originLandmark}</div>` : ''}
            ${iv.originCoords ? `<div style="font-size:11px;color:var(--gray-400);">📍 ${iv.originCoords}</div>` : ''}
          </div>
          <div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:var(--radius-sm);padding:12px 14px;">
            <div style="font-size:11px;font-weight:700;color:var(--primary-dark);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">▶ ปลายทาง</div>
            <div class="info-label">ประเภทสถานที่</div><div class="info-value ${iv.destinationType?'':'info-empty'}" style="margin-bottom:6px;">${iv.destinationType||'—'}</div>
            <div class="info-label">สถานที่ / หมู่บ้าน</div><div class="info-value ${iv.destination?'':'info-empty'}" style="margin-bottom:6px;">${iv.destination||'—'}</div>
            ${iv.destLandmark ? `<div class="info-label">จุดสังเกต</div><div class="info-value" style="margin-bottom:6px;">${iv.destLandmark}</div>` : ''}
            ${iv.destinationCoords ? `<div style="font-size:11px;color:var(--gray-400);">📍 ${iv.destinationCoords}</div>` : ''}
          </div>
        </div>
        <div class="info-grid">
          ${row('วัตถุประสงค์', iv.purpose)}
          ${row('ความถี่การเดินทาง', iv.tripFrequency)}
        </div>
      </div>

      ${(iv.hasCargo || OPT.vehicleTypes.find(v=>v.key===iv.vehicleType)?.group==='truck') ? `
      <div class="card-box">
        <div class="card-box-title">📦 สินค้าที่บรรทุก</div>
        <div class="info-grid">
          ${row('มีสินค้า', iv.hasCargo)}
          ${iv.hasCargo === 'มีสินค้า' ? row('ชนิดสินค้า', iv.cargoType) : ''}
          ${iv.hasCargo === 'มีสินค้า' && iv.cargoWeight ? row('น้ำหนัก', iv.cargoWeight + ' กก.') : ''}
        </div>
      </div>` : ''}

      <div class="card-box">
        <div class="card-box-title">👤 ข้อมูลผู้ขับขี่ / ตัวแทน</div>
        <div class="info-grid">
          ${row('เพศ', iv.driverGender)}
          ${row('อายุ', iv.driverAge ? iv.driverAge + ' ปี' : '')}
          ${row('อาชีพ', iv.driverOccupation)}
          ${row('รายได้ (บาท/เดือน)', iv.driverIncome)}
        </div>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">
        <button class="btn btn-ghost" onclick="App.navigate('station','${this.stId}')">← กลับจุดสำรวจ</button>
        <button class="btn btn-primary" onclick="App.openWizard()">+ เพิ่มรายถัดไป</button>
      </div>
    </div>`;
  },

  // ===================== STATION FORM =====================
  _loadSurveyorNames() {
    return {
      surveyor:   localStorage.getItem('_ri_surveyor_name')   || '',
      supervisor: localStorage.getItem('_ri_supervisor_name') || ''
    };
  },
  _saveSurveyorNames(s, sv) {
    if (s)  localStorage.setItem('_ri_surveyor_name',   s);
    if (sv) localStorage.setItem('_ri_supervisor_name', sv);
  },

  _stationFormHTML(st) {
    const dirOpts = OPT.roadAxis.map(d =>
      `<option value="${d}" ${d === st?.direction ? 'selected' : ''}>${d}</option>`).join('');

    return `
      <div class="section-label">ข้อมูลจุดสำรวจ</div>
      <div class="form-row">
        <label class="form-label">รหัส / ชื่อจุดสำรวจ</label>
        <input id="s_stName" class="form-input" autocomplete="off" placeholder="เช่น MB01, MB02..."
          value="${st?.stationName||''}" />
      </div>
      <div class="form-grid">
        <div class="form-row">
          <label class="form-label">ถนน / ทางหลวง</label>
          <input id="s_road" class="form-input" autocomplete="off" placeholder="เช่น ทล.226"
            value="${st?.road||''}" />
        </div>
        <div class="form-row">
          <label class="form-label">แกนถนน</label>
          <select id="s_direction" class="form-select">
            <option value="">— เลือก —</option>${dirOpts}
          </select>
        </div>
      </div>
      <div class="form-grid">
        <div class="form-row">
          <label class="form-label">วันที่สำรวจ</label>
          <input id="s_surveyDate" class="form-input" type="date"
            value="${st ? (st.surveyDate||this._today()) : this._today()}" />
        </div>
      </div>

      <div class="section-label">ตำแหน่งจุดสำรวจ</div>
      <div class="form-row">
        <label class="form-label">พิกัด GPS</label>
        <div style="display:flex;gap:6px;">
          <input id="s_coords" class="form-input" autocomplete="off"
            placeholder="เช่น 16.0590, 102.7313" style="flex:1;min-width:0;"
            value="${st?.coordinates||''}" />
          <button type="button" onclick="App._openStationMap()"
            style="padding:9px 12px;background:#fef3c7;color:#92400e;border:1.5px solid #d97706;
                   border-radius:var(--radius-sm);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0;">🗺 แผนที่</button>
          <button type="button" id="gpsBtn_s_coords" onclick="App._useGPS('s_coords')"
            style="padding:9px 10px;background:#fef3c7;color:#92400e;border:1.5px solid #d97706;
                   border-radius:var(--radius-sm);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0;">📍</button>
        </div>
      </div>
      <div class="form-grid">
        <div class="form-row">
          <label class="form-label">ตำบล</label>
          <input id="s_subdistrict" class="form-input" autocomplete="off" value="${st?.subdistrict||''}" placeholder="กด GPS เพื่อดึงอัตโนมัติ" />
        </div>
        <div class="form-row">
          <label class="form-label">อำเภอ</label>
          <input id="s_district" class="form-input" autocomplete="off" value="${st?.district||''}" placeholder="กด GPS เพื่อดึงอัตโนมัติ" />
        </div>
        <div class="form-row">
          <label class="form-label">จังหวัด</label>
          <input id="s_province" class="form-input" autocomplete="off" value="${st?.province||''}" placeholder="ขอนแก่น" />
        </div>
      </div>`;
  },

  _openStationMap() {
    const coordsEl = document.getElementById('s_coords');
    MapPicker.open(coordsEl?.value || '', coords => {
      if (coordsEl) coordsEl.value = coords;
      this._reverseGeocode(
        parseFloat(coords.split(',')[0]),
        parseFloat(coords.split(',')[1])
      );
    });
  },

  _today() { return new Date().toISOString().split('T')[0]; },

  _readStationForm() {
    return {
      surveyDate:     document.getElementById('s_surveyDate')?.value         || '',
      stationName:    document.getElementById('s_stName')?.value.trim()      || '',
      stationCode:    document.getElementById('s_stName')?.value.trim()      || '',
      road:           document.getElementById('s_road')?.value.trim()        || '',
      direction:      document.getElementById('s_direction')?.value          || '',
      coordinates:    document.getElementById('s_coords')?.value.trim()      || '',
      subdistrict:    document.getElementById('s_subdistrict')?.value.trim() || '',
      district:       document.getElementById('s_district')?.value.trim()    || '',
      province:       document.getElementById('s_province')?.value.trim()    || ''
    };
  },

  _validateStationForm(data) {
    const errs = [];
    if (!data.surveyorName)   errs.push('ชื่อผู้สำรวจ');
    if (!data.supervisorName) errs.push('ชื่อผู้ควบคุม');
    if (!data.surveyDate)     errs.push('วันที่สำรวจ');
    if (!data.stationName)    errs.push('ชื่อจุดสำรวจ');
    if (!data.direction)      errs.push('ทิศทาง');
    return errs;
  },

  openAddStation() {
    this.showModal('🚦 เพิ่มจุดสำรวจใหม่', this._stationFormHTML(null),
      `<button class="btn btn-ghost" onclick="App.closeModal()">ยกเลิก</button>
       <button class="btn btn-primary" onclick="App.saveStation()">บันทึก</button>`
    );
    setTimeout(() => document.getElementById('s_sname')?.focus(), 50);
  },

  saveStation() {
    const data = this._readStationForm();
    this._saveSurveyorNames(data.surveyorName, data.supervisorName);
    const st = DB.addStation({
      ...data,
      deviceId: (typeof FB !== 'undefined' ? FB.deviceId() : null) || localStorage.getItem('_device_id') || '',
      clientIp: this._clientIp || ''
    });
    this.closeModal();
    this.toast('เพิ่มจุดสำรวจแล้ว', 'success');
    this.navigate('station', st.id);
  },

  openEditStation(id) {
    const st = DB.getStation(id);
    if (!st) return;
    this.showModal('✏️ แก้ไขข้อมูลจุดสำรวจ', this._stationFormHTML(st),
      `<button class="btn btn-ghost" onclick="App.closeModal()">ยกเลิก</button>
       <button class="btn btn-primary" onclick="App.saveEditStation('${id}')">บันทึก</button>`
    );
  },

  saveEditStation(id) {
    const data = this._readStationForm();
    this._saveSurveyorNames(data.surveyorName, data.supervisorName);
    DB.updateStation(id, data);
    this.closeModal();
    this.toast('บันทึกข้อมูลจุดสำรวจแล้ว', 'success');
    this.render();
  },

  confirmDeleteStation(id) {
    const st = DB.getStation(id);
    this.showModal('⚠️ ลบจุดสำรวจ',
      `<p style="color:var(--gray-600);">ต้องการลบจุดสำรวจ <strong>${st?.stationName || st?.id}</strong>
       พร้อมข้อมูลการสำรวจ ${st?.interviews.length || 0} ราย ใช่หรือไม่?<br><br>ไม่สามารถย้อนกลับได้</p>`,
      `<button class="btn btn-ghost" onclick="App.closeModal()">ยกเลิก</button>
       <button class="btn btn-danger" onclick="App.deleteStation('${id}')">ลบ</button>`
    );
  },

  deleteStation(id) {
    DB.deleteStation(id);
    this.closeModal();
    this.toast('ลบจุดสำรวจแล้ว', 'danger');
    this.navigate('home');
  },

  // ===================== INTERVIEW FORM =====================
  openInterviewForm(ivId) {
    const st    = DB.getStation(this.stId);
    const iv    = ivId ? st?.interviews.find(x => x.id === ivId) : null;
    const isEdit = !!iv;

    const selOpt = (list, val) => list.map(o =>
      `<option value="${o}" ${o === val ? 'selected' : ''}>${o}</option>`).join('');

    const vtGroups = {
      personal: OPT.vehicleTypes.filter(v => v.group === 'personal'),
      bus:      OPT.vehicleTypes.filter(v => v.group === 'bus'),
      truck:    OPT.vehicleTypes.filter(v => v.group === 'truck')
    };
    const mkVtOpts = (arr) => arr.map(vt =>
      `<option value="${vt.key}" ${vt.key === iv?.vehicleType ? 'selected' : ''}>${vt.icon} ${vt.label}</option>`
    ).join('');
    const vtOpts = `
      <optgroup label="รถส่วนบุคคล (1–5)">${mkVtOpts(vtGroups.personal)}</optgroup>
      <optgroup label="รถโดยสาร (6–7)">${mkVtOpts(vtGroups.bus)}</optgroup>
      <optgroup label="รถบรรทุก (8–9)">${mkVtOpts(vtGroups.truck)}</optgroup>`;

    const pvOpts = OPT.provinces.map(p =>
      `<option value="${p}" ${p === iv?.licensePlateProvince ? 'selected' : ''}>${p}</option>`).join('');

    this.showModal(isEdit ? '✏️ แก้ไขการสำรวจ' : '📋 เพิ่มการสำรวจ', `
      <div class="section-label">ข้อมูลยานพาหนะ</div>
      <div class="form-grid">
        <div class="form-row">
          <label class="form-label">ประเภทยานพาหนะ</label>
          <select id="iv_vtype" class="form-select">
            <option value="">— เลือก —</option>${vtOpts}
          </select>
        </div>
        <div class="form-row">
          <label class="form-label">เวลาสำรวจ</label>
          <input id="iv_time" class="form-input" type="time" value="${iv?.interviewTime||''}" />
        </div>
      </div>
      <div class="form-grid">
        <div class="form-row">
          <label class="form-label">ทะเบียนรถ</label>
          <input id="iv_plate" class="form-input" autocomplete="off" placeholder="เช่น กข 1234"
            value="${iv?.licensePlate||''}" style="text-transform:uppercase;" />
        </div>
        <div class="form-row">
          <label class="form-label">จังหวัดทะเบียน</label>
          <select id="iv_province" class="form-select">
            <option value="">— เลือก —</option>${pvOpts}
          </select>
        </div>
        <div class="form-row">
          <label class="form-label">ผู้โดยสาร (รวมคนขับ)</label>
          <input id="iv_pax" class="form-input" type="number" min="1" inputmode="numeric"
            autocomplete="off" placeholder="เช่น 2" value="${iv?.passengerCount||''}" />
        </div>
      </div>

      ${(() => {
        const axis = st?.direction;
        const opts = OPT.directionsByAxis[axis];
        if (!opts) return '';
        return `<div class="section-label">ทิศทางของยานพาหนะคันนี้</div>
        <div class="form-row">
          <div class="radio-group">
            ${opts.map(d => `
              <div class="radio-opt ${iv?.travelDirection === d ? 'sel' : ''}"
                onclick="App._pickTravelDir('${d}',this)">
                <div class="radio-dot"></div>${d}
              </div>`).join('')}
          </div>
          <input type="hidden" id="iv_travelDir" value="${iv?.travelDirection||''}" />
        </div>`;
      })()}

      <div class="section-label">จุดต้นทาง</div>
      <div class="form-row">
        <label class="form-label">ประเภทสถานที่ต้นทาง</label>
        <select id="iv_originType" class="form-select">
          <option value="">— เลือก —</option>${selOpt(OPT.locationType, iv?.originType||'')}
        </select>
      </div>
      <div class="form-row">
        <label class="form-label">ชื่อสถานที่ / หมู่บ้านต้นทาง</label>
        <input id="iv_origin" class="form-input" autocomplete="off"
          placeholder="ชื่อสถานที่หรือหมู่บ้าน" value="${iv?.origin||''}" />
      </div>
      <div class="form-row">
        <label class="form-label">จุดสังเกตต้นทาง</label>
        <input id="iv_originLandmark" class="form-input" autocomplete="off"
          placeholder="เช่น ใกล้ปั๊มน้ำมัน, หน้าวัด..." value="${iv?.originLandmark||''}" />
      </div>
      <div class="form-row">
        <label class="form-label">พิกัด GPS ต้นทาง</label>
        <div style="display:flex;gap:6px;">
          <input id="iv_originCoords" class="form-input" autocomplete="off"
            placeholder="เช่น 16.0590, 102.7313" style="flex:1;min-width:0;"
            value="${iv?.originCoords||''}" />
          <button type="button" id="gpsBtn_iv_originCoords" onclick="App._useGPS('iv_originCoords')"
            style="padding:9px 10px;background:#fef3c7;color:#92400e;border:1.5px solid #d97706;
                   border-radius:var(--radius-sm);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0;">📍</button>
        </div>
      </div>

      <div class="section-label">จุดปลายทาง</div>
      <div class="form-row">
        <label class="form-label">ประเภทสถานที่ปลายทาง</label>
        <select id="iv_destType" class="form-select">
          <option value="">— เลือก —</option>${selOpt(OPT.locationType, iv?.destinationType||'')}
        </select>
      </div>
      <div class="form-row">
        <label class="form-label">ชื่อสถานที่ / หมู่บ้านปลายทาง</label>
        <input id="iv_dest" class="form-input" autocomplete="off"
          placeholder="ชื่อสถานที่หรือหมู่บ้าน" value="${iv?.destination||''}" />
      </div>
      <div class="form-row">
        <label class="form-label">จุดสังเกตปลายทาง</label>
        <input id="iv_destLandmark" class="form-input" autocomplete="off"
          placeholder="เช่น ใกล้โรงเรียน, ตรงข้ามห้าง..." value="${iv?.destLandmark||''}" />
      </div>
      <div class="form-row">
        <label class="form-label">พิกัด GPS ปลายทาง</label>
        <div style="display:flex;gap:6px;">
          <input id="iv_destCoords" class="form-input" autocomplete="off"
            placeholder="เช่น 16.0590, 102.7313" style="flex:1;min-width:0;"
            value="${iv?.destinationCoords||''}" />
          <button type="button" id="gpsBtn_iv_destCoords" onclick="App._useGPS('iv_destCoords')"
            style="padding:9px 10px;background:#fef3c7;color:#92400e;border:1.5px solid #d97706;
                   border-radius:var(--radius-sm);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0;">📍</button>
        </div>
      </div>

      <div class="form-grid">
        <div class="form-row">
          <label class="form-label">วัตถุประสงค์การเดินทาง</label>
          <select id="iv_purpose" class="form-select">
            <option value="">— เลือก —</option>${selOpt(OPT.purpose, iv?.purpose||'')}
          </select>
        </div>
        <div class="form-row">
          <label class="form-label">ความถี่การเดินทางเส้นทางนี้</label>
          <select id="iv_freq" class="form-select">
            <option value="">— เลือก —</option>${selOpt(OPT.tripFrequency, iv?.tripFrequency||'')}
          </select>
        </div>
      </div>

      <div class="section-label">สินค้าที่บรรทุก <span style="font-size:11px;font-weight:400;color:var(--gray-400);">(สำหรับรถบรรทุก)</span></div>
      <div class="form-row">
        <label class="form-label">มีสินค้า</label>
        <div class="radio-group" id="iv_cargoGrp">
          ${['ไม่มีสินค้า','มีสินค้า'].map(v => `
            <div class="radio-opt ${iv?.hasCargo === v ? 'sel' : ''}" onclick="App._pickCargo('${v}',this)">
              <div class="radio-dot"></div>${v}
            </div>`).join('')}
        </div>
        <input type="hidden" id="iv_hasCargo" value="${iv?.hasCargo||''}" />
      </div>
      <div id="iv_cargoDetail" style="display:${iv?.hasCargo==='มีสินค้า'?'block':'none'};">
        <div class="form-grid">
          <div class="form-row">
            <label class="form-label">ชนิดสินค้า</label>
            <select id="iv_cargoType" class="form-select">
              <option value="">— เลือก —</option>${selOpt(OPT.cargoTypes, iv?.cargoType||'')}
            </select>
          </div>
          <div class="form-row">
            <label class="form-label">น้ำหนัก (กก.)</label>
            <input id="iv_cargoWeight" class="form-input" type="number" min="0"
              inputmode="numeric" autocomplete="off" placeholder="เช่น 5000"
              value="${iv?.cargoWeight||''}" />
          </div>
        </div>
      </div>

      <div class="section-label">ข้อมูลผู้ขับขี่ / ตัวแทน</div>
      <div class="form-row">
        <label class="form-label">เพศ</label>
        <div class="radio-group">
          ${['ชาย','หญิง'].map(g => `
            <div class="radio-opt ${iv?.driverGender === g ? 'sel' : ''}" onclick="App._pickGender('${g}',this)">
              <div class="radio-dot"></div>${g}
            </div>`).join('')}
        </div>
        <input type="hidden" id="iv_gender" value="${iv?.driverGender||''}" />
      </div>
      <div class="form-grid">
        <div class="form-row">
          <label class="form-label">อายุ (ปี)</label>
          <input id="iv_age" class="form-input" type="number" min="0" max="120" inputmode="numeric"
            autocomplete="off" placeholder="เช่น 35" value="${iv?.driverAge||''}" />
        </div>
        <div class="form-row">
          <label class="form-label">อาชีพ</label>
          <select id="iv_occ" class="form-select">
            <option value="">— เลือก —</option>${selOpt(OPT.occupation, iv?.driverOccupation||'')}
          </select>
        </div>
        <div class="form-row">
          <label class="form-label">รายได้ (บาท/เดือน)</label>
          <select id="iv_income" class="form-select">
            <option value="">— เลือก —</option>${selOpt(OPT.income, iv?.driverIncome||'')}
          </select>
        </div>
      </div>`,
      `<button class="btn btn-ghost" onclick="App.closeModal()">ยกเลิก</button>
       <button class="btn btn-primary" onclick="App.saveInterview(${isEdit ? `'${iv.id}'` : 'null'})">${isEdit ? 'บันทึกการแก้ไข' : 'เพิ่มการสำรวจ'}</button>`
    );
    setTimeout(() => document.getElementById('iv_vtype')?.focus(), 50);
  },

  _pickGender(val, el) {
    el.closest('.radio-group').querySelectorAll('.radio-opt').forEach(o => o.classList.remove('sel'));
    el.classList.add('sel');
    const h = document.getElementById('iv_gender');
    if (h) h.value = val;
  },

  _pickTravelDir(val, el) {
    el.closest('.radio-group').querySelectorAll('.radio-opt').forEach(o => o.classList.remove('sel'));
    el.classList.add('sel');
    const h = document.getElementById('iv_travelDir');
    if (h) h.value = val;
  },

  _pickCargo(val, el) {
    document.getElementById('iv_cargoGrp').querySelectorAll('.radio-opt').forEach(o => o.classList.remove('sel'));
    el.classList.add('sel');
    const h = document.getElementById('iv_hasCargo');
    if (h) h.value = val;
    const detail = document.getElementById('iv_cargoDetail');
    if (detail) detail.style.display = val === 'มีสินค้า' ? 'block' : 'none';
  },

  saveInterview(ivId) {
    const vehicleType = document.getElementById('iv_vtype')?.value;
    const origin      = document.getElementById('iv_origin')?.value.trim();
    const destination = document.getElementById('iv_dest')?.value.trim();
    const purpose     = document.getElementById('iv_purpose')?.value;


    const data = {
      vehicleType,
      interviewTime:        document.getElementById('iv_time')?.value         || '',
      licensePlate:         (document.getElementById('iv_plate')?.value || '').trim().toUpperCase(),
      licensePlateProvince: document.getElementById('iv_province')?.value      || '',
      passengerCount:       +(document.getElementById('iv_pax')?.value)        || '',
      origin,
      originVillage:        document.getElementById('iv_origin')?.value.trim()         || '',
      originLandmark:       document.getElementById('iv_originLandmark')?.value.trim() || '',
      originCoords:         document.getElementById('iv_originCoords')?.value.trim()   || '',
      originType:           document.getElementById('iv_originType')?.value             || '',
      destination,
      destVillage:          document.getElementById('iv_dest')?.value.trim()           || '',
      destLandmark:         document.getElementById('iv_destLandmark')?.value.trim()   || '',
      destinationCoords:    document.getElementById('iv_destCoords')?.value.trim()     || '',
      destinationType:      document.getElementById('iv_destType')?.value              || '',
      travelDirection:      document.getElementById('iv_travelDir')?.value      || '',
      purpose,
      tripFrequency:        document.getElementById('iv_freq')?.value           || '',
      hasCargo:             document.getElementById('iv_hasCargo')?.value      || '',
      cargoType:            document.getElementById('iv_cargoType')?.value     || '',
      cargoWeight:          document.getElementById('iv_cargoWeight')?.value   || '',
      driverGender:         document.getElementById('iv_gender')?.value        || '',
      driverAge:            +(document.getElementById('iv_age')?.value)        || '',
      driverOccupation:     document.getElementById('iv_occ')?.value           || '',
      driverIncome:         document.getElementById('iv_income')?.value        || ''
    };

    if (ivId) {
      DB.updateInterview(this.stId, ivId, data);
      this.toast('แก้ไขการสำรวจแล้ว', 'success');
    } else {
      const iv = DB.addInterview(this.stId, data);
      this.ivId = iv.id;
      this.toast('เพิ่มการสำรวจแล้ว', 'success');
    }
    this.closeModal();
    this.navigate('station', this.stId);
  },

  confirmDeleteInterview(ivId) {
    const iv = DB.getInterview(this.stId, ivId);
    this.showModal('⚠️ ลบการสำรวจ',
      `<p style="color:var(--gray-600);">ต้องการลบการสำรวจรายที่ ${iv?.seq} ใช่หรือไม่?</p>`,
      `<button class="btn btn-ghost" onclick="App.closeModal()">ยกเลิก</button>
       <button class="btn btn-danger" onclick="App.deleteInterview('${ivId}')">ลบ</button>`
    );
  },

  deleteInterview(ivId) {
    DB.deleteInterview(this.stId, ivId);
    this.closeModal();
    this.toast('ลบการสำรวจแล้ว', 'danger');
    this.navigate('station', this.stId);
  },

  // ===================== WIZARD =====================
  openWizard() {
    this._wizardDone = false;
    this.wizardData = { originType:'', originCoords:'', originLandmark:'', destType:'', destCoords:'', destLandmark:'', vehicleType:'', passengerCount:'', purpose:'', hasCargo:'', cargoType:'', cargoWeight:'', driverIncome:'' };
    this.wizardStep = this._wizardDirection ? 2 : 1;
    this.page = 'wizard'; this.render(); window.scrollTo(0, 0);
  },

  _wizardCancel() { this.navigate('station', this.stId); },

  _wIsTruck() {
    return OPT.vehicleTypes.find(v => v.key === this.wizardData?.vehicleType)?.group === 'truck';
  },
  // total steps ไม่นับ step ทิศถ้าทิศถูกตั้งแล้ว
  _wTotalSteps() { return (this._wizardDirection ? 0 : 1) + (this._wIsTruck() ? 7 : 6); },
  // step ที่แสดงให้ user เห็น (ไม่นับ step ทิศถ้าข้ามไปแล้ว)
  _wStepDisplay() { return this._wizardDirection ? this.wizardStep - 1 : this.wizardStep; },

  _wizardNext() {
    // purpose(6) + non-truck → ข้าม cargo ไป income(8)
    if (this.wizardStep === 6 && !this._wIsTruck()) { this.wizardStep = 8; }
    else { this.wizardStep++; }
    this.page = 'wizard'; this.render(); window.scrollTo(0, 0);
  },

  _wizardPrev() {
    if (this._wizardDone) { this._wizardCancel(); return; }
    // income(8) + non-truck → ย้อนไป purpose(6) ข้าม cargo
    if (this.wizardStep === 8 && !this._wIsTruck()) { this.wizardStep = 6; }
    // vehicle(2) + direction ตั้งแล้ว → cancel (ไม่ย้อนกลับไป direction อีก)
    else if (this.wizardStep <= 1 || (this.wizardStep === 2 && this._wizardDirection)) { this._wizardCancel(); return; }
    else { this.wizardStep--; }
    this.page = 'wizard'; this.render(); window.scrollTo(0, 0);
  },

  _wHeader(title, sub) {
    const step = this._wStepDisplay();
    const total = this._wTotalSteps();
    const pct = Math.round(step / total * 100);
    return `
      <div class="wiz-progress"><div class="wiz-progress-fill" style="width:${pct}%"></div></div>
      <div class="wiz-body">
        <div class="wiz-meta">
          <span class="wiz-step-label">คำถาม ${step} / ${total}</span>
          <button class="wiz-cancel-btn" onclick="App._wizardCancel()">ยกเลิก</button>
        </div>
        <div class="wiz-question">${title}</div>
        ${sub ? `<div class="wiz-sub">${sub}</div>` : ''}`;
  },
  _wFooter() { return `</div>`; },

  pageWizard() {
    switch (this.wizardStep) {
      case 1: return this._wStep1Direction();
      case 2: return this._wStep2Vehicle();
      case 3: return this._wStep3Passengers();
      case 4: return this._wStep4Origin();
      case 5: return this._wStep5Dest();
      case 6: return this._wStep6Purpose();
      case 7: return this._wStep7Cargo();
      case 8: return this._wStep8Income();
      default: return '';
    }
  },

  // Step 1: ทิศทาง (แสดงเฉพาะตอนยังไม่ตั้ง)
  _wStep1Direction() {
    const st = DB.getStation(this.stId);
    const opts = OPT.directionsByAxis[st?.direction] || ['มุ่งทิศเหนือ','มุ่งทิศใต้','มุ่งทิศตะวันออก','มุ่งทิศตะวันตก'];
    const icons = { 'มุ่งทิศเหนือ':'⬆️','มุ่งทิศใต้':'⬇️','มุ่งทิศตะวันออก':'➡️','มุ่งทิศตะวันตก':'⬅️' };
    const cards = opts.map(d => `
      <div class="wiz-card dir" onclick="App._wPickDirection('${d}')">
        <div class="wiz-card-icon">${icons[d]||'↕'}</div>
        <div class="wiz-card-label">${d}</div>
      </div>`).join('');
    return this._wHeader('คุณประจำฝั่งไหน?', 'ระบบจะจำไว้ใช้กับทุกคันถัดไป') +
      `<div class="wiz-grid wiz-grid-2">${cards}</div>` + this._wFooter();
  },
  _wPickDirection(val) { this._wizardDirection = val; this._wizardNext(); },

  // Step 2: ประเภทรถ
  _wStep2Vehicle() {
    const cards = OPT.vehicleTypes.map(vt => `
      <div class="wiz-card veh ${this.wizardData.vehicleType === vt.key ? 'sel' : ''}"
        onclick="App._wPickVehicle('${vt.key}')">
        <div class="wiz-card-icon">${vt.icon}</div>
        <div class="wiz-card-label">${vt.label}</div>
      </div>`).join('');
    return this._wHeader('ประเภทยานพาหนะ') +
      `<div class="wiz-grid wiz-grid-3">${cards}</div>` + this._wFooter();
  },
  _wPickVehicle(key) { this.wizardData.vehicleType = key; this._wizardNext(); },

  // Step 2: จำนวนคน
  _wStep3Passengers() {
    const nums = [1,2,3,4,5,6,7,8,9,10];
    const btns = nums.map(n => `
      <button class="wiz-num-btn ${this.wizardData.passengerCount === n ? 'sel' : ''}"
        onclick="App._wPickPax(${n})">${n}</button>`).join('');
    return this._wHeader('จำนวนคนในรถ', 'รวมคนขับ') +
      `<div class="wiz-num-grid">${btns}</div>
       <button class="wiz-num-btn ${this.wizardData.passengerCount > 10 ? 'sel' : ''}"
         onclick="App._wPickPax(11)" style="width:100%;font-size:18px;">10+ คน</button>` +
      this._wFooter();
  },
  _wPickPax(n) { this.wizardData.passengerCount = n; this._wizardNext(); },

  // Step 3: ต้นทาง
  _wStep4Origin() {
    const wd = this.wizardData;
    const cards = OPT.locationTypeCards.map(lt => `
      <div class="wiz-card ${wd.originType === lt.val ? 'sel' : ''}"
        onclick="App._wPickLocType('origin','${lt.val}')">
        <div class="wiz-card-icon">${lt.icon}</div>
        <div class="wiz-card-label">${lt.short}</div>
      </div>`).join('');
    return this._wHeader('ต้นทาง') + `
      <div class="wiz-grid wiz-grid-3" style="margin-bottom:14px;">${cards}</div>
      <button class="wiz-map-btn ${wd.originCoords ? 'picked' : ''}" onclick="App._wOpenOriginMap()">
        ${wd.originCoords ? '📍 ' + wd.originCoords : '🗺 เลือกจากแผนที่'}
      </button>
      <input id="wiz_originLandmark" class="form-input" style="margin-top:10px;"
        placeholder="จุดสังเกต / ชื่อสถานที่" value="${wd.originLandmark||''}"
        oninput="App.wizardData.originLandmark=this.value" />
      <div class="wiz-bottom"><div class="wiz-bottom-row">
        <button class="btn btn-primary btn-block" onclick="App._wOriginNext()">ถัดไป →</button>
      </div></div>` + this._wFooter();
  },
  _wOriginNext() {
    const inp = document.getElementById('wiz_originLandmark');
    if (inp) this.wizardData.originLandmark = inp.value;
    this._wizardNext();
  },

  // Step 4: ปลายทาง
  _wStep5Dest() {
    const wd = this.wizardData;
    const cards = OPT.locationTypeCards.map(lt => `
      <div class="wiz-card ${wd.destType === lt.val ? 'sel' : ''}"
        onclick="App._wPickLocType('dest','${lt.val}')">
        <div class="wiz-card-icon">${lt.icon}</div>
        <div class="wiz-card-label">${lt.short}</div>
      </div>`).join('');
    return this._wHeader('ปลายทาง') + `
      <div class="wiz-grid wiz-grid-3" style="margin-bottom:14px;">${cards}</div>
      <button class="wiz-map-btn ${wd.destCoords ? 'picked' : ''}" onclick="App._wOpenDestMap()">
        ${wd.destCoords ? '📍 ' + wd.destCoords : '🗺 เลือกจากแผนที่'}
      </button>
      <input id="wiz_destLandmark" class="form-input" style="margin-top:10px;"
        placeholder="จุดสังเกต / ชื่อสถานที่" value="${wd.destLandmark||''}"
        oninput="App.wizardData.destLandmark=this.value" />
      <div class="wiz-bottom"><div class="wiz-bottom-row">
        <button class="btn btn-primary btn-block" onclick="App._wDestNext()">ถัดไป →</button>
      </div></div>` + this._wFooter();
  },
  _wDestNext() {
    const inp = document.getElementById('wiz_destLandmark');
    if (inp) this.wizardData.destLandmark = inp.value;
    this._wizardNext();
  },

  _wPickLocType(prefix, val) {
    const dKey = prefix === 'origin' ? 'originLandmark' : 'destLandmark';
    const inp  = document.getElementById('wiz_' + dKey.replace('Landmark','Landmark').replace('origin','origin').replace('dest','dest'));
    if (inp) this.wizardData[dKey] = inp.value;
    this.wizardData[prefix + 'Type'] = val;
    this.page = 'wizard'; this.render();
  },
  _wOpenOriginMap() {
    const inp = document.getElementById('wiz_originLandmark');
    if (inp) this.wizardData.originLandmark = inp.value;
    MapPicker.open(this.wizardData.originCoords || '', (coords, name) => {
      this.wizardData.originCoords = coords;
      if (name && !this.wizardData.originLandmark) this.wizardData.originLandmark = name;
      this.page = 'wizard'; this.render();
    });
  },
  _wOpenDestMap() {
    const inp = document.getElementById('wiz_destLandmark');
    if (inp) this.wizardData.destLandmark = inp.value;
    MapPicker.open(this.wizardData.destCoords || '', (coords, name) => {
      this.wizardData.destCoords = coords;
      if (name && !this.wizardData.destLandmark) this.wizardData.destLandmark = name;
      this.page = 'wizard'; this.render();
    });
  },

  // Step 5: วัตถุประสงค์
  _wStep6Purpose() {
    const cards = OPT.purposeCards.map(p => `
      <div class="wiz-card ${this.wizardData.purpose === p.val ? 'sel' : ''}"
        onclick="App._wPickPurpose('${p.val.replace(/'/g, "\\'")}')">
        <div class="wiz-card-icon">${p.icon}</div>
        <div class="wiz-card-label">${p.val}</div>
      </div>`).join('');
    return this._wHeader('วัตถุประสงค์การเดินทาง') +
      `<div class="wiz-grid wiz-grid-3">${cards}</div>` + this._wFooter();
  },
  _wPickPurpose(val) { this.wizardData.purpose = val; this._wizardNext(); },

  // Step 6: สินค้า (รถบรรทุกเท่านั้น)
  _wStep7Cargo() {
    const wd = this.wizardData;
    const cargoCards = OPT.cargoTypes.map(c => `
      <div class="wiz-card wiz-cargo-item ${wd.cargoType === c ? 'sel' : ''}"
        data-label="${c}" onclick="App._wPickCargoType('${c.replace(/'/g,"\\'")}')">
        <div class="wiz-card-label" style="font-size:12px;">${c}</div>
      </div>`).join('');
    return this._wHeader('สินค้าที่บรรทุก') + `
      <div class="wiz-grid wiz-grid-2" style="margin-bottom:16px;">
        <div class="wiz-card ${wd.hasCargo==='ไม่มีสินค้า'?'sel':''}" onclick="App._wPickHasCargo('ไม่มีสินค้า')">
          <div class="wiz-card-icon">🚫</div><div class="wiz-card-label">ไม่มีสินค้า</div>
        </div>
        <div class="wiz-card ${wd.hasCargo==='มีสินค้า'?'sel':''}" onclick="App._wPickHasCargo('มีสินค้า')">
          <div class="wiz-card-icon">📦</div><div class="wiz-card-label">มีสินค้า</div>
        </div>
      </div>
      ${wd.hasCargo === 'ไม่มีสินค้า' ? `<div class="wiz-bottom"><div class="wiz-bottom-row"><button class="btn btn-primary btn-block" onclick="App._wizardNext()">ถัดไป →</button></div></div>` : ''}
      ${wd.hasCargo === 'มีสินค้า' ? `
        <input class="wiz-search" placeholder="🔍 ค้นหาชนิดสินค้า..." oninput="App._wFilterCargo(this.value)" />
        <div style="max-height:280px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:var(--radius);padding:8px;">
          <div class="wiz-grid wiz-grid-2">${cargoCards}</div>
        </div>
        ${wd.cargoType ? `
          <div style="margin-top:14px;">
            <label class="form-label">น้ำหนักสินค้า (กก.)</label>
            <input id="wiz_cargoWeight" class="form-input" type="number" inputmode="numeric"
              placeholder="เช่น 5000" value="${wd.cargoWeight||''}" oninput="App.wizardData.cargoWeight=this.value" />
          </div>
          <div class="wiz-bottom"><div class="wiz-bottom-row"><button class="btn btn-primary btn-block" onclick="App._wCargoNext()">ถัดไป →</button></div></div>
        ` : ''}
      ` : ''}` + this._wFooter();
  },
  _wPickHasCargo(val) { this.wizardData.hasCargo = val; this.wizardData.cargoType = ''; this.wizardData.cargoWeight = ''; this.page='wizard'; this.render(); window.scrollTo(0,0); },
  _wPickCargoType(val) { this.wizardData.cargoType = val; this.page='wizard'; this.render(); },
  _wCargoNext() { const w = document.getElementById('wiz_cargoWeight'); if (w) this.wizardData.cargoWeight = w.value; this._wizardNext(); },
  _wFilterCargo(q) { document.querySelectorAll('.wiz-cargo-item').forEach(el => { el.style.display = el.dataset.label.toLowerCase().includes(q.toLowerCase()) ? '' : 'none'; }); },

  // Step 7: รายได้
  _wStep8Income() {
    return this._wHeader('รายได้ต่อเดือน (บาท)', 'ของผู้ขับขี่หรือตัวแทน') + `
      <input id="wiz_income" class="form-input" type="number" inputmode="numeric"
        placeholder="เช่น 15000 (กรอก 0 ถ้าไม่มีรายได้)"
        style="font-size:22px;padding:20px;text-align:center;"
        value="${this.wizardData.driverIncome||''}" />
      <div class="wiz-bottom"><div class="wiz-bottom-row">
        <button class="btn btn-ghost" onclick="App._wSave()" style="flex:1;">ข้าม</button>
        <button class="btn btn-primary" onclick="App._wSave()" style="flex:2;">บันทึก ✓</button>
      </div></div>` + this._wFooter();
  },

  _wSave() {
    const incEl = document.getElementById('wiz_income');
    if (incEl) this.wizardData.driverIncome = incEl.value;
    const wd = this.wizardData;
    DB.addInterview(this.stId, {
      vehicleType:       wd.vehicleType,
      travelDirection:   this._wizardDirection || '',
      interviewTime:     new Date().toTimeString().slice(0,5),
      passengerCount:    wd.passengerCount,
      originType:        wd.originType,
      origin:            wd.originLandmark || wd.originCoords || '',
      originCoords:      wd.originCoords,
      originLandmark:    wd.originLandmark,
      destType:          wd.destType,
      destination:       wd.destLandmark || wd.destCoords || '',
      destinationCoords: wd.destCoords,
      destLandmark:      wd.destLandmark,
      purpose:           wd.purpose,
      hasCargo:          wd.hasCargo,
      cargoType:         wd.cargoType,
      cargoWeight:       wd.cargoWeight,
      driverIncome:      wd.driverIncome
    });
    this._wizardDone = true;
    this.page = 'wizard'; this.render(); window.scrollTo(0,0);
  },

  _wDoneScreen() {
    const vt = OPT.vehicleTypes.find(v => v.key === this.wizardData.vehicleType);
    const st = DB.getStation(this.stId);
    const dir = this._wizardDirection || '';
    return `<div class="wiz-done">
      <span class="wiz-done-icon">✅</span>
      <div class="wiz-done-badge">บันทึกสำเร็จ</div>
      <div class="wiz-done-title">รับทราบแล้ว!</div>
      <div class="wiz-done-sub">${vt?.icon||''} ${vt?.label||''}${dir ? ' · ' + dir : ''}</div>
      <div class="wiz-done-count">รายที่ ${st?.interviews.length||''} · จุด ${st?.stationName||''}</div>
      <div class="wiz-done-actions">
        <button class="btn btn-primary btn-lg btn-block" onclick="App._wizardNextCar()" style="font-size:16px;padding:16px;">
          🚗 รถคันถัดไป${dir ? ' — ' + dir : ''}
        </button>
        <button class="btn btn-outline btn-block" onclick="App._wizardChangeDir()">↔ เปลี่ยนทิศทาง</button>
        <button class="btn btn-ghost btn-block" onclick="App.navigate('station',App.stId)">← กลับหน้าจุดสำรวจ</button>
      </div>
    </div>`;
  },

  _wizardNextCar() {
    this._wizardDone = false;
    this.wizardData = { originType:'', originCoords:'', originLandmark:'', destType:'', destCoords:'', destLandmark:'', vehicleType:'', passengerCount:'', purpose:'', hasCargo:'', cargoType:'', cargoWeight:'', driverIncome:'' };
    this.wizardStep = 2; // ข้ามทิศ เริ่มที่รถ
    this.page = 'wizard'; this.render(); window.scrollTo(0,0);
  },
  _wizardChangeDir() {
    this._wizardDirection = null;
    this._wizardDone = false;
    this.wizardData = { originType:'', originCoords:'', originLandmark:'', destType:'', destCoords:'', destLandmark:'', vehicleType:'', passengerCount:'', purpose:'', hasCargo:'', cargoType:'', cargoWeight:'', driverIncome:'' };
    this.wizardStep = 1; // ถามทิศใหม่
    this.page = 'wizard'; this.render(); window.scrollTo(0,0);
  },

  // ===================== GPS =====================
  _useGPS(coordsId) {
    if (!navigator.geolocation) { this.toast('เบราว์เซอร์นี้ไม่รองรับ GPS', 'error'); return; }
    const btn = document.getElementById('gpsBtn_' + coordsId);
    if (btn) { btn.textContent = '⌛'; btn.disabled = true; }
    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = pos.coords.latitude.toFixed(6);
        const lon = pos.coords.longitude.toFixed(6);
        const coords = `${lat}, ${lon}`;
        const el = document.getElementById(coordsId);
        if (el) el.value = coords;
        if (btn) { btn.textContent = '📍'; btn.disabled = false; }
        this.toast(`รับพิกัด GPS: ${coords}`, 'success');
        if (coordsId === 's_coords') this._reverseGeocode(lat, lon);
      },
      () => {
        if (btn) { btn.textContent = '📍'; btn.disabled = false; }
        this.toast('ไม่สามารถอ่าน GPS ได้ — กรุณาอนุญาตการเข้าถึงตำแหน่ง', 'error');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  },

  _reverseGeocode(lat, lon) {
    const KEY = '4ffd5bcaa8a5941163c24dbe2a4401e8';
    fetch(`https://api.longdo.com/map/services/address?lon=${lon}&lat=${lat}&noescape=1&key=${KEY}`)
      .then(r => r.json())
      .then(d => {
        const sub = document.getElementById('s_subdistrict');
        const dis = document.getElementById('s_district');
        const pro = document.getElementById('s_province');
        if (sub) sub.value = d.subdistrict || sub.value;
        if (dis) dis.value = d.district    || dis.value;
        if (pro) pro.value = d.province    || pro.value;
        if (d.subdistrict || d.district)
          this.toast(`พบที่อยู่: ต.${d.subdistrict||'?'} อ.${d.district||'?'}`, 'success');
      })
      .catch(() => {});
  },

  // ===================== MODAL ENGINE =====================
  showModal(title, body, footer) {
    const old = document.getElementById('appModal');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = 'modal-overlay';
    el.id = 'appModal';
    el.innerHTML = `<div class="modal">
      <div class="modal-header">
        <div class="modal-title">${title}</div>
        <button class="modal-close" onclick="App.closeModal()">✕</button>
      </div>
      <div class="modal-body">${body}</div>
      <div class="modal-footer">${footer}</div>
    </div>`;
    el.addEventListener('click', e => { if (e.target === el) this.closeModal(); });
    document.body.appendChild(el);
  },

  closeModal() {
    const m = document.getElementById('appModal');
    if (m) m.remove();
  },

  // ===================== TOAST =====================
  toast(msg, type = '') {
    const wrap = document.getElementById('toastWrap');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    const icon = { success: '✓', warning: '⚠', danger: '✕' };
    t.innerHTML = `<span>${icon[type] || 'ℹ'}</span> ${msg}`;
    wrap.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  },

  // ===================== FIREBASE SYNC / PULL =====================
  pullFromCloud() {
    const isAdmin    = this._role === 'admin';
    const localCount = DB.getStations().length;
    const filterNote = isAdmin ? '' :
      `<br><span style="color:var(--primary);font-size:12px;">🔍 จะดึงเฉพาะข้อมูลของ "${this._surveyorName}" เท่านั้น</span>`;
    const msg = localCount > 0
      ? `<p style="font-size:14px;color:var(--gray-600);">จะดึงข้อมูลจาก Firebase มา<b>รวม</b>กับข้อมูลในเครื่อง ${localCount} จุดสำรวจ${filterNote}</p>`
      : `<p style="font-size:14px;color:var(--gray-600);">จะดึงข้อมูลจาก Firebase มาไว้ในเครื่องนี้${filterNote}</p>`;
    this.showModal('☁️ ดึงข้อมูลจาก Firebase', msg,
      `<button class="btn btn-ghost" onclick="App.closeModal()">ยกเลิก</button>
       <button class="btn btn-primary" onclick="App.closeModal();App._doPull()">ดึงข้อมูล</button>`
    );
  },

  async _doPull() {
    const btn = document.getElementById('pullBtn');
    if (btn) { btn.textContent = '⌛ กำลังดึง...'; btn.disabled = true; }
    try {
      if (typeof firebase === 'undefined') throw new Error('โหลด Firebase SDK ไม่สำเร็จ — ต้องการอินเทอร์เน็ต');
      if (!FB.db) FB.init();
      if (!FB.db) throw new Error('Firebase เชื่อมต่อไม่ได้ — ลองรีเฟรชหน้า');
      const count = this._role === 'admin'
        ? await FB.pullAll()
        : await FB.pullBySurveyor(this._surveyorName);
      this.toast(`☁️ ดึงข้อมูลสำเร็จ รวม ${count} จุดสำรวจ`, 'success');
      this.navigate('home');
    } catch (e) {
      this.toast('ดึงข้อมูลไม่สำเร็จ: ' + e.message, 'error');
    } finally {
      if (btn) { btn.textContent = '☁️ ดึงข้อมูล'; btn.disabled = false; }
    }
  },

  async syncToCloud() {
    const btn = document.getElementById('syncBtn');
    if (btn) { btn.textContent = '⌛ กำลัง sync...'; btn.disabled = true; }
    try {
      if (typeof firebase === 'undefined') throw new Error('โหลด Firebase SDK ไม่สำเร็จ — ต้องการอินเทอร์เน็ต');
      if (!FB.db) FB.init();
      if (!FB.db) throw new Error('Firebase เชื่อมต่อไม่ได้ — ลองรีเฟรชหน้า');
      const count = await FB.syncAll();
      const lastSync = FB.lastSync();
      const timeStr  = lastSync ? new Date(lastSync).toLocaleTimeString('th-TH') : '';
      this.toast(`☁️ sync สำเร็จ ${count} จุดสำรวจ${timeStr ? ' · ' + timeStr : ''}`, 'success');
    } catch (e) {
      this.toast('sync ไม่สำเร็จ: ' + e.message, 'error');
    } finally {
      if (btn) { btn.textContent = '☁️ Sync'; btn.disabled = false; }
    }
  },

  // ===================== EXPORT / CLEAR =====================
  exportData() {
    if (this._role !== 'admin') { this.toast('เฉพาะผู้ดูแลระบบเท่านั้น', 'error'); return; }
    if (typeof XLSX === 'undefined') { this.toast('โหลด SheetJS ไม่สำเร็จ', 'error'); return; }
    const data = JSON.parse(DB.exportJSON());
    const wb   = XLSX.utils.book_new();

    // Sheet 1: จุดสำรวจ
    const stRows = data.stations.map(st => ({
      'ID':              st.id,
      'วันที่สำรวจ':    st.surveyDate,
      'ผู้สำรวจ':       st.surveyorName,
      'ผู้ควบคุม':      st.supervisorName,
      'ชื่อจุดสำรวจ':   st.stationName,
      'รหัสจุดสำรวจ':   st.stationCode,
      'ถนน/ทางหลวง':    st.road,
      'ทิศทาง':         st.direction,
      'พิกัด':          st.coordinates,
      'ตำบล':           st.subdistrict,
      'อำเภอ':          st.district,
      'จังหวัด':        st.province,
      'จำนวนการสำรวจ':  st.interviews.length,
      'Device ID':       st.deviceId,
      'IP เครื่อง':     st.clientIp
    }));

    // Sheet 2: การสำรวจ
    const ivRows = data.stations.flatMap(st =>
      st.interviews.map(iv => ({
        'ID_จุดสำรวจ':           st.id,
        'ชื่อจุดสำรวจ':          st.stationName,
        'รหัสจุดสำรวจ':          st.stationCode,
        'ทิศทาง':                st.direction,
        'ID_การสำรวจ':           iv.id,
        'ลำดับ':                 iv.seq,
        'เวลาสำรวจ':             iv.interviewTime,
        'ประเภทยานพาหนะ':        (OPT.vehicleTypes.find(v=>v.key===iv.vehicleType)?.label) || iv.vehicleType,
        'กลุ่มยานพาหนะ':         ({'personal':'รถส่วนบุคคล','bus':'รถโดยสาร','truck':'รถบรรทุก'})[OPT.vehicleTypes.find(v=>v.key===iv.vehicleType)?.group] || '',
        'ทิศทาง':                iv.travelDirection,
        'ทะเบียนรถ':             iv.licensePlate,
        'จังหวัดทะเบียน':        iv.licensePlateProvince,
        'จำนวนผู้โดยสาร':        iv.passengerCount,
        'ประเภทสถานที่ต้นทาง':   iv.originType,
        'สถานที่/หมู่บ้านต้นทาง':iv.origin,
        'จุดสังเกตต้นทาง':       iv.originLandmark,
        'พิกัดต้นทาง':           iv.originCoords,
        'ประเภทสถานที่ปลายทาง':  iv.destinationType,
        'สถานที่/หมู่บ้านปลายทาง':iv.destination,
        'จุดสังเกตปลายทาง':      iv.destLandmark,
        'พิกัดปลายทาง':          iv.destinationCoords,
        'วัตถุประสงค์':           iv.purpose,
        'ความถี่การเดินทาง':     iv.tripFrequency,
        'มีสินค้า':               iv.hasCargo,
        'ชนิดสินค้า':            iv.cargoType,
        'น้ำหนักสินค้า(กก.)':    iv.cargoWeight,
        'เพศ(คนขับ)':            iv.driverGender,
        'อายุ(คนขับ)':           iv.driverAge,
        'อาชีพ(คนขับ)':          iv.driverOccupation,
        'รายได้(คนขับ)':         iv.driverIncome
      }))
    );

    const mkSheet = rows => rows.length
      ? XLSX.utils.json_to_sheet(rows)
      : XLSX.utils.aoa_to_sheet([['ไม่มีข้อมูล']]);

    XLSX.utils.book_append_sheet(wb, mkSheet(stRows), 'จุดสำรวจ');
    XLSX.utils.book_append_sheet(wb, mkSheet(ivRows), 'การสำรวจ');

    const filename = `roadside-interview-banphai-${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, filename);
    this.toast('Export Excel สำเร็จ', 'success');
  },

  confirmClearAll() {
    const stats = DB.stats();
    this.showModal('⚠️ ล้างข้อมูลทั้งหมด',
      `<div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;padding:14px 16px;margin-bottom:12px;">
        <strong style="color:#dc2626;">ข้อมูลที่จะถูกลบ:</strong>
        <ul style="margin-top:8px;padding-left:18px;font-size:14px;color:#7f1d1d;line-height:1.8;">
          <li>${stats.stations} จุดสำรวจ</li>
          <li>${stats.interviews} การสำรวจ</li>
        </ul>
      </div>
      <p style="font-size:14px;color:var(--gray-600);">ไม่สามารถย้อนกลับได้ — แนะนำให้ Export ก่อน</p>`,
      `<button class="btn btn-ghost" onclick="App.closeModal()">ยกเลิก</button>
       <button class="btn btn-ghost btn-sm" onclick="App.exportData()" style="color:var(--primary);">⬇ Export ก่อนลบ</button>
       <button class="btn btn-danger" onclick="App.clearAll()">ล้างข้อมูลทั้งหมด</button>`
    );
  },

  clearAll() {
    localStorage.removeItem(DB.KEY);
    DB._data = null;
    this.closeModal();
    this.toast('ล้างข้อมูลทั้งหมดแล้ว', 'danger');
    this.navigate('home');
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
