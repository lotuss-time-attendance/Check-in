// หน้าสรุปสำหรับ RM — อ่านอย่างเดียว · ดึงข้อมูลจาก Firebase ของทุกทีมในภาค (ข้อมูลยังอยู่ที่ทีมเดิม ไม่ถูกคัดลอกไปเก็บที่อื่น)
import { $, esc, fmtTime, bkkDay, errText, busy, shiftInfo, shiftWindow, mergeDays, LATE_GRACE_MIN, displayCode, shiftLabel, normCode } from "./common.js";
import { TENANTS } from "./tenants.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, getDocs, collection, query, where, Timestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const msg = (id, t, k = "err") => { $(id).textContent = t || ""; $(id).className = "msg " + k; };
const regions = [...new Set(Object.values(TENANTS).map((t) => t.region).filter(Boolean))];
let region = (new URLSearchParams(location.search).get("rm") || "").toLowerCase();
if (!regions.some((r) => r.toLowerCase() === region)) region = "";
$("rmRegion").innerHTML = `<option value="">ทุกภาค (ทุกทีมที่บัญชีนี้ดูได้)</option>` + regions.map((r) => `<option value="${esc(r.toLowerCase())}">${esc(r)}</option>`).join("");
$("rmRegion").value = region;
$("rmRegion").onchange = () => { location.search = $("rmRegion").value ? "?rm=" + $("rmRegion").value : ""; };

// ไม่ระบุภาค = ลองทุกทีม แล้วแสดงเฉพาะทีมที่บัญชีนี้มีสิทธิ์ดู (ลิงก์เดียวใช้ได้ทุก RM)
const teams = Object.entries(TENANTS).filter(([, t]) => !region || (t.region || "").toLowerCase() === region)
  .map(([id, t]) => { const app = initializeApp(t.firebaseConfig, "rm-" + id); return { id, t, name: t.amName || t.name.replace(/^AM Check-In\s*·?\s*/, "") || "ทีม " + ((t.aliases || [])[0] || id).toUpperCase(), auth: getAuth(app), db: getFirestore(app), ok: false, err: "" }; });

const today = bkkDay();
$("rmMonth").value = today.slice(0, 7);
$("rmDay").value = today; $("rmDay").max = today;
let data = { people: [], days: [], month: "" };

function screen(id) { ["scPick", "scLogin", "scDash"].forEach((s) => $(s).classList.toggle("hidden", s !== id)); $("btnOut").classList.toggle("hidden", id !== "scDash"); }

