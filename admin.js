import { auth, db, $, fmtTime, fmtDateTime, bkkDay, errText, esc, busy, phoneKey, normCode, shiftInfo, shiftWindow, LATE_GRACE_MIN, displayCode, shiftLabel, mergeDays } from "./common.js";
import { firebaseConfig, OWNER_EMAIL, DEFAULT_RADIUS, TENANT_QS, GOOGLE_CLIENT_ID, TENANT_REGION } from "./firebase-config.js";
import * as CFG from "./firebase-config.js";
import { findTeam, goTeam } from "./teamfinder.js";
const MULTI_ZONE = CFG.MULTI_ZONE === true; // false = ใช้คนเดียว ไม่แบ่งเขต
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, orderBy, limit, startAfter, writeBatch, Timestamp, serverTimestamp, deleteField } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const SEED_BRANCHES = `5175, Bangkadi, , , 200
5052, Pathumthani, , , 200
5184, North Ratchapruek, , , 200
5015, Fortune, , , 200
5081, Lumlookka Klong2, , , 200
5183, Tiwanon, , , 200
5112, Pattanakarn Bangkok, , , 200
5037, Rangsit, , , 200
5104, Nakorn-In Bangkrauy, , , 200
5027, Rattanathibet, , , 200
5045, Bangyai, , , 200
6401, Bangkok - Phong Phet (BKK1), , , 200
5056, Baan Fah, , , 200
5162, Bang Kruay Sai Noi, , , 200`;

const SCREENS = ["scLoading", "scLogin", "scDenied", "scPanel"];
const screen = (id) => { SCREENS.forEach((s) => $(s).classList.toggle("hidden", s !== id)); $("btnLogout").classList.toggle("hidden", id === "scLogin" || id === "scLoading"); };
const msg = (id, t, k = "err") => { $(id).textContent = t || ""; $(id).className = "msg " + k; };

