import { auth, db, $, haversine, fmtDist, getDeviceId, isMobile, isInAppBrowser, bkkDay, fmtTime, fmtDateLong, GESTURES, errText, esc, busy,
  normCode, shiftInfo, shiftLabel, displayCode, shiftWindow, mergeDays, deviceInfo, LATE_GRACE_MIN, SHIFT_CHOICES } from "./common.js";
import { TENANT_QS, TENANT_REGION, TENANT_ID } from "./firebase-config.js";
import { TENANTS } from "./tenants.js";
import { STORES } from "./stores.js";
import { LOOKS, applyLook } from "./filters.js";
import { findTeam, goTeam, resetAllTeams, teamKnown } from "./teamfinder.js";
document.querySelectorAll('a[href="admin.html"]').forEach((a) => (a.href = "admin.html" + TENANT_QS));
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, getDocs, setDoc, updateDoc, collection, query, where, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const SCREENS = ["scInApp", "scLoading", "scLogin", "scChangePw", "scDevice", "scBlocked", "scAdmin", "scMain"];
function screen(id) {
  SCREENS.forEach((s) => $(s).classList.toggle("hidden", s !== id));
  $("btnLogout").classList.toggle("hidden", !["scChangePw", "scDevice", "scBlocked", "scAdmin", "scMain"].includes(id));
}
function msg(id, text, kind = "err") { const el = $(id); el.textContent = text || ""; el.className = "msg " + kind; }

const deviceId = getDeviceId();
const MAX_DEVICES = 2;
const NOTE_MIN = 10;
let me = null, profile = null, branches = [], type = "in", lockedType = null;
let pos = null, watchId = null, inRange = false, dist = null;
let stream = null, gesture = null, photo = null, todayCode = "", beauty = 1;
let monthDays = {};   // กะของเดือนนี้ (รวมรายการที่สลับแล้ว)
let placeMode = "branch", place = null, map = null, mapLayers = [], overrideDays = new Set(), pendingDays = {}, monthRecs = [], calSel = "", hoursTimer = null;
const AUTO_OUT_H = 12;
let DEMO = false;     // โหมดทดลองสำหรับผู้ดูแล: เห็นทุกขั้นตอน แต่ไม่บันทึกข้อมูล
const isAdminRole = () => profile && ["rm", "admin", "am"].includes(profile.role);

/* ---------- เริ่มต้น ---------- */
if (isInAppBrowser()) {
  screen("scInApp");
  $("btnCopyLink").onclick = async () => {
    try { await navigator.clipboard.writeText(location.href); msg("copyMsg", "คัดลอกแล้ว นำไปวางใน Safari หรือ Chrome", "ok"); }
    catch { msg("copyMsg", location.href, "ok"); }
  };
} else {
  screen("scLoading");
  onAuthStateChanged(auth, onUser);
}

async function onUser(user) {
  stopAll();
  me = user;
  if (!user) { screen("scLogin"); return; }
  screen("scLoading");
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists()) return blocked("บัญชีนี้ยังไม่ได้ลงทะเบียนในระบบ กรุณาติดต่อหัวหน้า");
    profile = snap.data();
    if (profile.active === false) return blocked("บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อหัวหน้า");
    if (profile.mustChangePassword) { screen("scChangePw"); return; }
    if (profile.role === "viewer") { location.href = "rm.html"; return; }
    if (isAdminRole()) { if (new URLSearchParams(location.search).has("demo")) return enterDemo(); screen("scAdmin"); return; }
    await checkDevice();
  } catch (e) { blocked(errText(e)); }
}
function blocked(text) { $("blkText").textContent = text; screen("scBlocked"); }
$("btnAdminTest").onclick = () => enterDemo();
async function enterDemo() {
  DEMO = true;
  $("demoBar").classList.remove("hidden");
  try { await enterMain(); } catch (e) { blocked(errText(e)); }
}
$("demoInRange").addEventListener("change", () => {
  const b = curBranch();
  if ($("demoInRange").checked && b) { if (watchId !== null) navigator.geolocation.clearWatch(watchId); watchId = null; pos = { latitude: b.lat, longitude: b.lng, accuracy: 10 }; updateLoc(); }
  else { pos = null; startGeo(); }
});

/* ---------- ล็อกอิน ---------- */
$("btnLogin").onclick = async () => {
  const email = $("liEmail").value.trim(), pw = $("liPw").value;
  if (!email || !pw) return msg("liMsg", "กรุณากรอกอีเมลและรหัสผ่าน");
  busy($("btnLogin"), true);
  try { await signInWithEmailAndPassword(auth, email, pw); msg("liMsg", ""); }
  catch (e) {
    if (["auth/invalid-credential", "auth/user-not-found", "auth/wrong-password"].includes(e.code)) {
      msg("liMsg", "กำลังค้นหาทีมของคุณ...", "ok");
      const id = await findTeam(email, pw);
      if (id) { msg("liMsg", "พบบัญชีแล้ว กำลังเข้าสู่ระบบ...", "ok"); return goTeam(id); }
    }
    msg("liMsg", errText(e));
  }
  finally { busy($("btnLogin"), false); }
};
$("liPw").addEventListener("keydown", (e) => { if (e.key === "Enter") $("btnLogin").click(); });
$("btnForgot").onclick = async () => {
  const email = $("liEmail").value.trim();
  if (!email) return msg("liMsg", "กรอกอีเมลของคุณในช่องด้านบนก่อน แล้วกด \"ลืมรหัสผ่าน\" อีกครั้ง");
  try { if (teamKnown()) await sendPasswordResetEmail(auth, email); else await Promise.allSettled([sendPasswordResetEmail(auth, email), resetAllTeams(email)]); msg("liMsg", "ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่อีเมลแล้ว (ตรวจในกล่อง Junk/Spam ด้วย)", "ok"); }
  catch (e) { msg("liMsg", errText(e)); }
};
$("btnLogout").onclick = () => { stopAll(); DEMO = false; $("demoBar").classList.add("hidden"); signOut(auth); };

/* ---------- เปลี่ยนรหัสผ่านครั้งแรก ---------- */
$("btnChangePw").onclick = async () => {
  const a = $("cpPw1").value, b = $("cpPw2").value;
  if (a.length < 6) return msg("cpMsg", "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร");
  if (a !== b) return msg("cpMsg", "รหัสผ่านทั้ง 2 ช่องไม่ตรงกัน");
  busy($("btnChangePw"), true);
  try {
    await updatePassword(me, a);
    await updateDoc(doc(db, "users", me.uid), { mustChangePassword: false });
    profile.mustChangePassword = false;
    msg("cpMsg", "");
    if (["rm", "admin", "am"].includes(profile.role)) { screen("scAdmin"); return; }
    await checkDevice();
  } catch (e) { msg("cpMsg", errText(e)); }
  finally { busy($("btnChangePw"), false); }
};