async function init() {
  setTitle();
  if (!teams.length) { screen("scLogin"); return msg("lgMsg", "ภาคนี้ยังไม่มีทีมในระบบ"); }
  await Promise.all(teams.map((x) => x.auth.authStateReady()));
  for (const x of teams) x.ok = !!x.auth.currentUser;
  if (teams.some((x) => x.ok)) { await checkRoles(); setTitle(); if (teams.some((x) => x.ok)) { screen("scDash"); return load(); } }
  screen("scLogin"); renderStatus();
}
async function checkRoles() {
  await Promise.all(teams.filter((x) => x.ok).map(async (x) => {
    try {
      const s = await getDoc(doc(x.db, "users", x.auth.currentUser.uid));
      const role = s.exists() ? s.data().role : "";
      if (!["viewer", "rm", "admin"].includes(role)) { x.ok = false; x.err = "บัญชีนี้ไม่ใช่บัญชี RM ของทีมนี้"; await signOut(x.auth); }
    } catch (e) { x.ok = false; x.err = errText(e); }
  }));
}
let attempted = false;
function setTitle() {
  const ok = teams.filter((x) => x.ok), regs = [...new Set(ok.map((x) => x.t.region).filter(Boolean))];
  $("rmTitle").textContent = region ? `สรุปภาค ${regions.find((r) => r.toLowerCase() === region)} · ${ok.length || teams.length} ทีม`
    : ok.length ? `สรุป ${regs.join(" + ")} · ${ok.length} ทีม` : "สรุปการเข้า-ออกงาน";
}
function renderStatus() {
  const ok = teams.filter((x) => x.ok), bad = teams.filter((x) => !x.ok);
  if (!region) {
    $("lgTeams").innerHTML = ok.map((x) => `<li><span>✅ ${esc(x.name)} <span class="muted">(${esc(x.id.toUpperCase())} · ${esc(x.t.region || "")})</span></span></li>`).join("")
      + (attempted && bad.length ? `<li><details><summary class="muted">ทีมที่บัญชีนี้ยังเข้าไม่ได้ (${bad.length}) — ปกติถ้าไม่ใช่ภาคของคุณ · กดเพื่อส่งอีเมลตั้งรหัส</summary>${bad.map((x) => `<div class="row" style="justify-content:space-between;align-items:center;margin:4px 0"><span>${esc(x.name)} <span class="muted">(${esc(x.id.toUpperCase())} · ${esc(x.t.region || "")})</span></span><button class="btn sm" data-reset="${x.id}" style="width:auto;flex:0 0 auto">ส่งอีเมลตั้งรหัสผ่าน</button></div>`).join("")}</details></li>` : "");
    return;
  }
  $("lgTeams").innerHTML = teams.map((x) => `<li><span>${x.ok ? "✅" : "⬜️"} ${esc(x.name)} <span class="muted">(${esc(x.id.toUpperCase())})</span></span>
    ${x.ok ? "" : `<span class="muted">${esc(x.err || "")}</span> <button class="btn sm" data-reset="${x.id}">ส่งอีเมลตั้งรหัสผ่าน</button>`}</li>`).join("");
}
$("lgTeams").addEventListener("click", async (e) => {
  const id = e.target.dataset.reset; if (!id) return;
  const x = teams.find((t) => t.id === id), email = $("lgEmail").value.trim();
  if (!email) return msg("lgMsg", "กรอกอีเมลก่อน");
  try { await sendPasswordResetEmail(x.auth, email); msg("lgMsg", `ส่งอีเมลตั้งรหัสผ่านของทีม ${x.name} แล้ว — ตั้งรหัสเดียวกับทีมอื่น`, "ok"); }
  catch (err) { msg("lgMsg", `${x.name}: ${errText(err)} (AM ของทีมนี้ต้องเพิ่มบัญชี RM ก่อน)`); }
});
$("btnLogin").onclick = async () => {
  const email = $("lgEmail").value.trim(), pw = $("lgPw").value;
  if (!email || !pw) return msg("lgMsg", "กรอกอีเมลและรหัสผ่าน");
  busy($("btnLogin"), true, "กำลังเข้าสู่ระบบ...");
  await Promise.all(teams.map(async (x) => {
    try { await signInWithEmailAndPassword(x.auth, email, pw); x.ok = true; x.err = ""; }
    catch (e) { x.ok = false; x.err = e.code === "auth/invalid-credential" || e.code === "auth/user-not-found" ? "ยังไม่มีบัญชี หรือรหัสผ่านไม่ตรง" : errText(e); }
  }));
  await checkRoles();
  attempted = true; setTitle();
  busy($("btnLogin"), false);
  renderStatus();
  if (teams.some((x) => x.ok)) { msg("lgMsg", ""); screen("scDash"); load(); }
  else msg("lgMsg", "เข้าไม่ได้สักทีม — ให้ AM เพิ่มบัญชี RM (แท็บ ตั้งค่า) แล้วตั้งรหัสจากอีเมลที่ได้รับ");
};
$("btnOut").onclick = async () => { await Promise.all(teams.map((x) => signOut(x.auth).catch(() => {}))); teams.forEach((x) => (x.ok = false)); screen("scLogin"); renderStatus(); };