const STAFF_DOMAIN = ""; // ใส่ "lotuss.com" ถ้าต้องการบังคับโดเมนอีเมลพนักงาน ("" = ใช้อีเมลอะไรก็ได้)
let branches = [], allBranches = [], users = [], reportRows = [], zones = [], reportLoaded = false;
let me = { uid: "", role: "", zoneId: "", owner: false };
const isRM = () => me.owner || me.role === "rm" || me.role === "admin";
const bName = (id) => (allBranches.find((b) => b.id === id) || {}).name || id || "-";
const bZoneOf = (id) => (allBranches.find((b) => b.id === id) || {}).zoneId || "";
const zName = (id) => (zones.find((z) => z.id === id) || {}).name || id || "-";
const ROLE_LABEL = { rm: "RM / RL", admin: "RM / RL", am: "AM", staff: "พนักงาน", viewer: "RM (ดูอย่างเดียว)" };
const monthsBetween = (a, b) => { const out = []; let [y, m] = a.split("-").map(Number); const [y2, m2] = b.split("-").map(Number);
  while (y < y2 || (y === y2 && m <= m2)) { out.push(`${y}-${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; y++; } } return out; };
const nextMonth = (ym) => { let [y, m] = ym.split("-").map(Number); m++; if (m > 12) { m = 1; y++; } return `${y}-${String(m).padStart(2, "0")}`; };

/* ---------- auth ---------- */
onAuthStateChanged(auth, async (user) => {
  if (!user) return screen("scLogin");
  screen("scLoading");
  try {
    const ref = doc(db, "users", user.uid);
    let snap = await getDoc(ref);
    const isOwner = (user.email || "").toLowerCase() === OWNER_EMAIL.toLowerCase();
    if (!snap.exists() && isOwner) {
      await setDoc(ref, { name: "ผู้ดูแลระบบ", email: user.email, empId: "", position: "Area Mall Manager", branchId: "", zoneId: "", role: "rm", active: true, mustChangePassword: false, deviceId: "", createdAt: serverTimestamp() });
      snap = await getDoc(ref);
    }
    const p = snap.exists() ? snap.data() : {};
    me = { uid: user.uid, role: p.role || "", zoneId: p.zoneId || "", owner: isOwner, name: p.name || user.email };
    const allowed = isRM() || (me.role === "am" && me.zoneId && p.active !== false);
    if (p.role === "viewer") { $("scDenied").querySelector("p").innerHTML = `บัญชีนี้สำหรับดูสรุป — <a href="rm.html">ไปหน้าสรุป RM</a>`; return screen("scDenied"); }
    if (!allowed) { $("scDenied").querySelector("p").textContent = me.role === "am" ? "บัญชี AM นี้ยังไม่ได้กำหนดเขต — ติดต่อ RM" : "บัญชีนี้ไม่ใช่ผู้ดูแลระบบ"; return screen("scDenied"); }
    document.querySelectorAll(".rm-only").forEach((el) => el.classList.toggle("hidden", !isRM() || !MULTI_ZONE));
    if (!MULTI_ZONE) document.querySelectorAll("#uRole option[value=am]").forEach((o) => o.remove());
    screen("scPanel");
    await loadZones();
    $("whoami").textContent = !MULTI_ZONE ? "ผู้ดูแล" : isRM() ? "RM / RL" : `AM · ${zName(me.zoneId)}`;
    $("staffLink").textContent = new URL("./" + TENANT_QS, location.href).href;
    $("lnkDemo").href = "./" + (TENANT_QS ? TENANT_QS + "&demo=1" : "?demo=1");
    await loadBranches();
    await loadUsers();
    if (isRM()) loadZones();
    loadDevices();
    const today = bkkDay();
    $("rFrom").value = today; $("rTo").value = today;
    $("aMonth").value = today.slice(0, 7); $("roMonth").value = today.slice(0, 7); $("sMonth").value = today.slice(0, 7); $("aGrace").textContent = LATE_GRACE_MIN;
    runToday(); loadShiftRequests();
  } catch (e) { screen("scLogin"); msg("liMsg", e && e.code === "permission-denied" ? "ล็อกอินได้แต่ฐานข้อมูลปฏิเสธการอ่าน — ตรวจว่าวาง Rules ล่าสุดใน Firebase และกด Publish แล้ว" : errText(e)); }
});
$("btnLogin").onclick = async () => {
  busy($("btnLogin"), true);
  const email = $("liEmail").value.trim(), pw = $("liPw").value;
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
$("btnLogout").onclick = () => signOut(auth);

/* ---------- tabs ---------- */
$("tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  [...$("tabs").children].forEach((x) => x.classList.toggle("on", x === b));
  ["today", "report", "shifts", "roster", "devices", "users", "branches", "zones", "tools"].forEach((t) => $("t-" + t).classList.toggle("hidden", t !== b.dataset.t));
  if (b.dataset.t === "today") runToday();
  if (b.dataset.t === "report" && !reportLoaded) { reportLoaded = true; runReport(); }
  if (b.dataset.t === "shifts") { loadShiftRequests(); if (!att.sums.length) runAtt(); }
  if (b.dataset.t === "devices") loadDevices();
  if (b.dataset.t === "roster" && roster.month !== $("roMonth").value) runRoster();
  if (b.dataset.t === "zones") loadZones();
});

/* ---------- photo modal ---------- */
document.addEventListener("click", async (e) => {
  const img = e.target.closest("img.thumb");
  const pb = e.target.closest("button[data-pid]");
  if (!img && !pb) return;
  let src = img ? img.src : null;
  if (pb) {
    try {
      const s = await getDoc(doc(db, "checkinPhotos", pb.dataset.pid));
      src = s.exists() ? s.data().photo : null;
    } catch (err) { src = null; }
    if (!src) { alert("ไม่พบรูป (อาจถูกลบตามรอบลบรูปเก่าแล้ว)"); return; }
  }
  $("photoBig").src = src; $("photoCap").textContent = (img || pb).dataset.cap || "";
  $("photoModal").classList.remove("hidden");
});
$("btnPhotoClose").onclick = () => $("photoModal").classList.add("hidden");
$("photoModal").onclick = (e) => { if (e.target.id === "photoModal") $("photoModal").classList.add("hidden"); };

/* ================= สาขา ================= */
async function loadBranches() {
  allBranches = (await getDocs(collection(db, "branches"))).docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  branches = isRM() ? allBranches : allBranches.filter((b) => b.zoneId === me.zoneId);
  $("bCount").textContent = branches.length;
  const opts = branches.map((b) => `<option value="${esc(b.id)}">${esc(b.name)} (${esc(b.id)})</option>`).join("");
  $("rBranch").innerHTML = `<option value="">ทุกสาขา</option>` + opts;
  $("aBranch").innerHTML = `<option value="">ทุกสาขา</option>` + opts;
  $("roBranch").innerHTML = `<option value="">ทุกสาขา</option>` + opts;
  $("uBranch").innerHTML = `<option value="">— ไม่ระบุ —</option>` + opts;
  $("tBranches").innerHTML = `<tr><th>รหัส</th><th>ชื่อสาขา</th><th>เขต</th><th>พิกัด</th><th>รัศมี</th><th>แผนที่</th><th></th></tr>` +
    branches.map((b) => {
      const has = typeof b.lat === "number" && typeof b.lng === "number";
      return `<tr><td>${esc(b.id)}</td><td>${esc(b.name)}</td><td>${b.zoneId ? esc(zName(b.zoneId)) : `<span class="tag warn">ยังไม่กำหนด</span>`}</td>
        <td>${has ? `${b.lat.toFixed(6)}, ${b.lng.toFixed(6)}` : `<span class="tag off">ยังไม่มีพิกัด</span>`}</td>
        <td>${b.radius || DEFAULT_RADIUS} ม.</td>
        <td>${has ? `<a href="https://www.google.com/maps?q=${b.lat},${b.lng}" target="_blank" rel="noopener">เปิด</a>` : "-"}</td>
        <td class="actions"><button class="btn sm" data-bedit="${esc(b.id)}">แก้ไข</button><button class="btn sm danger" data-bdel="${esc(b.id)}">ลบ</button></td></tr>`;
    }).join("");
}
function parseNum(v) { const n = parseFloat(String(v).trim()); return Number.isFinite(n) ? n : null; }
$("bLat").addEventListener("input", () => {
  const m = $("bLat").value.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
  if (m) { $("bLat").value = m[1]; $("bLng").value = m[2]; }
});
$("btnBSave").onclick = async () => {
  const id = $("bCode").value.trim(), name = $("bName").value.trim();
  const lat = parseNum($("bLat").value), lng = parseNum($("bLng").value), radius = parseNum($("bRad").value) || DEFAULT_RADIUS;
  if (!id || !name) return msg("bMsg", "กรอกรหัสและชื่อสาขา");
  if (/[\/]/.test(id)) return msg("bMsg", "รหัสสาขาห้ามมีเครื่องหมาย /");
  if ((lat === null) !== (lng === null)) return msg("bMsg", "กรอก Latitude และ Longitude ให้ครบทั้งคู่");
  if (lat !== null && (lat < 5 || lat > 21 || lng < 97 || lng > 106)) return msg("bMsg", "พิกัดไม่อยู่ในประเทศไทย ตรวจสอบอีกครั้ง (lat ก่อน lng)");
  busy($("btnBSave"), true);
  try {
    if (isRM()) await setDoc(doc(db, "branches", id), { name, lat, lng, radius, zoneId: $("bZone").value || "" });
    else {
      const other = allBranches.find((b) => b.id === id && b.zoneId && b.zoneId !== me.zoneId);
      if (other) throw new Error(`สาขา ${id} อยู่ในเขต ${zName(other.zoneId)} — แก้ไขได้เฉพาะสาขาในเขตตัวเอง`);
      await setDoc(doc(db, "branches", id), { name, lat, lng, radius, zoneId: me.zoneId });
    }
    msg("bMsg", "บันทึกแล้ว", "ok"); clearBranchForm(); await loadBranches();
  }
  catch (e) { msg("bMsg", errText(e)); }
  finally { busy($("btnBSave"), false); }
};
function clearBranchForm() { ["bCode", "bName", "bLat", "bLng", "bRad"].forEach((i) => ($(i).value = "")); $("bCode").disabled = false; $("bName").disabled = false; $("bZone").value = ""; }
$("btnBClear").onclick = clearBranchForm;
$("btnBHere").onclick = () => {
  msg("bMsg", "กำลังหาตำแหน่ง...", "ok");
  navigator.geolocation.getCurrentPosition(
    (p) => { $("bLat").value = p.coords.latitude.toFixed(6); $("bLng").value = p.coords.longitude.toFixed(6); msg("bMsg", `ได้ตำแหน่งแล้ว (ความแม่นยำ ±${Math.round(p.coords.accuracy)} ม.)`, "ok"); },
    () => msg("bMsg", "หาตำแหน่งไม่ได้ — อนุญาตการใช้ตำแหน่งในเบราว์เซอร์ก่อน"),
    { enableHighAccuracy: true, timeout: 20000 }
  );
};
$("tBranches").addEventListener("click", async (e) => {
  const ed = e.target.dataset.bedit, del = e.target.dataset.bdel;
  if (ed) {
    const b = branches.find((x) => x.id === ed);
    $("bCode").value = b.id; $("bCode").disabled = true; $("bName").value = b.name || "";
    $("bLat").value = b.lat ?? ""; $("bLng").value = b.lng ?? ""; $("bRad").value = b.radius || DEFAULT_RADIUS;
    $("bZone").value = b.zoneId || "";
    $("bFormTitle").scrollIntoView({ behavior: "smooth" });
  }
  if (del && confirm(`ลบสาขา ${del}?`)) { await deleteDoc(doc(db, "branches", del)); loadBranches(); }
});
$("btnBSeed").onclick = () => { $("bBulk").value = SEED_BRANCHES; };
$("btnBBulk").onclick = async () => {
  const lines = $("bBulk").value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return msg("bBulkMsg", "ยังไม่มีข้อมูล");
  const batch = writeBatch(db); let n = 0; const bad = [];
  for (const l of lines) {
    // รูปแบบแบบฟอร์ม (คัดลอกจากแท็บ 1_สาขา): รหัสสาขา | ชื่อสาขา | Latitude | Longitude | รัศมี | ใช้งาน | เขต(รหัสทีม)
    const cols = (l.includes("\t") ? l.split("\t") : l.split(",")).map((s) => (s || "").trim());
    let [id, name, la, ln, r, act, z] = cols;
    if (/รหัสสาขา/.test(id)) continue; // แถวหัวตาราง
    if ((!ln) && /,/.test(la || "")) [la, ln] = la.split(",").map((s) => s.trim()); // "13.69, 100.64" ในช่องเดียว
    if (act && !/^(true|false|1|0|y|n|ใช่|ไม่)$/i.test(act)) { z = act; act = ""; } // รูปแบบเดิม: ช่องที่ 6 = รหัสเขต
    id = (String(id || "").match(/\d{3,5}/) || [""])[0];
    if (!id || !name) { bad.push(l); continue; }
    const data = { name, lat: parseNum(la), lng: parseNum(ln), radius: parseNum(r) || DEFAULT_RADIUS, active: !/^(false|0|n|ไม่)$/i.test(act || "") };
    if (!MULTI_ZONE) z = "";
    if (!isRM()) {
      const other = allBranches.find((b) => b.id === id && b.zoneId && b.zoneId !== me.zoneId);
      if (other) { bad.push(`${id} (อยู่เขตอื่น)`); continue; }
      data.zoneId = me.zoneId;
    } else if (z) data.zoneId = z;
    batch.set(doc(db, "branches", id), data, { merge: true });
    n++;
  }
  try { await batch.commit(); msg("bBulkMsg", `นำเข้า ${n} สาขา` + (bad.length ? ` · ข้าม ${bad.length} บรรทัดที่ข้อมูลไม่ครบ` : ""), "ok"); loadBranches(); }
  catch (e) { msg("bBulkMsg", errText(e)); }
};

/* ================= พนักงาน ================= */
let editingUid = null;
async function loadUsers() {
  const uq = isRM() ? collection(db, "users") : query(collection(db, "users"), where("zoneId", "==", me.zoneId));
  users = (await getDocs(uq)).docs.map((d) => ({ uid: d.id, ...d.data() }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "th"));
  $("uCount").textContent = users.length;
  $("tUsers").innerHTML = `<tr><th>ชื่อ</th><th>ชื่อเล่น</th><th>รหัส</th><th>อีเมล</th><th>เบอร์โทร</th><th>ตำแหน่ง</th><th>สาขาประจำ</th><th>สิทธิ์</th><th>สถานะ</th><th>เครื่อง</th><th></th></tr>` +
    users.map((u) => `<tr>
      <td>${esc(u.name)}</td><td>${esc(u.nickname)}</td><td>${esc(u.empId)}</td><td>${esc(u.email)}</td><td>${esc(u.phone)}</td><td>${esc(u.position)}</td><td>${esc(bName(u.branchId))}</td>
      <td>${ROLE_LABEL[u.role] || "พนักงาน"}</td>
      <td>${u.active === false ? `<span class="tag off">ระงับ</span>` : u.mustChangePassword ? `<span class="tag warn">ยังไม่เข้าครั้งแรก</span>` : `<span class="tag in">ใช้งาน</span>`}</td>
      <td>${devCell(u)}</td>
      <td class="actions">
        <button class="btn sm" data-uedit="${u.uid}">แก้ไข</button>
        <button class="btn sm" data-ureset="${u.uid}">รีเซ็ตเครื่อง</button>
        ${u.lastType === "in" ? `<button class="btn sm" data-uunlock="${u.uid}" title="กรณีพนักงานลืมออกงาน แล้วต้องเข้างานวันใหม่">ปลดล็อกให้กดเข้างานได้</button>` : ""}
        <button class="btn sm" data-upw="${u.uid}">ส่งลิงก์ตั้งรหัสใหม่</button>
        <button class="btn sm ${u.active === false ? "" : "danger"}" data-uact="${u.uid}">${u.active === false ? "เปิดใช้งาน" : "ระงับ"}</button>
        ${u.active === false && isRM() && u.uid !== me.uid ? `<button class="btn sm danger" data-udel="${u.uid}" title="ลบรายชื่อออกจากระบบ (ประวัติเข้า-ออกงานเดิมยังอยู่)">ลบรายชื่อ</button>` : ""}
      </td></tr>`).join("");
}
// รายละเอียดเครื่องที่ผูก (ระบบ/รุ่น/ช่องทาง) — เบอร์โทรจากซิม และรุ่น iPhone อ่านจากเว็บไม่ได้
const devText = (i) => i ? [i.os, i.model, i.browser, i.channel].filter(Boolean).join(" · ") : "";
function devCell(u) {
  const ids = (u.deviceIds && u.deviceIds.length) ? u.deviceIds : u.deviceId ? [u.deviceId] : [];
  if (!ids.length) return "-";
  const info = u.devices || {};
  return ids.map((id) => `<div class="dev">${esc(devText(info[id]) || "เครื่องเดิม (ไม่มีรายละเอียด)")}${info[id] && info[id].at ? ` <span class="muted">· ${fmtDateTime(info[id].at.toDate ? info[id].at.toDate() : new Date(info[id].at))}</span>` : ""}
    <button class="btn sm" data-udevdel="${u.uid}|${esc(id)}" title="ลบที่นี้">✕</button></div>`).join("");
}
function genPw() { const c = "abcdefghjkmnpqrstuvwxyz23456789"; return Array.from({ length: 8 }, () => c[Math.floor(Math.random() * c.length)]).join(""); }
$("btnUGen").onclick = () => { $("uPw").value = genPw(); };

async function createAuthUser(email, pw) {
  const sec = initializeApp(firebaseConfig, "sec-" + Date.now() + Math.random());
  const sa = getAuth(sec);
  try { return (await createUserWithEmailAndPassword(sa, email, pw)).user.uid; }
  finally { try { await signOut(sa); } catch {} await deleteApp(sec); }
}
async function addUser(d, pw) {
  const uid = await createAuthUser(d.email, pw);
  await setDoc(doc(db, "users", uid), { ...d, active: d.active !== false, mustChangePassword: true, deviceId: "", deviceIds: [], createdAt: serverTimestamp() });
}
function resetUserForm() {
  editingUid = null;
  ["uName", "uEmp", "uEmail", "uPw", "uPos", "uPhone", "uNick"].forEach((i) => ($(i).value = ""));
  $("uEmail").disabled = false; $("uPw").disabled = false; $("uRole").value = "staff"; $("uBranch").value = ""; $("uZone").value = "";
  $("uFormTitle").textContent = "เพิ่มพนักงาน"; $("btnUSave").textContent = "เพิ่มพนักงาน"; $("btnUCancel").classList.add("hidden");
}
$("btnUCancel").onclick = resetUserForm;
$("btnUSave").onclick = async () => {
  const d = { name: $("uName").value.trim(), empId: $("uEmp").value.trim(), email: $("uEmail").value.trim().toLowerCase(), position: $("uPos").value.trim(), branchId: $("uBranch").value, role: $("uRole").value,
    phone: $("uPhone").value.trim(), phoneKey: phoneKey($("uPhone").value), nickname: $("uNick").value.trim() };
  // พนักงานจากแบบฟอร์ม: จับคู่ตารางกะด้วยรหัสพนักงาน (ไม่ใช้เบอร์)
  const old = editingUid && users.find((x) => x.uid === editingUid);
  if ((old && String(old.phoneKey || "").startsWith("id")) || (!d.phoneKey && d.empId)) d.phoneKey = d.empId ? empKey(d.empId) : "";
  if (!d.name) return msg("uMsg", "กรอกชื่อ-นามสกุล");
  if (!isRM()) d.role = "staff";
  if (d.role === "rm") d.zoneId = "";
  else if (d.role === "am") d.zoneId = isRM() ? $("uZone").value : me.zoneId;
  else d.zoneId = bZoneOf(d.branchId) || (isRM() ? $("uZone").value : me.zoneId);
  if (d.role === "am" && !d.zoneId) return msg("uMsg", "AM ต้องเลือกเขต");
  if (!isRM() && d.zoneId !== me.zoneId) return msg("uMsg", "เลือกสาขาประจำที่อยู่ในเขตของคุณ");
  if (!editingUid && d.role === "staff" && STAFF_DOMAIN && !d.email.endsWith("@" + STAFF_DOMAIN)) return msg("uMsg", `อีเมลพนักงานต้องเป็น @${STAFF_DOMAIN}`);
  busy($("btnUSave"), true);
  try {
    if (editingUid) {
      const { email, ...rest } = d;
      await updateDoc(doc(db, "users", editingUid), rest);
      msg("uMsg", "บันทึกการแก้ไขแล้ว", "ok");
    } else {
      const pw = $("uPw").value.trim();
      if (!d.email) throw { message: "กรอกอีเมล" };
      if (pw.length < 6) throw { message: "รหัสผ่านเริ่มต้นต้องมีอย่างน้อย 6 ตัว" };
      await addUser(d, pw);
      msg("uMsg", `เพิ่ม ${d.name} แล้ว — แจ้งพนักงาน: อีเมล ${d.email} / รหัสผ่านเริ่มต้น ${pw}`, "ok");
    }
    resetUserForm(); await loadUsers();
  } catch (e) { msg("uMsg", errText(e)); }
  finally { busy($("btnUSave"), false); }
};
$("btnUBulk").onclick = async () => {
  const pw = $("uBulkPw").value.trim();
  if (pw.length < 6) return msg("uBulkMsg", "รหัสผ่านเริ่มต้นต้องมีอย่างน้อย 6 ตัว");
  const lines = $("uBulk").value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return msg("uBulkMsg", "ยังไม่มีข้อมูล");
  busy($("btnUBulk"), true);
  let ok = 0; const fail = [];
  const existing = new Set(users.map((u) => (u.email || "").toLowerCase()));
  let skip = 0;
  for (const l of lines) {
    const cols = l.split(l.includes("\t") ? "\t" : l.includes("|") ? "|" : l.includes(";") ? ";" : ",").map((s) => (s || "").trim());
    if (/^email|อีเมล/i.test(cols[0]) || /ชื่อ-นามสกุล/.test(cols[0])) continue; // แถวหัวตาราง
    let name, empId, email, position, branchId, phone = "", nickname = "", active = "";
    // รูปแบบแบบฟอร์ม (คัดลอกจากแท็บ 2_พนักงาน): Email | ชื่อ-นามสกุล | ตำแหน่ง | รหัสสาขาประจำ | ใช้งาน | รหัสพนักงาน
    if (cols[0].includes("@")) [email, name, position, branchId, active, empId] = cols;
    else [name, empId, email, position, branchId, phone, nickname] = cols; // รูปแบบเดิม
    empId = String(empId || "").replace(/\.0+$/, "");
    if (!name || !email || !email.includes("@")) { fail.push(`${name || l} (อ่านอีเมลไม่ได้ — คั่นข้อมูลด้วยจุลภาค , หรือคัดลอกจาก Excel)`); continue; }
    if (STAFF_DOMAIN && !email.toLowerCase().endsWith("@" + STAFF_DOMAIN)) { fail.push(`${email} (ต้องเป็น @${STAFF_DOMAIN})`); continue; }
    if (existing.has(email.toLowerCase())) { skip++; continue; }
    const bId = (String(branchId).match(/\d{4}/) || [""])[0];
    const zId = bZoneOf(bId) || (isRM() ? "" : me.zoneId);
    if (!isRM() && zId !== me.zoneId) { fail.push(`${name} (สาขา ${bId} ไม่อยู่ในเขตของคุณ)`); continue; }
    try { await addUser({ name, empId, email: email.toLowerCase(), position, branchId: bId, zoneId: zId, role: "staff", phone: phone || "", phoneKey: phone ? phoneKey(phone) : empId ? empKey(empId) : "", nickname: nickname || "", active: !/^(false|0|n|ไม่)$/i.test(active || "") }, pw); ok++; msg("uBulkMsg", `กำลังเพิ่ม... ${ok}/${lines.length}`, "ok"); }
    catch (e) { fail.push(`${email} (${errText(e)})`); }
  }
  busy($("btnUBulk"), false);
  msg("uBulkMsg", `เพิ่มสำเร็จ ${ok} คน` + (skip ? ` · ข้าม ${skip} คน (มีบัญชีอยู่แล้ว)` : "") + (fail.length ? ` · ไม่สำเร็จ: ${fail.join(" | ")}` : ""), fail.length ? "err" : "ok");
  loadUsers();
};
$("tUsers").addEventListener("click", async (e) => {
  const t = e.target.dataset;
  if (t.udevdel) {
    const [uid, id] = t.udevdel.split("|"); const u = users.find((x) => x.uid === uid); if (!u) return;
    if (!confirm(`ลบเครื่องนี้ออกจากบัญชี ${u.name}?\n${devText((u.devices || {})[id]) || id}`)) return;
    try {
      const left = (u.deviceIds || [u.deviceId]).filter((x) => x && x !== id);
      await updateDoc(doc(db, "users", uid), { deviceIds: left, deviceId: left[0] || "", ["devices." + id]: deleteField() }); loadUsers();
    } catch (err) { alert(errText(err)); }
    return;
  }
  const u = users.find((x) => x.uid === (t.uedit || t.ureset || t.upw || t.uact || t.uunlock || t.udel));
  if (!u) return;
  try {
    if (t.uedit) {
      editingUid = u.uid;
      $("uName").value = u.name || ""; $("uEmp").value = u.empId || ""; $("uEmail").value = u.email || ""; $("uEmail").disabled = true;
      $("uPw").value = ""; $("uPw").disabled = true; $("uPos").value = u.position || "";
      $("uPhone").value = u.phone || ""; $("uNick").value = u.nickname || ""; $("uBranch").value = u.branchId || ""; $("uRole").value = u.role === "admin" ? "rm" : u.role || "staff"; $("uZone").value = u.zoneId || "";
      $("uFormTitle").textContent = "แก้ไข: " + u.name; $("btnUSave").textContent = "บันทึกการแก้ไข"; $("btnUCancel").classList.remove("hidden");
      $("uFormTitle").scrollIntoView({ behavior: "smooth" });
    } else if (t.ureset) {
      if (!confirm(`รีเซ็ตเครื่องของ ${u.name}? เครื่องถัดไปที่เข้าใช้งาน (มือถือ) จะถูกผูกอัตโนมัติ`)) return;
      await updateDoc(doc(db, "users", u.uid), { deviceId: "", deviceIds: [], devices: {} }); loadUsers();
    } else if (t.uunlock) {
      if (!confirm(`${u.name} ยังค้างสถานะ "เข้างาน" (ลืมกดออกงาน)\nปลดล็อกให้กดเข้างานได้เลย? (แนะนำให้พนักงานกดออกงานพร้อมหมายเหตุแทน ถ้ายังทำได้)`)) return;
      await updateDoc(doc(db, "users", u.uid), { lastType: "out" }); loadUsers();
    } else if (t.upw) {
      await sendPasswordResetEmail(auth, u.email); alert(`ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่ ${u.email} แล้ว`);
    } else if (t.uact) {
      await updateDoc(doc(db, "users", u.uid), { active: u.active === false }); loadUsers();
    } else if (t.udel) {
      if (u.active !== false) return alert("ระงับรายชื่อนี้ก่อน แล้วจึงลบ");
      if (!confirm(`ลบ "${u.name || u.email || u.uid}" ออกจากรายชื่อพนักงาน?\n• ประวัติเข้า-ออกงานเดิมยังอยู่ในรายงาน\n• ลบแล้วกู้คืนไม่ได้`)) return;
      await deleteDoc(doc(db, "users", u.uid)); loadUsers();
    }
  } catch (err) { alert(errText(err)); }
});

/* ================= คำขอเปลี่ยนเครื่อง ================= */
async function loadDevices() {
  try {
    const dq = isRM() ? collection(db, "deviceRequests") : query(collection(db, "deviceRequests"), where("zoneId", "==", me.zoneId));
    const reqs = (await getDocs(dq)).docs.map((d) => ({ uid: d.id, ...d.data() }));
    $("devBadge").textContent = reqs.length; $("devBadge").classList.toggle("hidden", !reqs.length);
    $("tDev").innerHTML = reqs.length
      ? `<tr><th>ชื่อ</th><th>อีเมล</th><th>ประเภทเครื่อง</th><th>เวลาขอ</th><th>รายละเอียดเครื่อง</th><th></th></tr>` +
        reqs.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.email)}</td><td>${r.mobile ? "มือถือ/แท็บเล็ต" : "<b>คอมพิวเตอร์</b>"}</td>
          <td>${fmtDateTime(r.at && r.at.toDate())}</td><td class="wrap-txt">${r.info ? `<b>${esc(devText(r.info))}</b><br>` : ""}<span class="muted">${esc((r.ua || "").slice(0, 120))}</span></td>
          <td class="actions"><button class="btn sm primary" data-ok="${r.uid}">อนุมัติ</button><button class="btn sm danger" data-no="${r.uid}">ปฏิเสธ</button></td></tr>`).join("")
      : `<tr><td class="muted">ไม่มีคำขอ</td></tr>`;
    $("tDev").onclick = async (e) => {
      const ok = e.target.dataset.ok, no = e.target.dataset.no;
      try {
        if (ok) { const r = reqs.find((x) => x.uid === ok); await updateDoc(doc(db, "users", ok), { deviceId: r.deviceId, deviceIds: [r.deviceId], devices: r.info ? { [r.deviceId]: { ...r.info, at: serverTimestamp() } } : {} }); await deleteDoc(doc(db, "deviceRequests", ok)); }
        if (no) await deleteDoc(doc(db, "deviceRequests", no));
        if (ok || no) { loadDevices(); loadUsers(); }
      } catch (err) { alert(errText(err)); }
    };
  } catch (e) { $("tDev").innerHTML = `<tr><td class="msg err">${esc(errText(e))}</td></tr>`; }
}
$("btnDevReload").onclick = loadDevices;