/* ---------- ตรวจเครื่อง: มือถือ 1 เครื่องผูกได้ 2 ที่ (เช่น Safari + ไอคอนหน้าจอโฮม) ---------- */
async function checkDevice() {
  const snap = await getDoc(doc(db, "users", me.uid));
  profile = snap.data();
  if (profile.active === false) return blocked("บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อหัวหน้า");
  if (!isMobile()) return blocked("ลงเวลาได้เฉพาะบนมือถือ — บัญชีพนักงานใช้กับคอมพิวเตอร์หรือโน้ตบุ๊กไม่ได้ เปิดลิงก์นี้ด้วย Safari (iPhone) หรือ Chrome (Android) บนมือถือของคุณ");
  const ids = Array.isArray(profile.deviceIds) && profile.deviceIds.length ? [...profile.deviceIds] : (profile.deviceId ? [profile.deviceId] : []);
  const info = await deviceInfo();
  if (!ids.includes(deviceId)) {
    if (ids.length < MAX_DEVICES) {
      const upd = { deviceIds: [...ids, deviceId], [`devices.${deviceId}`]: { ...info, at: serverTimestamp() } };
      if (!profile.deviceId) upd.deviceId = deviceId;
      await updateDoc(doc(db, "users", me.uid), upd);
      ids.push(deviceId);
    }
  } else if (!(profile.devices && profile.devices[deviceId])) {
    // เครื่องที่ผูกไว้ก่อนมีระบบเก็บรายละเอียด → บันทึกรายละเอียดเพิ่ม
    try { await updateDoc(doc(db, "users", me.uid), { [`devices.${deviceId}`]: { ...info, at: serverTimestamp() } }); } catch (e) {}
  }
  if (!ids.includes(deviceId)) {
    return requestDevice("มือถือนี้ผูกครบ 2 ที่แล้ว / เปลี่ยนเครื่อง / ล้างข้อมูลเบราว์เซอร์ — ระบบส่งคำขอให้หัวหน้าอนุมัติแล้ว", info);
  }
  enterMain();
}
async function requestDevice(text, info) {
  await setDoc(doc(db, "deviceRequests", me.uid), {
    deviceId, ua: navigator.userAgent.slice(0, 300), name: profile.name || "", email: me.email || "",
    mobile: isMobile(), zoneId: profile.zoneId || "", info: info || {}, at: serverTimestamp()
  });
  $("devText").textContent = text;
  screen("scDevice");
}
$("btnDevRecheck").onclick = async () => {
  busy($("btnDevRecheck"), true);
  try { await checkDevice(); } catch (e) { $("devText").textContent = errText(e); }
  finally { busy($("btnDevRecheck"), false); }
};

/* ---------- หน้าหลัก ---------- */
async function enterMain() {
  screen("scMain");
  $("mName").textContent = profile.name || me.email;
  $("mPos").textContent = [profile.position, profile.empId ? "รหัส " + profile.empId : ""].filter(Boolean).join(" · ");
  $("mDate").textContent = fmtDateLong();
  const bs = await getDocs(collection(db, "branches"));
  branches = bs.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((b) => b.active !== false && typeof b.lat === "number" && typeof b.lng === "number")
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "th"));
  const sel = $("mBranch");
  sel.innerHTML = branches.map((b) => `<option value="${esc(b.id)}">${esc(b.name)} (${esc(b.id)})</option>`).join("")
    || `<option value="">— ยังไม่มีสาขาที่ตั้งพิกัดไว้ —</option>`;
  const own = branches.find((b) => b.id === String(profile.branchId || ""));
  if (own) sel.value = own.id; else if (!DEMO) sel.innerHTML = `<option value="">—</option>`;
  // สาขาประจำ: ระบบเลือกให้ เปลี่ยนไม่ได้ (โหมดทดลองของผู้ดูแลเลือกสาขาได้)
  $("branchSelWrap").classList.toggle("hidden", !DEMO);
  $("branchLock").classList.toggle("hidden", DEMO);
  $("branchLockName").textContent = own ? `${own.id} · ${own.name}` : "ยังไม่ได้กำหนดสาขาประจำ — ติดต่อ AM";
  showRound();
  setPlaceMode("branch");
  sel.onchange = () => { if (DEMO && $("demoInRange").checked) { const b = curBranch(); if (b) pos = { latitude: b.lat, longitude: b.lng, accuracy: 10 }; } updateLoc(); };
  applyLock();
  resetPhoto();
  startGeo();
  loadToday();
  await loadShift();
  applyDayBranch();
  checkAutoOut();
  loadRequests();
  loadHistory();
}
function showRound() {
  const T = TENANTS[TENANT_ID] || {}, am = T.amName || String(T.name || "").replace(/^AM Check-In\s*·?\s*/, "");
  const day = bkkDay(), [y, m] = day.split("-").map(Number), last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mon = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", month: "long", year: "numeric" }).format(new Date(day + "T12:00:00+07:00"));
  $("roundBar").innerHTML = `<b>เช็กอินรอบ 1–${last} ${esc(mon)}</b>${am ? `<span>AM ${esc(am)}</span>` : ""}`;
  $("roundBar").classList.remove("hidden");
  $("calMonth").textContent = mon;
}
const fmtDur = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return `${Math.floor(m / 60)} ชม. ${m % 60} นาที`; };
const hhmm = (d) => new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" }).format(d);
const lastInTime = () => (profile.lastAt && profile.lastAt.toDate ? profile.lastAt.toDate() : null);