/* ---------- ดึงข้อมูล + คำนวณ (กติกาเดียวกับหน้าผู้ดูแล) ---------- */
async function teamData(x, month, fromDay, toDay) {
  const start = new Date(new Date(`${fromDay}T00:00:00+07:00`).getTime() - 6 * 3600000);
  const end = new Date(new Date(`${toDay}T00:00:00+07:00`).getTime() + 2 * 86400000);
  const [us, bs, sh, ov, ck] = await Promise.all([
    getDocs(collection(x.db, "users")), getDocs(collection(x.db, "branches")),
    getDocs(query(collection(x.db, "shifts"), where("month", "==", month))),
    getDocs(query(collection(x.db, "shiftOverrides"), where("month", "==", month))).catch(() => ({ docs: [] })),
    getDocs(query(collection(x.db, "checkins"), where("ts", ">=", Timestamp.fromDate(start)), where("ts", "<", Timestamp.fromDate(end)))),
  ]);
  const users = us.docs.map((d) => ({ uid: d.id, ...d.data() })).filter((u) => (u.role || "staff") === "staff");
  const bName = Object.fromEntries(bs.docs.map((d) => [d.id, d.data().name || d.id]));
  const ovMap = new Map(ov.docs.map((d) => [d.id, d.data()]));
  const uidBy = new Map(users.filter((u) => u.phoneKey).map((u) => [u.phoneKey, u]));
  const byUid = new Map();
  ck.docs.forEach((d) => { const c = d.data(); if (!c.ts) return; c.t = c.autoOut && c.outAt ? new Date(c.outAt) : c.ts.toDate(); (byUid.get(c.uid) || byUid.set(c.uid, []).get(c.uid)).push(c); });
  const now = new Date(), people = [], days = [];
  for (const sd of sh.docs) {
    const s = sd.data(), u = uidBy.get(s.phoneKey), list = u ? byUid.get(u.uid) || [] : [];
    const o = ovMap.get(sd.id), md = mergeDays(s, o);
    const bId = (u && u.branchId) || s.branchId || "";
    const p = { key: x.id + "|" + sd.id, team: x.name, teamId: x.id, branchId: bId, branch: bId ? `${bId} ${bName[bId] || ""}`.trim() : s.store || "", name: s.name || (u && u.name) || "", nickname: s.nickname || (u && u.nickname) || "",
      position: ((u && u.position) || s.position || "").trim(), acct: !!u, md, edited: Object.keys((o && o.days) || {}),
      work: 0, present: 0, late: 0, lateMin: 0, absent: 0, early: 0, noOut: 0, offsite: 0, off: 0, leave: 0 };
    for (const day of Object.keys(md).sort()) {
      if (day < fromDay || day > toDay) continue;
      const info = shiftInfo(md[day]); if (!info) continue;
      const recs = list.filter((c) => c.day === day), ins = recs.filter((c) => c.type === "in").map((c) => c.t).sort((a, b) => a - b);
      let status = "", out = null, state = "", late = false, offsite = false;
      if (info.off) { if (info.off === "วันหยุด") p.off++; else p.leave++; status = info.off; state = "off"; }
      else {
        const w = shiftWindow(day, info), limit = new Date(w.e.getTime() + 6 * 3600000), from = ins[0] || new Date(w.s.getTime() - 4 * 3600000);
        out = list.filter((c) => c.type === "out" && c.t > from && c.t < limit).map((c) => c.t).sort((a, b) => b - a)[0] || null;
        if (now < w.s && !ins[0]) { status = "ยังไม่ถึงกะ"; state = "wait"; }
        else {
          p.work++;
          if (!ins[0]) { state = "absent"; if (now > w.e) { p.absent++; status = "ขาดงาน"; } else status = "ยังไม่เช็กอิน"; }
          else {
            p.present++; const parts = [];
            const lateMin = Math.round((ins[0] - w.s) / 60000);
            if (lateMin > LATE_GRACE_MIN) { p.late++; p.lateMin += lateMin; parts.push(`สาย ${lateMin} น.`); late = true; }
            if (out) { const e = Math.round((w.e - out) / 60000); if (e > 0) { p.early++; parts.push(`ออกก่อน ${e} น.`); } }
            else if (now > limit) { p.noOut++; parts.push("ไม่ลงออก"); }
            if (recs.some((c) => c.offsite)) { p.offsite++; parts.push("นอกสถานที่"); offsite = true; }
            status = parts.join(" · ") || "ปกติ";
            state = out ? "done" : "in";
          }
        }
      }
      days.push({ p, team: x.name, day, branch: p.branch, name: p.name, position: p.position, code: displayCode(md[day]), label: shiftLabel(md[day]), sched: info.off ? "" : `${info.s}–${info.e}`, in: ins[0] ? fmtTime(ins[0]) : "", out: out ? fmtTime(out) : "", status, state, late, offsite });
    }
    people.push(p);
  }
  return { people, days };
}
async function load() {
  const month = $("rmMonth").value || today.slice(0, 7);
  const [y, m] = month.split("-").map(Number), last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const fromDay = $("rmStart").value && $("rmStart").value.startsWith(month) ? $("rmStart").value : `${month}-01`;
  const toDay = last < today ? last : (month === today.slice(0, 7) ? today : last);
  // วันที่ของแท็บรายวันต้องอยู่ในเดือนที่โหลด
  if (!$("rmDay").value.startsWith(month)) $("rmDay").value = toDay < fromDay ? fromDay : toDay;
  $("rmDay").min = `${month}-01`; $("rmDay").max = toDay;
  busy($("btnLoad"), true, "กำลังโหลด...");
  msg("dMsg", "", "ok");
  const res = await Promise.all(teams.filter((x) => x.ok).map((x) => teamData(x, month, fromDay, toDay).catch((e) => ({ err: `${x.name}: ${errText(e)}`, people: [], days: [] }))));
  data = { people: res.flatMap((r) => r.people), days: res.flatMap((r) => r.days), month };
  const errs = res.filter((r) => r.err).map((r) => r.err), off = region ? teams.filter((x) => !x.ok).map((x) => x.name) : [];
  msg("dMsg", [errs.join(" · "), off.length ? `ยังไม่ได้ล็อกอิน: ${off.join(", ")}` : "", `ข้อมูล ${fromDay} ถึง ${toDay} · อัปเดต ${fmtTime(new Date())}`].filter(Boolean).join(" · "), errs.length ? "err" : "ok");
  fillFilters();
  busy($("btnLoad"), false);
  render();
}