/* ================= รายงาน ================= */
const dayStart = (s) => new Date(s + "T00:00:00+07:00");
async function runReport() {
  const from = $("rFrom").value, to = $("rTo").value;
  if (!from || !to) return msg("rMsg", "เลือกช่วงวันที่");
  const start = dayStart(from), end = new Date(dayStart(to).getTime() + 86400000);
  if (end <= start) return msg("rMsg", "วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด");
  if ((end - start) / 86400000 > 62) return msg("rMsg", "เลือกช่วงไม่เกิน 62 วันต่อครั้ง");
  busy($("btnReport"), true, "กำลังโหลด...");
  try {
    reportRows = (await fetchCheckins(start, end)).sort((a, b) => b.t - a.t);
    msg("rMsg", "");
    renderReport();
  } catch (e) { msg("rMsg", errText(e)); }
  finally { busy($("btnReport"), false); }
}
// RM: ดึงตามช่วงเวลา · AM: ดึงเฉพาะเขตตัวเอง (ตามเดือน) แล้วกรองเวลา
async function fetchCheckins(start, end) {
  let docs;
  if (isRM()) docs = (await getDocs(query(collection(db, "checkins"), where("ts", ">=", Timestamp.fromDate(start)), where("ts", "<", Timestamp.fromDate(end)), orderBy("ts")))).docs;
  else {
    const ms = monthsBetween(bkkDay(start), bkkDay(new Date(end.getTime() - 1))).map((m) => `${me.zoneId}_${m}`).slice(0, 10);
    docs = (await getDocs(query(collection(db, "checkins"), where("zoneId", "==", me.zoneId), where("zm", "in", ms)))).docs;
  }
  return docs.map((d) => { const x = d.data(); return { id: d.id, ...x, t: x.autoOut && x.outAt ? new Date(x.outAt) : x.ts ? x.ts.toDate() : null }; }).filter((r) => r.t && r.t >= start && r.t < end);
}
// ตัวกรองประเภท (เข้า/ออก) ใช้กับ "ทุกรายการ" เท่านั้น — สรุปรายคนต้องเห็นทั้งเข้าและออก
function filtered(withType = false) {
  const br = $("rBranch").value, ty = withType ? $("rType").value : "", s = $("rSearch").value.trim().toLowerCase(), z = isRM() ? $("rZone").value : "";
  return reportRows.filter((r) => (!z || (r.zoneId || bZoneOf(r.branchId)) === z) && (!br || r.branchId === br) && (!ty || r.type === ty) && (!s || `${r.name} ${r.empId}`.toLowerCase().includes(s)));
}
let sumFilter = "all";
const SUM_FILTERS = [["all", "ทั้งหมด"], ["noOut", "ยังไม่ออกงาน"], ["noIn", "ไม่มีเข้างาน"], ["complete", "ครบเข้า-ออก"], ["offsite", "นอกสถานที่"]];
const sumOk = (g) => sumFilter === "all" || (sumFilter === "noOut" ? g.firstIn && !g.lastOut : sumFilter === "noIn" ? !g.firstIn : sumFilter === "complete" ? g.firstIn && g.lastOut : g.offsite);
function summarize(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = r.uid + "|" + r.day;
    if (!m.has(k)) m.set(k, { day: r.day, name: r.name, empId: r.empId, position: r.position, branches: new Set(), firstIn: null, lastOut: null, count: 0, offsite: false, notes: [] });
    const g = m.get(k); g.count++; g.branches.add(r.branchName);
    if (r.offsite) { g.offsite = true; if (r.note) g.notes.push(r.note); }
    if (r.type === "in" && r.t && (!g.firstIn || r.t < g.firstIn)) g.firstIn = r.t;
    if (r.type === "out" && r.t && (!g.lastOut || r.t > g.lastOut)) g.lastOut = r.t;
  }
  return [...m.values()].map((g) => ({ ...g, branches: [...g.branches].join(", "),
    hours: g.firstIn && g.lastOut && g.lastOut > g.firstIn ? ((g.lastOut - g.firstIn) / 3600000) : null }))
    .sort((a, b) => b.day.localeCompare(a.day) || String(a.name).localeCompare(String(b.name), "th"));
}
function renderReport() {
  const rows = filtered(), sumAll = summarize(rows), sum = sumAll.filter(sumOk), raw = filtered(true);
  const sc = Object.fromEntries(SUM_FILTERS.map(([k]) => [k, 0]));
  sumAll.forEach((g) => SUM_FILTERS.forEach(([k]) => { const keep = sumFilter; sumFilter = k; if (sumOk(g)) sc[k]++; sumFilter = keep; }));
  $("rChips").innerHTML = SUM_FILTERS.map(([k, l]) => `<button type="button" data-f="${k}" class="${sumFilter === k ? "on" : ""}">${l} (${sc[k]})</button>`).join("");
  const people = new Set(rows.map((r) => r.uid)).size;
  const noOut = sumAll.filter((s) => s.firstIn && !s.lastOut).length;
  $("rStats").innerHTML = `<div class="stat"><span class="muted">รายการทั้งหมด</span><b>${rows.length}</b></div>
    <div class="stat"><span class="muted">จำนวนคน</span><b>${people}</b></div>
    <div class="stat"><span class="muted">เข้างาน</span><b>${rows.filter((r) => r.type === "in").length}</b></div>
    <div class="stat"><span class="muted">ออกงาน</span><b>${rows.filter((r) => r.type === "out").length}</b></div>
    <div class="stat"><span class="muted">ยังไม่ลงออกงาน (คน-วัน)</span><b>${noOut}</b></div>
    <div class="stat"><span class="muted">นอกสถานที่ (รอตรวจ)</span><b>${rows.filter((r) => r.offsite && !r.reviewed).length}</b></div>`;
  $("tSum").innerHTML = `<tr><th>วันที่</th><th>ชื่อ</th><th>รหัส</th><th>สาขา</th><th>เข้างาน</th><th>ออกงาน</th><th>ชั่วโมง</th></tr>` +
    (sum.map((s) => `<tr><td>${s.day}</td><td>${esc(s.name)}</td><td>${esc(s.empId)}</td><td>${esc(s.branches)}</td>
      <td>${s.firstIn ? fmtTime(s.firstIn) : `<span class="tag warn">ไม่มี</span>`}</td>
      <td>${s.lastOut ? fmtTime(s.lastOut) : `<span class="tag warn">ไม่มี</span>`}</td>
      <td>${s.hours != null ? s.hours.toFixed(2) : "-"}</td></tr>`).join("") || `<tr><td class="muted" colspan="7">ไม่มีข้อมูล</td></tr>`);
  $("sumCards").innerHTML = sum.map((s) => `<div class="pcard"><div class="top"><b>${esc(s.name)}</b><span class="sub">${s.day}</span></div>
    <div class="sub">${esc(s.branches)} · เข้า ${s.firstIn ? fmtTime(s.firstIn).slice(0, 5) : `<span class="tag warn">ไม่มี</span>`} · ออก ${s.lastOut ? fmtTime(s.lastOut).slice(0, 5) : `<span class="tag warn">ยังไม่ออก</span>`}${s.hours != null ? ` · ${s.hours.toFixed(1)} ชม.` : ""}</div>
    ${s.offsite ? `<div class="sub"><span class="tag offsite">นอกสถานที่</span> ${esc(s.notes.join(" / "))}</div>` : ""}</div>`).join("") || `<p class="muted">ไม่มีข้อมูล</p>`;
  $("tRaw").innerHTML = `<tr><th>รูป</th><th>วัน-เวลา</th><th>ชื่อ</th><th>ประเภท</th><th>สาขา</th><th>ระยะ</th><th>ท่า</th><th>หมายเหตุ</th><th>แผนที่</th></tr>` +
    (raw.map((r) => `<tr>
      <td>${r.photo ? `<img class="thumb" loading="lazy" src="${r.photo}" data-cap="${esc(r.name)} · ${esc(r.gesture)} · ${esc(fmtDateTime(r.t))}">`
        : r.hasPhoto ? `<button class="btn sm" data-pid="${r.id}" data-cap="${esc(r.name)} · ท่า: ${esc(r.gesture)} · ${esc(fmtDateTime(r.t))}">📷 ดูรูป</button>` : `<span class="muted">-</span>`}</td>
      <td>${fmtDateTime(r.t)}</td><td>${esc(r.name)}</td>
      <td><span class="tag ${r.type}">${r.type === "in" ? "เข้างาน" : "ออกงาน"}</span>${r.offsite ? ` <span class="tag offsite">นอกสถานที่</span>` : ""}</td>
      <td>${esc(r.branchName)}</td><td>${r.distance != null ? fmtDistM(r.distance) : "-"} (±${r.accuracy ?? "-"})</td><td>${esc(r.gesture)}</td>
      <td class="wrap-txt">${esc(r.note || "")}${r.offsite ? (r.reviewed ? ` <span class="tag in">ตรวจแล้ว</span>` : ` <button class="btn sm" data-review="${r.id}">✓ ตรวจแล้ว</button>`) : ""}</td>
      <td><a href="https://www.google.com/maps?q=${r.lat},${r.lng}" target="_blank" rel="noopener">ดู</a></td></tr>`).join("") || `<tr><td class="muted" colspan="9">ไม่มีข้อมูล</td></tr>`);
}
const fmtDistM = (m) => (m >= 1000 ? (m / 1000).toFixed(1) + " กม." : m + " ม.");
$("tRaw").addEventListener("click", async (e) => {
  const id = e.target.dataset && e.target.dataset.review; if (!id) return;
  try { await updateDoc(doc(db, "checkins", id), { reviewed: true }); const r = reportRows.find((x) => x.id === id); if (r) r.reviewed = true; renderReport(); }
  catch (err) { alert(errText(err)); }
});
$("btnReport").onclick = runReport;
["rBranch", "rType", "rZone"].forEach((i) => $(i).addEventListener("change", renderReport));
$("rSearch").addEventListener("input", renderReport);
$("rChips").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; sumFilter = b.dataset.f; renderReport(); });
$("rZone").addEventListener("change", () => { if (todayRows.length) renderToday(); });