// บังคับสลับ: ล่าสุดเข้างาน → ต้องออกงาน, ล่าสุดออกงาน → ต้องเข้างาน
function applyLock() {
  if (DEMO) {
    lockedType = type;
    [...$("segType").children].forEach((b) => { b.disabled = false; });
    setType(type);
    $("mState").textContent = "โหมดทดลอง: กดสลับ เข้างาน/ออกงาน ได้อิสระ (ของจริงระบบจะบังคับสลับให้ เข้า → ออก)";
    return;
  }
  lockedType = profile.lastType === "in" ? "out" : "in";
  [...$("segType").children].forEach((b) => { b.disabled = b.dataset.v !== lockedType; });
  setType(lockedType);
  const lt = profile.lastAt && profile.lastAt.toDate ? profile.lastAt.toDate() : null;
  $("mState").textContent = profile.lastType === "in"
    ? `สถานะ: เข้างานแล้ว${lt ? " เมื่อ " + new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "short" }).format(lt) : ""} — กดได้เฉพาะ "ออกงาน"`
    : "สถานะ: ยังไม่ได้เข้างาน — กดได้เฉพาะ \"เข้างาน\"";
  showHours();
}
// ออกงาน: แสดงชั่วโมงทำงาน + เตือนเมื่อเลยเวลาเลิกกะ 30 นาที
function showHours() {
  clearInterval(hoursTimer); hoursTimer = null;
  const tin = lastInTime(), on = type === "out" && !!tin;
  $("outHours").classList.toggle("hidden", !on);
  if (!on) return;
  const tick = () => {
    const now = new Date(), inDay = bkkDay(tin), info = shiftInfo(monthDays[inDay]);
    $("ohTime").textContent = fmtDur(now - tin);
    let sub = `เข้างาน ${hhmm(tin)} น.`, pct = 0;
    if (info && !info.off) {
      const w = shiftWindow(inDay, info), left = Math.round((w.e - now) / 60000);
      pct = Math.min(100, Math.round(((now - tin) / (w.e - w.s)) * 100));
      sub += left > 0 ? ` · ครบกะ ${info.e} น. · อีก ${left} นาที` : ` · เลยเวลาเลิกกะ ${-left} นาที`;
      if (left < -30) sub += ` — อย่าลืมกดออกงาน (ถ้าไม่กดภายใน ${hhmm(new Date(tin.getTime() + AUTO_OUT_H * 3600000))} น. ระบบจะปิดให้อัตโนมัติ)`;
      $("ohSub").className = left < -30 ? "msg err" : "muted";
    }
    $("ohSub").textContent = sub;
    $("ohBar").style.width = pct + "%";
  };
  tick(); hoursTimer = setInterval(tick, 30000);
}

async function loadShift() {
  const el = $("mShift");
  el.classList.add("hidden"); todayCode = ""; monthDays = {};
  if (DEMO && !profile.phoneKey) {
    // ตัวอย่างตารางกะ (ผู้ดูแลไม่มีกะของตัวเอง)
    const day = bkkDay(), [y, m] = day.split("-").map(Number), last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (let i = 1; i <= last; i++) { const d = `${day.slice(0, 7)}-${String(i).padStart(2, "0")}`; monthDays[d] = new Date(d + "T12:00:00+07:00").getDay() === 3 ? "H" : "9"; }
    todayCode = normCode(monthDays[day]);
    $("mShift").textContent = "🕘 วันนี้: " + shiftLabel(todayCode) + " (ตัวอย่าง)";
    $("mShift").className = "loc " + (shiftInfo(todayCode).off ? "bad" : "ok");
    setShiftBox(shiftInfo(todayCode));
    fillRequestForm(); renderCal();
    return;
  }
  if (!profile.phoneKey) return;
  const day = bkkDay(), key = `${day.slice(0, 7)}_${profile.phoneKey}`;
  let s = null, o = null;
  try { const x = await getDoc(doc(db, "shifts", key)); if (x.exists()) s = x.data(); } catch (e) {}
  try { const x = await getDoc(doc(db, "shiftOverrides", key)); if (x.exists()) o = x.data(); } catch (e) {}
  if (!s && !o) return;
  monthDays = mergeDays(s, o);
  overrideDays = new Set(Object.keys((o && o.days) || {}));
  todayCode = normCode(monthDays[day]);
  const info = shiftInfo(todayCode);
  setShiftBox(info);
  el.textContent = "🕘 วันนี้: " + shiftLabel(todayCode);
  el.className = "loc " + (info && info.off ? "bad" : "ok");
  el.classList.add("hidden");
  fillRequestForm(); renderCal(); showHours();
}
// ตารางกะใส่รหัสสาขา 4 หลัก = วันนี้ทำงานต่างสาขา (เข้า 08:00)
let dayBranch = null;
function applyDayBranch() {
  dayBranch = null;
  const info = shiftInfo(todayCode); if (!info || DEMO) return;
  if (info.visit) { setPlaceMode("off"); $("mNote").value = "ออกตรวจสาขา (Visit) ตามตารางกะ"; updateLoc(); return; }
  if (!info.branch) return;
  const own = String(profile.branchId || ""), tb = branches.find((b) => String(b.id) === info.branch);
  if (info.branch === own) return;
  if (tb) { // สาขาในทีม: เช็กอินที่สาขานั้นได้ตามปกติ
    dayBranch = tb; $("mBranch").value = tb.id;
    $("branchLockName").textContent = `${tb.id} · ${tb.name} (วันนี้ทำงานต่างสาขาตามตารางกะ)`;
  } else { // สาขานอกทีม: ใช้ "นอกสถานที่" และเลือกสาขานั้นให้
    const p = places().find((x) => x.id === info.branch);
    setPlaceMode("off");
    if (p) { place = p; renderPlaces(); }
    $("mNote").value = `ทำงานต่างสาขา ${info.branch} ตามตารางกะ`;
  }
  updateLoc();
}
function setShiftBox(info) {
  const b = $("mShiftBox");
  if (!info) { b.classList.add("hidden"); return; }
  b.classList.remove("hidden");
  b.classList.toggle("off", !!info.off);
  $("mShiftTime").textContent = info.off ? info.off : info.train ? `อบรม ${info.s}` : info.branch ? `${info.branch} · ${info.s}` : info.special ? `${displayCode(todayCode)} · ${info.s}` : `${info.s}–${info.e}`;
}
const curBranch = () => branches.find((b) => b.id === $("mBranch").value);

$("segType").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b && !b.disabled) setType(b.dataset.v); });
function setType(v) {
  type = v; if (DEMO) lockedType = v;
  [...$("segType").children].forEach((b) => b.classList.toggle("on", b.dataset.v === v));
  const out = v === "out";
  $("camCard").classList.toggle("hidden", out);
  $("outNoPhoto").classList.toggle("hidden", !out);
  if (out) stopCam();
  updateLoc(); if (profile) showHours();
}