/* ---------- ตัวกรอง: ตำแหน่ง (หลายรายการ) · ทีม · สาขา · ค้นหา ---------- */
let posSel = new Set(); try { posSel = new Set(JSON.parse(localStorage.getItem("amci_rm_pos") || "[]")); } catch (e) {}
const keepSel = (el, html) => { const v = el.value; el.innerHTML = html; if ([...el.options].some((o) => o.value === v)) el.value = v; };
function fillFilters() {
  keepSel($("rmTeamF"), `<option value="">ทุกทีม</option>` + teams.filter((x) => x.ok || region).map((x) => `<option value="${esc(x.name)}">${esc(x.name)}</option>`).join(""));
  fillBranches();
  const cnt = new Map(); data.people.forEach((p) => { const k = p.position || "(ไม่ระบุตำแหน่ง)"; cnt.set(k, (cnt.get(k) || 0) + 1); });
  const list = [...cnt.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "th"));
  [...posSel].forEach((k) => { if (!cnt.has(k)) posSel.delete(k); });
  $("posList").innerHTML = list.map(([k, n]) => `<label><input type="checkbox" value="${esc(k)}"${posSel.has(k) ? " checked" : ""}> ${esc(k)} <span class="n">${n}</span></label>`).join("") || `<p class="muted">ไม่มีข้อมูลตำแหน่ง</p>`;
  posSummary();
}
function fillBranches() {
  const t = $("rmTeamF").value, bs = new Map();
  data.people.filter((p) => !t || p.team === t).forEach((p) => p.branch && bs.set(p.branch, p.branchId));
  keepSel($("rmBranchF"), `<option value="">ทุกสาขา</option>` + [...bs.keys()].sort((a, b) => a.localeCompare(b, "th")).map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join(""));
}
function posSummary() {
  const a = [...posSel];
  $("posSum").textContent = !a.length ? "ทุกตำแหน่ง" : a.length <= 2 ? a.join(", ") : `${a.slice(0, 2).join(", ")} +${a.length - 2}`;
  try { localStorage.setItem("amci_rm_pos", JSON.stringify(a)); } catch (e) {}
}
const pOk = (p) => {
  const t = $("rmTeamF").value, b = $("rmBranchF").value, s = $("rmSearch").value.trim().toLowerCase();
  return (!t || p.team === t) && (!b || p.branch === b) && (!posSel.size || posSel.has(p.position || "(ไม่ระบุตำแหน่ง)"))
    && (!s || `${p.name} ${p.nickname} ${p.branch}`.toLowerCase().includes(s));
};
const P = () => data.people.filter(pOk);
$("posList").addEventListener("change", (e) => { const c = e.target; if (!c.value) return; c.checked ? posSel.add(c.value) : posSel.delete(c.value); posSummary(); render(); });
$("posAll").onclick = () => { $("posList").querySelectorAll("input").forEach((c) => { c.checked = true; posSel.add(c.value); }); posSummary(); render(); };
$("posNone").onclick = () => { $("posList").querySelectorAll("input").forEach((c) => (c.checked = false)); posSel.clear(); posSummary(); render(); };
document.addEventListener("click", (e) => { const d = $("posBox"); if (d.open && !d.contains(e.target)) d.open = false; });
$("rmTeamF").onchange = () => { fillBranches(); render(); };
$("rmBranchF").onchange = render; $("rmSearch").oninput = render;
$("btnLoad").onclick = load; $("rmMonth").onchange = load;
$("rmDay").onchange = renderDay;