function downloadCsv(name, header, rows) {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = "﻿" + [header, ...rows].map((r) => r.map(q).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
$("btnCsvSum").onclick = () => {
  const s = summarize(filtered()).filter(sumOk);
  downloadCsv(`${bkkDay()}_สรุปเข้าออกงาน_${$("rFrom").value}_${$("rTo").value}.csv`,
    ["วันที่", "ชื่อ", "รหัสพนักงาน", "ตำแหน่ง", "สาขา", "เข้างาน", "ออกงาน", "ชั่วโมง"],
    s.map((x) => [x.day, x.name, x.empId, x.position, x.branches, x.firstIn ? fmtTime(x.firstIn) : "", x.lastOut ? fmtTime(x.lastOut) : "", x.hours != null ? x.hours.toFixed(2) : ""]));
};
$("btnCsvRaw").onclick = () => {
  downloadCsv(`${bkkDay()}_รายการเข้าออกงาน_${$("rFrom").value}_${$("rTo").value}.csv`,
    ["วันที่", "เวลา", "ชื่อ", "รหัสพนักงาน", "ประเภท", "รหัสสาขา", "สาขา", "ระยะจากสาขา(ม.)", "ความแม่นยำ GPS(ม.)", "ท่า", "นอกสถานที่", "หมายเหตุ", "lat", "lng"],
    filtered(true).slice().reverse().map((r) => [r.day, fmtTime(r.t), r.name, r.empId, r.type === "in" ? "เข้างาน" : "ออกงาน", r.branchId, r.branchName, r.distance, r.accuracy, r.gesture, r.offsite ? "ใช่" : "", r.note || "", r.lat, r.lng]));
};

/* ================= ลบรูปเก่า ================= */
$("btnPurge").onclick = async () => {
  const days = parseInt($("pDays").value, 10);
  if (!(days >= 7)) return msg("pMsg", "กำหนดอย่างน้อย 7 วัน");
  if (!confirm(`ลบรูปเซลฟี่ที่เก่ากว่า ${days} วัน? (กู้คืนไม่ได้)`)) return;
  const cutoff = Timestamp.fromDate(new Date(Date.now() - days * 86400000));
  busy($("btnPurge"), true);
  let total = 0;
  try {
    if (!isRM()) {
      // AM: ลบเฉพาะรูปของเช็กอินในเขตตัวเอง
      const old = (await getDocs(query(collection(db, "checkins"), where("zoneId", "==", me.zoneId)))).docs
        .filter((d) => d.data().ts && d.data().ts.toMillis() < cutoff.toMillis() && d.data().hasPhoto !== false);
      for (let i = 0; i < old.length; i += 400) {
        const batch = writeBatch(db);
        old.slice(i, i + 400).forEach((d) => { batch.delete(doc(db, "checkinPhotos", d.id)); batch.update(d.ref, { hasPhoto: false }); });
        await batch.commit(); total += Math.min(400, old.length - i);
        msg("pMsg", `ลบแล้ว ${total} รูป...`, "ok");
      }
      msg("pMsg", `เสร็จแล้ว ลบรูปทั้งหมด ${total} รูป (เฉพาะเขต ${zName(me.zoneId)})`, "ok");
      return;
    }
    // รูปที่แยกเก็บใน checkinPhotos
    for (;;) {
      const snap = await getDocs(query(collection(db, "checkinPhotos"), where("ts", "<", cutoff), orderBy("ts"), limit(300)));
      if (snap.empty) break;
      const batch = writeBatch(db);
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit(); total += snap.size;
      msg("pMsg", `ลบแล้ว ${total} รูป...`, "ok");
      if (snap.size < 300) break;
    }
    // รูปแบบเก่าที่เก็บในรายการเช็กอิน
    let lastDoc = null;
    for (;;) {
      const parts = [collection(db, "checkins"), where("ts", "<", cutoff), orderBy("ts")];
      if (lastDoc) parts.push(startAfter(lastDoc));
      parts.push(limit(300));
      const snap = await getDocs(query(...parts));
      if (snap.empty) break;
      lastDoc = snap.docs[snap.docs.length - 1];
      const withPhoto = snap.docs.filter((d) => d.data().photo);
      if (withPhoto.length) {
        const batch = writeBatch(db);
        withPhoto.forEach((d) => batch.update(d.ref, { photo: null }));
        await batch.commit(); total += withPhoto.length;
        msg("pMsg", `ลบแล้ว ${total} รูป...`, "ok");
      }
      if (snap.size < 300) break;
    }
    msg("pMsg", `เสร็จแล้ว ลบรูปทั้งหมด ${total} รูป`, "ok");
  } catch (e) { msg("pMsg", errText(e)); }
  finally { busy($("btnPurge"), false); }
};

/* ================= ตารางกะ: อัปโหลด ================= */
let parsedShift = null;
async function loadXLSX() {
  if (window.XLSX) return window.XLSX;
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload = res; s.onerror = () => rej(new Error("โหลดตัวอ่าน Excel ไม่สำเร็จ"));
    document.head.appendChild(s);
  });
  return window.XLSX;
}
const serialToDay = (n) => new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);
const cleanName = (s) => String(s ?? "").replace(/^\s*(คุณ|นางสาว|นาย|นาง|น\.ส\.)\s*/, "").replace(/\s+/g, " ").trim();

function parseShiftRows(rows) {
  const h = rows.findIndex((r) => r && String(r[0] ?? "").trim().toLowerCase() === "store");
  if (h < 1) throw new Error('ไม่พบหัวตาราง "Store" ในคอลัมน์ A');
  const cols = [];
  (rows[h - 1] || []).forEach((v, i) => { if (i >= 6 && typeof v === "number" && v > 40000 && v < 80000) cols.push([i, serialToDay(v)]); });
  if (!cols.length) throw new Error("ไม่พบแถววันที่เหนือหัวตาราง");
  const out = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const store = String(r[0] ?? "").trim();
    if (!store) { if (out.length) break; continue; }
    const days = {};
    cols.forEach(([c, d]) => { const v = normCode(r[c]); if (v) days[d] = v; });
    const first = cleanName(r[1]), last = cleanName(r[2]);
    const bId = (store.match(/\d{4}/) || [""])[0];
    out.push({ store, branchId: bId, zoneId: bZoneOf(bId), name: `${first} ${last}`.trim(), nickname: String(r[3] ?? "").trim(),
      position: String(r[4] ?? "").trim(), phone: String(r[5] ?? "").trim(), phoneKey: phoneKey(r[5]), days });
  }
  const months = [...new Set(cols.map((c) => c[1].slice(0, 7)))];
  return { rows: out, month: months.sort((a, b) => cols.filter((c) => c[1].startsWith(b)).length - cols.filter((c) => c[1].startsWith(a)).length)[0] };
}

$("sFile").onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  parsedShift = null; $("btnSSave").classList.add("hidden"); $("tShiftPrev").innerHTML = "";
  msg("sMsg", "กำลังอ่านไฟล์...", "ok");
  try {
    const XLSX = await loadXLSX();
    const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
    const formSheet = wb.SheetNames.find((n) => n.includes("ตารางกะ") && /^\d_/.test(n)) || (isFormShiftSheet(wb.Sheets[wb.SheetNames[0]], XLSX) ? wb.SheetNames[0] : null);
    if (formSheet) {
      const month = formMonth(wb, XLSX) || $("sMonth").value;
      if (!month) throw new Error("ไฟล์แบบฟอร์ม: เลือก \"เดือนของตารางกะ\" ก่อนอัปโหลด");
      $("sMonth").value = month;
      parsedShift = { month, rows: parseFormShift(sheetRows(wb, formSheet, XLSX), month, []) };
    } else {
      const ws = wb.Sheets[wb.SheetNames[0]];
      parsedShift = parseShiftRows(XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }));
    }
    const byPhone = new Map(users.filter((u) => u.phoneKey).map((u) => [u.phoneKey, u]));
    let matched = 0;
    $("tShiftPrev").innerHTML = `<tr><th>สาขา</th><th>ชื่อ</th><th>ชื่อเล่น</th><th>เบอร์โทร</th><th>จำนวนวัน</th><th>บัญชีในระบบ</th><th>รหัสกะที่ไม่รู้จัก</th></tr>` +
      parsedShift.rows.map((r) => {
        const u = byPhone.get(r.phoneKey); if (u) matched++;
        const outZone = !isRM() && r.zoneId && r.zoneId !== me.zoneId;
        const unknown = [...new Set(Object.values(r.days).filter((c) => !shiftInfo(c)))];
        return `<tr><td>${esc(r.store)}</td><td>${esc(r.name)}</td><td>${esc(r.nickname)}</td><td>${esc(r.phone || (r.empId ? "รหัส " + r.empId : ""))}</td><td>${Object.keys(r.days).length}</td>
          <td>${outZone ? `<span class="tag off">นอกเขตของคุณ — ข้าม</span>` : !r.phoneKey ? `<span class="tag off">ไม่มีเบอร์</span>` : u ? `<span class="tag in">${esc(u.email)}</span>` : `<span class="tag warn">ยังไม่มีบัญชี</span>`}</td>
          <td>${unknown.length ? `<span class="tag warn">${esc(unknown.join(", "))}</span>` : "-"}</td></tr>`;
      }).join("");
    msg("sMsg", `เดือน ${parsedShift.month} · พนักงาน ${parsedShift.rows.length} คน · จับคู่บัญชีได้ ${matched} คน (คนที่ยังไม่มีบัญชี บันทึกกะไว้ก่อนได้ เพิ่มบัญชีทีหลังจะจับคู่ให้อัตโนมัติด้วยเบอร์โทร/รหัสพนักงาน)`, "ok");
    $("btnSSave").classList.remove("hidden");
  } catch (err) { msg("sMsg", errText(err)); }
};
$("btnSSave").onclick = async () => {
  if (!parsedShift) return;
  if (!isRM()) parsedShift.rows.forEach((r) => { if (!r.zoneId) r.zoneId = me.zoneId; });
  const rows = parsedShift.rows.filter((r) => r.phoneKey && (isRM() || r.zoneId === me.zoneId));
  busy($("btnSSave"), true);
  try {
    await saveShiftRows(parsedShift.month, rows);
    msg("sMsg", `บันทึกตารางกะเดือน ${parsedShift.month} แล้ว ${rows.length} คน` + (rows.length < parsedShift.rows.length ? ` · ข้าม ${parsedShift.rows.length - rows.length} คน (ไม่มีเบอร์โทร/อยู่นอกเขต)` : ""), "ok");
    $("btnSSave").classList.add("hidden");
    $("aMonth").value = parsedShift.month;
  } catch (err) { msg("sMsg", errText(err)); }
  finally { busy($("btnSSave"), false); }
};