/* ---------- GPS ---------- */
function setLoc(kind, text) { const el = $("locBox"); el.className = "loc " + kind; el.textContent = text; }
function startGeo() {
  if (!("geolocation" in navigator)) { setLoc("bad", "✗ อุปกรณ์นี้ไม่รองรับการหาตำแหน่ง"); return; }
  setLoc("wait", "📍 กำลังหาตำแหน่ง...");
  watchId = navigator.geolocation.watchPosition(
    (p) => { pos = p.coords; updateLoc(); autoRefresh(); },
    (e) => {
      pos = null; inRange = false;
      setLoc("bad", e.code === 1
        ? "✗ ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง — เปิด Location ในเครื่อง และกดอนุญาตในเบราว์เซอร์"
        : "✗ หาตำแหน่งไม่ได้ — เปิด Location แล้วเดินไปใกล้หน้าต่างหรือที่โล่ง");
      refresh();
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
  );
}
const isOff = () => placeMode === "off";
const noteText = () => $("mNote").value.trim();
// ต้องใส่เหตุผลเมื่อเลือก "นอกสถานที่" (ทั้งเข้างานและออกงาน)
const needNote = () => isOff();

/* ---------- นอกสถานที่: เลือกได้เฉพาะสาขา Lotus's (stores.js) หรือ "อื่นๆ" ---------- */
let placesCache = null;
function places() {
  if (placesCache) return placesCache;
  const fromTeam = new Map(branches.map((b) => [String(b.id), b]));
  placesCache = STORES.map(([id, name, am, lat, lng]) => {
    const t = fromTeam.get(String(id));
    return { id: String(id), name: name || (t && t.name) || "", lat: t ? t.lat : lat, lng: t ? t.lng : lng };
  });
  return placesCache;
}
const placeLabel = () => !place ? "" : place.id === "other" ? $("pOther").value.trim() : `${place.id} ${place.name}`;
const placeOk = () => !!place && (place.id !== "other" || $("pOther").value.trim().length >= 3);
const placeDist = (p) => (pos && p && typeof p.lat === "number" ? haversine(pos.latitude, pos.longitude, p.lat, p.lng) : null);
function nearestPlace() {
  if (!pos) return null;
  let best = null, bd = Infinity;
  for (const p of places()) { const d = placeDist(p); if (d !== null && d < bd) { bd = d; best = p; } }
  return best;
}
function renderPlaces() {
  if (!isOff()) return;
  const q = $("pSearch").value.trim().toLowerCase();
  const li = (p) => { const d = placeDist(p), on = place && place.id === p.id; return `<li data-pid="${esc(p.id)}" class="${on ? "on" : ""}"><span>${esc(p.id)} · ${esc(p.name)}</span><span class="d">${d !== null ? "ห่าง " + fmtDist(d) : ""}${on ? " ✓" : ""}</span></li>`; };
  let html = `<li data-pid="other" class="other${place && place.id === "other" ? " on" : ""}"><span>＋ อื่นๆ (ระบุสถานที่เอง)</span>${place && place.id === "other" ? "<span>✓</span>" : ""}</li>`;
  if (q) {
    const hits = places().filter((p) => p.id.startsWith(q) || p.name.toLowerCase().includes(q)).slice(0, 8);
    html += hits.length ? hits.map(li).join("") : `<li class="empty">ไม่พบสาขา — เลือก "อื่นๆ" แล้วพิมพ์สถานที่</li>`;
  } else {
    const n = nearestPlace();
    if (place && place.id !== "other" && (!n || n.id !== place.id)) html += `<li class="hd">ที่เลือกไว้</li>` + li(place);
    html += n ? `<li class="hd">ใกล้คุณที่สุด</li>` + li(n) : `<li class="empty">${pos ? "พิมพ์รหัสหรือชื่อสาขาด้านบน" : "กำลังหาตำแหน่ง..."}</li>`;
  }
  $("pList").innerHTML = html;
}
$("pList").addEventListener("click", (e) => {
  const el = e.target.closest("li[data-pid]"); if (!el) return;
  const id = el.dataset.pid;
  place = id === "other" ? { id: "other", name: "" } : places().find((p) => p.id === id) || null;
  $("pOtherWrap").classList.toggle("hidden", id !== "other");
  if (id === "other") $("pOther").focus();
  renderPlaces(); updateLoc();
});
$("pSearch").addEventListener("input", renderPlaces);
$("pOther").addEventListener("input", () => { updateLoc(); });
$("segPlace").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setPlaceMode(b.dataset.v); });
function setPlaceMode(v) {
  placeMode = v;
  [...$("segPlace").children].forEach((b) => b.classList.toggle("on", b.dataset.v === v));
  $("offBox").classList.toggle("hidden", v !== "off");
  if (!DEMO) $("branchLock").classList.toggle("hidden", v === "off");
  if (v !== "off") { place = null; $("pSearch").value = ""; $("pOther").value = ""; $("pOtherWrap").classList.add("hidden"); }
  renderPlaces(); updateLoc();
}

/* ---------- แผนที่ (Leaflet + OpenStreetMap) ---------- */
let leafletP = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletP) return leafletP;
  leafletP = new Promise((res, rej) => {
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"; document.head.appendChild(css);
    const js = document.createElement("script"); js.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"; js.onload = () => res(window.L); js.onerror = rej; document.head.appendChild(js);
  });
  return leafletP;
}
let mapKey = "";
async function drawMap(kind) {
  const el = $("map"); el.className = "map " + kind;
  const b = curBranch(), tgt = isOff() ? (place && typeof place.lat === "number" ? place : null) : b;
  if (!pos && !tgt) return;
  let L; try { L = await loadLeaflet(); } catch (e) { el.classList.add("hidden"); return; }
  if (!map) {
    map = L.map(el, { zoomControl: false, attributionControl: true, scrollWheelZoom: false });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
  }
  mapLayers.forEach((x) => map.removeLayer(x)); mapLayers = [];
  const pts = [];
  if (tgt) {
    const r = (b && tgt.id === b.id ? b.radius : 0) || 200;
    mapLayers.push(L.circle([tgt.lat, tgt.lng], { radius: r, color: "#1E5BD8", weight: 2, fillColor: "#1E5BD8", fillOpacity: 0.12 }).addTo(map));
    mapLayers.push(L.circleMarker([tgt.lat, tgt.lng], { radius: 6, color: "#fff", weight: 2, fillColor: "#0B2E7A", fillOpacity: 1 }).addTo(map));
    pts.push([tgt.lat, tgt.lng]);
  }
  if (pos) {
    mapLayers.push(L.circleMarker([pos.latitude, pos.longitude], { radius: 7, color: "#fff", weight: 2, fillColor: "#FFB800", fillOpacity: 1 }).addTo(map));
    pts.push([pos.latitude, pos.longitude]);
  }
  const key = (tgt ? tgt.id : "") + "|" + (pos ? 1 : 0);
  if (key !== mapKey) { // จัดมุมมองใหม่เมื่อเปลี่ยนเป้าหมาย (ไม่กระตุกทุกครั้งที่ GPS ขยับ)
    mapKey = key;
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(0.35), { maxZoom: 17 }); else map.setView(pts[0], 16);
  }
  setTimeout(() => map.invalidateSize(), 50);
}