/* ---------- แท็บ ---------- */
let tab = "day";
$("rmTabs").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return; tab = b.dataset.t;
  [...$("rmTabs").children].forEach((x) => x.classList.toggle("on", x === b));
  ["day", "sum", "roster"].forEach((t) => $("rt-" + t).classList.toggle("hidden", t !== tab));
  render();
});

const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0);
const pct = (a, b) => (b ? Math.round((a / b) * 100) + "%" : "-");
function group(rows, key) {
  const g = new Map();
  rows.forEach((p) => { const k = key(p); (g.get(k) || g.set(k, []).get(k)).push(p); });
  return [...g.entries()].map(([k, rs]) => ({ k, rows: rs, n: rs.length, work: sum(rs, "work"), present: sum(rs, "present"), late: sum(rs, "late"), absent: sum(rs, "absent"), noOut: sum(rs, "noOut"), offsite: sum(rs, "offsite") }));
}
function render() { if (tab === "day") renderDay(); else if (tab === "sum") renderSum(); else renderRoster(); }

/* ---------- สรุปรายวัน (แบบหน้า AM) ---------- */
let dayFilter = "all";
const ST = { absent: ["off", "ยังไม่มา"], in: ["warn", "ยังไม่ออกงาน"], done: ["in", "ออกงานแล้ว"], off: ["", "หยุด/ลา"], wait: ["", "ยังไม่ถึงกะ"] };
function renderDay() {
  const d = $("rmDay").value || today;
  $("dyTitle").textContent = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "full" }).format(new Date(d + "T12:00:00+07:00")) + (d === today ? " (วันนี้)" : "");
  const rows = data.days.filter((r) => r.day === d && pOk(r.p));
  const cnt = { all: rows.length, absent: 0, in: 0, done: 0, late: 0, offsite: 0, off: 0 };
  rows.forEach((r) => { if (cnt[r.state] !== undefined) cnt[r.state]++; if (r.late) cnt.late++; if (r.offsite) cnt.offsite++; });
  const absentLbl = d === today ? "ยังไม่มา" : "ขาดงาน";
  $("dyChips").innerHTML = [["all", "ทั้งหมด"], ["absent", absentLbl], ["in", "ยังไม่ออกงาน"], ["done", "ออกงานแล้ว"], ["late", "มาสาย"], ["offsite", "นอกสถานที่"], ["off", "หยุด/ลา"]]
    .map(([k, l]) => `<button type="button" data-f="${k}" class="${dayFilter === k ? "on" : ""}">${l} (${cnt[k]})</button>`).join("");
  // สรุปแต่ละทีม
  const byTeam = new Map(); rows.forEach((r) => (byTeam.get(r.team) || byTeam.set(r.team, []).get(r.team)).push(r));
  const c = (rs, s) => rs.filter((r) => r.state === s).length;
  $("rmToday").innerHTML = `<tr><th>ทีม</th><th>มีกะ</th><th>เข้างานแล้ว</th><th>ออกงานแล้ว</th><th>${absentLbl}</th><th>มาสาย</th><th>นอกสถานที่</th><th>หยุด/ลา</th></tr>` +
    ([...byTeam.entries()].sort((a, b) => a[0].localeCompare(b[0], "th")).map(([t, rs]) => `<tr><td>${esc(t)}</td><td>${rs.filter((r) => r.state !== "off").length}</td><td>${c(rs, "in") + c(rs, "done")}</td><td>${c(rs, "done")}</td>
      <td>${c(rs, "absent") ? `<span class="tag off">${c(rs, "absent")}</span>` : 0}</td><td>${rs.filter((r) => r.late).length}</td><td>${rs.filter((r) => r.offsite).length}</td><td>${c(rs, "off")}</td></tr>`).join("")
      || `<tr><td class="muted" colspan="8">ไม่มีข้อมูลวันนี้</td></tr>`);
  const f = (r) => dayFilter === "all" || (dayFilter === "late" ? r.late : dayFilter === "offsite" ? r.offsite : r.state === dayFilter);
  const list = rows.filter(f).sort((a, b) => a.team.localeCompare(b.team, "th") || a.branch.localeCompare(b.branch, "th") || a.name.localeCompare(b.name, "th"));
  $("dyPeople").innerHTML = `<tr><th>ทีม</th><th>สาขา</th><th>ชื่อ</th><th>ตำแหน่ง</th><th>กะ</th><th>เข้า</th><th>ออก</th><th>สถานะ</th><th>รายละเอียด</th></tr>` +
    (list.map((r) => { const t = ST[r.state] || ["", r.status]; const lab = r.state === "absent" && d !== today ? "ขาดงาน" : t[1];
      return `<tr><td>${esc(r.team)}</td><td>${esc(r.branch)}</td><td>${esc(r.name)}${r.p.nickname ? ` (${esc(r.p.nickname)})` : ""}</td><td>${esc(r.position)}</td><td>${esc(r.label)}</td>
        <td>${r.in ? r.in.slice(0, 5) : "–"}</td><td>${r.out ? r.out.slice(0, 5) : "–"}</td><td><span class="tag ${t[0]}">${esc(lab)}</span></td><td class="muted">${esc(r.state === "off" || r.state === "wait" ? "" : r.status)}</td></tr>`; }).join("")
      || `<tr><td class="muted" colspan="9">ไม่มีรายการ</td></tr>`);
}
$("dyChips").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; dayFilter = b.dataset.f; renderDay(); });

