// ฟิลเตอร์แบบ IG / TikTok — ใช้ตอนบันทึกรูป (พรีวิวใช้ CSS ใกล้เคียง)
// ขั้นตอน: 1) ปรับแสงอัตโนมัติตามความสว่างกลางภาพ (หน้า) 2) แก้สีเพี้ยนจากไฟ 3) เกลี่ยผิว (ขอบคม)
//          4) ผิวสว่าง-อมชมพู 5) โทน/คอนทราสต์/ความอิ่มสี 6) เพิ่มความคมเฉพาะส่วนที่ไม่ใช่ผิว (ตา คิ้ว ผม)
// ค่า: target = ความสว่างเป้าหมายของหน้า (0–1), lift = ยกเงา, smooth = เกลี่ยผิว (0–1), glow = ผิวสว่างขึ้น,
//      blush = อมชมพู, warm = อุ่น(+)/เย็น(−), sat = ความอิ่มสี, con = คอนทราสต์, sharp = ความคม, vig = ขอบมืด
export const LOOKS = [
  null,
  { key: "clear", label: "ใส", target: 0.52, lift: 0.025, smooth: 0.55, glow: 0.06, blush: 0.02, warm: 0.01, sat: 1.1, con: 1.0, sharp: 0.35, vig: 0,
    css: "brightness(1.15) contrast(.94) saturate(1.05)" },
  { key: "glow", label: "ผิวเนียน", target: 0.54, lift: 0.035, smooth: 0.85, glow: 0.08, blush: 0.03, warm: 0.015, sat: 1.06, con: 0.97, sharp: 0.25, vig: 0,
    css: "brightness(1.2) contrast(.9) saturate(1.02) sepia(.04)" },
  { key: "white", label: "ขาวใส", target: 0.58, lift: 0.04, smooth: 0.65, glow: 0.10, blush: 0.02, warm: -0.025, sat: 1.0, con: 0.96, sharp: 0.3, vig: 0,
    css: "brightness(1.25) contrast(.9) saturate(.94) hue-rotate(-4deg)" },
  { key: "warm", label: "ละมุน", target: 0.50, lift: 0.06, smooth: 0.6, glow: 0.06, blush: 0.03, warm: 0.045, sat: 0.98, con: 0.92, sharp: 0.2, vig: 0.12,
    css: "brightness(1.12) contrast(.88) saturate(.92) sepia(.12)" },
];
export const DEFAULT_LOOK = 1; // เปิด "ใส" ไว้ก่อน

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

function boxBlur(src, W, H, r, stride) {
  const tmp = new Float32Array(W * H * 3), out = new Float32Array(W * H * 3), n = 2 * r + 1;
  for (let y = 0; y < H; y++) for (let c = 0; c < 3; c++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += src[(y * W + Math.min(W - 1, Math.max(0, k))) * stride + c];
    for (let x = 0; x < W; x++) {
      tmp[(y * W + x) * 3 + c] = s / n;
      s += src[(y * W + Math.min(W - 1, x + r + 1)) * stride + c] - src[(y * W + Math.max(0, x - r)) * stride + c];
    }
  }
  for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[(Math.min(H - 1, Math.max(0, k)) * W + x) * 3 + c];
    for (let y = 0; y < H; y++) {
      out[(y * W + x) * 3 + c] = s / n;
      s += tmp[(Math.min(H - 1, y + r + 1) * W + x) * 3 + c] - tmp[(Math.max(0, y - r) * W + x) * 3 + c];
    }
  }
  return out;
}

// โอกาสเป็นผิว (0–1) จากสี YCbCr — ใช้ได้กับผิวคนไทยหลายโทน
function skinProb(R, G, B) {
  const Y = 0.299 * R + 0.587 * G + 0.114 * B;
  if (Y < 35) return 0;
  const cb = 128 - 0.168736 * R - 0.331264 * G + 0.5 * B, cr = 128 + 0.5 * R - 0.418688 * G - 0.081312 * B;
  const dcb = (cb - 110) / 18, dcr = (cr - 150) / 16;
  return Math.exp(-(dcb * dcb + dcr * dcr) / 2);
}