/* ================= แบบฟอร์มข้อมูลทีม (สำหรับ AM) ================= */
const empKey = (id) => "id" + String(id ?? "").replace(/\.0+$/, "").trim();
const cellStr = (v) => (v == null ? "" : String(v).replace(/\.0+$/, "").trim());
const truthy = (v) => !(v === false || /^(false|0|no|ไม่|n)$/i.test(String(v ?? "").trim()));
const sheetRows = (wb, name, XLSX) => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
const findSheet = (wb, key) => wb.SheetNames.find((n) => n.includes(key));
function isFormShiftSheet(ws, XLSX) { const r = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }); return r.some((x) => x && cellStr(x[0]) === "รหัสพนักงาน"); }
// เดือนจากแท็บ 0_ข้อมูลAM ("เดือนแรกที่เริ่มใช้")
function formMonth(wb, XLSX) {
  const n = findSheet(wb, "ข้อมูลAM"); if (!n) return "";
  const row = sheetRows(wb, n, XLSX).find((r) => r && String(r[0] ?? "").includes("เดือน"));
  if (!row) return "";
  const v = row[1];
  if (typeof v === "number" && v > 40000) return serialToDay(v).slice(0, 7);
  if (v instanceof Date) return v.toISOString().slice(0, 7);
  const m = String(v ?? "").match(/(\d{4})[-/.](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}` : "";
}
// แท็บ 3_ตารางกะ: รหัสพนักงาน | ชื่อ | 1 … 31
function parseFormShift(rows, month, formStaff) {
  const h = rows.findIndex((r) => r && cellStr(r[0]) === "รหัสพนักงาน");
  if (h < 0) throw new Error('ไม่พบหัวตาราง "รหัสพนักงาน" ในแท็บตารางกะ');
  const [y, mo] = month.split("-").map(Number), last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const cols = [];
  (rows[h] || []).forEach((v, i) => { const d = Number(cellStr(v)); if (i >= 2 && Number.isInteger(d) && d >= 1 && d <= last) cols.push([i, `${month}-${String(d).padStart(2, "0")}`]); });
  if (!cols.length) throw new Error("ไม่พบคอลัมน์วันที่ 1–31 ในแท็บตารางกะ");
  const out = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] || [], empId = cellStr(r[0]);
    if (!empId) continue;
    const days = {};
    cols.forEach(([c, d]) => { const v = normCode(cellStr(r[c])); if (v) days[d] = v; });
    const u = users.find((x) => cellStr(x.empId) === empId) || formStaff.find((x) => x.empId === empId) || {};
    const bId = u.branchId || "";
    out.push({ store: bId ? `${bId} ${bName(bId)}` : "", branchId: bId, zoneId: u.zoneId || bZoneOf(bId) || (isRM() ? "" : me.zoneId), name: cellStr(r[1]) || u.name || "",
      nickname: u.nickname || "", position: u.position || "", phone: "", phoneKey: empKey(empId), empId, days });
  }
  return out;
}
async function saveShiftRows(month, rows) {
  for (let i = 0; i < rows.length; i += 400) {
    const batch = writeBatch(db);
    rows.slice(i, i + 400).forEach((r) => batch.set(doc(db, "shifts", `${month}_${r.phoneKey}`), { ...r, month, updatedAt: serverTimestamp() }));
    await batch.commit();
  }
}
const SAMPLE = { emails: ["somchai@gmail.com"], branches: ["5001"] }; // แถวตัวอย่างในแบบฟอร์ม
let formData = null;
$("fFile").onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  formData = null; $("fGo").classList.add("hidden"); $("fPrev").innerHTML = ""; msg("fMsg", "กำลังอ่านไฟล์...", "ok");
  try {
    const XLSX = await loadXLSX();
    const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
    const sB = findSheet(wb, "สาขา"), sS = findSheet(wb, "พนักงาน"), sT = findSheet(wb, "ตารางกะ");
    if (!sB || !sS) throw new Error("ไม่ใช่ไฟล์แบบฟอร์ม — ต้องมีแท็บ 1_สาขา และ 2_พนักงาน");
    const warn = [];
    // สาขา
    const br = [];
    sheetRows(wb, sB, XLSX).slice(1).forEach((r) => {
      const id = (cellStr(r[0]).match(/\d{3,5}/) || [""])[0]; if (!id) return;
      let lat = r[2], lng = r[3];
      if ((lng == null || lng === "") && /,/.test(String(lat))) [lat, lng] = String(lat).split(",");
      lat = parseFloat(String(lat ?? "").trim()); lng = parseFloat(String(lng ?? "").trim());
      const b = { id, name: cellStr(r[1]), lat: Number.isFinite(lat) ? lat : null, lng: Number.isFinite(lng) ? lng : null, radius: parseFloat(cellStr(r[4])) || DEFAULT_RADIUS, active: truthy(r[5]), team: cellStr(r[6]), sample: SAMPLE.branches.includes(id) && /^\s*13\.69412\s*,\s*100\.64817\s*$/.test(String(r[2] ?? "")) }; // แถวตัวอย่าง = พิกัดตัวอย่างเป๊ะ (สาขา 5001 จริงไม่ถูกข้าม)
      const exB = allBranches.find((x) => x.id === id);
      if (!b.sample && (b.lat == null || b.lng == null) && !(exB && typeof exB.lat === "number")) warn.push(`สาขา ${id} ${b.name}: ยังไม่มีพิกัด (เช็กอินที่สาขานี้ไม่ได้จนกว่าจะใส่)`);
      br.push(b);
    });
    // พนักงาน
    const st = [], seen = new Set();
    sheetRows(wb, sS, XLSX).slice(1).forEach((r) => {
      const email = cellStr(r[0]).toLowerCase(), name = cellStr(r[1]); if (!email && !name) return;
      const s = { email, name, position: cellStr(r[2]), branchId: (cellStr(r[3]).match(/\d{3,5}/) || [""])[0], active: truthy(r[4]), empId: cellStr(r[5]), sample: SAMPLE.emails.includes(email) && cellStr(r[5]) === "40012345" };
      if (s.sample) { st.push(s); return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) warn.push(`${name || "(ไม่มีชื่อ)"}: อีเมลไม่ถูกต้อง — ข้าม`);
      else if (seen.has(email)) warn.push(`${email}: อีเมลซ้ำในไฟล์ — ใช้แถวแรก`);
      if (!s.empId) warn.push(`${name}: ไม่มีรหัสพนักงาน (จับคู่ตารางกะไม่ได้)`);
      if (s.branchId && !br.some((b) => b.id === s.branchId) && !allBranches.some((b) => b.id === s.branchId)) warn.push(`${name}: สาขา ${s.branchId} ไม่อยู่ในแท็บสาขา`);
      seen.add(email); st.push(s);
    });
    // ตารางกะ
    let month = formMonth(wb, XLSX) || $("sMonth").value, sh = [];
    const realStaff = st.filter((s) => !s.sample);
    if (sT) {
      if (!month) warn.push("ไม่พบเดือนของตารางกะ (แท็บ 0_ข้อมูลAM) — ข้ามตารางกะ อัปโหลดทีหลังที่แท็บ กะ & มาสาย/ขาด");
      else sh = parseFormShift(sheetRows(wb, sT, XLSX), month, realStaff).filter((r) => !(r.empId === "40012345" && /สมชาย/.test(r.name)));
      sh.forEach((r) => { if (!realStaff.some((s) => s.empId === r.empId) && !users.some((u) => cellStr(u.empId) === r.empId)) warn.push(`ตารางกะ: รหัส ${r.empId} ${r.name} ไม่อยู่ในแท็บพนักงาน`); });
    }
    const existing = new Set(users.map((u) => (u.email || "").toLowerCase()));
    const newStaff = realStaff.filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.email)).filter((s, i, a) => a.findIndex((x) => x.email === s.email) === i);
    formData = { br: br.filter((b) => !b.sample), st: newStaff, sh, month };
    const nSample = br.filter((b) => b.sample).length + st.filter((s) => s.sample).length;
    $("fPrev").innerHTML = `<div class="stats sm">
        <div class="stat"><span class="muted">สาขา</span><b>${formData.br.length}</b></div>
        <div class="stat"><span class="muted">พนักงานใหม่</span><b>${newStaff.filter((s) => !existing.has(s.email)).length}</b></div>
        <div class="stat"><span class="muted">มีบัญชีแล้ว (ข้าม)</span><b>${newStaff.filter((s) => existing.has(s.email)).length}</b></div>
        <div class="stat"><span class="muted">ตารางกะ ${esc(month || "-")}</span><b>${sh.length} คน</b></div></div>
      ${nSample ? `<p class="muted">ข้ามแถวตัวอย่างของแบบฟอร์ม ${nSample} แถว</p>` : ""}
      ${warn.length ? `<div class="msg err">ตรวจก่อนนำเข้า:<br>${warn.map(esc).join("<br>")}</div>` : `<p class="msg ok">ข้อมูลพร้อมนำเข้า</p>`}`;
    $("fGo").classList.toggle("hidden", !(formData.br.length || newStaff.length || sh.length));
    msg("fMsg", "");
  } catch (err) { msg("fMsg", errText(err)); }
};
$("btnFImport").onclick = async () => {
  if (!formData) return;
  const pw = $("fPw").value.trim();
  const existing = new Set(users.map((u) => (u.email || "").toLowerCase()));
  const toAdd = formData.st.filter((s) => !existing.has(s.email));
  if (toAdd.length && pw.length < 6) return msg("fMsg", "ตั้งรหัสผ่านเริ่มต้นอย่างน้อย 6 ตัว");
  if (!confirm(`นำเข้า: สาขา ${formData.br.length} · พนักงานใหม่ ${toAdd.length} คน · ตารางกะ ${formData.sh.length} คน ?`)) return;
  busy($("btnFImport"), true, "กำลังนำเข้า...");
  const fail = [];
  try {
    const zoneFor = (team) => (isRM() ? (MULTI_ZONE ? String(team || "").toLowerCase() : "") : me.zoneId);
    for (const b of formData.br) {
      const ex = allBranches.find((x) => x.id === b.id);
      try { await setDoc(doc(db, "branches", b.id), { name: b.name, lat: b.lat ?? (ex && ex.lat) ?? null, lng: b.lng ?? (ex && ex.lng) ?? null, radius: b.radius, active: b.active, zoneId: (ex && ex.zoneId) || zoneFor(b.team) }); }
      catch (e) { fail.push(`สาขา ${b.id}: ${errText(e)}`); }
    }
    msg("fMsg", "บันทึกสาขาแล้ว · กำลังสร้างบัญชีพนักงาน...", "ok");
    await loadBranches();
    let n = 0;
    for (const s of toAdd) {
      try {
        await addUser({ name: s.name, empId: s.empId, email: s.email, position: s.position, branchId: s.branchId, zoneId: bZoneOf(s.branchId) || (isRM() ? "" : me.zoneId),
          role: "staff", phone: "", phoneKey: s.empId ? empKey(s.empId) : "", nickname: "", active: s.active }, pw);
        n++; msg("fMsg", `สร้างบัญชีแล้ว ${n}/${toAdd.length}...`, "ok");
      } catch (e) { fail.push(`${s.email}: ${errText(e)}`); }
    }
    await loadUsers();
    if (formData.sh.length && formData.month) {
      const rows = parseFormShiftFix(formData.sh);
      await saveShiftRows(formData.month, rows.filter((r) => isRM() || r.zoneId === me.zoneId));
      $("aMonth").value = formData.month;
    }
    msg("fMsg", `นำเข้าเสร็จ · สาขา ${formData.br.length} · บัญชีใหม่ ${n} คน · ตารางกะ ${formData.sh.length} คน` + (toAdd.length ? ` · แจ้งพนักงาน: ล็อกอินด้วยอีเมลส่วนตัว + รหัสเริ่มต้น "${pw}"` : "") + (fail.length ? ` · ไม่สำเร็จ: ${fail.join(" | ")}` : ""), fail.length ? "err" : "ok");
  } catch (e) { msg("fMsg", errText(e)); }
  finally { busy($("btnFImport"), false); }
};
// เติมสาขา/เขตของตารางกะจากบัญชีที่เพิ่งสร้าง
function parseFormShiftFix(rows) {
  return rows.map((r) => { const u = users.find((x) => cellStr(x.empId) === r.empId); if (!u) return r;
    return { ...r, branchId: u.branchId || r.branchId, store: u.branchId ? `${u.branchId} ${bName(u.branchId)}` : r.store, zoneId: u.zoneId || r.zoneId, position: u.position || r.position, name: r.name || u.name }; });
}

/* ================= ตารางกะ: มาสาย / ขาด ================= */
let att = { sums: [], days: [] };
// โหลดตารางกะ + รายการที่แก้/สลับ ของเดือน แล้วรวมกัน
async function loadShiftDocs(month) {
  const qz = (c) => isRM() ? query(collection(db, c), where("month", "==", month)) : query(collection(db, c), where("month", "==", month), where("zoneId", "==", me.zoneId));
  const [sh, ov] = await Promise.all([getDocs(qz("shifts")), getDocs(qz("shiftOverrides")).catch(() => ({ docs: [] }))]);
  const ovMap = new Map(ov.docs.map((d) => [d.id, d.data()]));
  return sh.docs.map((d) => { const s = d.data(); const o = ovMap.get(d.id); return { key: d.id, ...s, days: mergeDays(s, o), edited: o ? Object.keys(o.days || {}) : [] }; });
}
// คำนวณสถานะรายวันตามกะ ช่วง fromDay..toDay
async function attendanceCore(month, fromDay, toDay) {
  const start = new Date(new Date(`${fromDay}T00:00:00+07:00`).getTime() - 6 * 3600000);
  const end = new Date(new Date(`${toDay}T00:00:00+07:00`).getTime() + 2 * 86400000);
  const [shiftDocs, ckRows] = await Promise.all([loadShiftDocs(month), fetchCheckins(start, end)]);
  const uidByPhone = new Map(users.filter((u) => u.phoneKey).map((u) => [u.phoneKey, u.uid]));
  const byUid = new Map();
  ckRows.forEach((r) => { (byUid.get(r.uid) || byUid.set(r.uid, []).get(r.uid)).push(r); });
  const now = new Date(), sums = [], days = [];
  for (const s of shiftDocs) {
    const uid = uidByPhone.get(s.phoneKey), list = uid ? byUid.get(uid) || [] : [];
    const sum = { key: s.key, name: s.name, nickname: s.nickname, branchId: s.branchId, zoneId: s.zoneId || bZoneOf(s.branchId), store: s.store, phone: s.phone, hasAccount: !!uid,
      work: 0, present: 0, offsite: 0, late: 0, lateMin: 0, early: 0, earlyMin: 0, absent: 0, noOut: 0, off: 0, leave: 0, offWork: 0 };
    for (const day of Object.keys(s.days || {}).sort()) {
      if (day < fromDay || day > toDay) continue;
      const code = s.days[day], info = shiftInfo(code);
      const dayRecs = list.filter((c) => c.day === day);
      const dayIns = dayRecs.filter((c) => c.type === "in").map((c) => c.t).sort((a, b) => a - b);
      const offRecs = dayRecs.filter((c) => c.offsite);
      const row = { key: s.key, phoneKey: s.phoneKey, day, name: s.name, nickname: s.nickname, store: s.store, branchId: s.branchId, zoneId: sum.zoneId,
        code, edited: s.edited.includes(day), sched: "", in: dayIns[0] || null, out: null, status: "", kind: "", issue: false, state: "" };
      if (!info) { row.status = "รหัสกะไม่รู้จัก"; row.kind = "warn"; row.issue = true; row.state = "other"; }
      else if (info.off) {
        if (info.off === "วันหยุด") sum.off++; else sum.leave++;
        row.status = info.off; row.state = "off";
        if (dayIns.length) { row.status += " (แต่มีเช็กอิน)"; row.kind = "warn"; row.issue = true; sum.offWork++; row.state = "in"; }
      } else {
        const w = shiftWindow(day, info);
        row.sched = `${info.s}–${info.e}`;
        const limit = new Date(w.e.getTime() + 6 * 3600000);
        const from = row.in || new Date(w.s.getTime() - 4 * 3600000);
        row.out = list.filter((c) => c.type === "out" && c.t > from && c.t < limit).map((c) => c.t).sort((a, b) => b - a)[0] || null;
        if (now < w.s && !row.in) { row.status = "ยังไม่ถึงกะ"; row.state = "wait"; }
        else {
          sum.work++;
          if (!uid) { row.status = "ยังไม่มีบัญชีในระบบ"; row.kind = "warn"; row.issue = true; row.state = "absent"; }
          else if (!row.in) {
            row.state = "absent";
            if (now > w.e) { row.status = "ขาดงาน"; row.kind = "off"; row.issue = true; sum.absent++; }
            else { row.status = "ยังไม่เช็กอิน"; row.kind = "warn"; row.issue = true; }
          } else {
            sum.present++;
            row.state = row.out ? "done" : "in";
            const parts = [], late = Math.round((row.in - w.s) / 60000);
            row.late = late > LATE_GRACE_MIN;
            if (row.late) { parts.push(`สาย ${late} นาที`); sum.late++; sum.lateMin += late; }
            if (row.out) { const early = Math.round((w.e - row.out) / 60000); if (early > 0) { parts.push(`ออกก่อน ${early} นาที`); sum.early++; sum.earlyMin += early; } }
            else if (now > limit) { parts.push("ไม่ลงออกงาน"); sum.noOut++; }
            if (offRecs.length) { sum.offsite++; row.offsite = true; parts.push("นอกสถานที่/นอกพื้นที่: " + offRecs.map((c) => c.note).filter(Boolean).join(" / ")); }
            row.status = parts.join(" · ") || "ปกติ"; row.kind = offRecs.length ? "offsite" : parts.length ? "warn" : "in"; row.issue = parts.length > 0;
          }
        }
      }
      days.push(row);
    }
    sums.push(sum);
  }
  sums.sort((a, b) => String(a.store).localeCompare(String(b.store), "th") || String(a.name).localeCompare(String(b.name), "th"));
  days.sort((a, b) => b.day.localeCompare(a.day) || String(a.store).localeCompare(String(b.store), "th"));
  return { sums, days, empty: !shiftDocs.length };
}
async function runAtt() {
  const month = $("aMonth").value;
  if (!month) return msg("aMsg", "เลือกเดือน");
  busy($("btnAtt"), true, "กำลังค้นหา...");
  try {
    const [y, mo] = month.split("-").map(Number);
    const last = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
    const fromDay = $("aStart").value && $("aStart").value.startsWith(month) ? $("aStart").value : `${month}-01`;
    const r = await attendanceCore(month, fromDay, last);
    att = { sums: r.sums, days: r.days };
    msg("aMsg", r.empty ? `ยังไม่มีตารางกะเดือน ${month} — อัปโหลดไฟล์ที่ด้านล่าง` : `คำนวณจากข้อมูลถึง ${fmtDateTime(new Date())}`, r.empty ? "err" : "ok");
    renderAtt();
  } catch (err) { msg("aMsg", errText(err)); }
  finally { busy($("btnAtt"), false); }
}
function attFiltered() {
  const br = $("aBranch").value, s = $("aSearch").value.trim().toLowerCase(), z = isRM() ? $("aZone").value : "";
  const ok = (r) => (!z || r.zoneId === z) && (!br || r.branchId === br) && (!s || `${r.name} ${r.nickname}`.toLowerCase().includes(s));
  // ซ่อนรายชื่อที่ไม่มีบัญชี (ถูกลบ/ยังไม่สร้าง) — ข้อมูลยังอยู่ใน Export และรายงานเข้า-ออก
  const acct = $("aAcct").value !== "all", has = new Set(att.sums.filter((x) => x.hasAccount).map((x) => x.key));
  const ok2 = (r) => ok(r) && (!acct || has.has(r.key));
  return { sums: att.sums.filter(ok2), days: att.days.filter(ok2) };
}
const codeCell = (r) => `${esc(displayCode(r.code))}${r.edited ? ` <span class="tag offsite" title="แก้/สลับแล้ว">แก้</span>` : ""} <button class="btn sm" data-edit="${esc(r.key)}|${r.day}|${esc(r.phoneKey)}|${esc(r.zoneId)}" title="แก้กะวันนี้">✏️</button>`;
function renderAtt() {
  const { sums, days } = attFiltered();
  const t = (k) => sums.reduce((a, x) => a + x[k], 0);
  $("aStats").innerHTML = [["พนักงานในตาราง", sums.length], ["วันทำงาน (ถึงวันนี้)", t("work")], ["มาสาย (ครั้ง)", t("late")], ["ขาดงาน (วัน)", t("absent")], ["ออกก่อนเวลา", t("early")], ["ไม่ลงออกงาน", t("noOut")], ["ยังไม่มีบัญชี (คน)", sums.filter((x) => !x.hasAccount).length]]
    .map(([l, v]) => `<div class="stat"><span class="muted">${l}</span><b>${v}</b></div>`).join("");
  if (isRM()) {
    const zs = new Map();
    sums.forEach((x) => { const k = x.zoneId || ""; const g = zs.get(k) || { n: 0, work: 0, present: 0, late: 0, absent: 0, noOut: 0, offsite: 0 }; g.n++; ["work", "present", "late", "absent", "noOut", "offsite"].forEach((f) => (g[f] += x[f])); zs.set(k, g); });
    $("tAttZone").innerHTML = `<tr><th>เขต</th><th>คน</th><th>วันทำงาน</th><th>มาทำงาน</th><th>% มาทำงาน</th><th>สาย (ครั้ง)</th><th>% ตรงเวลา</th><th>ขาด</th><th>ไม่ลงออก</th><th>นอกสถานที่</th></tr>` +
      ([...zs.entries()].sort().map(([k, g]) => `<tr><td>${k ? esc(zName(k)) : `<span class="tag warn">ยังไม่กำหนดเขต</span>`}</td><td>${g.n}</td><td>${g.work}</td><td>${g.present}</td>
        <td>${g.work ? Math.round((g.present / g.work) * 100) + "%" : "-"}</td><td>${g.late}</td><td>${g.present ? Math.round(((g.present - g.late) / g.present) * 100) + "%" : "-"}</td>
        <td>${g.absent}</td><td>${g.noOut}</td><td>${g.offsite}</td></tr>`).join("") || `<tr><td class="muted" colspan="10">ไม่มีข้อมูล</td></tr>`);
  }
  $("tAttSum").innerHTML = `<tr><th>สาขา</th><th>ชื่อ</th><th>ชื่อเล่น</th><th>วันทำงาน</th><th>มาทำงาน</th><th>นอกสถานที่</th><th>สาย (ครั้ง/นาที)</th><th>ขาด</th><th>ออกก่อน</th><th>ไม่ลงออก</th><th>หยุด</th><th>ลา/พักร้อน/อบรม</th><th>บัญชี</th></tr>` +
    (sums.map((x) => `<tr><td>${esc(x.store)}</td><td>${esc(x.name)}</td><td>${esc(x.nickname)}</td><td>${x.work}</td><td>${x.present}</td><td>${x.offsite || "-"}</td>
      <td>${x.late ? `<span class="tag warn">${x.late} / ${x.lateMin}</span>` : "-"}</td><td>${x.absent ? `<span class="tag off">${x.absent}</span>` : "-"}</td>
      <td>${x.early || "-"}</td><td>${x.noOut || "-"}</td><td>${x.off}</td><td>${x.leave}</td>
      <td>${x.hasAccount ? `<span class="tag in">มี</span>` : `<span class="tag warn">ยังไม่มี</span>`}</td></tr>`).join("") || `<tr><td class="muted" colspan="13">ไม่มีข้อมูล</td></tr>`);
  // การ์ดรายคน (มือถือ)
  $("attCards").innerHTML = sums.map((x) => `<div class="pcard"><div class="top"><b>${esc(x.name)}${x.nickname ? ` (${esc(x.nickname)})` : ""}</b><span class="sub">${esc(x.store)}</span></div>
    <div class="sub">มา ${x.present}/${x.work} วัน · ${x.late ? `<span class="tag warn">สาย ${x.late} ครั้ง ${x.lateMin} น.</span>` : "ไม่สาย"} ${x.absent ? `<span class="tag off">ขาด ${x.absent}</span>` : ""} ${x.noOut ? `<span class="tag warn">ไม่ลงออก ${x.noOut}</span>` : ""} ${x.offsite ? `<span class="tag offsite">นอกสถานที่ ${x.offsite}</span>` : ""}</div></div>`).join("") || `<p class="muted">ไม่มีข้อมูล</p>`;
  const showAll = $("aShow").value === "all";
  const rows = days.filter((r) => showAll || r.issue);
  $("tAttDay").innerHTML = `<tr><th>วันที่</th><th>สาขา</th><th>ชื่อ</th><th>กะ</th><th>เวลากะ</th><th>เข้างาน</th><th>ออกงาน</th><th>สถานะ</th></tr>` +
    (rows.slice(0, 1500).map((r) => `<tr><td>${r.day}</td><td>${esc(r.store)}</td><td>${esc(r.name)}${r.nickname ? ` (${esc(r.nickname)})` : ""}</td><td>${codeCell(r)}</td><td>${r.sched || "-"}</td>
      <td>${r.in ? fmtTime(r.in) : "-"}</td><td>${r.out ? fmtTime(r.out) : "-"}</td><td>${r.kind ? `<span class="tag ${r.kind}">${esc(r.status)}</span>` : esc(r.status)}</td></tr>`).join("")
      || `<tr><td class="muted" colspan="8">${showAll ? "ไม่มีข้อมูล" : "ไม่มีรายการผิดปกติ"}</td></tr>`);
}
$("btnAtt").onclick = runAtt;
["aBranch", "aShow", "aZone", "aAcct"].forEach((i) => $(i).addEventListener("change", renderAtt));
$("aMonth").addEventListener("change", runAtt);
$("aSearch").addEventListener("input", renderAtt);

/* ---------- แก้กะรายวัน (หัวหน้า) ---------- */
async function setOverride(key, phoneKey, zoneId, day, code, by) {
  await setDoc(doc(db, "shiftOverrides", key), { month: key.slice(0, 7), phoneKey, zoneId: zoneId || "", days: { [day]: code }, log: { [day]: { by, at: new Date().toISOString() } } }, { merge: true });
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-edit]"); if (!b) return;
  const [key, day, pk, z] = b.dataset.edit.split("|");
  const code = prompt(`แก้กะวันที่ ${day}\nใส่ชั่วโมงเข้างาน (เช่น 8, 9, 10, 13) หรือ H=หยุด, V=พักร้อน, T=อบรม, ลากิจ, ลาป่วย`);
  if (code === null) return;
  const c = normCode(code);
  if (!shiftInfo(c)) return alert("รหัสไม่ถูกต้อง");
  try { await setOverride(key, pk, z, day, c, me.name || "หัวหน้า"); runAtt(); if (!$("t-today").classList.contains("hidden")) runToday(); }
  catch (err) { alert(errText(err)); }
});

/* ---------- คำขอสลับวันจากพนักงาน ---------- */
let rqRows = [];
async function loadShiftRequests() {
  try {
    const q = isRM() ? query(collection(db, "shiftRequests"), where("status", "==", "pending"))
      : query(collection(db, "shiftRequests"), where("status", "==", "pending"), where("zoneId", "==", me.zoneId));
    rqRows = (await getDocs(q)).docs.map((d) => ({ id: d.id, ...d.data() }));
    $("rqBadge").textContent = rqRows.length; $("rqBadge").classList.toggle("hidden", !rqRows.length);
    $("tShiftReq").innerHTML = rqRows.length ? `<tr><th>ชื่อ</th><th>ขอเปลี่ยน</th><th>เหตุผล</th><th>เวลาขอ</th><th></th></tr>` +
      rqRows.map((r) => `<tr><td>${esc(r.name)}</td><td class="wrap-txt">${Object.keys(r.changes || {}).sort().map((d) => `${d}: ${esc(displayCode((r.from || {})[d] || "-"))} → <b>${esc(displayCode(r.changes[d]))}</b>`).join("<br>")}</td>
        <td class="wrap-txt">${esc(r.reason)}</td><td>${fmtDateTime(r.at && r.at.toDate())}</td>
        <td class="actions"><button class="btn sm primary" data-rqok="${r.id}">อนุมัติ</button><button class="btn sm danger" data-rqno="${r.id}">ไม่อนุมัติ</button></td></tr>`).join("")
      : `<tr><td class="muted">ไม่มีคำขอรออนุมัติ</td></tr>`;
  } catch (e) { $("tShiftReq").innerHTML = `<tr><td class="msg err">${esc(errText(e))}</td></tr>`; }
}
$("tShiftReq").addEventListener("click", async (e) => {
  const ok = e.target.dataset.rqok, no = e.target.dataset.rqno; if (!ok && !no) return;
  const r = rqRows.find((x) => x.id === (ok || no));
  try {
    if (ok) {
      if (!r.phoneKey) throw new Error("พนักงานคนนี้ยังไม่มีเบอร์โทรในบัญชี จึงจับคู่ตารางกะไม่ได้");
      const key = `${r.month}_${r.phoneKey}`;
      for (const d of Object.keys(r.changes || {})) await setOverride(key, r.phoneKey, r.zoneId, d, r.changes[d], `อนุมัติคำขอ: ${me.name || ""}`);
    }
    await updateDoc(doc(db, "shiftRequests", r.id), { status: ok ? "approved" : "rejected", decidedBy: me.name || "", decidedAt: serverTimestamp() });
    loadShiftRequests(); if (ok) runAtt();
  } catch (err) { alert(errText(err)); }
});

/* ================= วันนี้ ================= */
let todayRows = [], todayFilter = "all";
async function runToday() {
  const day = bkkDay();
  $("tdDate").textContent = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "full" }).format(new Date());
  try {
    const r = await attendanceCore(day.slice(0, 7), day, day);
    todayRows = r.days.filter((x) => x.day === day);
    $("tdMsg").textContent = r.empty ? "ยังไม่มีตารางกะเดือนนี้ — อัปโหลดที่แท็บ กะ & มาสาย/ขาด" : `อัปเดตล่าสุด ${fmtTime(new Date())}`;
    renderToday();
  } catch (e) { $("tdMsg").textContent = errText(e); }
}
function renderToday() {
  const z = isRM() ? $("rZone").value : "";
  const base = todayRows.filter((r) => !z || r.zoneId === z);
  const cnt = { all: base.length, absent: 0, in: 0, done: 0, late: 0, offsite: 0, off: 0 };
  base.forEach((r) => { if (cnt[r.state] !== undefined) cnt[r.state]++; if (r.late) cnt.late++; if (r.offsite) cnt.offsite++; });
  const labels = [["all", "ทั้งหมด"], ["absent", "ยังไม่มา"], ["in", "ยังไม่ออกงาน"], ["done", "ออกงานแล้ว"], ["late", "มาสาย"], ["offsite", "นอกสถานที่"], ["off", "หยุด/ลา"]];
  $("tdChips").innerHTML = labels.map(([k, l]) => `<button type="button" data-f="${k}" class="${todayFilter === k ? "on" : ""}">${l} (${cnt[k]})</button>`).join("");
  const f = (r) => todayFilter === "all" || (todayFilter === "late" ? r.late : todayFilter === "offsite" ? r.offsite : r.state === todayFilter);
  const rows = base.filter(f).sort((a, b) => String(a.store).localeCompare(String(b.store), "th"));
  const stTag = { absent: ["off", "ยังไม่มา"], in: ["warn", "ยังไม่ออกงาน"], done: ["in", "ออกงานแล้ว"], off: ["", "หยุด/ลา"], wait: ["", "ยังไม่ถึงกะ"], other: ["warn", "ไม่ทราบกะ"] };
  $("tdList").innerHTML = rows.map((r) => { const t = stTag[r.state] || ["", r.status];
    return `<div class="pcard"><div class="top"><b>${esc(r.name)}${r.nickname ? ` (${esc(r.nickname)})` : ""}</b><span class="tag ${t[0]}">${t[1]}</span></div>
      <div class="sub">${esc(r.store)} · ${esc(shiftLabel(r.code))} · เข้า ${r.in ? fmtTime(r.in).slice(0, 5) : "–"} · ออก ${r.out ? fmtTime(r.out).slice(0, 5) : "–"}</div>
      ${r.issue && r.status ? `<div class="sub">${esc(r.status)}</div>` : ""}</div>`; }).join("") || `<p class="muted">ไม่มีรายการ</p>`;
}
$("tdChips").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; todayFilter = b.dataset.f; renderToday(); });
$("btnTdReload").onclick = runToday;

$("btnAttCsvSum").onclick = () => {
  const { sums } = attFiltered();
  downloadCsv(`${bkkDay()}_สรุปมาสายขาดงาน_${$("aMonth").value}.csv`,
    ["สาขา", "ชื่อ", "ชื่อเล่น", "เบอร์โทร", "วันทำงาน", "มาทำงาน", "นอกสถานที่(วัน)", "สาย(ครั้ง)", "สาย(นาทีรวม)", "ขาดงาน", "ออกก่อน(ครั้ง)", "ออกก่อน(นาทีรวม)", "ไม่ลงออก", "วันหยุด", "ลา/พักร้อน/อบรม", "เช็กอินในวันหยุด", "มีบัญชี"],
    sums.map((x) => [x.store, x.name, x.nickname, x.phone, x.work, x.present, x.offsite, x.late, x.lateMin, x.absent, x.early, x.earlyMin, x.noOut, x.off, x.leave, x.offWork, x.hasAccount ? "มี" : "ไม่มี"]));
};
$("btnAttCsvDay").onclick = () => {
  const { days } = attFiltered();
  downloadCsv(`${bkkDay()}_รายวันตามกะ_${$("aMonth").value}.csv`,
    ["วันที่", "สาขา", "ชื่อ", "ชื่อเล่น", "รหัสกะ", "เวลากะ", "เข้างาน", "ออกงาน", "สถานะ"],
    days.slice().reverse().map((r) => [r.day, r.store, r.name, r.nickname, displayCode(r.code), r.sched, r.in ? fmtTime(r.in) : "", r.out ? fmtTime(r.out) : "", r.status]));
};

/* ================= ส่งออก Excel / Google Sheet ================= */
// รวมข้อมูลที่โหลดไว้ในหน้า (รายงานเข้า-ออก + มาสาย/ขาด) เป็นตารางหลายแท็บ
function exportTables() {
  const t = [];
  if (reportRows.length) {
    const s = summarize(filtered()).filter(sumOk);
    t.push({ name: "สรุปรายคนรายวัน", rows: [["วันที่", "ชื่อ", "รหัสพนักงาน", "ตำแหน่ง", "สาขา", "เข้างาน", "ออกงาน", "ชั่วโมง", "นอกสถานที่", "เหตุผล"],
      ...s.map((x) => [x.day, x.name, x.empId, x.position, x.branches, x.firstIn ? fmtTime(x.firstIn) : "", x.lastOut ? fmtTime(x.lastOut) : "", x.hours != null ? +x.hours.toFixed(2) : "", x.offsite ? "ใช่" : "", (x.notes || []).join(" / ")])] });
    t.push({ name: "ทุกรายการ", rows: [["วันที่", "เวลา", "ชื่อ", "รหัสพนักงาน", "ประเภท", "รหัสสาขา", "สาขา", "ระยะจากสาขา(ม.)", "ความแม่นยำ GPS(ม.)", "ท่า", "นอกสถานที่", "หมายเหตุ", "ตรวจแล้ว", "lat", "lng"],
      ...filtered(true).slice().reverse().map((r) => [r.day, fmtTime(r.t), r.name, r.empId, r.type === "in" ? "เข้างาน" : "ออกงาน", r.branchId, r.branchName, r.distance ?? "", r.accuracy ?? "", r.gesture || "", r.offsite ? "ใช่" : "", r.note || "", r.reviewed ? "ใช่" : "", r.lat, r.lng])] });
  }
  if (att.sums.length) {
    const { sums, days } = attFiltered();
    t.push({ name: "มาสาย-ขาด สรุปรายคน", rows: [["สาขา", "ชื่อ", "ชื่อเล่น", "เบอร์โทร", "วันทำงาน", "มาทำงาน", "นอกสถานที่(วัน)", "สาย(ครั้ง)", "สาย(นาทีรวม)", "ขาดงาน", "ออกก่อน(ครั้ง)", "ออกก่อน(นาทีรวม)", "ไม่ลงออก", "วันหยุด", "ลา/พักร้อน/อบรม", "มีบัญชี"],
      ...sums.map((x) => [x.store, x.name, x.nickname, x.phone, x.work, x.present, x.offsite, x.late, x.lateMin, x.absent, x.early, x.earlyMin, x.noOut, x.off, x.leave, x.hasAccount ? "มี" : "ไม่มี"])] });
    t.push({ name: "รายวันตามกะ", rows: [["วันที่", "สาขา", "ชื่อ", "ชื่อเล่น", "กะ", "เวลากะ", "เข้างาน", "ออกงาน", "สถานะ"],
      ...days.slice().reverse().map((r) => [r.day, r.store, r.name, r.nickname, displayCode(r.code), r.sched, r.in ? fmtTime(r.in) : "", r.out ? fmtTime(r.out) : "", r.status])] });
  }
  return t;
}
async function ensureExportData() {
  if (!reportRows.length) await runReport();
  if (!att.sums.length && $("aMonth").value) { try { await runAtt(); } catch (e) {} }
  const t = exportTables();
  if (!t.length) throw new Error("ยังไม่มีข้อมูล — กด \"ดูรายงาน\" หรือ \"คำนวณ\" ก่อน");
  return t;
}
const exportTitle = () => `${bkkDay()}_${document.title.replace(/ Admin$/, "")}_รายงาน ${$("rFrom").value} ถึง ${$("rTo").value}`;
const exportMsg = (b, t, k) => { const m = b.closest(".card").querySelector(".msg"); if (m) { m.textContent = t; m.className = "msg " + (k || "ok"); } };

document.querySelectorAll(".js-xlsx").forEach((b) => (b.onclick = async () => {
  busy(b, true, "กำลังสร้างไฟล์...");
  try {
    const [XLSX, tables] = await Promise.all([loadXLSX(), ensureExportData()]);
    const wb = XLSX.utils.book_new();
    tables.forEach((t) => { const ws = XLSX.utils.aoa_to_sheet(t.rows); ws["!cols"] = t.rows[0].map((h) => ({ wch: Math.max(10, String(h).length + 4) })); XLSX.utils.book_append_sheet(wb, ws, t.name.slice(0, 31)); });
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const url = URL.createObjectURL(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const a = document.createElement("a"); a.href = url; a.download = `${bkkDay()}_AM-CheckIn_report_${$("rFrom").value}_to_${$("rTo").value}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    exportMsg(b, `ดาวน์โหลดแล้ว ${tables.length} แท็บ · เปิดใน Google Sheet: ลากไฟล์เข้า Google Drive แล้วดับเบิลคลิก`);
  } catch (e) { exportMsg(b, errText(e), "err"); }
  finally { busy(b, false); }
}));