/* ---------- สรุปทั้งเดือน ---------- */
function renderSum() {
  const ps = P();
  const kp = [["ทีม", new Set(ps.map((p) => p.team)).size], ["พนักงาน", ps.length], ["% มาทำงาน", pct(sum(ps, "present"), sum(ps, "work"))], ["มาสาย (ครั้ง)", sum(ps, "late")], ["ขาดงาน (วัน)", sum(ps, "absent")], ["ไม่ลงออก", sum(ps, "noOut")]];
  $("rmKpi").innerHTML = kp.map(([l, v]) => `<div class="stat"><span class="muted">${l}</span><b>${v}</b></div>`).join("");
  const head = `<th>พนักงาน</th><th>วันทำงาน</th><th>มาทำงาน</th><th>% มา</th><th>สาย (ครั้ง)</th><th>% ตรงเวลา</th><th>ขาด</th><th>ไม่ลงออก</th><th>นอกสถานที่</th>`;
  const cells = (g) => `<td>${g.n}</td><td>${g.work}</td><td>${g.present}</td><td>${pct(g.present, g.work)}</td><td>${g.late}</td><td>${pct(g.present - g.late, g.present)}</td><td>${g.absent || "-"}</td><td>${g.noOut || "-"}</td><td>${g.offsite || "-"}</td>`;
  $("rmTeams").innerHTML = `<tr><th>ทีม (AM)</th>${head}</tr>` + (group(ps, (p) => p.team).map((g) => `<tr><td>${esc(g.k)}</td>${cells(g)}</tr>`).join("") || `<tr><td class="muted">ไม่มีข้อมูล</td></tr>`);
  $("rmBranches").innerHTML = `<tr><th>ทีม</th><th>สาขา</th>${head}</tr>` + (group(ps, (p) => p.team + "\u0001" + p.branch).sort((a, b) => a.k.localeCompare(b.k, "th"))
    .map((g) => { const [t, b] = g.k.split("\u0001"); return `<tr><td>${esc(t)}</td><td>${esc(b)}</td>${cells(g)}</tr>`; }).join("") || `<tr><td class="muted">ไม่มีข้อมูล</td></tr>`);
  $("rmPeople").innerHTML = `<tr><th>ทีม</th><th>สาขา</th><th>ชื่อ</th><th>ตำแหน่ง</th><th>วันทำงาน</th><th>มา</th><th>สาย (ครั้ง/นาที)</th><th>ขาด</th><th>ออกก่อน</th><th>ไม่ลงออก</th><th>นอกสถานที่</th></tr>` +
    (ps.sort((a, b) => a.team.localeCompare(b.team, "th") || a.branch.localeCompare(b.branch, "th")).map((p) => `<tr><td>${esc(p.team)}</td><td>${esc(p.branch)}</td><td>${esc(p.name)}</td><td>${esc(p.position)}</td><td>${p.work}</td><td>${p.present}</td>
      <td>${p.late ? `<span class="tag warn">${p.late} / ${p.lateMin}</span>` : "-"}</td><td>${p.absent ? `<span class="tag off">${p.absent}</span>` : "-"}</td><td>${p.early || "-"}</td><td>${p.noOut || "-"}</td><td>${p.offsite || "-"}</td></tr>`).join("") || `<tr><td class="muted">ไม่มีข้อมูล</td></tr>`);
}

