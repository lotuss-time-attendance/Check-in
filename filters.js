// ฟิลเตอร์โทนสีแบบ IG (ปรับสีทั้งภาพ + เกลี่ยผิวเบามาก) — ใช้ทั้งตอนบันทึกรูปและพรีวิว
// แต่ละแบบ: exp = ความสว่าง, con = คอนทราสต์, sat = ความอิ่มสี, warm = อุ่น(+)/เย็น(−),
// fade = ยกเงาให้จางแบบฟิล์ม, knee = กดไฮไลต์ไม่ให้ขาวจ้า, vig = ขอบมืด, smooth = เกลี่ยผิว (0–1), tint = เขียว(−)/ชมพู(+)
export const LOOKS = [
  null,
  { key: "soft", label: "นุ่ม", exp: 1.05, con: 0.9, sat: 0.96, warm: 0.035, fade: 0.06, knee: 0.75, vig: 0.12, smooth: 0.22, tint: 0.01,
    css: "brightness(1.05) contrast(.9) saturate(.96) sepia(.08)" },
  { key: "bright", label: "สดใส", exp: 1.09, con: 0.97, sat: 1.1, warm: 0.02, fade: 0.02, knee: 0.8, vig: 0.08, smooth: 0.18, tint: 0.015,
    css: "brightness(1.09) contrast(.97) saturate(1.1) sepia(.04)" },
  { key: "film", label: "ละมุน", exp: 1.03, con: 0.86, sat: 0.88, warm: 0.05, fade: 0.11, knee: 0.7, vig: 0.18, smooth: 0.2, tint: -0.005,
    css: "brightness(1.04) contrast(.86) saturate(.88) sepia(.14)" },
  { key: "clear", label: "ขาวใส", exp: 1.12, con: 0.92, sat: 0.92, warm: -0.025, fade: 0.04, knee: 0.72, vig: 0.06, smooth: 0.25, tint: 0.01,
    css: "brightness(1.12) contrast(.92) saturate(.92) hue-rotate(-4deg)" },
];

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

// โค้งโทน: ความสว่าง → คอนทราสต์ (รอบจุดกลาง) → กดไฮไลต์แบบนุ่ม → ยกเงา (fade)
function toneLUT(P, chanGain) {
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    let x = (i / 255) * P.exp * chanGain;
    x = 0.5 + (x - 0.5) * P.con;
    if (x > P.knee) { const r = 1 - P.knee; x = P.knee + r * (1 - Math.exp(-(x - P.knee) / r)); }
    x = P.fade + x * (1 - P.fade);
    lut[i] = clamp(Math.round(x * 255));
  }
  return lut;
}

function boxBlur(src, W, H, r) {
  const tmp = new Float32Array(W * H * 3), out = new Float32Array(W * H * 3), n = 2 * r + 1;
  for (let y = 0; y < H; y++) for (let c = 0; c < 3; c++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += src[(y * W + Math.min(W - 1, Math.max(0, k))) * 4 + c];
    for (let x = 0; x < W; x++) {
      tmp[(y * W + x) * 3 + c] = s / n;
      s += src[(y * W + Math.min(W - 1, x + r + 1)) * 4 + c] - src[(y * W + Math.max(0, x - r)) * 4 + c];
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

// d = RGBA (ImageData.data) แก้ในที่เดิม
export function applyLook(d, W, H, P) {
  if (!P) return;
  // 1) เกลี่ยผิวเบา ๆ เฉพาะบริเวณที่สีใกล้เคียงกัน (ขอบตา คิ้ว ปาก ยังคม)
  if (P.smooth > 0) {
    const r = Math.max(2, Math.round(W / 160)), bl = boxBlur(d, W, H, r);
    for (let i = 0, j = 0; i < d.length; i += 4, j += 3) {
      const R = d[i], G = d[i + 1], B = d[i + 2];
      const diff = Math.abs(R - bl[j]) + Math.abs(G - bl[j + 1]) + Math.abs(B - bl[j + 2]);
      const skin = R > 60 && R > B && R >= G - 10 && R - B > 8 ? 1 : 0.35;
      const w = P.smooth * skin * Math.exp(-(diff * diff) / 1800);
      d[i] = R + (bl[j] - R) * w; d[i + 1] = G + (bl[j + 1] - G) * w; d[i + 2] = B + (bl[j + 2] - B) * w;
    }
  }
  // 2) โทนสี + ความอิ่มสี + ขอบมืด
  const lr = toneLUT(P, 1 + P.warm + P.tint * 0.5), lg = toneLUT(P, 1 - P.tint), lb = toneLUT(P, 1 - P.warm);
  const cx = W / 2, cy = H / 2, md = Math.hypot(cx, cy);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    let R = lr[d[i]], G = lg[d[i + 1]], B = lb[d[i + 2]];
    const L = 0.299 * R + 0.587 * G + 0.114 * B;
    R = L + (R - L) * P.sat; G = L + (G - L) * P.sat; B = L + (B - L) * P.sat;
    if (P.vig) { const t = Math.hypot(x - cx, y - cy) / md, v = 1 - P.vig * t * t * t; R *= v; G *= v; B *= v; }
    d[i] = clamp(R); d[i + 1] = clamp(G); d[i + 2] = clamp(B);
  }
}