function updateLoc() {
  const b = curBranch(), off = isOff();
  if (!b) { inRange = false; setLoc("bad", "✗ ยังไม่ได้กำหนดสาขาประจำ — ติดต่อ AM"); return refresh(); }
  let kind = "wait";
  if (pos) {
    dist = haversine(pos.latitude, pos.longitude, b.lat, b.lng);
    const r = b.radius || 200, acc = Math.round(pos.accuracy);
    inRange = dist <= r;
    if (off) {
      const d = placeDist(place);
      setLoc("wait", place ? `📍 นอกสถานที่ · ${placeLabel() || "อื่นๆ"}${d !== null ? " · ห่าง " + fmtDist(d) : ""} (±${acc} ม.) · ระบบบันทึกพิกัดจริงให้ AM ตรวจ` : "📍 นอกสถานที่ — เลือกสถานที่ด้านบน แล้วระบุเหตุผล");
    } else if (inRange) { kind = "ok"; setLoc("ok", `✓ อยู่ในพื้นที่สาขา (ห่าง ${Math.round(dist)} ม. · ความแม่นยำ ±${acc} ม.)`); }
    else { kind = "bad"; setLoc("bad", `✗ อยู่นอกพื้นที่สาขา — ห่าง ${fmtDist(dist)} (กำหนด ${r} ม. · ±${acc} ม.) · ถ้าทำงานนอกสถานที่ ให้กด "นอกสถานที่"`); }
  }
  drawMap(kind);
  const need = needNote();
  $("noteWrap").classList.toggle("hidden", !need);
  $("noteReq").textContent = need ? `(จำเป็น — อย่างน้อย ${NOTE_MIN} ตัวอักษร)` : "(ไม่บังคับ)";
  $("noteReq").className = need ? "msg err" : "";
  $("noteChips").classList.toggle("hidden", !need);
  if (off && !$("pSearch").value) renderPlaces();
  refresh();
}
$("mNote").addEventListener("input", refresh);
$("noteChips").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  const cur = noteText();
  $("mNote").value = cur && !cur.startsWith(b.textContent) ? `${b.textContent} — ${cur}` : `${b.textContent} — `;
  $("mNote").focus(); refresh();
});

/* ---------- กล้อง (เฉพาะเข้างาน) ---------- */
async function openCam() {
  msg("mMsg", "");
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 960 } }, audio: false });
    const v = $("video");
    v.srcObject = stream;
    setVidClass(v);
    await v.play();
    gesture = GESTURES[Math.floor(Math.random() * GESTURES.length)];
    $("gesture").innerHTML = `<span class="e">${gesture.emoji}</span>ทำท่า: ${esc(gesture.text)} แล้วกดถ่ายรูป`;
    $("gesture").classList.remove("hidden");
    v.classList.remove("hidden"); $("camPh").classList.add("hidden"); $("shot").classList.add("hidden");
    $("btnCam").classList.add("hidden"); $("btnShoot").classList.remove("hidden"); $("btnRetake").classList.add("hidden");
  } catch (e) {
    msg("mMsg", "เปิดกล้องไม่ได้ — ตรวจสอบว่าเปิดด้วย Safari/Chrome และกดอนุญาตกล้องแล้ว");
  }
}
function stopCam() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  $("video").classList.add("hidden");
}
function resetPhoto() {
  stopCam(); photo = null; gesture = null;
  $("shot").classList.add("hidden"); $("shot").removeAttribute("src");
  $("camPh").classList.remove("hidden"); $("gesture").classList.add("hidden");
  $("btnCam").classList.remove("hidden"); $("btnShoot").classList.add("hidden"); $("btnRetake").classList.add("hidden");
  refresh();
}
$("btnCam").onclick = openCam;
$("btnRetake").onclick = () => { resetPhoto(); openCam(); };
$("btnFilter").onclick = () => {
  beauty = (beauty + 1) % LOOKS.length;
  try { localStorage.setItem("amci_look", String(beauty)); } catch (e) {}
  showBeauty();
};
/* ---------- ฟิลเตอร์โทนสีแบบ IG (filters.js) — พรีวิวกล้องใช้ CSS ใกล้เคียงกัน รูปที่บันทึกใช้ applyLook ---------- */
const LOOK_NAMES = ["ปิด", ...LOOKS.slice(1).map((p) => p.label)];
function setVidClass(v) { v.style.filter = (LOOKS[beauty] && LOOKS[beauty].css) || ""; }
function showBeauty() {
  $("btnFilter").textContent = `✨ ฟิลเตอร์: ${LOOK_NAMES[beauty]} (กดเพื่อเปลี่ยน)`;
  setVidClass($("video"));
}
try { const v = parseInt(localStorage.getItem("amci_look"), 10); if (v >= 0 && v < LOOKS.length) beauty = v; } catch (e) {}
setTimeout(showBeauty, 0);
$("btnShoot").onclick = () => {
  const v = $("video");
  if (!v.videoWidth) return;
  const W = 640, H = Math.round(W * (v.videoHeight / v.videoWidth)); // ความละเอียดสูงขึ้น ภาพคมขึ้น
  const c = $("canvas"), ctx = c.getContext("2d");
  c.width = W; c.height = H;
  ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1);
  ctx.drawImage(v, 0, 0, W, H);
  ctx.restore();
  if (beauty && LOOKS[beauty]) { const img = ctx.getImageData(0, 0, W, H); applyLook(img.data, W, H, LOOKS[beauty]); ctx.putImageData(img, 0, 0); }
  const b = curBranch();
  ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(0, H - 70, W, 70);
  ctx.fillStyle = "#fff"; ctx.font = "20px sans-serif";
  ctx.fillText(`${profile.name || ""} · ${b ? b.name : ""}`, 14, H - 42);
  ctx.fillText(`เข้างาน · ท่า: ${gesture.text} · ${new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}`, 14, H - 14);
  photo = c.toDataURL("image/jpeg", 0.75);
  if (photo.length > 280000) photo = c.toDataURL("image/jpeg", 0.55); // ไม่เกินขนาดที่ฐานข้อมูลรับได้
  stopCam();
  $("shot").src = photo; $("shot").classList.remove("hidden");
  $("btnShoot").classList.add("hidden"); $("btnRetake").classList.remove("hidden");
  refresh();
};
document.addEventListener("visibilitychange", () => { if (document.hidden && stream) resetPhoto(); });