/* ---------- ตารางกะ (แบบหน้า AM · ดูอย่างเดียว) ---------- */
const WD = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
function rosterCls(code) {
  const i = shiftInfo(code);
  if (!normCode(code)) return "r-none";
  if (!i) return "r-unk";
  if (i.train || i.special) return "r-train";
  if (i.branch) return "r-branch";
  if (i.off) return /วันหยุด/.test(i.off) ? "r-off" : "r-leave";
  return "r-work";
}
const shortCode = (c) => normCode(c) ? displayCode(c).replace("วันหยุด", "H").replace("พักร้อน", "V").replace("ลาอื่นๆ", "OL").replace("อบรม", "T") : "";
function renderRoster() {
  const month = data.month; if (!month) return;
  const [y, m] = month.split("-").map(Number), last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const ds = Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  const wd = (d) => new Date(d + "T12:00:00+07:00").getDay(), we = (d) => wd(d) === 0 || wd(d) === 6;
  const list = P().sort((a, b) => a.team.localeCompare(b.team, "th") || String(a.branch).localeCompare(String(b.branch), "th") || a.name.localeCompare(b.name, "th"));
  const head1 = `<tr><th class="sk s1" rowspan="2">Store</th><th class="sk s2" rowspan="2">ชื่อ</th><th class="sk s3" rowspan="2">ชื่อเล่น</th><th rowspan="2" class="tm">ทีม</th><th rowspan="2">ตำแหน่ง</th>` +
    ds.map((d, i) => `<th class="dd${we(d) ? " we" : ""}${d === today ? " td" : ""}">${i + 1}</th>`).join("") + `<th rowspan="2">ทำงาน</th><th rowspan="2">หยุด/ลา</th></tr>`;
  const head2 = `<tr>${ds.map((d) => `<th class="dd wdn${we(d) ? " we" : ""}${d === today ? " td" : ""}">${WD[wd(d)]}</th>`).join("")}</tr>`;
  const body = list.slice(0, 1500).map((r) => {
    let w = 0, o = 0;
    const cells = ds.map((d) => {
      const code = r.md[d] || "", i = shiftInfo(code);
      if (i && !i.off) w++; else if (i && i.off) o++;
      const ed = r.edited.includes(d);
      return `<td class="${[rosterCls(code), ed ? "r-edit" : "", d === today ? "td" : ""].filter(Boolean).join(" ")}" title="${esc(`${d} · ${shiftLabel(code)}${ed ? " · แก้/สลับแล้ว" : ""}`)}">${esc(shortCode(code))}</td>`;
    }).join("");
    return `<tr><td class="sk s1">${esc(r.branchId || r.branch)}</td><td class="sk s2">${esc(r.name)}</td><td class="sk s3">${esc(r.nickname)}</td><td class="tm">${esc(r.team)}</td><td>${esc(r.position)}</td>${cells}<td><b>${w}</b></td><td>${o}</td></tr>`;
  }).join("");
  $("rmRoster").innerHTML = head1 + head2 + (body || `<tr><td colspan="${last + 7}" class="muted">ไม่มีข้อมูล</td></tr>`);
}

