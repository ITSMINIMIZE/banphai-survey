// ===== HOME INTERVIEW APP (v2) =====
const App = {
  page: 'home', hhId: null, memberId: null, memberTab: 'info', editingTripId: null,
  _mapActive: false,
  _clientIp: '',
  _role: null,          // 'admin' | 'surveyor'
  _surveyorName: '',    // ชื่อ-นามสกุล ผู้สำรวจ
  _adminUsername: '',   // username ผู้ดูแลระบบ

  init() {
    DB.load();
    fetch('https://api.ipify.org?format=json')
      .then(r => r.json())
      .then(d => { this._clientIp = d.ip || ''; })
      .catch(() => {});

    // แสดง loading แล้วรอ Firebase Auth ตรวจสอบ session
    document.querySelector('.topbar').style.display = 'none';
    document.getElementById('app').innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;color:#94a3b8;font-size:14px;">กำลังโหลด...</div>';

    if (typeof firebase !== 'undefined' && firebase.apps?.length) {
      FB.onAuthStateChanged(user => {
        if (this._role) return; // เข้าระบบแล้ว ไม่ต้องทำซ้ำ
        if (user) {
          // มี session admin อยู่ → เข้าเลย
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
                  justify-content:center;padding:24px;background:var(--bg);">
        <div style="text-align:center;margin-bottom:48px;">
          <div style="font-size:48px;margin-bottom:12px;">🏠</div>
          <div style="font-size:22px;font-weight:700;color:var(--gray-800);">Home Interview</div>
          <div style="font-size:13px;color:var(--gray-500);margin-top:6px;">โครงการวางผังเมืองรวมอำเภอบ้านไผ่ จ.ขอนแก่น</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:12px;width:100%;max-width:300px;">
          <button class="btn btn-primary" style="padding:14px;font-size:15px;"
            onclick="App.loginAsSurveyor()">
            📋 เข้าใช้งานเป็นผู้สำรวจ
          </button>
          <button class="btn btn-ghost" style="padding:14px;font-size:15px;"
            onclick="App.loginAsAdmin()">
            🔐 เข้าสู่ระบบ (ผู้ดูแลระบบ)
          </button>
        </div>
      </div>`;
  },

  // ---- ผู้สำรวจ ----
  loginAsSurveyor() {
    this.showModal('📋 เข้าใช้งานเป็นผู้สำรวจ', `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-row">
          <label class="form-label req">ชื่อ</label>
          <input id="sv_fname" class="form-input" autocomplete="off" placeholder="ชื่อจริง" />
        </div>
        <div class="form-row">
          <label class="form-label req">นามสกุล</label>
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

  // ---- ผู้ดูแลระบบ ----
  loginAsAdmin() {
    this.showModal('🔐 เข้าสู่ระบบ (ผู้ดูแลระบบ)', `
      <div class="form-row">
        <label class="form-label req">ชื่อผู้ใช้</label>
        <input id="adm_user" class="form-input" autocomplete="off" placeholder="username"
          onkeydown="if(event.key==='Enter')document.getElementById('adm_pass').focus()" />
      </div>
      <div class="form-row">
        <label class="form-label req">รหัสผ่าน</label>
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
    } catch (e) {
      if (btn) { btn.textContent = 'เข้าสู่ระบบ'; btn.disabled = false; }
      this.toast('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', 'error');
    }
  },

  // ---- เข้าแอปหลังจาก login ----
  _enterApp() {
    document.querySelector('.topbar').style.display = '';
    // อัปเดตขวาของ topbar → แสดงชื่อ + ปุ่มออก
    const right = document.getElementById('topbarRight');
    if (right) {
      right.outerHTML = `<div id="topbarRight" style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
        <span style="font-size:12px;color:#64748b;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
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

  // ---- ออกจากระบบ ----
  logout() {
    if (!confirm('ออกจากระบบ?')) return;
    if (this._role === 'admin') FB.logoutAdmin().catch(() => {});
    this._role = null;
    this._surveyorName = '';
    this._adminUsername = '';
    // คืน topbar right เป็นลิงก์เมนูหลัก
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

  navigate(page, hhId, memberId) {
    if (this._mapActive) { MapDashboard.destroy(); this._mapActive = false; }
    this.page = page;
    if (hhId !== undefined) this.hhId = hhId;
    if (memberId !== undefined) this.memberId = memberId;
    this.render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  goBack() {
    if (this.page === 'member') this.navigate('household');
    else this.navigate('home');
  },

  render() {
    const app = document.getElementById('app');
    const back = document.getElementById('backBtn');
    const bc   = document.getElementById('breadcrumb');
    back.style.display = this.page === 'home' ? 'none' : 'block';

    if (this.page === 'home') {
      bc.className = 'breadcrumb';
      app.innerHTML = this.pageHome();
    } else if (this.page === 'household') {
      const hh = DB.getHousehold(this.hhId);
      bc.className = 'breadcrumb visible';
      bc.innerHTML = `<a onclick="App.navigate('home')">หน้าหลัก</a> <span>›</span> ${hh ? (hh.houseNo ? 'บ้านเลขที่ ' + hh.houseNo : hh.id) : ''}`;
      app.innerHTML = this.pageHousehold();
    } else if (this.page === 'member') {
      const hh = DB.getHousehold(this.hhId);
      const m  = DB.getMember(this.hhId, this.memberId);
      bc.className = 'breadcrumb visible';
      bc.innerHTML = `<a onclick="App.navigate('home')">หน้าหลัก</a> <span>›</span>
        <a onclick="App.navigate('household','${this.hhId}')">${hh ? (hh.houseNo ? 'บ้านเลขที่ ' + hh.houseNo : hh.id) : ''}</a>
        <span>›</span> สมาชิกที่ ${m ? m.seq : ''}`;
      app.innerHTML = this.pageMember();
    } else if (this.page === 'map') {
      bc.className = 'breadcrumb visible';
      bc.innerHTML = `<a onclick="App.navigate('home')">หน้าหลัก</a> <span>›</span> แผนที่สำรวจ`;
      app.innerHTML = this.pageMap();
      setTimeout(() => { MapDashboard.init(); this._mapActive = true; }, 100);
    }
  },

  // ===================== PAGE: HOME =====================
  pageHome() {
    const isAdmin = this._role === 'admin';
    const allHhs  = DB.getHouseholds();
    const hhs     = isAdmin ? allHhs : allHhs.filter(h => h.surveyorName === this._surveyorName);
    const members = hhs.reduce((s, h) => s + h.members.length, 0);
    const trips   = hhs.reduce((s, h) => h.members.reduce((s2, m) => s2 + m.trips.length, s), 0);

    return `<div class="page container">
      <div class="dash-hero">
        <div class="dash-hero-text">
          <h1>แบบสำรวจการเดินทาง</h1>
          <p>โครงการวางผังเมืองรวมอำเภอบ้านไผ่ จ.ขอนแก่น</p>
        </div>
        <div class="dash-stats">
          <div class="dash-stat"><div class="dash-stat-val">${hhs.length}</div><div class="dash-stat-lbl">ครัวเรือน</div></div>
          <div class="dash-stat"><div class="dash-stat-val">${members}</div><div class="dash-stat-lbl">สมาชิก</div></div>
          <div class="dash-stat"><div class="dash-stat-val">${trips}</div><div class="dash-stat-lbl">การเดินทาง</div></div>
        </div>
      </div>

      <div class="sec-header">
        <div>
          <div class="sec-title">รายการครัวเรือน</div>
          <div class="sec-sub">พบ ${hhs.length} ครัวเรือน${!isAdmin ? ' (ของคุณ)' : ''}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${isAdmin ? `<button class="btn btn-ghost btn-sm" onclick="App.navigate('map')">🗺 แผนที่สำรวจ</button>` : ''}
          ${isAdmin && hhs.length > 0 ? `<button class="btn btn-ghost btn-sm" onclick="App.exportData()">⬇ Export Excel</button>` : ''}
          ${hhs.length > 0 ? `<button class="btn btn-ghost btn-sm" id="syncBtn" onclick="App.syncToCloud()">☁️ Sync</button>` : ''}
          ${isAdmin && hhs.length > 0 ? `<button class="btn btn-danger btn-sm" onclick="App.confirmClearAll()">🗑 ล้างข้อมูล</button>` : ''}
          <button class="btn btn-ghost btn-sm" id="pullBtn" onclick="App.pullFromCloud()">☁️ ดึงข้อมูล</button>
          <button class="btn btn-primary" onclick="App.openAddHousehold()">+ เพิ่มครัวเรือน</button>
        </div>
      </div>

      ${hhs.length === 0 ? `
        <div class="empty">
          <span class="empty-icon">🏘️</span>
          <h3>ยังไม่มีครัวเรือน</h3>
          <p>กดปุ่มด้านบนเพื่อเริ่มบันทึกข้อมูล หรือดึงข้อมูลจาก Firebase</p>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
            <button class="btn btn-primary" onclick="App.openAddHousehold()">+ เพิ่มครัวเรือนแรก</button>
            <button class="btn btn-ghost" id="pullBtn" onclick="App.pullFromCloud()">☁️ ดึงข้อมูลจาก Firebase</button>
          </div>
        </div>` :
        `<div class="hh-list">${hhs.map(hh => {
          const t    = hh.members.reduce((s, m) => s + m.trips.length, 0);
          const totM = Object.values(hh.memberGrid || {}).reduce((s, v) => s + (+v || 0), 0);
          const addr = [hh.houseNo ? 'บ้านเลขที่ ' + hh.houseNo : '', hh.moo ? 'ม.' + hh.moo : '', hh.road].filter(Boolean).join(' ');
          return `<div class="hh-card" onclick="App.navigate('household','${hh.id}')">
            <div class="hh-card-icon">🏠</div>
            <div class="hh-card-body">
              <div class="hh-card-id">${addr || 'ไม่ระบุที่อยู่'}</div>
              <div class="hh-card-addr">${hh.surveyorName ? 'ผู้สำรวจ: ' + hh.surveyorName : ''}</div>
              <div class="hh-card-tags">
                <span class="tag tag-blue">👥 ${totM} คน</span>
                <span class="tag tag-green">🚗 ${t} เที่ยว</span>
                <span class="tag tag-gray">📅 ${hh.surveyDate}</span>
                ${hh.residentialType ? `<span class="tag tag-gray">${hh.residentialType}</span>` : ''}
              </div>
            </div>
            <div class="hh-card-arrow">›</div>
          </div>`;
        }).join('')}</div>`}
    </div>`;
  },

  // ===================== PAGE: HOUSEHOLD =====================
  pageHousehold() {
    const hh = DB.getHousehold(this.hhId);
    if (!hh) return '<div class="container"><p>ไม่พบข้อมูล</p></div>';

    const addr = [
      hh.houseNo  ? 'บ้านเลขที่ ' + hh.houseNo : '',
      hh.moo      ? 'หมู่ที่ '    + hh.moo      : '',
      hh.alley    ? 'ซอย '        + hh.alley    : '',
      hh.road     ? 'ถ.'          + hh.road     : ''
    ].filter(Boolean).join(' ');

    const totalM        = Object.values(hh.memberGrid || {}).reduce((s, v) => s + (+v || 0), 0);
    // คำนวณอัตโนมัติ: สมาชิกที่มีข้อมูลส่วนที่ 2 และ 3 ครบ
    const surveyableCnt = hh.members.filter(m => m.gender && m.trips.length > 0).length;

    // vehicle summary
    let vehicleSummary = '';
    if (hh.hasVehicle === 'มี' && hh.vehicles) {
      const lines = OPT.vehicleTypes
        .filter(vt => { const v = hh.vehicles[vt.key]; return v && (+v.private||0) + (+v.company||0) + (+v.gov||0) > 0; })
        .map(vt => {
          const v = hh.vehicles[vt.key];
          const total = (+v.private||0) + (+v.company||0) + (+v.gov||0);
          return `<span class="tag tag-gray">${vt.icon} ${vt.label}: ${total} คัน</span>`;
        });
      vehicleSummary = lines.join('');
    }

    return `<div class="page container">
      <div class="hh-detail-header">
        <div class="hh-detail-icon">🏠</div>
        <div class="hh-detail-info">
          <div class="hh-detail-id">${addr || 'ไม่ระบุที่อยู่'}</div>
          <div class="hh-detail-addr">${hh.residentialType || ''}</div>
          <div class="hh-detail-tags">
            ${hh.travelDate    ? `<span class="tag tag-blue">🗓 เดินทาง ${hh.travelDate}</span>` : ''}
            <span class="tag tag-gray">📋 บันทึก ${hh.surveyDate}</span>
            ${hh.surveyorName  ? `<span class="tag tag-gray">🧑‍💼 ${hh.surveyorName}</span>`  : ''}
            ${hh.supervisorName? `<span class="tag tag-gray">👔 ${hh.supervisorName}</span>`  : ''}
            ${hh.coordinates   ? `<span class="tag tag-blue">📍 ${hh.coordinates}</span>`     : ''}
            ${hh.deviceId      ? `<span class="tag tag-gray" title="Device ID: ${hh.deviceId}">💻 ${hh.deviceId.slice(0,8)}…</span>` : ''}
            ${hh.clientIp      ? `<span class="tag tag-gray">🌐 ${hh.clientIp}</span>`          : ''}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button class="btn btn-ghost btn-sm" onclick="App.openEditHousehold('${hh.id}')">✏️ แก้ไข</button>
          <button class="btn btn-danger btn-sm" onclick="App.confirmDeleteHousehold('${hh.id}')">ลบ</button>
        </div>
      </div>

      ${totalM > 0 ? `<div class="card-box" style="margin-bottom:20px;">
        <div class="card-box-title">📊 ส่วนที่ 1 — สรุปข้อมูลครัวเรือน</div>
        <div class="member-grid-summary">
          ${OPT.memberGridRows.map(row => {
            const val = +(hh.memberGrid[row.key] || 0);
            const [gender, status] = row.label.split(' — ');
            return `<div class="mg-cell">
              <span style="font-size:20px;line-height:1;">${row.icon}</span>
              <span class="mg-cell-label">${status}</span>
              <span class="mg-cell-val ${val === 0 ? 'zero' : ''}">${val}</span>
            </div>`;
          }).join('')}
        </div>
        <div style="margin-top:12px;display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--gray-500);">
          <span>👥 รวม ${totalM} คน · รวบรวมข้อมูลได้ ${surveyableCnt} คน</span>
          ${hh.householdIncome ? `<span>💰 ${hh.householdIncome}</span>` : ''}
          ${hh.hasVehicle      ? `<span>🚗 ยานพาหนะ: ${hh.hasVehicle}</span>` : ''}
        </div>
        ${vehicleSummary ? `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">${vehicleSummary}</div>` : ''}
      </div>` : ''}

      <div class="sec-header">
        <div>
          <div class="sec-title">สมาชิก (ส่วนที่ 2 & 3)</div>
          <div class="sec-sub">กดที่สมาชิกเพื่อกรอกข้อมูล</div>
        </div>
        <button class="btn btn-primary" onclick="App.addMember()">+ เพิ่มสมาชิก</button>
      </div>
      ${hh.members.length > 0 ? `
      <div style="background:#f0fdf4;border:1.5px solid #16a34a;border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div style="font-size:13px;color:#15803d;font-weight:600;">✅ บันทึกสมาชิก ${hh.members.length} คนแล้ว</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-primary btn-sm" onclick="App.addMember()" style="background:#16a34a;border-color:#16a34a;white-space:nowrap;">+ เพิ่มสมาชิกคนต่อไป</button>
          <button class="btn btn-primary btn-sm" onclick="App.nextHousehold()" style="white-space:nowrap;">➡️ บ้านถัดไป</button>
        </div>
      </div>` : ''}

      ${hh.members.length === 0 ? `
        <div class="empty">
          <span class="empty-icon">👤</span>
          <h3>ยังไม่มีสมาชิก</h3>
          <p>เพิ่มสมาชิกแต่ละคนเพื่อบันทึกข้อมูลส่วนที่ 2 และ 3</p>
          <button class="btn btn-primary" onclick="App.addMember()">+ เพิ่มสมาชิก</button>
        </div>` :
        `<div class="member-list">${hh.members.map(m => {
          const avCls  = m.gender === 'ชาย' ? 'av-m' : m.gender === 'หญิง' ? 'av-f' : 'av-o';
          const avIcon = m.gender === 'ชาย' ? '👨'   : m.gender === 'หญิง' ? '👩'   : '👤';
          const hasInfo = m.gender && m.occupation;
          const dotCls  = hasInfo && m.trips.length > 0 ? 'dot-green' : (hasInfo || m.trips.length > 0) ? 'dot-amber' : 'dot-gray';
          return `<div class="member-card" onclick="App.navigate('member','${hh.id}','${m.id}')">
            <div class="member-avatar ${avCls}">${avIcon}</div>
            <div class="member-info">
              <div class="member-name">สมาชิกที่ ${m.seq}${m.gender ? ' · ' + m.gender : ''}${m.age ? ' · ' + m.age + ' ปี' : ''}</div>
              <div class="member-detail">${[m.homeStatus, m.occupation].filter(Boolean).join(' · ') || 'ยังไม่กรอกข้อมูล'}</div>
            </div>
            <div class="member-right">
              <span class="tag ${m.trips.length > 0 ? 'tag-green' : 'tag-gray'}">🚗 ${m.trips.length} เที่ยว</span>
              <div class="status-dot ${dotCls}"></div>
              <span style="color:var(--gray-300)">›</span>
            </div>
          </div>`;
        }).join('')}</div>`}
    </div>`;
  },

  // ===================== PAGE: MAP DASHBOARD =====================
  pageMap() {
    return `<div class="map-page">
      <div class="map-layout">
        <div class="map-main">
          <div id="surveyMapContainer"></div>
        </div>
        <div class="map-panel" id="mapStatsPanel">
          <div class="map-panel-header">
            <div class="sec-title">Survey collections</div>
            <div class="sec-sub" id="mapTotalCount">กำลังโหลด...</div>
          </div>
          <div class="zone-list" id="zoneList">
            <div class="zone-empty">กำลังโหลด...</div>
          </div>
        </div>
      </div>
    </div>`;
  },

  // ===================== PAGE: MEMBER =====================
  pageMember() {
    const hh = DB.getHousehold(this.hhId);
    const m  = DB.getMember(this.hhId, this.memberId);
    if (!m) return '<div class="container"><p>ไม่พบข้อมูล</p></div>';
    const avCls  = m.gender === 'ชาย' ? 'av-m' : m.gender === 'หญิง' ? 'av-f' : 'av-o';
    const avIcon = m.gender === 'ชาย' ? '👨'   : m.gender === 'หญิง' ? '👩'   : '👤';
    return `<div class="page container">
      <div class="hh-detail-header" style="margin-bottom:20px;">
        <div class="member-avatar ${avCls}" style="width:50px;height:50px;font-size:22px;border-radius:50%;flex-shrink:0;">${avIcon}</div>
        <div class="hh-detail-info">
          <div class="hh-detail-id">สมาชิกที่ ${m.seq} — ${hh ? hh.areaCode || hh.id : ''}</div>
          <div class="hh-detail-addr">${[m.gender, m.age ? 'อายุ ' + m.age + ' ปี' : '', m.homeStatus, m.occupation].filter(Boolean).join(' · ') || 'ยังไม่กรอกข้อมูล'}</div>
        </div>
        <button class="btn btn-danger btn-sm" onclick="App.confirmDeleteMember('${m.id}')">ลบ</button>
      </div>

      <div class="tabs">
        <button class="tab-btn ${this.memberTab === 'info'  ? 'active' : ''}" onclick="App.switchTab('info')">👤 ส่วนที่ 2 — ข้อมูลบุคคล</button>
        <button class="tab-btn ${this.memberTab === 'trips' ? 'active' : ''}" onclick="App.switchTab('trips')">
          🚗 ส่วนที่ 3 — การเดินทาง
          ${m.trips.length > 0 ? `<span style="background:var(--primary);color:#fff;font-size:11px;padding:1px 7px;border-radius:999px;margin-left:4px;">${m.trips.length}</span>` : ''}
        </button>
      </div>
      ${this.memberTab === 'info' ? this.tabPersonalInfo(m) : this.tabTrips(m, hh)}
    </div>`;
  },

  switchTab(tab) { this.memberTab = tab; this.render(); },

  // ===================== TAB: PERSONAL INFO =====================
  tabPersonalInfo(m) {
    const sel = (list, val, id) =>
      `<select id="${id}" class="form-select" autocomplete="off">
        <option value="">— เลือก —</option>
        ${list.map(o => `<option value="${o}" ${o === val ? 'selected' : ''}>${o}</option>`).join('')}
      </select>`;

    return `<div class="card-box">
      <div class="card-box-title">👤 ข้อมูลบุคคล (ส่วนที่ 2)</div>

      <div class="form-grid">
        <div class="form-row">
          <label class="form-label req">เพศ</label>
          <div class="radio-group">
            ${['ชาย','หญิง'].map(g => `
              <div class="radio-opt ${m.gender === g ? 'sel' : ''}" onclick="App.selectGender('${g}',this)">
                <div class="radio-dot"></div>${g}
              </div>`).join('')}
          </div>
          <input type="hidden" id="f_gender" value="${m.gender}" />
        </div>
        <div class="form-row">
          <label class="form-label">อายุ (ปี)</label>
          <input id="f_age" class="form-input" type="number" min="0" max="120" inputmode="numeric" autocomplete="off" value="${m.age || ''}" />
        </div>
      </div>

      <div class="form-grid">
        <div class="form-row">
          <label class="form-label">สถานะในบ้าน</label>
          ${sel(OPT.homeStatus, m.homeStatus, 'f_homeStatus')}
        </div>
        <div class="form-row">
          <label class="form-label req">สถานะการทำงาน / เรียน</label>
          ${sel(OPT.workStatus, m.workStatus, 'f_workStatus')}
        </div>
      </div>

      <div class="form-grid">
        <div class="form-row">
          <label class="form-label">อาชีพ</label>
          ${sel(OPT.occupation, m.occupation, 'f_occupation')}
        </div>
        <div class="form-row">
          <label class="form-label">ระดับการศึกษา</label>
          ${sel(OPT.education, m.education, 'f_education')}
        </div>
      </div>

      <div class="form-row">
        <label class="form-label req">รายได้บุคคล (บาท/เดือน)</label>
        <div style="display:flex;align-items:center;gap:10px;">
          <input id="f_income" class="form-input" type="number" min="0" inputmode="numeric"
            autocomplete="off" placeholder="เช่น 15000" style="flex:1;"
            value="${m.income === 'ไม่ระบุ' ? '' : (m.income || '')}"
            ${m.income === 'ไม่ระบุ' ? 'disabled' : ''} />
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;white-space:nowrap;cursor:pointer;flex-shrink:0;">
            <input type="checkbox" id="f_income_ns" style="accent-color:var(--primary);width:16px;height:16px;"
              ${m.income === 'ไม่ระบุ' ? 'checked' : ''}
              onchange="const inp=document.getElementById('f_income');inp.disabled=this.checked;if(this.checked)inp.value='';" />
            ไม่ระบุ
          </label>
        </div>
      </div>

      <hr class="divider" />
      <div class="section-label">ชื่อ / ที่อยู่สถานที่ทำงาน หรือ สถานศึกษา</div>

      <div class="form-row">
        <label class="form-label">ชื่อสถานที่ทำงาน / สถานศึกษา</label>
        <input id="f_wpName" class="form-input" autocomplete="off" value="${m.workplaceName || ''}" placeholder="เช่น โรงเรียนนางรอง, บริษัท ABC" />
      </div>
      <div class="form-grid">
        <div class="form-row">
          <label class="form-label">ตรอก / ซอย</label>
          <input id="f_wpAlley" class="form-input" autocomplete="off" value="${m.workplaceAlley || ''}" />
        </div>
        <div class="form-row">
          <label class="form-label">ถนน</label>
          <input id="f_wpRoad" class="form-input" autocomplete="off" value="${m.workplaceRoad || ''}" />
        </div>
      </div>
      <div class="form-grid">
        <div class="form-row">
          <label class="form-label">ตำบล</label>
          <input id="f_wpSub" class="form-input" autocomplete="off" value="${m.workplaceSubdistrict || ''}" />
        </div>
        <div class="form-row">
          <label class="form-label">อำเภอ</label>
          <input id="f_wpDist" class="form-input" autocomplete="off" value="${m.workplaceDistrict || ''}" />
        </div>
        <div class="form-row">
          <label class="form-label">จังหวัด</label>
          <input id="f_wpProv" class="form-input" autocomplete="off" value="${m.workplaceProvince || ''}" placeholder="ขอนแก่น" />
        </div>
      </div>

      <hr class="divider" />
      <div style="display:flex;justify-content:flex-end;">
        <button class="btn btn-primary" onclick="App.savePersonalInfo()">บันทึก → ไปส่วนที่ 3</button>
      </div>
    </div>`;
  },

  selectGender(val, el) {
    document.querySelectorAll('#f_genderGroup .radio-opt, .card-box .radio-opt').forEach(o => o.classList.remove('sel'));
    el.classList.add('sel');
    const h = document.getElementById('f_gender');
    if (h) h.value = val;
  },

  savePersonalInfo() {
    const gender    = document.getElementById('f_gender')?.value    || '';
    const workStatus= document.getElementById('f_workStatus')?.value|| '';
    const notSpec   = document.getElementById('f_income_ns')?.checked;
    const incomeRaw = document.getElementById('f_income')?.value    || '';
    const income    = notSpec ? 'ไม่ระบุ' : incomeRaw;

    // --- validate required ---
    if (!gender) { this.toast('กรุณาเลือกเพศ', 'error'); return; }

    // --- gender quota check ---
    const hh   = DB.getHousehold(this.hhId);
    const grid = hh?.memberGrid || {};
    const otherMembers = (hh?.members || []).filter(m => m.id !== this.memberId);
    const maleKeys   = ['m_study','m_work','m_notw','m_child'];
    const femaleKeys = ['f_study','f_work','f_notw','f_child'];
    const maleCap    = maleKeys.reduce((s, k)   => s + (+(grid[k]||0)), 0);
    const femaleCap  = femaleKeys.reduce((s, k) => s + (+(grid[k]||0)), 0);
    const maleUsed   = otherMembers.filter(m => m.gender === 'ชาย').length;
    const femaleUsed = otherMembers.filter(m => m.gender === 'หญิง').length;
    if (gender === 'ชาย'  && maleUsed   >= maleCap)   { this.toast(`ครัวเรือนนี้มีเพศชายครบ ${maleCap} คนแล้ว`,   'error'); return; }
    if (gender === 'หญิง' && femaleUsed >= femaleCap) { this.toast(`ครัวเรือนนี้มีเพศหญิงครบ ${femaleCap} คนแล้ว`, 'error'); return; }

    if (!workStatus) { this.toast('กรุณาเลือกสถานะการทำงาน', 'error'); return; }
    if (!notSpec && !incomeRaw) { this.toast('กรุณากรอกรายได้ หรือเลือก "ไม่ระบุ"', 'error'); return; }

    DB.updateMember(this.hhId, this.memberId, {
      gender,
      age:                  +(document.getElementById('f_age')?.value) || '',
      homeStatus:           document.getElementById('f_homeStatus')?.value || '',
      workStatus,
      occupation:           document.getElementById('f_occupation')?.value || '',
      education:            document.getElementById('f_education')?.value || '',
      income,
      workplaceName:        document.getElementById('f_wpName')?.value.trim()  || '',
      workplaceAlley:       document.getElementById('f_wpAlley')?.value.trim() || '',
      workplaceRoad:        document.getElementById('f_wpRoad')?.value.trim()  || '',
      workplaceSubdistrict: document.getElementById('f_wpSub')?.value.trim()   || '',
      workplaceDistrict:    document.getElementById('f_wpDist')?.value.trim()  || '',
      workplaceProvince:    document.getElementById('f_wpProv')?.value.trim()  || ''
    });

    // --- auto-update household income if sum > current ---
    const updatedHH  = DB.getHousehold(this.hhId);
    const memberSum  = (updatedHH?.members || []).reduce((s, m) => {
      const n = +m.income;
      return (!m.income || m.income === 'ไม่ระบุ' || isNaN(n)) ? s : s + n;
    }, 0);
    if (memberSum > 0 && memberSum > (+(updatedHH?.householdIncome) || 0)) {
      DB.updateHousehold(this.hhId, { householdIncome: memberSum });
      this.toast(`บันทึกแล้ว — อัพเดทรายได้ครัวเรือนเป็น ${memberSum.toLocaleString()} บาท`, 'success');
    } else {
      this.toast('บันทึกข้อมูลบุคคลแล้ว', 'success');
    }
    // ไปหน้าการเดินทางต่อเลย
    this.memberTab = 'trips';
    this.render();
  },

  // ===================== TAB: TRIPS =====================
  tabTrips(m, hh) {
    const travelLabel = hh?.travelDate ? `วันที่ ${hh.travelDate}` : 'วันที่เดินทาง';
    return `<div>
      <div class="sec-header">
        <div>
          <div class="sec-title">การเดินทาง ${travelLabel} (ส่วนที่ 3)</div>
          <div class="sec-sub">ต้องมีอย่างน้อย 2 ครั้ง · ครั้งสุดท้ายต้องเป็น "กลับบ้าน"</div>
        </div>
        <button class="btn btn-primary" onclick="App.openTripForm(null)">+ เพิ่มการเดินทาง</button>
      </div>

      ${m.trips.length === 0 ? `
        <div class="empty">
          <span class="empty-icon">🗺️</span>
          <h3>ยังไม่มีข้อมูลการเดินทาง</h3>
          <p>บันทึกการเดินทางทุกครั้งของเมื่อวาน</p>
          <button class="btn btn-primary" onclick="App.openTripForm(null)">+ เพิ่มการเดินทาง</button>
        </div>` :
        `<div class="trip-list">
          ${m.trips.map(t => {
            const segs = (t.segments || []).filter(s => s.mode);
            return `<div class="trip-card">
              <div class="trip-seq">${t.seq}</div>
              <div class="trip-body">
                <div class="trip-route">
                  <span>${t.origin || '?'}</span>
                  <span class="trip-arrow">→</span>
                  <span>${t.destination || '?'}</span>
                </div>
                <div class="trip-meta">
                  ${t.purpose      ? `<span>🎯 ${t.purpose}</span>` : ''}
                  ${t.departureTime? `<span>🕐 ${t.departureTime}${t.arrivalTime ? '–' + t.arrivalTime : ''}</span>` : ''}
                </div>
                ${segs.length > 0 ? `<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">
                  ${segs.map((s, i) => `<span class="tag tag-blue">ช่วง${i+1}: ${s.mode}${s.duration ? ' ' + s.duration + 'นาที' : ''}${s.fare ? ' ฿' + s.fare : ''}</span>`).join('')}
                </div>` : ''}
                ${(t.originCoords || t.destinationCoords) ? `<div style="font-size:11px;color:var(--gray-400);margin-top:3px;">
                  ${t.originCoords ? '📍 ' + t.originCoords : ''}${t.originCoords && t.destinationCoords ? ' → ' : ''}${t.destinationCoords ? '📍 ' + t.destinationCoords : ''}
                </div>` : ''}
                ${t.parkingLocation || t.parkingFee ? `<div style="font-size:12px;color:var(--gray-400);margin-top:4px;">🅿 ${[t.parkingLocation, t.parkingFee ? t.parkingFee + ' บาท' : ''].filter(Boolean).join(' · ')}</div>` : ''}
              </div>
              <div class="trip-actions">
                <button class="icon-btn" onclick="App.openTripForm('${t.id}')" title="แก้ไข">✏️</button>
                <button class="icon-btn del" onclick="App.deleteTrip('${t.id}')" title="ลบ">🗑</button>
              </div>
            </div>`;
          }).join('')}
        </div>
        <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-outline" style="flex:1;" onclick="App.openTripForm(null)">+ เพิ่มการเดินทางอีก</button>
          <button class="btn btn-primary" onclick="App.completeMember()">เสร็จสิ้น ✓</button>
        </div>`}
    </div>`;
  },

  // ===================== MODAL: HOUSEHOLD =====================
  _lastFriday() {
    const d = new Date();
    const daysBack = (d.getDay() - 5 + 7) % 7; // วันศุกร์=5; ถ้าวันนี้คือศุกร์ daysBack=0
    d.setDate(d.getDate() - daysBack);
    return d.toISOString().split('T')[0];
  },

  // ===== SURVEYOR NAME MEMORY =====
  _loadSurveyorNames() {
    return {
      surveyor:   localStorage.getItem('_surveyor_name')   || '',
      supervisor: localStorage.getItem('_supervisor_name') || ''
    };
  },
  _saveSurveyorNames(surveyor, supervisor) {
    if (surveyor)   localStorage.setItem('_surveyor_name',   surveyor);
    if (supervisor) localStorage.setItem('_supervisor_name', supervisor);
  },

  // ===== SHARED: HOUSEHOLD FORM HTML =====
  _hhFormHTML(hh) {
    // hh = null for add, existing object for edit
    const names      = this._loadSurveyorNames();
    // ถ้า role = surveyor ใช้ชื่อ login เป็น default ผู้สำรวจ
    const defaultSurveyor = this._role === 'surveyor' ? this._surveyorName : names.surveyor;
    const resOpts    = OPT.residentialType.map(r =>
      `<option value="${r}" ${r === hh?.residentialType ? 'selected' : ''}>${r}</option>`).join('');
    const gridCards  = OPT.memberGridRows.map(row => {
      const [gender, status] = row.label.split(' — ');
      const cur = hh?.memberGrid?.[row.key] || 0;
      return `<div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:var(--radius-sm);padding:10px 12px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="font-size:24px;line-height:1;">${row.icon}</span>
          <div>
            <div style="font-size:10px;font-weight:700;color:var(--gray-400);text-transform:uppercase;letter-spacing:.04em;">${gender}</div>
            <div style="font-size:12px;font-weight:600;color:var(--gray-700);">${status}</div>
          </div>
        </div>
        <select id="mg_${row.key}" class="form-select" autocomplete="off">
          ${[0,1,2,3,4,5].map(n => `<option value="${n}" ${n === +cur ? 'selected' : ''}>${n === 0 ? '' : n + ' คน'}</option>`).join('')}
        </select>
      </div>`;
    }).join('');
    const vhRows = OPT.vehicleTypes.map(vt => {
      const v    = hh?.vehicles?.[vt.key];
      const show = v && ((+v.private||0)+(+v.company||0)+(+v.gov||0)) > 0;
      return `<tr id="vrow_${vt.key}" style="${show ? '' : 'display:none'}">
        <td style="font-size:13px;padding:5px 8px;color:var(--gray-700);">${vt.icon} ${vt.label}</td>
        <td style="padding:4px"><input type="number" min="0" inputmode="numeric" value="${v?.private||0}" class="form-input" id="vp_${vt.key}" autocomplete="off" style="width:60px;padding:4px 6px;text-align:center;" /></td>
        <td style="padding:4px"><input type="number" min="0" inputmode="numeric" value="${v?.company||0}" class="form-input" id="vc_${vt.key}" autocomplete="off" style="width:60px;padding:4px 6px;text-align:center;" /></td>
        <td style="padding:4px"><input type="number" min="0" inputmode="numeric" value="${v?.gov||0}"     class="form-input" id="vg_${vt.key}" autocomplete="off" style="width:60px;padding:4px 6px;text-align:center;" /></td>
      </tr>`;
    }).join('');

    return `
      <div class="section-label">ข้อมูลผู้สำรวจ</div>
      <div class="form-grid">
        <div class="form-row">
          <label class="form-label req">ชื่อ–สกุลผู้สำรวจ</label>
          <input id="m_sname" class="form-input" autocomplete="off" placeholder="ชื่อ นามสกุล"
            value="${hh ? (hh.surveyorName||'') : defaultSurveyor}" />
        </div>
        <div class="form-row">
          <label class="form-label req">ชื่อผู้ควบคุม</label>
          <input id="m_supervisor" class="form-input" autocomplete="off" placeholder="ชื่อผู้ควบคุม"
            value="${hh ? (hh.supervisorName||'') : names.supervisor}" />
        </div>
        <div class="form-row">
          <label class="form-label req">วันที่เดินทาง</label>
          <input id="m_travelDate" class="form-input" type="date" autocomplete="off"
            value="${hh ? (hh.travelDate||this._lastFriday()) : this._lastFriday()}" />
        </div>
      </div>

      <div class="section-label">ที่อยู่</div>
      <div class="form-row">
        <label class="form-label req">พิกัด GPS</label>
        <div style="display:flex;gap:6px;">
          <input id="m_coords" class="form-input" autocomplete="off" placeholder="เช่น 16.0590, 102.7313"
            style="flex:1;min-width:0;" value="${hh?.coordinates||''}" />
          <button type="button" id="gpsBtn_m_coords" onclick="App._useGPS('m_coords')"
            style="padding:9px 12px;background:#f0fdf4;color:#16a34a;border:1.5px solid #16a34a;
                   border-radius:var(--radius-sm);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0;">📍 GPS</button>
        </div>
      </div>
      <div class="form-grid">
        <div class="form-row">
          <label class="form-label req">บ้านเลขที่</label>
          <input id="m_houseNo" class="form-input" autocomplete="off" placeholder="เช่น 123/4" value="${hh?.houseNo||''}" />
        </div>
        <div class="form-row">
          <label class="form-label">หมู่ที่</label>
          <input id="m_moo" class="form-input" type="number" min="1" inputmode="numeric" autocomplete="off" placeholder="เช่น 5" value="${hh?.moo||''}" />
        </div>
      </div>
      <div class="form-grid">
        <div class="form-row">
          <label class="form-label">ตรอก / ซอย</label>
          <input id="m_alley" class="form-input" autocomplete="off" value="${hh?.alley||''}" />
        </div>
        <div class="form-row">
          <label class="form-label">ถนน</label>
          <input id="m_road" class="form-input" autocomplete="off" value="${hh?.road||''}" />
        </div>
      </div>
      <div class="form-grid">
        <div class="form-row">
          <label class="form-label req">ตำบล</label>
          <input id="m_subdistrict" class="form-input" autocomplete="off" placeholder="กด GPS เพื่อดึงอัตโนมัติ" value="${hh?.subdistrict||''}" />
        </div>
        <div class="form-row">
          <label class="form-label req">อำเภอ</label>
          <input id="m_district" class="form-input" autocomplete="off" placeholder="กด GPS เพื่อดึงอัตโนมัติ" value="${hh?.district||''}" />
        </div>
        <div class="form-row">
          <label class="form-label">จังหวัด</label>
          <input id="m_province" class="form-input" autocomplete="off" placeholder="กด GPS เพื่อดึงอัตโนมัติ" value="${hh?.province||''}" />
        </div>
      </div>
      <div class="form-row">
        <label class="form-label">โทรศัพท์</label>
        <input id="m_phone" class="form-input" type="tel" inputmode="numeric"
          maxlength="12" placeholder="08x-xxx-xxxx" autocomplete="off"
          oninput="App._formatPhone(this)"
          value="${App._displayPhone(hh?.phone||'')}" />
      </div>

      <div class="section-label">ประเภทที่อยู่อาศัย</div>
      <div class="form-row">
        <select id="m_restype" class="form-select" autocomplete="off">
          <option value="">— เลือกประเภท —</option>${resOpts}
        </select>
      </div>

      <div class="section-label">จำนวนผู้อยู่อาศัยในครัวเรือน</div>
      <div class="mg-input-grid">${gridCards}</div>

      <div class="section-label">รายได้และยานพาหนะ</div>
      <div class="form-row">
        <label class="form-label req">รายได้ทั้งหมดของครัวเรือน (บาท/เดือน)</label>
        <input id="m_income" class="form-input" type="number" min="0" inputmode="numeric"
          autocomplete="off" placeholder="เช่น 25000" value="${hh?.householdIncome||''}" />
      </div>
      <div class="form-row">
        <label class="form-label req">การครอบครองยานพาหนะ</label>
        <div class="radio-group" id="m_vehicleGrp">
          <div class="radio-opt ${hh?.hasVehicle==='ไม่มี'?'sel':''}" onclick="App._pickVehicle('ไม่มี',this)"><div class="radio-dot"></div>ไม่มียานพาหนะ</div>
          <div class="radio-opt ${hh?.hasVehicle==='มี'?'sel':''}" onclick="App._pickVehicle('มี',this)"><div class="radio-dot"></div>มียานพาหนะ</div>
        </div>
        <input type="hidden" id="m_vehicle" value="${hh?.hasVehicle||''}" />
      </div>
      <div id="vehicleDetail" style="display:${hh?.hasVehicle==='มี'?'block':'none'};margin-top:10px;overflow-x:auto;border:1px solid var(--gray-200);border-radius:var(--radius-sm);">
        <div style="padding:8px 12px;background:var(--gray-50);border-bottom:1px solid var(--gray-200);font-size:12px;font-weight:600;color:var(--gray-500);">เลือกประเภทยานพาหนะที่มี → ระบุจำนวนคัน</div>
        <div style="padding:10px 12px;display:flex;gap:10px;flex-wrap:wrap;border-bottom:1px solid var(--gray-100);">
          ${OPT.vehicleTypes.map(vt => {
            const v = hh?.vehicles?.[vt.key];
            const checked = v && ((+v.private||0)+(+v.company||0)+(+v.gov||0)) > 0;
            return `<label style="display:flex;align-items:center;gap:5px;font-size:13px;cursor:pointer;white-space:nowrap;">
              <input type="checkbox" ${checked?'checked':''} style="accent-color:var(--primary);" onchange="App._toggleVehicleRow('${vt.key}',this.checked)" />
              ${vt.icon} ${vt.label}</label>`;
          }).join('')}
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:var(--gray-50);">
            <th style="padding:6px 8px;font-size:12px;color:var(--gray-500);text-align:left;font-weight:600;">ประเภท</th>
            <th style="padding:6px 8px;font-size:12px;color:var(--gray-500);text-align:center;font-weight:600;">ส่วนตัว</th>
            <th style="padding:6px 8px;font-size:12px;color:var(--gray-500);text-align:center;font-weight:600;">บริษัท</th>
            <th style="padding:6px 8px;font-size:12px;color:var(--gray-500);text-align:center;font-weight:600;">ราชการ/รัฐ</th>
          </tr></thead>
          <tbody>${vhRows}</tbody>
        </table>
      </div>`;
  },

  // ===== SHARED: HOUSEHOLD SAVE DATA =====
  _readHhForm() {
    const memberGrid = {};
    OPT.memberGridRows.forEach(row => {
      memberGrid[row.key] = +(document.getElementById('mg_' + row.key)?.value || 0);
    });
    const vehicle = document.getElementById('m_vehicle')?.value;
    const vehicles = {};
    if (vehicle === 'มี') {
      OPT.vehicleTypes.forEach(vt => {
        const p = +(document.getElementById('vp_' + vt.key)?.value || 0);
        const c = +(document.getElementById('vc_' + vt.key)?.value || 0);
        const g = +(document.getElementById('vg_' + vt.key)?.value || 0);
        if (p || c || g) vehicles[vt.key] = { private: p, company: c, gov: g };
      });
    }
    return {
      surveyorName:    document.getElementById('m_sname')?.value.trim()       || '',
      supervisorName:  document.getElementById('m_supervisor')?.value.trim()  || '',
      travelDate:      document.getElementById('m_travelDate')?.value         || '',
      coordinates:     document.getElementById('m_coords')?.value.trim()      || '',
      houseNo:         document.getElementById('m_houseNo')?.value.trim()     || '',
      moo:             document.getElementById('m_moo')?.value.trim()         || '',
      alley:           document.getElementById('m_alley')?.value.trim()       || '',
      road:            document.getElementById('m_road')?.value.trim()        || '',
      subdistrict:     document.getElementById('m_subdistrict')?.value.trim() || '',
      district:        document.getElementById('m_district')?.value.trim()    || '',
      province:        document.getElementById('m_province')?.value.trim()    || '',
      phone:           (document.getElementById('m_phone')?.value || '').replace(/-/g,'').trim(),
      residentialType: document.getElementById('m_restype')?.value            || '',
      memberGrid,
      householdIncome: +(document.getElementById('m_income')?.value)          || 0,
      hasVehicle:      vehicle                                                 || '',
      vehicles
    };
  },

  // ===== SHARED: HOUSEHOLD VALIDATION =====
  _validateHhForm(data) {
    const errs = [];
    if (!data.surveyorName)    errs.push('ชื่อผู้สำรวจ');
    if (!data.supervisorName)  errs.push('ชื่อผู้ควบคุม');
    if (!data.travelDate)      errs.push('วันที่เดินทาง');
    if (!data.coordinates)     errs.push('พิกัด GPS');
    if (!data.houseNo)         errs.push('บ้านเลขที่');
    if (!data.subdistrict)     errs.push('ตำบล');
    if (!data.district)        errs.push('อำเภอ');
    if (!data.residentialType) errs.push('ประเภทที่อยู่อาศัย');
    const gridTotal = Object.values(data.memberGrid).reduce((s, v) => s + (+v||0), 0);
    if (gridTotal === 0)       errs.push('จำนวนสมาชิก (ต้องมีอย่างน้อย 1 คน)');
    if (!data.householdIncome) errs.push('รายได้ครัวเรือน');
    if (!data.hasVehicle)      errs.push('การครอบครองยานพาหนะ');
    return errs;
  },

  openAddHousehold() {
    this.showModal('🏠 เพิ่มครัวเรือนใหม่', this._hhFormHTML(null),
      `<button class="btn btn-ghost" onclick="App.closeModal()">ยกเลิก</button>
       <button class="btn btn-primary" onclick="App.saveHousehold()">บันทึก</button>`
    );
    setTimeout(() => document.getElementById('m_sname')?.focus(), 50);
  },

  _pickVehicle(val, el) {
    document.querySelectorAll('#m_vehicleGrp .radio-opt').forEach(o => o.classList.remove('sel'));
    el.classList.add('sel');
    document.getElementById('m_vehicle').value = val;
    document.getElementById('vehicleDetail').style.display = val === 'มี' ? 'block' : 'none';
  },

  _toggleVehicleRow(key, show) {
    const row = document.getElementById('vrow_' + key);
    if (row) row.style.display = show ? '' : 'none';
  },

  saveHousehold() {
    const data = this._readHhForm();
    const errs = this._validateHhForm(data);
    if (errs.length) { this.toast('กรุณากรอก: ' + errs.join(', '), 'error'); return; }
    this._saveSurveyorNames(data.surveyorName, data.supervisorName);
    const hh = DB.addHousehold({
      ...data,
      surveyDate: new Date().toISOString().split('T')[0],
      deviceId:   (typeof FB !== 'undefined' ? FB.deviceId() : null) || localStorage.getItem('_device_id') || '',
      clientIp:   this._clientIp || ''
    });
    this.closeModal();
    this.toast('เพิ่มครัวเรือนแล้ว', 'success');
    this.navigate('household', hh.id);
  },

  openEditHousehold(id) {
    const hh = DB.getHousehold(id);
    if (!hh) return;
    this.showModal('✏️ แก้ไขข้อมูลบ้าน', this._hhFormHTML(hh),
      `<button class="btn btn-ghost" onclick="App.closeModal()">ยกเลิก</button>
       <button class="btn btn-primary" onclick="App.saveEditHousehold('${id}')">บันทึก</button>`
    );
  },

  saveEditHousehold(id) {
    const data = this._readHhForm();
    const errs = this._validateHhForm(data);
    if (errs.length) { this.toast('กรุณากรอก: ' + errs.join(', '), 'error'); return; }
    this._saveSurveyorNames(data.surveyorName, data.supervisorName);
    DB.updateHousehold(id, data);
    this.closeModal();
    this.toast('บันทึกข้อมูลบ้านแล้ว', 'success');
    this.render();
  },

  confirmDeleteHousehold(id) {
    const hh = DB.getHousehold(id);
    this.showModal('⚠️ ลบครัวเรือน',
      `<p style="color:var(--gray-600)">ต้องการลบครัวเรือน <strong>[${hh?.areaCode || hh?.id}]</strong>
       พร้อมสมาชิก ${hh?.members.length || 0} คน ใช่หรือไม่?<br><br>ไม่สามารถย้อนกลับได้</p>`,
      `<button class="btn btn-ghost" onclick="App.closeModal()">ยกเลิก</button>
       <button class="btn btn-danger" onclick="App.deleteHousehold('${id}')">ลบ</button>`
    );
  },

  deleteHousehold(id) {
    DB.deleteHousehold(id);
    this.closeModal();
    this.toast('ลบครัวเรือนแล้ว', 'danger');
    this.navigate('home');
  },

  // ===================== MEMBER: ไปหน้าสมาชิกเลย ไม่มี modal =====================
  completeMember() {
    const m = DB.getMember(this.hhId, this.memberId);
    if (!m) return this.navigate('household', this.hhId);
    if (m.trips.length < 2) {
      this.toast('ต้องมีการเดินทางอย่างน้อย 2 ครั้ง', 'error'); return;
    }
    const lastTrip = m.trips[m.trips.length - 1];
    if (lastTrip.purpose !== 'กลับบ้าน') {
      this.toast('การเดินทางครั้งสุดท้ายต้องเป็น "กลับบ้าน"', 'error'); return;
    }
    this.toast(`บันทึกสมาชิกที่ ${m.seq} เสร็จสิ้น`, 'success');
    this.navigate('household', this.hhId);
  },

  nextHousehold() {
    this.navigate('home');
    setTimeout(() => this.openAddHousehold(), 150);
  },

  addMember() {
    const m = DB.addMember(this.hhId, {});
    if (!m) return;
    this.memberTab = 'info';
    this.navigate('member', this.hhId, m.id);
  },

  confirmDeleteMember(mid) {
    const m = DB.getMember(this.hhId, mid);
    this.showModal('⚠️ ลบสมาชิก',
      `<p style="color:var(--gray-600)">ต้องการลบสมาชิกที่ ${m?.seq} พร้อมการเดินทาง ${m?.trips.length || 0} เที่ยว ใช่หรือไม่?</p>`,
      `<button class="btn btn-ghost" onclick="App.closeModal()">ยกเลิก</button>
       <button class="btn btn-danger" onclick="App.deleteMember('${mid}')">ลบ</button>`
    );
  },

  deleteMember(mid) {
    DB.deleteMember(this.hhId, mid);
    this.closeModal();
    this.toast('ลบสมาชิกแล้ว', 'danger');
    this.navigate('household', this.hhId);
  },

  // ===================== MODAL: TRIP =====================
  openTripForm(tripId) {
    this.editingTripId = tripId;
    const hh = DB.getHousehold(this.hhId);
    const m  = DB.getMember(this.hhId, this.memberId);
    const t  = tripId ? m?.trips.find(x => x.id === tripId) : null;
    const isEdit = !!t;
    const segs   = t?.segments?.length ? t.segments : [{ mode:'', duration:'', fare:'' }];

    // ——— Trip-chain logic: auto-fill origin ———
    const homeAddr = [
      hh?.houseNo ? 'บ้านเลขที่ ' + hh.houseNo : '',
      hh?.road    ? 'ถ.' + hh.road              : ''
    ].filter(Boolean).join(' ') || 'ที่พักอาศัย';

    let defOrigin       = t?.origin            || '';
    let defOriginCoords = t?.originCoords      || '';
    let defOriginType   = t?.originType        || '';

    if (!isEdit) {
      if (!m || m.trips.length === 0) {
        // การเดินทางแรก: ต้นทาง = บ้าน
        defOrigin       = homeAddr;
        defOriginCoords = hh?.coordinates || '';
        defOriginType   = 'ที่พักอาศัย / บ้าน';
      } else {
        // การเดินทางถัดไป: ต้นทาง = ปลายทางของครั้งก่อน
        const last      = m.trips[m.trips.length - 1];
        defOrigin       = last.destination       || '';
        defOriginCoords = last.destinationCoords || '';
        defOriginType   = last.destinationType   || '';
      }
    }

    // default departure = เวลาถึงปลายทางครั้งที่แล้ว
    let defDepart = t?.departureTime || '';
    let prevArrival = '';
    if (!isEdit && m && m.trips.length > 0) {
      prevArrival = m.trips[m.trips.length - 1].arrivalTime || '';
      defDepart   = prevArrival;
    }

    // กรอง tripMode ตามยานพาหนะที่ครัวเรือนมี
    const ownedVehicles = new Set(
      hh?.hasVehicle === 'มี' ? Object.keys(hh.vehicles || {}) : []
    );
    const availModes = OPT.tripMode.filter(mode => {
      const req = OPT.modeRequiresVehicle[mode];
      if (!req) return true; // ไม่ต้องมีรถส่วนตัว → แสดงเสมอ
      return req.some(v => ownedVehicles.has(v));
    });

    const selOpt = (list, val) => list.map(o =>
      `<option value="${o}" ${o === val ? 'selected' : ''}>${o}</option>`
    ).join('');

    const modeOptsStr = `<option value="">— เลือก —</option>` +
      availModes.map(o => `<option value="${o}">${o}</option>`).join('');

    const segHTML = (s, i) => `
      <div class="seg-row" style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <div class="seg-title" style="font-size:12px;font-weight:700;color:var(--primary);">ช่วงที่ ${i+1}</div>
          ${i > 0 ? `<button type="button" onclick="App._removeSeg(this)"
            style="background:none;border:none;cursor:pointer;color:var(--danger);font-size:20px;line-height:1;padding:0 4px;">×</button>` : ''}
        </div>
        <div class="form-grid">
          <div class="form-row">
            <label class="form-label">ประเภทยานพาหนะ</label>
            <select class="form-select seg-mode" autocomplete="off" onchange="App._calcArrival()">
              <option value="">— เลือก —</option>${selOpt(availModes, s.mode)}
            </select>
          </div>
          <div class="form-row">
            <label class="form-label">เวลาที่ใช้ (นาที)</label>
            <input class="form-input seg-dur" type="number" min="0" inputmode="numeric" autocomplete="off"
              value="${s.duration || ''}" placeholder="นาที" oninput="App._calcArrival()" />
          </div>
          <div class="form-row">
            <label class="form-label">ค่าโดยสาร (บาท)</label>
            <input class="form-input seg-fare" type="number" min="0" inputmode="numeric" autocomplete="off" value="${s.fare || ''}" placeholder="บาท" />
          </div>
        </div>
      </div>`;

    this.showModal(isEdit ? '✏️ แก้ไขการเดินทาง' : '🚗 เพิ่มการเดินทาง', `
      <!-- ต้นทาง (read-only — auto-filled จากบ้านหรือปลายทางครั้งก่อน) -->
      <div class="section-label">ต้นทาง</div>
      <div class="form-row">
        <label class="form-label">สถานที่ตั้งต้นทาง
          <span style="font-size:11px;font-weight:400;color:var(--gray-400);margin-left:6px;">🔒 กำหนดอัตโนมัติ</span>
        </label>
        <input id="t_origin" class="form-input" readonly autocomplete="off"
          value="${defOrigin}"
          style="background:var(--gray-50);color:var(--gray-600);cursor:default;" />
        <input type="hidden" id="t_originCoords" value="${defOriginCoords}" />
        ${defOriginCoords ? `<div style="font-size:11px;color:var(--gray-400);margin-top:3px;">📍 ${defOriginCoords}</div>` : ''}
      </div>
      <div class="form-grid">
        <div class="form-row">
          <label class="form-label">ลักษณะสถานที่</label>
          <select id="t_originType" class="form-select" autocomplete="off">
            <option value="">— เลือก —</option>${selOpt(OPT.locationType, defOriginType)}
          </select>
        </div>
        <div class="form-row">
          <label class="form-label req">เวลาที่เริ่มเดินทาง${prevArrival ? ` <span style="font-size:11px;color:var(--gray-400);">(ครั้งที่แล้วถึง ${prevArrival})</span>` : ''}</label>
          <input id="t_depart" class="form-input" type="time" value="${defDepart}"
            oninput="App._calcArrival()" />
        </div>
      </div>

      <!-- วัตถุประสงค์ (ย้ายมาก่อนปลายทาง) -->
      <div class="form-row" style="margin-top:4px;">
        <label class="form-label req">วัตถุประสงค์การเดินทาง</label>
        <select id="t_purpose" class="form-select" autocomplete="off"
          onchange="App._onPurposeChange(this.value)">
          <option value="">— เลือก —</option>${selOpt(OPT.purpose, t?.purpose || '')}
        </select>
      </div>

      <!-- ปลายทาง -->
      <div class="section-label">ปลายทาง</div>
      <div class="form-row">
        <label class="form-label">สถานที่ตั้งปลายทาง</label>
        <div style="display:flex;gap:8px;">
          <input id="t_destination" class="form-input" autocomplete="off"
            placeholder="เช่น ตลาด, โรงเรียน" value="${t?.destination || ''}" style="flex:1;min-width:0;" />
          <button type="button" id="gpsBtn_t_destinationCoords" onclick="App._useGPS('t_destinationCoords')"
            style="padding:9px 10px;background:#f0fdf4;color:#16a34a;border:1.5px solid #16a34a;
                   border-radius:var(--radius-sm);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0;">📍</button>
          <button type="button" onclick="App._openMap('t_destinationCoords')"
            style="padding:9px 10px;background:var(--primary-light);color:var(--primary);
                   border:1.5px solid var(--primary);border-radius:var(--radius-sm);
                   font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0;">🗺</button>
        </div>
        <input type="hidden" id="t_destinationCoords" value="${t?.destinationCoords || ''}" />
        ${t?.destinationCoords ? `<div style="font-size:11px;color:var(--gray-400);margin-top:3px;">📍 ${t.destinationCoords}</div>` : ''}
      </div>
      <div class="form-row">
        <label class="form-label">ลักษณะสถานที่ปลายทาง</label>
        <select id="t_destType" class="form-select" autocomplete="off">
          <option value="">— เลือก —</option>${selOpt(OPT.locationType, t?.destinationType || '')}
        </select>
      </div>

      <!-- ช่วงการเดินทาง -->
      <div class="section-label">ยานพาหนะ / รูปแบบการเดินทาง <span style="font-size:11px;font-weight:400;color:var(--danger);">*ต้องมีอย่างน้อย 1 ช่วง</span></div>
      <div id="segContainer">${segs.map((s, i) => segHTML(s, i)).join('')}</div>
      <button type="button" onclick="App._addSeg()"
        style="width:100%;padding:9px;border:1.5px dashed var(--gray-300);background:transparent;
               border-radius:var(--radius-sm);font-family:inherit;font-size:13px;
               color:var(--gray-500);cursor:pointer;margin-bottom:4px;">
        + เพิ่มช่วงการเดินทาง
      </button>

      <!-- จอดรถ -->
      <div class="section-label">สถานที่จอดรถ</div>
      <div class="form-grid">
        <div class="form-row">
          <label class="form-label">สถานที่จอดรถ</label>
          <input id="t_park" class="form-input" autocomplete="off"
            value="${t?.parkingLocation || ''}" placeholder="เช่น ลานจอดห้าง" />
        </div>
        <div class="form-row">
          <label class="form-label">ค่าจอดรถ (บาท)</label>
          <input id="t_parkFee" class="form-input" type="number" min="0" inputmode="numeric" autocomplete="off"
            value="${t?.parkingFee || ''}" placeholder="0" />
        </div>
      </div>

      <!-- เวลาถึงปลายทาง — ท้ายสุด -->
      <div class="form-row" style="margin-top:4px;">
        <label class="form-label">เวลาถึงปลายทาง (คำนวณอัตโนมัติ)</label>
        <div id="t_arriveDisplay"
          style="padding:10px 14px;background:var(--gray-50);border:1.5px solid var(--gray-200);
                 border-radius:var(--radius-sm);font-size:15px;color:var(--gray-700);font-weight:700;text-align:center;">
          ${t?.arrivalTime || '— กรอกเวลาออก + ระยะเวลาก่อน'}
        </div>
        <input type="hidden" id="t_arrive_hidden" value="${t?.arrivalTime || ''}" />
      </div>`,
      `<button class="btn btn-ghost" onclick="App.closeModal()">ยกเลิก</button>
       <button class="btn btn-primary" onclick="App.saveTrip()">${isEdit ? 'บันทึกการแก้ไข' : 'เพิ่มการเดินทาง'}</button>`
    );
  },

  // format/display phone helpers
  _formatPhone(el) {
    let v = el.value.replace(/\D/g, '').slice(0, 10);
    if (v.length > 6) v = v.slice(0,3) + '-' + v.slice(3,6) + '-' + v.slice(6);
    else if (v.length > 3) v = v.slice(0,3) + '-' + v.slice(3);
    el.value = v;
  },
  _displayPhone(digits) {
    if (!digits) return '';
    const v = digits.replace(/\D/g,'');
    if (v.length > 6) return v.slice(0,3) + '-' + v.slice(3,6) + '-' + v.slice(6);
    if (v.length > 3) return v.slice(0,3) + '-' + v.slice(3);
    return v;
  },

  // reverse geocode พิกัด → ตำบล/อำเภอ/จังหวัด (Longdo Maps API)
  _reverseGeocode(lat, lon) {
    const KEY = '4ffd5bcaa8a5941163c24dbe2a4401e8';
    fetch(`https://api.longdo.com/map/services/address?lon=${lon}&lat=${lat}&noescape=1&key=${KEY}`)
      .then(r => r.json())
      .then(d => {
        const sub = document.getElementById('m_subdistrict');
        const dis = document.getElementById('m_district');
        const pro = document.getElementById('m_province');
        if (sub) sub.value = d.subdistrict || sub.value;
        if (dis) dis.value = d.district    || dis.value;
        if (pro) pro.value = d.province    || pro.value;
        if (d.subdistrict || d.district)
          this.toast(`พบที่อยู่: ต.${d.subdistrict||'?'} อ.${d.district||'?'}`, 'success');
      })
      .catch(() => {});
  },

  // ใช้ GPS เครื่องอ่านพิกัดปัจจุบัน
  _useGPS(coordsId) {
    if (!navigator.geolocation) {
      this.toast('เบราว์เซอร์นี้ไม่รองรับ GPS', 'error'); return;
    }
    const btn = document.getElementById('gpsBtn_' + coordsId);
    if (btn) { btn.textContent = '⌛'; btn.disabled = true; }

    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = pos.coords.latitude.toFixed(6);
        const lon = pos.coords.longitude.toFixed(6);
        const coords = `${lat}, ${lon}`;
        const el = document.getElementById(coordsId);
        if (el) el.value = coords;
        const hintEl = document.querySelector(`[data-coordshint="${coordsId}"]`);
        if (hintEl) hintEl.textContent = '📍 ' + coords;
        if (btn) { btn.textContent = '📍'; btn.disabled = false; }
        this.toast(`รับพิกัด GPS: ${coords}`, 'success');
        // ถ้าเป็นฟอร์มครัวเรือน ดึงชื่อตำบล/อำเภอ/จังหวัดอัตโนมัติ
        if (coordsId === 'm_coords') this._reverseGeocode(lat, lon);
      },
      () => {
        if (btn) { btn.textContent = '📍 GPS'; btn.disabled = false; }
        this.toast('ไม่สามารถอ่าน GPS ได้ — กรุณาอนุญาตการเข้าถึงตำแหน่ง', 'error');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  },

  // เปิด map picker สำหรับ trip (รับ coordsInputId)
  _openMap(coordsId) {
    const coordsEl = document.getElementById(coordsId);
    MapPicker.open(coordsEl?.value || '', coords => {
      if (coordsEl) {
        coordsEl.value = coords;
        // อัพเดตแสดงพิกัดใต้ input
        const hint = coordsEl.nextElementSibling;
        if (hint && hint.style.fontSize === '11px') {
          hint.textContent = '📍 ' + coords;
        } else {
          const d = document.createElement('div');
          d.style.cssText = 'font-size:11px;color:var(--gray-400);margin-top:3px;';
          d.textContent = '📍 ' + coords;
          coordsEl.insertAdjacentElement('afterend', d);
        }
      }
    });
  },

  // ถ้าเลือก "กลับบ้าน" → auto-fill ปลายทาง = บ้าน
  _onPurposeChange(val) {
    if (val !== 'กลับบ้าน') return;
    const hh = DB.getHousehold(this.hhId);
    if (!hh) return;
    const homeAddr = [
      hh.houseNo ? 'บ้านเลขที่ ' + hh.houseNo : '',
      hh.road    ? 'ถ.' + hh.road              : ''
    ].filter(Boolean).join(' ') || 'ที่พักอาศัย';

    const destEl   = document.getElementById('t_destination');
    const coordsEl = document.getElementById('t_destinationCoords');
    const typeEl   = document.getElementById('t_destType');

    if (destEl)   destEl.value   = homeAddr;
    if (coordsEl) coordsEl.value = hh.coordinates || '';
    if (typeEl)   typeEl.value   = 'ที่พักอาศัย / บ้าน';

    // แสดงพิกัดใต้ input
    if (hh.coordinates) {
      const existing = coordsEl?.nextElementSibling;
      if (existing && existing.style.fontSize === '11px') {
        existing.textContent = '📍 ' + hh.coordinates;
      } else if (coordsEl) {
        const d = document.createElement('div');
        d.style.cssText = 'font-size:11px;color:var(--gray-400);margin-top:3px;';
        d.textContent = '📍 ' + hh.coordinates;
        coordsEl.insertAdjacentElement('afterend', d);
      }
    }
  },

  _calcArrival() {
    const depart = document.getElementById('t_depart')?.value;
    const display = document.getElementById('t_arriveDisplay');
    const hidden  = document.getElementById('t_arrive_hidden');
    if (!depart) {
      if (display) display.textContent = '— กรอกเวลาออก + ระยะเวลาก่อน';
      if (hidden)  hidden.value = '';
      return;
    }
    const [h, mn] = depart.split(':').map(Number);
    let totalMins = h * 60 + mn;
    document.querySelectorAll('#segContainer .seg-dur').forEach(inp => {
      totalMins += +(inp.value) || 0;
    });
    const arrH = Math.floor(totalMins / 60) % 24;
    const arrM = totalMins % 60;
    const arrStr = `${String(arrH).padStart(2,'0')}:${String(arrM).padStart(2,'0')}`;
    if (display) display.textContent = arrStr;
    if (hidden)  hidden.value = arrStr;
  },

  _addSeg() {
    const container = document.getElementById('segContainer');
    if (!container) return;
    const i = container.querySelectorAll('.seg-row').length;
    // ใช้ modeOptsStr ที่ render ไว้ใน segContainer ตัวแรก (clone options)
    const firstSelect = container.querySelector('.seg-mode');
    const modeOpts = firstSelect
      ? Array.from(firstSelect.options).map(o => `<option value="${o.value}">${o.text}</option>`).join('')
      : OPT.tripMode.map(o => `<option value="${o}">${o}</option>`).join('');
    const div = document.createElement('div');
    div.className = 'seg-row';
    div.style.cssText = 'background:var(--gray-50);border:1px solid var(--gray-200);border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:8px;';
    div.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <div class="seg-title" style="font-size:12px;font-weight:700;color:var(--primary);">ช่วงที่ ${i+1}</div>
        <button type="button" onclick="App._removeSeg(this)"
          style="background:none;border:none;cursor:pointer;color:var(--danger);font-size:20px;line-height:1;padding:0 4px;">×</button>
      </div>
      <div class="form-grid">
        <div class="form-row">
          <label class="form-label">ประเภทยานพาหนะ</label>
          <select class="form-select seg-mode" autocomplete="off" onchange="App._calcArrival()">
            ${modeOpts}
          </select>
        </div>
        <div class="form-row">
          <label class="form-label">เวลาที่ใช้ (นาที)</label>
          <input class="form-input seg-dur" type="number" min="0" inputmode="numeric" autocomplete="off" placeholder="นาที" oninput="App._calcArrival()" />
        </div>
        <div class="form-row">
          <label class="form-label">ค่าโดยสาร (บาท)</label>
          <input class="form-input seg-fare" type="number" min="0" inputmode="numeric" autocomplete="off" placeholder="บาท" />
        </div>
      </div>`;
    container.appendChild(div);
    // renumber
    container.querySelectorAll('.seg-row .seg-title').forEach((t, idx) => {
      t.textContent = `ช่วงที่ ${idx + 1}`;
    });
  },

  _removeSeg(btn) {
    const container = document.getElementById('segContainer');
    if (!container || container.querySelectorAll('.seg-row').length <= 1) return;
    btn.closest('.seg-row').remove();
    container.querySelectorAll('.seg-row .seg-title').forEach((t, idx) => {
      t.textContent = `ช่วงที่ ${idx + 1}`;
    });
  },

  saveTrip() {
    const segRows = document.querySelectorAll('#segContainer .seg-row');
    const segments = [];
    segRows.forEach(row => {
      segments.push({
        mode:     row.querySelector('.seg-mode')?.value  || '',
        duration: row.querySelector('.seg-dur')?.value   || '',
        fare:     row.querySelector('.seg-fare')?.value  || ''
      });
    });

    const purpose       = document.getElementById('t_purpose')?.value   || '';
    const departureTime = document.getElementById('t_depart')?.value    || '';

    // --- validate required ---
    if (!purpose)       { this.toast('กรุณาเลือกวัตถุประสงค์การเดินทาง', 'error'); return; }
    if (!departureTime) { this.toast('กรุณากรอกเวลาออกเดินทาง', 'error'); return; }
    if (!segments.length || !segments[0].mode) {
      this.toast('กรุณาระบุวิธีเดินทางอย่างน้อย 1 ช่วง', 'error'); return;
    }
    // modes ที่บังคับกรอกค่าโดยสาร
    const fareRequired = ['รถจักรยานยนต์รับจ้าง','รถสามล้อเครื่อง / แท็กซี่','รถสองแถว / รถประจำทาง','รถส่วนบุคคลรับจ้าง'];
    for (let i = 0; i < segments.length; i++) {
      if (fareRequired.includes(segments[i].mode) && !segments[i].fare) {
        this.toast(`ช่วงที่ ${i+1} (${segments[i].mode}): กรุณากรอกค่าโดยสาร`, 'error'); return;
      }
    }

    // validate เวลาออกต้องมากกว่าครั้งก่อน
    if (!this.editingTripId && departureTime) {
      const m2 = DB.getMember(this.hhId, this.memberId);
      if (m2 && m2.trips.length > 0) {
        const prevArr = m2.trips[m2.trips.length - 1].arrivalTime;
        if (prevArr && departureTime < prevArr) {
          this.toast(`เวลาออก (${departureTime}) ต้องไม่ก่อนเวลาถึงครั้งที่แล้ว (${prevArr})`, 'error');
          return;
        }
      }
    }
    const data = {
      origin:            document.getElementById('t_origin')?.value.trim()       || '',
      originCoords:      document.getElementById('t_originCoords')?.value.trim() || '',
      originType:        document.getElementById('t_originType')?.value           || '',
      departureTime,
      destination:       document.getElementById('t_destination')?.value.trim()   || '',
      destinationCoords: document.getElementById('t_destinationCoords')?.value.trim() || '',
      destinationType:   document.getElementById('t_destType')?.value             || '',
      arrivalTime:       document.getElementById('t_arrive_hidden')?.value        || '',
      purpose,
      segments,
      parkingLocation:   document.getElementById('t_park')?.value.trim()          || '',
      parkingFee:        document.getElementById('t_parkFee')?.value              || ''
    };

    if (this.editingTripId) {
      DB.updateTrip(this.hhId, this.memberId, this.editingTripId, data);
      this.toast('แก้ไขการเดินทางแล้ว', 'success');
    } else {
      DB.addTrip(this.hhId, this.memberId, data);
      this.toast('เพิ่มการเดินทางแล้ว', 'success');
    }
    this.editingTripId = null;
    this.closeModal();
    this.memberTab = 'trips';
    this.render();
  },

  deleteTrip(tripId) {
    DB.deleteTrip(this.hhId, this.memberId, tripId);
    this.toast('ลบการเดินทางแล้ว', 'danger');
    this.render();
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
    const icon = { success:'✓', warning:'⚠', danger:'✕' };
    t.innerHTML = `<span>${icon[type] || 'ℹ'}</span> ${msg}`;
    wrap.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  },

  // ===================== FIREBASE SYNC / PULL =====================
  pullFromCloud() {
    const isAdmin    = this._role === 'admin';
    const localCount = DB.getHouseholds().length;
    const filterNote = isAdmin ? '' :
      `<br><span style="color:var(--primary);font-size:12px;">🔍 จะดึงเฉพาะข้อมูลของ "${this._surveyorName}" เท่านั้น</span>`;
    const msg = localCount > 0
      ? `<p style="font-size:14px;color:var(--gray-600);">จะดึงข้อมูลจาก Firebase มา<b>รวม</b>กับข้อมูลในเครื่อง ${localCount} ครัวเรือน<br>ข้อมูลที่ซ้ำ ID กันจะใช้ข้อมูลจาก Firebase แทน${filterNote}</p>`
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
      if (typeof FB === 'undefined') throw new Error('firebase.js โหลดไม่สำเร็จ');
      if (!FB.db) FB.init();
      if (!FB.db) throw new Error('Firebase เชื่อมต่อไม่ได้ — ลองรีเฟรชหน้า');
      const count = this._role === 'admin'
        ? await FB.pullAll()
        : await FB.pullBySurveyor(this._surveyorName);
      this.toast(`☁️ ดึงข้อมูลสำเร็จ รวม ${count} ครัวเรือน`, 'success');
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
      if (typeof FB === 'undefined') throw new Error('firebase.js โหลดไม่สำเร็จ');
      if (!FB.db) FB.init();
      if (!FB.db) throw new Error('Firebase เชื่อมต่อไม่ได้ — ลองรีเฟรชหน้า');
      const count = await FB.syncAll();
      const lastSync = FB.lastSync();
      const timeStr = lastSync ? new Date(lastSync).toLocaleTimeString('th-TH') : '';
      this.toast(`☁️ sync สำเร็จ ${count} ครัวเรือน${timeStr ? ' · ' + timeStr : ''}`, 'success');
    } catch (e) {
      this.toast('sync ไม่สำเร็จ: ' + e.message, 'error');
    } finally {
      if (btn) { btn.textContent = '☁️ Sync'; btn.disabled = false; }
    }
  },

  // ===================== EXPORT / CLEAR =====================
  exportData() {
    if (this._role !== 'admin') { this.toast('เฉพาะผู้ดูแลระบบเท่านั้น', 'error'); return; }
    if (typeof XLSX === 'undefined') {
      this.toast('โหลด SheetJS ไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ต', 'error');
      return;
    }
    const data = JSON.parse(DB.exportJSON());
    const wb   = XLSX.utils.book_new();

    // ===== Sheet 1: ครัวเรือน =====
    const hhRows = data.households.map(hh => ({
      'ID':                        hh.id,
      'วันที่เดินทาง':             hh.travelDate,
      'วันที่บันทึก':              hh.surveyDate,
      'ผู้สำรวจ':                  hh.surveyorName,
      'ผู้ควบคุม':                 hh.supervisorName,
      'ตำบล/อปท.':                 hh.subdistrict,
      'รหัสพื้นที่':               hh.areaCode,
      'บ้านเลขที่':                hh.houseNo,
      'หมู่':                      hh.moo,
      'ซอย':                       hh.alley,
      'ถนน':                       hh.road,
      'โทรศัพท์':                  hh.phone,
      'พิกัด':                     hh.coordinates,
      'ตำบล':                      hh.subdistrict,
      'อำเภอ':                     hh.district,
      'จังหวัด':                   hh.province,
      'Device ID':                 hh.deviceId,
      'IP เครื่อง':                hh.clientIp,
      'ประเภทที่อยู่อาศัย':        hh.residentialType,
      'สมาชิก ชาย-กำลังศึกษา':    +(hh.memberGrid?.m_study || 0),
      'สมาชิก ชาย-ทำงานแล้ว':     +(hh.memberGrid?.m_work  || 0),
      'สมาชิก ชาย-ไม่ได้ทำงาน':   +(hh.memberGrid?.m_notw  || 0),
      'สมาชิก หญิง-กำลังศึกษา':   +(hh.memberGrid?.f_study || 0),
      'สมาชิก หญิง-ทำงานแล้ว':    +(hh.memberGrid?.f_work  || 0),
      'สมาชิก หญิง-ไม่ได้ทำงาน':  +(hh.memberGrid?.f_notw  || 0),
      'สมาชิก ชาย-ต่ำกว่า6ปี':    +(hh.memberGrid?.m_child || 0),
      'สมาชิก หญิง-ต่ำกว่า6ปี':   +(hh.memberGrid?.f_child || 0),
      'รายได้ครัวเรือน':           hh.householdIncome,
      'มียานพาหนะ':                hh.hasVehicle,
      'จักรยาน2ล้อ':               +(hh.vehicles?.bicycle2   || 0),
      'จักรยาน3ล้อ':               +(hh.vehicles?.bicycle3   || 0),
      'รถจักรยานยนต์':             +(hh.vehicles?.motorcycle || 0),
      'รถสามล้อเครื่อง':           +(hh.vehicles?.tuk3       || 0),
      'รถยนต์':                    +(hh.vehicles?.car        || 0),
      'รถโดยสารเล็ก-กลาง':        +(hh.vehicles?.minibus    || 0),
      'รถโดยสารใหญ่':              +(hh.vehicles?.bus        || 0),
      'รถปิ๊กอัพ':                 +(hh.vehicles?.pickup     || 0),
      'รถบรรทุก6ล้อขึ้นไป':       +(hh.vehicles?.truck6     || 0),
      'ยานพาหนะอื่นๆ':             +(hh.vehicles?.other      || 0),
    }));

    // ===== Sheet 2: สมาชิก =====
    const memberRows = data.households.flatMap(hh =>
      hh.members.map(m => ({
        'ID_ครัวเรือน':        hh.id,
        'รหัสพื้นที่':         hh.areaCode,
        'ID_สมาชิก':          m.id,
        'ลำดับ':              m.seq,
        'เพศ':                m.gender,
        'อายุ':               m.age,
        'สถานะในบ้าน':        m.homeStatus,
        'สถานะการทำงาน':      m.workStatus,
        'อาชีพ':              m.occupation,
        'การศึกษา':           m.education,
        'ชื่อสถานที่ทำงาน':   m.workplaceName,
        'ซอย(ที่ทำงาน)':      m.workplaceAlley,
        'ถนน(ที่ทำงาน)':      m.workplaceRoad,
        'ตำบล(ที่ทำงาน)':     m.workplaceSubdistrict,
        'อำเภอ(ที่ทำงาน)':    m.workplaceDistrict,
        'จังหวัด(ที่ทำงาน)':  m.workplaceProvince,
        'รายได้':             m.income,
      }))
    );

    // ===== Sheet 3: การเดินทาง =====
    const tripRows = data.households.flatMap(hh =>
      hh.members.flatMap(m =>
        m.trips.map(t => {
          const segs = t.segments || [];
          return {
            'ID_ครัวเรือน':       hh.id,
            'รหัสพื้นที่':        hh.areaCode,
            'ID_สมาชิก':         m.id,
            'ลำดับสมาชิก':       m.seq,
            'ID_การเดินทาง':      t.id,
            'ลำดับการเดินทาง':    t.seq,
            'ต้นทาง':            t.origin,
            'พิกัดต้นทาง':       t.originCoords,
            'ประเภทต้นทาง':      t.originType,
            'เวลาออกเดินทาง':     t.departureTime,
            'ปลายทาง':           t.destination,
            'พิกัดปลายทาง':      t.destinationCoords,
            'ประเภทปลายทาง':     t.destinationType,
            'เวลาถึงปลายทาง':    t.arrivalTime,
            'วัตถุประสงค์':       t.purpose,
            'รูปแบบ_1':          segs[0]?.mode     || '',
            'ระยะเวลา_1(นาที)':  segs[0]?.duration || '',
            'ค่าโดยสาร_1(บาท)':  segs[0]?.fare     || '',
            'รูปแบบ_2':          segs[1]?.mode     || '',
            'ระยะเวลา_2(นาที)':  segs[1]?.duration || '',
            'ค่าโดยสาร_2(บาท)':  segs[1]?.fare     || '',
            'รูปแบบ_3':          segs[2]?.mode     || '',
            'ระยะเวลา_3(นาที)':  segs[2]?.duration || '',
            'ค่าโดยสาร_3(บาท)':  segs[2]?.fare     || '',
            'สถานที่จอด':         t.parkingLocation,
            'ค่าจอด(บาท)':       t.parkingFee,
          };
        })
      )
    );

    // สร้าง worksheet (ถ้าไม่มีข้อมูลให้สร้าง empty sheet)
    const mkSheet = rows => rows.length
      ? XLSX.utils.json_to_sheet(rows)
      : XLSX.utils.aoa_to_sheet([['ไม่มีข้อมูล']]);

    XLSX.utils.book_append_sheet(wb, mkSheet(hhRows),     'ครัวเรือน');
    XLSX.utils.book_append_sheet(wb, mkSheet(memberRows), 'สมาชิก');
    XLSX.utils.book_append_sheet(wb, mkSheet(tripRows),   'การเดินทาง');

    const filename = `home-interview-banphai-${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, filename);
    this.toast('Export Excel สำเร็จ', 'success');
  },

  confirmClearAll() {
    const stats = DB.stats();
    this.showModal('⚠️ ล้างข้อมูลทั้งหมด',
      `<div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;padding:14px 16px;margin-bottom:12px;">
        <strong style="color:#dc2626;">ข้อมูลที่จะถูกลบ:</strong>
        <ul style="margin-top:8px;padding-left:18px;font-size:14px;color:#7f1d1d;line-height:1.8;">
          <li>${stats.households} ครัวเรือน</li>
          <li>${stats.members} สมาชิก</li>
          <li>${stats.trips} การเดินทาง</li>
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
  },

};

document.addEventListener('DOMContentLoaded', () => App.init());