/* ---------- ยืนยัน ---------- */
function canSubmit() {
  if (!pos || !curBranch() || type !== lockedType) return false;
  if (isOff()) { if (!placeOk() || noteText().length < NOTE_MIN) return false; }
  else if (!inRange) return false;
  if (type === "in") return !!photo;
  return true; // ออกงาน: ไม่ต้องถ่ายรูป
}
function refresh() {
  const btn = $("btnSubmit");
  let t = "ยืนยัน" + (type === "in" ? "เข้างาน" : "ออกงาน");
  if (isOff()) t += " · นอกสถานที่";
  btn.textContent = t;
  btn.disabled = !canSubmit();
}
// รายละเอียดหลังกดยืนยัน (ดีไซน์เดิม + บรรทัดแรกตามประเภท)
function showDone(t, off, b, reason, tin, demo) {
  const lines = [];
  if (demo) lines.push("🧪 ทดลอง (ไม่ได้บันทึกจริง)");
  let main = "", badge = "";
  if (type === "in") {
    main = [profile.name || "", profile.position || ""].filter(Boolean).join(" · ");
    lines.push(`เข้างาน · ${off ? "นอกพื้นที่สาขา · " + esc(placeLabel()) : "ในพื้นที่สาขา " + esc(b.name)}`);
    const info = shiftInfo(todayCode);
    lines.push(`เวลา ${fmtTime(t)} น.${info && !info.off ? " · กะ " + info.s : ""}`);
    if (info && !info.off) {
      const m = Math.round((t - shiftWindow(bkkDay(t), info).s) / 60000);
      badge = m > LATE_GRACE_MIN ? `<span class="badge2 late">สาย ${m} นาที</span>`
        : m < 0 ? `<span class="badge2 ok">ก่อนเวลา ${-m} นาที</span>` : `<span class="badge2 ok">ตรงเวลา${m > 0 ? ` (สาย ${m} นาที · อยู่ในเวลาผ่อนผัน)` : ""}</span>`;
    }
  } else {
    main = tin ? `รวมเวลาทำงาน ${fmtDur(t - tin)}` : "";
    lines.push(`ออกงาน · ${off ? "นอกพื้นที่สาขา · " + esc(placeLabel()) : "ในพื้นที่สาขา"}`);
    lines.push(`เวลา ${fmtTime(t)} น.`);
  }
  if (off && reason) lines.push(`เหตุผล: ${esc(reason)}`);
  $("doneMain").textContent = main;
  $("doneMain").classList.toggle("hidden", !main);
  $("doneText").innerHTML = lines.join("<br>");
  $("doneBadge").innerHTML = badge;
  $("done").classList.remove("hidden");
}
function resetForm() {
  $("mNote").value = ""; setPlaceMode("branch");
}
$("btnSubmit").onclick = async () => {
  if (!canSubmit()) return;
  const b = curBranch(), reason = noteText(), off = isOff(), tin = lastInTime();
  const note = (off ? `สถานที่: ${placeLabel()} · ${reason}` : reason).slice(0, 300);
  busy($("btnSubmit"), true, "กำลังบันทึก...");
  msg("mMsg", "");
  if (DEMO) {
    showDone(new Date(), off, b, reason, type === "out" ? new Date(Date.now() - 8.5 * 3600000) : null, true);
    $("donePhoto").src = photo || ""; $("donePhoto").classList.toggle("hidden", !(type === "in" && photo));
    resetForm(); resetPhoto(); busy($("btnSubmit"), false); refresh();
    return;
  }
  try {
    const ref = doc(collection(db, "checkins"));
    const batch = writeBatch(db);
    if (type === "in") batch.set(doc(db, "checkinPhotos", ref.id), { uid: me.uid, ts: serverTimestamp(), photo });
    const pd = off ? placeDist(place) : null;
    batch.set(ref, {
      uid: me.uid, name: profile.name || "", empId: profile.empId || "", position: profile.position || "",
      branchId: b.id, branchName: b.name || "", zoneId: b.zoneId || "", zm: `${b.zoneId || ""}_${bkkDay().slice(0, 7)}`, type, shiftCode: todayCode || "",
      ts: serverTimestamp(), day: bkkDay(),
      lat: pos.latitude, lng: pos.longitude, accuracy: Math.round(pos.accuracy), distance: Math.round(dist),
      gesture: type === "in" ? gesture.text : "", hasPhoto: type === "in", offsite: off, note, deviceId, ua: navigator.userAgent.slice(0, 300),
      ...(off ? { placeId: place.id, placeName: placeLabel().slice(0, 100), placeDist: pd === null ? -1 : Math.round(pd) } : {})
    });
    batch.update(doc(db, "users", me.uid), { lastType: type, lastAt: serverTimestamp() });
    await batch.commit();
    const s = await getDoc(ref);
    const t = s.data().ts && s.data().ts.toDate();
    profile.lastType = type; profile.lastAt = s.data().ts;
    $("donePhoto").classList.add("hidden");
    showDone(t, off, b, reason, tin, false);
    resetForm(); resetPhoto();
    applyLock();
    loadToday(); loadHistory();
  } catch (e) {
    msg("mMsg", e && e.code === "permission-denied"
      ? "ระบบปฏิเสธการบันทึก — ตรวจสถานะเข้า/ออก (อาจกดซ้ำจากเครื่องอื่น) แล้วเปิดหน้านี้ใหม่ หรือแจ้งหัวหน้า"
      : errText(e));
  }
  finally { busy($("btnSubmit"), false); refresh(); }
};
$("btnDone").onclick = () => $("done").classList.add("hidden");