/* ---------- ดาวน์โหลด Excel (ตามตัวกรองที่เลือก) ---------- */
async function loadXLSX() {
  if (window.XLSX) return window.XLSX;
  await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"; s.onload = res; s.onerror = () => rej(new Error("โหลดตัวสร้าง Excel ไม่สำเร็จ")); document.head.appendChild(s); });
  return window.XLSX;
}
$("btnXlsx").onclick = async () => {
  busy($("btnXlsx"), true, "กำลังสร้างไฟล์...");
  try {
    const XLSX = await loadXLSX(), wb = XLSX.utils.book_new(), ps = P(), dys = data.days.filter((d) => pOk(d.p));
    const H = ["พนักงาน", "วันทำงาน", "มาทำงาน", "% มา", "สาย(ครั้ง)", "% ตรงเวลา", "ขาด", "ไม่ลงออก", "นอกสถานที่"];
    const V = (g) => [g.n, g.work, g.present, pct(g.present, g.work), g.late, pct(g.present - g.late, g.present), g.absent, g.noOut, g.offsite];
    const add = (name, rows) => { const ws = XLSX.utils.aoa_to_sheet(rows); ws["!cols"] = rows[0].map((h) => ({ wch: Math.max(8, String(h).length + 4) })); XLSX.utils.book_append_sheet(wb, ws, name); };
    add("สรุปตามทีม", [["ทีม (AM)", ...H], ...group(ps, (p) => p.team).map((g) => [g.k, ...V(g)])]);
    add("สรุปตามสาขา", [["ทีม", "สาขา", ...H], ...group(ps, (p) => p.team + "\u0001" + p.branch).map((g) => [...g.k.split("\u0001"), ...V(g)])]);
    add("รายคน", [["ทีม", "สาขา", "ชื่อ", "ตำแหน่ง", "วันทำงาน", "มา", "สาย(ครั้ง)", "สาย(นาทีรวม)", "ขาด", "ออกก่อน", "ไม่ลงออก", "นอกสถานที่", "หยุด", "ลา/พักร้อน/อบรม"],
      ...ps.map((p) => [p.team, p.branch, p.name, p.position, p.work, p.present, p.late, p.lateMin, p.absent, p.early, p.noOut, p.offsite, p.off, p.leave])]);
    add("รายวัน", [["ทีม", "วันที่", "สาขา", "ชื่อ", "ตำแหน่ง", "กะ", "เวลากะ", "เข้างาน", "ออกงาน", "สถานะ"], ...dys.map((d) => [d.team, d.day, d.branch, d.name, d.position, d.code, d.sched, d.in, d.out, d.status])]);
    if (data.month) {
      const [y, m] = data.month.split("-").map(Number), last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const ds = Array.from({ length: last }, (_, i) => `${data.month}-${String(i + 1).padStart(2, "0")}`);
      add("ตารางกะ", [["ทีม", "Store", "ชื่อ", "ชื่อเล่น", "ตำแหน่ง", ...ds.map((d) => Number(d.slice(8)))], ...ps.map((p) => [p.team, p.branch, p.name, p.nickname, p.position, ...ds.map((d) => shortCode(p.md[d] || ""))])]);
    }
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const url = URL.createObjectURL(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const a = document.createElement("a"); a.href = url; a.download = `${today}_RM-${region || "all"}_summary_${$("rmMonth").value}.xlsx`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) { msg("dMsg", errText(e)); }
  finally { busy($("btnXlsx"), false); }
};

init().catch((e) => { screen("scLogin"); msg("lgMsg", errText(e)); });
