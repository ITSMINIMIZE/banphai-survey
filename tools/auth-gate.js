/* 🔒 Tools auth gate — บังคับ login ด้วย Firebase Admin จริง (แทน gate รหัสฝัง client เดิม)
   - กันคนนอกเข้าหน้าเครื่องมือ: ต้องมีบัญชี admin (Firebase Auth) เท่านั้น
   - ความปลอดภัยจริงยังอยู่ที่ Firestore rules — gate นี้บังคับ identity + กัน UI
   - ใช้ร่วมทุกหน้าใน tools/ : <script src="auth-gate.js"></script>
   - ต้องโหลด firebase-app-compat + firebase-auth-compat ไว้ในหน้าด้วย (gate จะ init เองถ้ายังไม่ init) */
(function () {
  var EMAIL_DOMAIN = '@banphai.local';
  var CFG = {
    apiKey:            'AIzaSyA_f0UniGXeSRRn4VjD-56Gp9Xb0M-I8kQ',
    authDomain:        'banphai-survey.firebaseapp.com',
    projectId:         'banphai-survey',
    storageBucket:     'banphai-survey.firebasestorage.app',
    messagingSenderId: '755175522135',
    appId:             '1:755175522135:web:da20ccae36e1d1e9210812'
  };

  var ov, statusEl;

  // ---- overlay เต็มจอ (บล็อกหน้า) ----
  function injectOverlay() {
    if (ov || !document.body) return;
    ov = document.createElement('div');
    ov.id = '_authgate';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#0f172a;display:flex;' +
      'flex-direction:column;align-items:center;justify-content:center;gap:12px;' +
      'font-family:Sarabun,system-ui,sans-serif;padding:24px;';
    ov.innerHTML =
      '<div style="font-size:40px">🔒</div>' +
      '<div style="color:#f1f5f9;font-size:18px;font-weight:700">เครื่องมือสำหรับผู้ดูแล</div>' +
      '<div id="_agStatus" style="color:#94a3b8;font-size:13px">กำลังเชื่อมต่อ...</div>';
    document.body.appendChild(ov);
    statusEl = ov.querySelector('#_agStatus');
  }

  // ---- ฟอร์ม login (แสดงเมื่อยังไม่ได้ login) ----
  function showLoginForm(auth) {
    if (!ov) return;
    ov.innerHTML =
      '<div style="font-size:40px">🔒</div>' +
      '<div style="color:#f1f5f9;font-size:18px;font-weight:700">เครื่องมือสำหรับผู้ดูแล</div>' +
      '<div style="color:#94a3b8;font-size:13px">เข้าสู่ระบบด้วยบัญชี Admin</div>' +
      '<input id="_agU" type="text" placeholder="ชื่อผู้ใช้" autocomplete="username" ' +
        'style="padding:12px 16px;border-radius:10px;border:1px solid #334155;background:#1e293b;color:#f1f5f9;font-size:15px;width:240px;outline:none" />' +
      '<input id="_agP" type="password" placeholder="รหัสผ่าน" autocomplete="current-password" ' +
        'style="padding:12px 16px;border-radius:10px;border:1px solid #334155;background:#1e293b;color:#f1f5f9;font-size:15px;width:240px;outline:none" />' +
      '<button id="_agB" style="padding:12px 28px;border:none;border-radius:10px;background:#2563eb;color:#fff;font-weight:600;font-size:15px;cursor:pointer;width:240px">เข้าสู่ระบบ</button>' +
      '<div id="_agE" style="color:#f87171;font-size:13px;height:16px"></div>';
    var u = ov.querySelector('#_agU'), p = ov.querySelector('#_agP'),
        b = ov.querySelector('#_agB'), e = ov.querySelector('#_agE');
    function go() {
      var user = (u.value || '').trim().toLowerCase().replace(/\s+/g, ''), pw = p.value;
      if (!user || !pw) { e.textContent = 'กรุณากรอกให้ครบ'; return; }
      var email = user.indexOf('@') >= 0 ? user : user + EMAIL_DOMAIN;
      b.disabled = true; b.textContent = '⌛ กำลังตรวจสอบ...'; e.textContent = '';
      auth.signInWithEmailAndPassword(email, pw)
        .catch(function () {
          b.disabled = false; b.textContent = 'เข้าสู่ระบบ';
          e.textContent = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
          p.value = ''; p.focus();
        });
      // สำเร็จ → onAuthStateChanged จะลบ overlay เอง
    }
    b.onclick = go;
    p.onkeydown = function (ev) { if (ev.key === 'Enter') go(); };
    u.onkeydown = function (ev) { if (ev.key === 'Enter') p.focus(); };
    setTimeout(function () { u.focus(); }, 50);
  }

  // ---- firebase พร้อมหรือยัง (init ถ้ายังไม่ init) ----
  function getAuth() {
    if (typeof firebase === 'undefined' || !firebase.auth) return null;
    try {
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(CFG);
      return firebase.auth();
    } catch (e) { return null; }
  }

  function start() {
    injectOverlay();
    var tries = 0;
    (function wait() {
      var auth = getAuth();
      if (auth) {
        auth.onAuthStateChanged(function (user) {
          if (user) { if (ov) { ov.remove(); ov = null; } }
          else { showLoginForm(auth); }
        });
        return;
      }
      if (tries++ > 120) { // ~6s — Firebase SDK โหลดไม่สำเร็จ
        if (statusEl) statusEl.textContent = 'โหลด Firebase ไม่สำเร็จ — ต้องการอินเทอร์เน็ต แล้วรีเฟรช';
        return;
      }
      setTimeout(wait, 50);
    })();
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