/* ---------- ลืมออกงาน: ครบ 12 ชม. ระบบปิดให้ ---------- */
let autoInfo = null;
function checkAutoOut() {
  autoInfo = null;
  const tin = lastInTime();
  const need = !DEMO && profile.lastType === "in" && tin && Date.now() - tin.getTime() >= AUTO_OUT_H * 3600000;
  ["mainCard", "camCard", "btnSubmit"].forEach((id) => $(id).classList.toggle("hidden", !!need));
  $("autoCard").classList.toggle("hidden", !need);
  if (!need) return;
  const outAt = new Date(tin.getTime() + AUTO_OUT_H * 3600000), inDay = bkkDay(tin);
  autoInfo = { tin, outAt, inDay };
  $("autoText").textContent = `${new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "full" }).format(tin)} · ${curBranch() ? curBranch().name : ""}`;
  $("autoIn").textContent = hhmm(tin) + " น.";
  $("autoOut").textContent = hhmm(outAt) + " น.";
  autoRefresh();
}
const autoRefresh = () => { $("btnAuto").disabled = !(autoInfo && pos && curBranch() && $("autoNote").value.trim().length >= 10); };
$("autoNote").addEventListener("input", autoRefresh);
$("btnAuto").onclick = async () => {
  if (!autoInfo || $("btnAuto").disabled) return;
  const b = curBranch(), real = $("autoReal").value, reason = $("autoNote").value.trim();
  busy($("btnAuto"), true, "กำลังบันทึก...");
  try {
    const ref = doc(collection(db, "checkins")), batch = writeBatch(db);
    batch.set(ref, {
      uid: me.uid, name: profile.name || "", empId: profile.empId || "", position: profile.position || "",
      branchId: b.id, branchName: b.name || "", zoneId: b.zoneId || "", zm: `${b.zoneId || ""}_${autoInfo.inDay.slice(0, 7)}`, type: "out",
      shiftCode: normCode(monthDays[autoInfo.inDay] || ""), ts: serverTimestamp(), day: autoInfo.inDay,
      lat: pos.latitude, lng: pos.longitude, accuracy: Math.round(pos.accuracy), distance: Math.round(haversine(pos.latitude, pos.longitude, b.lat, b.lng)),
      gesture: "", hasPhoto: false, offsite: true, deviceId, ua: navigator.userAgent.slice(0, 300),
      note: `ลืมกดออก — ระบบปิดให้ ${hhmm(autoInfo.outAt)} · ออกจริง ${real || "ไม่ระบุ"} · ${reason}`.slice(0, 300),
      autoOut: true, outAt: autoInfo.outAt.getTime(), realOut: real || ""
    });
    batch.update(doc(db, "users", me.uid), { lastType: "out", lastAt: serverTimestamp() });
    await batch.commit();
    profile.lastType = "out";
    $("autoNote").value = ""; $("autoReal").value = "";
    checkAutoOut(); applyLock(); loadToday(); loadHistory();
    msg("mMsg", "ส่งให้ AM แล้ว — เข้างานวันนี้ได้เลย", "ok");
  } catch (e) { msg("autoMsg", errText(e)); }
  finally { busy($("btnAuto"), false); autoRefresh(); }
};

async function loadToday() {
  try {
    const q = query(collection(db, "checkins"), where("uid", "==", me.uid), where("day", "==", bkkDay()));
    const rows = (await getDocs(q)).docs.map((d) => d.data())
      .sort((a, b) => (a.ts ? a.ts.toMillis() : 0) - (b.ts ? b.ts.toMillis() : 0));
    $("today").innerHTML = rows.length
      ? rows.map((r) => `<li><span><span class="tag ${r.type}">${r.type === "in" ? "เข้างาน" : "ออกงาน"}</span> ${r.offsite ? `<span class="tag offsite">${r.type === "in" ? "นอกสถานที่" : "นอกพื้นที่"}</span>` : esc(r.branchName)}</span><b>${fmtTime(r.ts && r.ts.toDate())}</b></li>`).join("")
      : `<li class="muted">ยังไม่มีรายการ</li>`;
  } catch (e) { /* แสดงต่อได้แม้โหลดประวัติไม่สำเร็จ */ }
}

/* ---------- ขอสลับวัน / เปลี่ยนกะ ---------- */
let rqMode = "swap";
const dayLabel = (d) => new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", weekday: "short", day: "numeric", month: "short" }).format(new Date(d + "T12:00:00+07:00"));
function fillRequestForm() {
  const today = bkkDay();
  const days = Object.keys(monthDays).sort().filter((d) => d >= today);
  const opt = days.map((d) => `<option value="${d}">${dayLabel(d)} · ${esc(shiftLabel(monthDays[d]))}</option>`).join("") || `<option value="">— ยังไม่มีตารางกะ —</option>`;
  $("rqDayA").innerHTML = opt; $("rqDayB").innerHTML = opt;
  if (days[1]) $("rqDayB").value = days[1];
  $("rqCode").innerHTML = SHIFT_CHOICES.map((c) => `<option value="${c}">${esc(shiftLabel(c))}</option>`).join("");
}
$("rqMode").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  rqMode = b.dataset.v;
  [...$("rqMode").children].forEach((x) => x.classList.toggle("on", x === b));
  $("rqBWrap").classList.toggle("hidden", rqMode !== "swap");
  $("rqCodeWrap").classList.toggle("hidden", rqMode !== "change");
});
$("btnRq").onclick = async () => {
  const a = $("rqDayA").value, reason = $("rqReason").value.trim();
  if (!a) return msg("rqMsg", "ยังไม่มีตารางกะเดือนนี้ — ติดต่อหัวหน้า");
  if (reason.length < 5) return msg("rqMsg", "กรุณาระบุเหตุผล");
  let changes;
  if (rqMode === "swap") {
    const bDay = $("rqDayB").value;
    if (!bDay || bDay === a) return msg("rqMsg", "เลือกวันที่ต้องการสลับให้ต่างกัน");
    changes = { [a]: normCode(monthDays[bDay] || ""), [bDay]: normCode(monthDays[a] || "") };
  } else changes = { [a]: $("rqCode").value };
  const from = {}; Object.keys(changes).forEach((d) => (from[d] = normCode(monthDays[d] || "")));
  if (DEMO) return msg("rqMsg", "🧪 โหมดทดลอง: ของจริงคำขอนี้จะไปขึ้นที่แท็บ \"กะ & มาสาย/ขาด\" ของหัวหน้าให้กดอนุมัติ", "ok");
  busy($("btnRq"), true);
  try {
    await setDoc(doc(collection(db, "shiftRequests")), {
      uid: me.uid, name: profile.name || "", phoneKey: profile.phoneKey || "", zoneId: profile.zoneId || "",
      month: a.slice(0, 7), mode: rqMode, changes, from, reason, status: "pending", at: serverTimestamp()
    });
    msg("rqMsg", "ส่งคำขอแล้ว รอหัวหน้าอนุมัติ", "ok"); $("rqReason").value = "";
    loadRequests();
  } catch (e) { msg("rqMsg", errText(e)); }
  finally { busy($("btnRq"), false); }
};
const i_lbl = (c) => { const x = displayCode(c); return /^\d+$/.test(x) ? "กะ " + x : x; };
async function loadRequests() {
  try {
    const all = (await getDocs(query(collection(db, "shiftRequests"), where("uid", "==", me.uid)))).docs.map((d) => d.data());
    pendingDays = {}; all.filter((r) => r.status === "pending").forEach((r) => Object.assign(pendingDays, r.changes || {}));
    renderCal();
    const rows = all.sort((a, b) => (b.at ? b.at.toMillis() : 0) - (a.at ? a.at.toMillis() : 0)).slice(0, 5);
    const st = { pending: ["warn", "รออนุมัติ"], approved: ["in", "อนุมัติแล้ว"], rejected: ["off", "ไม่อนุมัติ"] };
    $("rqList").innerHTML = rows.map((r) => `<li><span>${Object.keys(r.changes || {}).sort().map((d) => `${dayLabel(d)} → ${esc(i_lbl(r.changes[d]))}`).join(", ")}</span><span class="tag ${(st[r.status] || st.pending)[0]}">${(st[r.status] || st.pending)[1]}</span></li>`).join("");
  } catch (e) {}
}