// ส่งเข้า Google Sheet: ผู้กดเลือกบัญชี Google ของตัวเอง → ระบบสร้างชีตใน Drive ของบัญชีนั้น
// ใช้ Google Identity Services (ไม่ผ่านระบบล็อกอินของ Firebase) สิทธิ์ drive.file = เข้าถึงเฉพาะไฟล์ที่ระบบสร้างเท่านั้น
let gisReady = null;
function loadGis() {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  return gisReady || (gisReady = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client"; s.async = true;
    s.onload = res; s.onerror = () => { gisReady = null; rej(new Error("โหลดระบบล็อกอิน Google ไม่สำเร็จ")); };
    document.head.appendChild(s);
  }));
}
if (GOOGLE_CLIENT_ID) loadGis().catch(() => {});
function googleToken() {
  return new Promise((res, rej) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID, scope: "https://www.googleapis.com/auth/drive.file", prompt: "select_account",
      callback: (r) => (r && r.access_token ? res(r.access_token) : rej(new Error("ไม่ได้รับสิทธิ์จาก Google"))),
      error_callback: (e) => rej(new Error(e && e.type === "popup_closed" ? "ปิดหน้าต่างเลือกบัญชีก่อนเสร็จ — กดใหม่อีกครั้ง" : e && e.type === "popup_failed_to_open" ? "เบราว์เซอร์บล็อก pop-up — อนุญาตแล้วกดใหม่" : "ล็อกอิน Google ไม่สำเร็จ")),
    });
    client.requestAccessToken(); // ต้องเรียกทันทีจากการกดปุ่ม (ไม่งั้นเบราว์เซอร์บล็อก pop-up)
  });
}
document.querySelectorAll(".js-gsheet").forEach((b) => (b.onclick = async () => {
  if (!GOOGLE_CLIENT_ID) return exportMsg(b, "ยังไม่ได้ตั้งค่า GOOGLE_CLIENT_ID ในไฟล์ tenants.js — ใช้ปุ่มดาวน์โหลด Excel ไปก่อน", "err");
  if (!(window.google && google.accounts && google.accounts.oauth2)) { loadGis().catch(() => {}); return exportMsg(b, "กำลังเตรียมระบบ Google — กดอีกครั้งใน 2–3 วินาที", "err"); }
  const tokenP = googleToken(); // เปิดหน้าต่างเลือกบัญชีก่อน แล้วค่อยเตรียมข้อมูล
  busy(b, true, "กำลังส่ง...");
  try {
    const [token, tables] = await Promise.all([tokenP, ensureExportData()]);
    const api = async (url, body) => {
      const r = await fetch(url, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const m = (j.error && j.error.message) || r.statusText;
        if (/has not been used|is disabled|SERVICE_DISABLED/i.test(m)) throw new Error("ยังไม่ได้เปิด Google Sheets API ในโปรเจกต์ที่สร้าง Client ID — Google Cloud → APIs & Services → Library → Google Sheets API → Enable");
        throw new Error("Google Sheet: " + m);
      }
      return j;
    };
    const ss = await api("https://sheets.googleapis.com/v4/spreadsheets", {
      properties: { title: exportTitle(), locale: "th_TH", timeZone: "Asia/Bangkok" },
      sheets: tables.map((t, i) => ({ properties: { sheetId: i + 1, title: t.name, gridProperties: { frozenRowCount: 1 } } })),
    });
    await api(`https://sheets.googleapis.com/v4/spreadsheets/${ss.spreadsheetId}/values:batchUpdate`, {
      valueInputOption: "RAW", data: tables.map((t) => ({ range: `'${t.name}'!A1`, values: t.rows.map((r) => r.map((v) => (v == null ? "" : v))) })),
    });
    await api(`https://sheets.googleapis.com/v4/spreadsheets/${ss.spreadsheetId}:batchUpdate`, {
      requests: tables.map((t, i) => ({ repeatCell: { range: { sheetId: i + 1, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.9, green: 0.93, blue: 0.98 } } }, fields: "userEnteredFormat(textFormat,backgroundColor)" } })),
    });
    const m = b.closest(".card").querySelector(".msg");
    m.className = "msg ok";
    m.innerHTML = `สร้าง Google Sheet ใน Drive ของบัญชีที่เลือกแล้ว (${tables.length} แท็บ) · <a href="${ss.spreadsheetUrl}" target="_blank" rel="noopener">เปิดชีต</a>`;
    try { google.accounts.oauth2.revoke(token, () => {}); } catch (e) {} // คืนสิทธิ์ทันที ไม่ค้างไว้
  } catch (e) { exportMsg(b, errText(e), "err"); }
  finally { busy(b, false); }
}));