// d = RGBA (ImageData.data) แก้ในที่เดิม
export function applyLook(d, W, H, P) {
  if (!P) return;
  const N = W * H;

  // 1) วัดแสงกลางภาพ (บริเวณหน้า) + ค่าเฉลี่ยสี (แก้ไฟเหลือง/ไฟฟ้า)
  let sumY = 0, cnt = 0, sr = 0, sg = 0, sb = 0;
  const hist = new Uint32Array(256), skHist = new Uint32Array(256); let skCnt = 0;
  for (let y = Math.floor(H * 0.2); y < H * 0.7; y += 2) for (let x = Math.floor(W * 0.25); x < W * 0.75; x += 2) {
    const i = (y * W + x) * 4, Y = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
    hist[Y]++; sumY += Y; cnt++; sr += d[i]; sg += d[i + 1]; sb += d[i + 2];
    if (skinProb(d[i], d[i + 1], d[i + 2]) > 0.4) { skHist[Y]++; skCnt++; }
  }
  // มีผิวในกลางภาพพอ → วัดแสงจากหน้า (ไม่ให้เสื้อ/พื้นหลังมืดหลอกจนหน้าขาวเกิน)
  const useSkin = skCnt > cnt * 0.04, hh = useSkin ? skHist : hist, nn = useSkin ? skCnt : cnt;
  // ใช้ค่ากลาง (median) แทนค่าเฉลี่ย จะไม่หลอกด้วยพื้นหลังสว่าง/มืด
  let acc = 0, med = 128;
  for (let v = 0; v < 256; v++) { acc += hh[v]; if (acc >= nn / 2) { med = v; break; } }
  // หน้าคน: เป้าหมายสูงกว่าค่ากลางทั้งภาพเล็กน้อย
  const m = Math.max(0.08, med / 255), tgt = useSkin ? P.target + 0.08 : P.target;
  // แปลงเป็นค่า gamma ให้ค่ากลางไปอยู่ที่ target (สว่างขึ้นโดยไฮไลต์ไม่ขาวจ้า) · จำกัดไม่ให้ปรับแรงเกิน
  let gamma = Math.log(tgt) / Math.log(m);
  gamma = Math.min(1.1, Math.max(0.6, gamma));
  // แก้สีเพี้ยน 40% (gray-world เบา ๆ)
  const avg = (sr + sg + sb) / 3 || 1;
  const wr = 1 + 0.4 * (avg / (sr || 1) - 1) + P.warm, wg = 1 + 0.4 * (avg / (sg || 1) - 1), wb = 1 + 0.4 * (avg / (sb || 1) - 1) - P.warm;

  // ตารางโทน: gamma → ยกเงา → คอนทราสต์ → กดไฮไลต์นุ่ม ๆ
  const lut = new Float32Array(256);
  for (let v = 0; v < 256; v++) {
    let x = Math.pow(v / 255, gamma);
    x = P.lift + x * (1 - P.lift);
    x = 0.5 + (x - 0.5) * P.con;
    if (x > 0.86) x = 0.86 + 0.14 * (1 - Math.exp(-(x - 0.86) / 0.14));
    lut[v] = x * 255;
  }
  const f = new Float32Array(N * 3);
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    f[p * 3] = lut[clamp(Math.round(d[i] * wr))];
    f[p * 3 + 1] = lut[clamp(Math.round(d[i + 1] * wg))];
    f[p * 3 + 2] = lut[clamp(Math.round(d[i + 2] * wb))];
  }

  // 2) เกลี่ยผิว 2 ระดับ (ละเอียด + กว้าง) เฉพาะผิวที่สีใกล้กัน → ตา คิ้ว ปาก ยังคม
  const r1 = Math.max(2, Math.round(W / 150)), r2 = Math.max(4, Math.round(W / 70));
  const b1 = boxBlur(f, W, H, r1, 3), b2 = boxBlur(f, W, H, r2, 3);
  const cx = W / 2, cy = H / 2, md = Math.hypot(cx, cy);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x, j = p * 3, i = p * 4;
    let R = f[j], G = f[j + 1], B = f[j + 2];
    const sk = skinProb(R, G, B);
    const diff1 = Math.abs(R - b1[j]) + Math.abs(G - b1[j + 1]) + Math.abs(B - b1[j + 2]);
    const diff2 = Math.abs(R - b2[j]) + Math.abs(G - b2[j + 1]) + Math.abs(B - b2[j + 2]);
    const w1 = P.smooth * (0.25 + 0.75 * sk) * Math.exp(-(diff1 * diff1) / 2200);
    const w2 = P.smooth * 0.6 * sk * Math.exp(-(diff2 * diff2) / 3500);
    R += (b1[j] - R) * w1; G += (b1[j + 1] - G) * w1; B += (b1[j + 2] - B) * w1;
    R += (b2[j] - R) * w2; G += (b2[j + 1] - G) * w2; B += (b2[j + 2] - B) * w2;

    // 3) ความคม: เฉพาะส่วนที่ไม่ใช่ผิว (ตา ผม เสื้อ) — ช่วยให้ภาพดู "ใส" ไม่เบลอ
    if (P.sharp) {
      const k = P.sharp * (1 - sk);
      R += (f[j] - b1[j]) * k; G += (f[j + 1] - b1[j + 1]) * k; B += (f[j + 2] - b1[j + 2]) * k;
    }
    // 4) ผิวสว่างขึ้น + อมชมพูนิด ๆ
    if (sk > 0.05) {
      const g = 1 + P.glow * sk;
      R = R * g + 255 * P.blush * sk; G = G * g; B = B * g + 255 * P.blush * 0.4 * sk;
    }
    // 5) ความอิ่มสี + ขอบมืด
    const L = 0.299 * R + 0.587 * G + 0.114 * B;
    R = L + (R - L) * P.sat; G = L + (G - L) * P.sat; B = L + (B - L) * P.sat;
    if (P.vig) { const t = Math.hypot(x - cx, y - cy) / md, v = 1 - P.vig * t * t * t; R *= v; G *= v; B *= v; }
    // ไฮไลต์นุ่ม (ไม่ให้แก้ม/หน้าผากขาวโพลน)
    d[i] = R > 235 ? 235 + 20 * (1 - Math.exp(-(R - 235) / 20)) : clamp(R);
    d[i + 1] = G > 235 ? 235 + 20 * (1 - Math.exp(-(G - 235) / 20)) : clamp(G);
    d[i + 2] = B > 235 ? 235 + 20 * (1 - Math.exp(-(B - 235) / 20)) : clamp(B);
  }
}