/* ---------- ตารางการทำงานของฉัน (เดือนนี้) ---------- */
async function loadHistory() {
  try {
    const month = bkkDay().slice(0, 7);
    if (!DEMO) monthRecs = (await getDocs(query(collection(db, "checkins"), where("uid", "==", me.uid)))).docs.map((d) => d.data())
      .filter((r) => r.ts && (r.day || "").startsWith(month)).map((r) => ({ ...r, t: r.autoOut && r.outAt ? new Date(r.outAt) : r.ts.toDate() }));
  } catch (e) { monthRecs = []; }
  renderCal();
}
function dayState(d) {
  const today = bkkDay(), code = normCode(monthDays[d] || ""), info = shiftInfo(code);
  const rs = monthRecs.filter((r) => r.day === d).sort((a, b) => a.t - b.t);
  const fin = rs.find((r) => r.type === "in"), lout = [...rs].reverse().find((r) => r.type === "out");
  const lines = [];
  if (info) lines.push(shiftLabel(code));
  if (fin) lines.push(`เข้างาน ${fmtTime(fin.t).slice(0, 5)}${lout ? ` · ออกงาน ${fmtTime(lout.t).slice(0, 5)}${lout.autoOut ? " (ระบบปิดให้)" : ""} · ทำงาน ${fmtDur(lout.t - fin.t)}` : ""}`);
  if (rs.some((r) => r.offsite)) lines.push("นอกสถานที่: " + rs.filter((r) => r.offsite && r.note).map((r) => r.note).join(" / "));
  let cls = "c-next", title = info ? "กะที่จะถึง" : "ไม่มีกะ", late = 0;
  if (pendingDays[d]) { cls = "c-wait"; title = "รออนุมัติ"; lines.push(`ขอเปลี่ยนเป็น ${i_lbl(pendingDays[d])} · รอ AM อนุมัติ`); }
  else if (info && info.off) { cls = /วันหยุด/.test(info.off) ? "c-off" : "c-leave"; title = info.off; }
  else if (info) {
    if (fin) {
      const m = Math.round((fin.t - shiftWindow(d, info).s) / 60000);
      if (m > LATE_GRACE_MIN) { cls = "c-late"; title = `มาสาย ${m} นาที`; late = m; } else { cls = "c-ok"; title = d === today ? "วันนี้ · เข้างานแล้ว" : "มาทำงานตรงเวลา"; }
    } else if (d < today) { cls = "c-abs"; title = "ขาดงาน"; }
    else if (d === today) { title = "วันนี้ · ยังไม่เข้างาน"; }
  }
  if (overrideDays.has(d) && !pendingDays[d]) { if (cls === "c-next" || cls === "c-off" || cls === "c-leave") cls = "c-swap"; title += " · สลับกะ (อนุมัติแล้ว)"; }
  return { cls, title, lines, fin, late, code: info ? (info.off ? (code.length <= 2 ? code : info.off.slice(0, 3)) : displayCode(code)) : "" };
}
function renderCal() {
  const day = bkkDay(), [y, m] = day.split("-").map(Number), last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  if (!calSel) calSel = day;
  let html = "<span></span>".repeat(first), work = 0, late = 0, lateMin = 0, abs = 0, leave = 0;
  for (let i = 1; i <= last; i++) {
    const d = `${day.slice(0, 7)}-${String(i).padStart(2, "0")}`, st = dayState(d);
    if (st.fin) work++;
    if (st.late) { late++; lateMin += st.late; }
    if (st.cls === "c-abs") abs++;
    if (st.cls === "c-leave") leave++;
    html += `<button type="button" data-d="${d}" class="${st.cls}${d === day ? " today" : ""}${d === calSel ? " sel" : ""}" aria-label="${i} · ${esc(st.title)}"><b>${i}</b><span>${esc(st.code)}</span></button>`;
  }
  $("cal").innerHTML = html;
  $("hStats").className = "stats sm";
  $("hStats").innerHTML = [["วันทำงาน", work], ["มาสาย", late ? `${late} · ${lateMin} น.` : 0], ["ขาดงาน", abs], ["ลา", leave]]
    .map(([l, v]) => `<div class="stat"><span class="muted">${l}</span><b>${v}</b></div>`).join("");
  const st = dayState(calSel);
  $("calDetail").innerHTML = `<span class="muted">${esc(dayLabel(calSel))}</span><b>${esc(st.title)}</b>${esc(st.lines.join("\n"))}`;
}
$("cal").addEventListener("click", (e) => { const b = e.target.closest("button[data-d]"); if (!b) return; calSel = b.dataset.d; renderCal(); });

function stopAll() {
  clearInterval(hoursTimer); hoursTimer = null;
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null; pos = null; inRange = false;
  stopCam();
}