$("btnResetAll").onclick = async () => {
  const list = users.filter((u) => (u.role || "staff") === "staff");
  if (!confirm(`รีเซ็ตเครื่องของพนักงาน ${list.length} คน?`)) return;
  busy($("btnResetAll"), true);
  try {
    for (let i = 0; i < list.length; i += 400) {
      const b = writeBatch(db);
      list.slice(i, i + 400).forEach((u) => b.update(doc(db, "users", u.uid), { deviceId: "", deviceIds: [], devices: {} }));
      await b.commit();
    }
    const reqs = await getDocs(isRM() ? collection(db, "deviceRequests") : query(collection(db, "deviceRequests"), where("zoneId", "==", me.zoneId)));
    for (const d of reqs.docs) await deleteDoc(d.ref);
    msg("raMsg", `รีเซ็ตแล้ว ${list.length} คน`, "ok"); loadUsers(); loadDevices();
  } catch (e) { msg("raMsg", errText(e)); }
  finally { busy($("btnResetAll"), false); }
};

/* ---------- บัญชี RM ดูอย่างเดียว ---------- */
$("btnViewer").onclick = async () => {
  const email = $("vEmail").value.trim().toLowerCase(), name = $("vName").value.trim() || "RM";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return msg("vMsg", "กรอกอีเมลของ RM");
  if (users.some((u) => (u.email || "").toLowerCase() === email)) return msg("vMsg", "อีเมลนี้มีบัญชีในทีมแล้ว");
  busy($("btnViewer"), true);
  try {
    const pw = genPw() + genPw(); // รหัสสุ่ม — RM ตั้งรหัสเองจากอีเมลที่ระบบส่งไป
    const uid = await createAuthUser(email, pw);
    await setDoc(doc(db, "users", uid), { name, email, role: "viewer", zoneId: "", branchId: "", active: true, mustChangePassword: false, deviceIds: [], createdAt: serverTimestamp() });
    await sendPasswordResetEmail(auth, email);
    msg("vMsg", `เพิ่มบัญชี ${email} แล้ว · ระบบส่งอีเมลให้ RM ตั้งรหัสผ่าน (ตั้งให้เหมือนกันทุกทีม จะล็อกอินหน้าสรุปครั้งเดียวได้)`, "ok");
    $("vEmail").value = ""; $("vName").value = ""; loadUsers();
  } catch (e) { msg("vMsg", errText(e)); }
  finally { busy($("btnViewer"), false); }
};

