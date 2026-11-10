// ค้นหาว่าอีเมลนี้มีบัญชีอยู่ในทีมไหน (ลองล็อกอินทุกทีมพร้อมกัน) → ส่งต่อการล็อกอินไปทีมนั้นโดยไม่ต้องพิมพ์รหัสซ้ำ
import { TENANTS } from "./tenants.js";
import { TENANT_ID, TEAM_KEY } from "./firebase-config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const HANDOFF_KEY = "amci_handoff";
const probeApp = (id) => getApps().find((a) => a.name === "probe-" + id) || initializeApp(TENANTS[id].firebaseConfig, "probe-" + id);

// ต้องมีทั้งบัญชีล็อกอิน "และ" รายชื่อพนักงาน (users/{uid}) ในทีมนั้น
// — กันกรณีอีเมลเคยถูกเพิ่มในทีมอื่นแล้วลบรายชื่อออก (บัญชีล็อกอินยังค้างอยู่) ทำให้เข้าผิดทีม
export async function findTeam(email, pw) {
  const ids = Object.keys(TENANTS).filter((id) => id !== TENANT_ID);
  try {
    return await Promise.any(ids.map(async (id) => {
      const app = probeApp(id);
      const cred = await signInWithEmailAndPassword(getAuth(app), email, pw);
      const snap = await getDoc(doc(getFirestore(app), "users", cred.user.uid));
      if (!snap.exists()) throw new Error("no profile");
      return id;
    }));
  } catch (e) { return ""; }
}
// พบทีมแล้ว: จำทีม + ส่งต่อการล็อกอิน แล้วเปิดหน้าเดิมของทีมนั้น
export function goTeam(id) {
  try { localStorage.setItem(TEAM_KEY, id); sessionStorage.setItem(HANDOFF_KEY, id); } catch (e) {}
  const u = new URL(location.href);
  if (u.searchParams.has("am")) u.searchParams.set("am", id);
  location.replace(u.href);
}

// ลืมรหัสผ่านจากลิงก์กลาง: ส่งคำขอไปทุกทีม — อีเมลจะถูกส่งจากทีมที่มีบัญชีนี้จริงเท่านั้น
export async function resetAllTeams(email) {
  await Promise.allSettled(Object.keys(TENANTS).filter((id) => id !== TENANT_ID).map((id) => sendPasswordResetEmail(getAuth(probeApp(id)), email)));
}
export const teamKnown = () => { try { return !!localStorage.getItem(TEAM_KEY) || new URLSearchParams(location.search).has("am"); } catch (e) { return false; } };