/* ================= เขต (RM) ================= */
async function loadZones() {
  try { zones = (await getDocs(collection(db, "zones"))).docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.id.localeCompare(b.id)); }
  catch (e) { zones = []; console.warn("อ่านข้อมูลเขตไม่ได้ — ตรวจว่า Publish Rules ล่าสุดแล้ว", e); }
  const opts = zones.map((z) => `<option value="${esc(z.id)}">${esc(z.name || z.id)}</option>`).join("");
  $("rZone").innerHTML = `<option value="">ทุกเขต</option>` + opts;
  $("aZone").innerHTML = `<option value="">ทุกเขต</option>` + opts;
  $("uZone").innerHTML = `<option value="">— ตามสาขาประจำ —</option>` + opts;
  $("bZone").innerHTML = `<option value="">— ยังไม่กำหนด —</option>` + opts;
  if (!isRM()) return;
  $("tZones").innerHTML = `<tr><th>รหัส</th><th>ชื่อเขต</th><th>AM</th><th>สาขา</th><th>พนักงาน</th><th></th></tr>` +
    (zones.map((z) => {
      const ams = users.filter((u) => u.role === "am" && u.zoneId === z.id).map((u) => u.name).join(", ");
      return `<tr><td>${esc(z.id)}</td><td>${esc(z.name)}</td><td>${ams ? esc(ams) : `<span class="tag warn">ยังไม่มีบัญชี AM</span>`}</td>
        <td>${allBranches.filter((b) => b.zoneId === z.id).length}</td><td>${users.filter((u) => u.zoneId === z.id && u.role === "staff").length}</td>
        <td class="actions"><button class="btn sm" data-zedit="${esc(z.id)}">แก้ไข</button><button class="btn sm danger" data-zdel="${esc(z.id)}">ลบ</button></td></tr>`;
    }).join("") || `<tr><td class="muted">ยังไม่มีเขต</td></tr>`);
}
$("btnZSave").onclick = async () => {
  const id = $("zId").value.trim(), name = $("zName").value.trim();
  if (!/^[A-Za-z0-9-]{1,20}$/.test(id)) return msg("zMsg", "รหัสเขตใช้ได้เฉพาะ A-Z, 0-9 และ - (ไม่เกิน 20 ตัว)");
  if (!name) return msg("zMsg", "กรอกชื่อเขต");
  try { await setDoc(doc(db, "zones", id), { name }); msg("zMsg", "บันทึกแล้ว", "ok"); $("zId").value = ""; $("zName").value = ""; $("zId").disabled = false; await loadZones(); await loadBranches(); }
  catch (e) { msg("zMsg", errText(e)); }
};
$("btnZClear").onclick = () => { $("zId").value = ""; $("zName").value = ""; $("zId").disabled = false; };
$("tZones").addEventListener("click", async (e) => {
  const ed = e.target.dataset.zedit, del = e.target.dataset.zdel;
  if (ed) { const z = zones.find((x) => x.id === ed); $("zId").value = z.id; $("zId").disabled = true; $("zName").value = z.name || ""; }
  if (del) {
    if (allBranches.some((b) => b.zoneId === del)) return alert("ย้ายสาขาออกจากเขตนี้ก่อนลบ");
    if (confirm(`ลบเขต ${del}?`)) { await deleteDoc(doc(db, "zones", del)); loadZones(); }
  }
});
$("btnBackfill").onclick = async () => {
  if (!confirm("อัปเดตเขตให้พนักงาน ตารางกะ และประวัติเช็กอินทั้งหมดตามสาขาประจำ?")) return;
  busy($("btnBackfill"), true);
  let n = 0;
  const commitAll = async (ops) => { for (let i = 0; i < ops.length; i += 400) { const b = writeBatch(db); ops.slice(i, i + 400).forEach(([r, d]) => b.update(r, d)); await b.commit(); n += Math.min(400, ops.length - i); msg("bfMsg", `อัปเดตแล้ว ${n} รายการ...`, "ok"); } };
  try {
    const uOps = [];
    (await getDocs(collection(db, "users"))).docs.forEach((d) => { const u = d.data(); if (u.role === "staff" || !u.role) { const z = bZoneOf(u.branchId); if (z && z !== u.zoneId) uOps.push([d.ref, { zoneId: z }]); } });
    await commitAll(uOps);
    const sOps = [];
    (await getDocs(collection(db, "shifts"))).docs.forEach((d) => { const s = d.data(); const z = bZoneOf(s.branchId); if (z && z !== s.zoneId) sOps.push([d.ref, { zoneId: z }]); });
    await commitAll(sOps);
    const cOps = [];
    (await getDocs(collection(db, "checkins"))).docs.forEach((d) => { const c = d.data(); const z = bZoneOf(c.branchId); const zm = `${z}_${(c.day || "").slice(0, 7)}`; if (z && (z !== c.zoneId || zm !== c.zm)) cOps.push([d.ref, { zoneId: z, zm }]); });
    await commitAll(cOps);
    msg("bfMsg", `เสร็จแล้ว · พนักงาน ${uOps.length} · ตารางกะ ${sOps.length} · เช็กอิน ${cOps.length} รายการ`, "ok");
    await loadUsers(); await loadZones();
  } catch (e) { msg("bfMsg", errText(e)); }
  finally { busy($("btnBackfill"), false); }
};

/* ================= ตารางกะ (ภาพรวม แบบไฟล์ Excel) ================= */
// ข้อมูลล่าสุด: ตารางที่อัปโหลด + กะที่ AM แก้ / พนักงานขอสลับที่อนุมัติแล้ว (กรอบน้ำเงิน) + คำขอที่รออนุมัติ (สีเหลือง)
let roster = { month: "", rows: [], pend: new Map() };
const WD = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
async function runRoster() {
  const month = $("roMonth").value; if (!month) return;
  busy($("btnRoster"), true, "กำลังโหลด...");
  try {
    const [rows] = await Promise.all([loadShiftDocs(month), loadShiftRequests()]);
    const pend = new Map();
    (rqRows || []).forEach((r) => Object.entries(r.changes || {}).forEach(([d, c]) => { if (d.startsWith(month)) pend.set(`${r.phoneKey}|${d}`, c); }));
    const hasAcct = new Set(users.filter((u) => u.phoneKey).map((u) => u.phoneKey));
    roster = { month, rows: rows.map((r) => ({ ...r, hasAcct: hasAcct.has(r.phoneKey) })), pend };
    msg("roMsg", rows.length ? `${rows.length} คน · อัปเดต ${fmtDateTime(new Date())}` : `ยังไม่มีตารางกะเดือน ${month}`, rows.length ? "ok" : "err");
    renderRoster();
  } catch (e) { msg("roMsg", errText(e)); }
  finally { busy($("btnRoster"), false); }
}
function rosterCls(code) {
  const i = shiftInfo(code);
  if (!normCode(code)) return "r-none";
  if (!i) return "r-unk";
  if (i.off) return /วันหยุด/.test(i.off) ? "r-off" : "r-leave";
  return "r-work";
}
function renderRoster() {
  const { month, rows, pend } = roster; if (!month) return;
  const [y, m] = month.split("-").map(Number), last = new Date(Date.UTC(y, m, 0)).getUTCDate(), today = bkkDay();
  const br = $("roBranch").value, q = $("roSearch").value.trim().toLowerCase(), acct = $("roAcct").value !== "all";
  const list = rows.filter((r) => (!br || r.branchId === br) && (!q || `${r.name} ${r.nickname || ""}`.toLowerCase().includes(q)) && (!acct || r.hasAcct))
    .sort((a, b) => String(a.store).localeCompare(String(b.store), "th") || String(a.name).localeCompare(String(b.name), "th"));
  const ds = Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  const wd = (d) => new Date(d + "T12:00:00+07:00").getDay();
  const head1 = `<tr><th class="sk s1" rowspan="2">Store</th><th class="sk s2" rowspan="2">ชื่อ</th><th class="sk s3" rowspan="2">ชื่อเล่น</th><th rowspan="2">ตำแหน่ง</th>` +
    ds.map((d, i) => `<th class="dd${wd(d) === 0 || wd(d) === 6 ? " we" : ""}${d === today ? " td" : ""}">${i + 1}</th>`).join("") + `<th rowspan="2">ทำงาน</th><th rowspan="2">หยุด/ลา</th></tr>`;
  const head2 = `<tr>${ds.map((d) => `<th class="dd wdn${wd(d) === 0 || wd(d) === 6 ? " we" : ""}${d === today ? " td" : ""}">${WD[wd(d)]}</th>`).join("")}</tr>`;
  const body = list.map((r) => {
    let w = 0, o = 0;
    const cells = ds.map((d) => {
      const code = (r.days || {})[d] || "", i = shiftInfo(code), p = pend.get(`${r.phoneKey}|${d}`);
      if (i && !i.off) w++; else if (i && i.off) o++;
      const cls = [rosterCls(code), r.edited.includes(d) ? "r-edit" : "", p !== undefined ? "r-pend" : "", d === today ? "td" : ""].filter(Boolean).join(" ");
      const tip = `${d} · ${shiftLabel(code)}${r.edited.includes(d) ? " · แก้/สลับแล้ว" : ""}${p !== undefined ? ` · รออนุมัติ → ${shiftLabel(p)}` : ""}`;
      return `<td class="${cls}" title="${esc(tip)}">${esc(normCode(code) ? displayCode(code).replace("วันหยุด", "H").replace("พักร้อน", "V").replace("ลาอื่นๆ", "OL").replace("อบรม", "T") : "")}${p !== undefined ? `<small>→${esc(displayCode(p).replace("วันหยุด", "H"))}</small>` : ""}</td>`;
    }).join("");
    return `<tr><td class="sk s1">${esc(r.store || r.branchId || "")}</td><td class="sk s2">${esc(r.name)}${r.hasAcct ? "" : ` <span class="tag warn">ไม่มีบัญชี</span>`}</td><td class="sk s3">${esc(r.nickname || "")}</td><td>${esc(r.position || "")}</td>${cells}<td><b>${w}</b></td><td>${o}</td></tr>`;
  }).join("");
  $("tRoster").innerHTML = head1 + head2 + (body || `<tr><td colspan="${last + 6}" class="muted">ไม่มีข้อมูล</td></tr>`);
}
$("btnRoster").onclick = runRoster;
["roBranch", "roAcct"].forEach((i) => $(i).addEventListener("change", renderRoster));
$("roSearch").addEventListener("input", renderRoster);
$("roMonth").addEventListener("change", runRoster);
