// ============================================================
//  รายชื่อ AM ที่ใช้ระบบนี้ — 1 AM = 1 Firebase (ข้อมูล/บัญชี/โควตาแยกกันเด็ดขาด)
//  เพิ่ม AM ใหม่: เปิดหน้า setup.html → กรอกข้อมูล → คัดลอกบล็อกที่ได้มาวางต่อท้ายในรายการนี้
//  ลิงก์กลาง (ทุกทีม): พนักงาน …/  ·  AM …/admin.html  ·  RM …/rm.html — ระบบหาทีมจากบัญชีที่ล็อกอิน
//  ลิงก์เฉพาะทีม (สำรอง): …/?am=<รหัสทีม เช่น e1>
// ============================================================
export const DEFAULT_TENANT = "east"; // ทีมที่ลองก่อนเมื่อเปิดลิงก์กลางครั้งแรก (ถ้าบัญชีไม่อยู่ทีมนี้ ระบบจะค้นหาทีมอื่นให้อัตโนมัติ)

// ปุ่ม "ส่งเข้า Google Sheet" — OAuth Client ID (ประเภท Web application) ตั้งครั้งเดียว ใช้ได้ทุก AM
// ชีตจะถูกสร้างใน Drive ของคนที่กดปุ่ม ไม่ผ่านพื้นที่ของเจ้าของ Client ID · เว้นว่าง = ซ่อนการทำงาน (ใช้ปุ่ม Excel แทน)
export const GOOGLE_CLIENT_ID = "590562682171-omf4u1edg9koq9nf4f5bae9nuf035mpe.apps.googleusercontent.com";

export const TENANTS = {
  // ---------- AM East (Punnapat) ----------
  east: {
    aliases: ["e4"],          // รหัสทีม E4 ในแบบฟอร์ม → ?am=e4 ใช้ได้เหมือนกัน
    region: "East",           // ภาค — RM ของภาคนี้ดูสรุปได้ที่ rm.html?rm=east
    amName: "Punnapat N.",    // ชื่อที่แสดงในหน้าสรุป RM
    name: "AM Check-In",
    ownerEmail: "kanlys.2541@gmail.com",
    multiZone: false,
    defaultRadius: 200,
    firebaseConfig: {
      apiKey: "AIzaSyARoRNjmbNXiF0mjBOOGgP2R-5fOSDuDAA",
      authDomain: "check-in-am-punnapat.firebaseapp.com",
      projectId: "check-in-am-punnapat",
      storageBucket: "check-in-am-punnapat.firebasestorage.app",
      messagingSenderId: "590562682171",
      appId: "1:590562682171:web:8c5ec6182d87925568831e"
    }
  },

  // ---------- วาง AM ใหม่ต่อจากบรรทัดนี้ ----------

  // ---------- S1 · Ubonrat S. ----------
  "s1": {
    name: "AM Check-In · Ubonrat S.",
    region: "South",
    ownerEmail: "tn844sd@gmail.com",
    multiZone: false,
    defaultRadius: 200,
    firebaseConfig: {
      apiKey: "AIzaSyDIdVf_NDFROlDSubZhdWnfu3r6afqLqt0",
      authDomain: "checkin-s1.firebaseapp.com",
      projectId: "checkin-s1",
      storageBucket: "checkin-s1.firebasestorage.app",
      messagingSenderId: "1040805777386",
      appId: "1:1040805777386:web:399eb4a74a7c44a10bec93"
    }
  },


  // ---------- E2 · Pattarasiri S. ----------
  "e2": {
    name: "AM Check-In · Pattarasiri S.",
    region: "East",
    ownerEmail: "pattarasiri1612@gmail.com",
    multiZone: false,
    defaultRadius: 200,
    firebaseConfig: {
      apiKey: "AIzaSyB8_6KqzdCBn03k0Ng86yoclUj1l33jQZo",
      authDomain: "checkin-e2.firebaseapp.com",
      projectId: "checkin-e2",
      storageBucket: "checkin-e2.firebasestorage.app",
      messagingSenderId: "867526731219",
      appId: "1:867526731219:web:e6edec9b02521bb633bb26"
    }
  },

  // ---------- S2 · Tananan P. ----------
  "s2": {
    name: "AM Check-In · Tananan P.",
    region: "South",
    ownerEmail: "tanananpakdeelertvichian@gmail.com",
    multiZone: false,
    defaultRadius: 200,
    firebaseConfig: {
      apiKey: "AIzaSyCf5vD8-4EZ-8TNT5N9inmjQWOhxhtwxtU",
      authDomain: "checkin-s2.firebaseapp.com",
      projectId: "checkin-s2",
      storageBucket: "checkin-s2.firebasestorage.app",
      messagingSenderId: "127264605506",
      appId: "1:127264605506:web:824ad571d1d57a3bb334db"
    }
  },

  // ---------- S3 · Nantiya F. ----------
  "s3": {
    name: "AM Check-In · Nantiya F.",
    region: "South",
    ownerEmail: "nantiya.sindee@gmail.com",
    multiZone: false,
    defaultRadius: 200,
    firebaseConfig: {
      apiKey: "AIzaSyAeeKS9HYcwUovg0nGsaVDkgcl8iFHVdVA",
      authDomain: "checkin-s3.firebaseapp.com",
      projectId: "checkin-s3",
      storageBucket: "checkin-s3.firebasestorage.app",
      messagingSenderId: "431509096458",
      appId: "1:431509096458:web:d44fab13dc52452f4777f3"
    }
  },

  // ---------- S4 · Eakapol T. ----------
  "s4": {
    name: "AM Check-In · Eakapol T.",
    region: "South",
    ownerEmail: "eakapon1993tk@gmail.com",
    multiZone: false,
    defaultRadius: 200,
    firebaseConfig: {
      apiKey: "AIzaSyCXTg7I6b05Fbj9Yoq9JzhkJJhOgAnl3cI",
      authDomain: "checkin-s4.firebaseapp.com",
      projectId: "checkin-s4",
      storageBucket: "checkin-s4.firebasestorage.app",
      messagingSenderId: "294804175029",
      appId: "1:294804175029:web:7bdf1d07861b313786e6fc"
    }
  },

  // ---------- E1 · Janjira B. ----------
  "e1": {
    name: "AM Check-In · Janjira B.",
    region: "East",
    ownerEmail: "jenjiraboknoi@gmail.com",
    multiZone: false,
    defaultRadius: 200,
    firebaseConfig: {
      apiKey: "AIzaSyARUD2ubJg737ss03F1CjqHgdB6__xJwRA",
      authDomain: "checkin-e1.firebaseapp.com",
      projectId: "checkin-e1",
      storageBucket: "checkin-e1.firebasestorage.app",
      messagingSenderId: "617416718928",
      appId: "1:617416718928:web:7b3694946fdec195176f55"
    }
  },

  // ---------- E3 · Sirirojn W. ----------
  "e3": {
    name: "AM Check-In · Sirirojn W.",
    region: "East",
    ownerEmail: "sirirojn.wo@gmail.com",
    multiZone: false,
    defaultRadius: 200,
    firebaseConfig: {
      apiKey: "AIzaSyBCKbF5BYH4XpH5RU03Lw2BFZeP6KwrP2Q",
      authDomain: "checkin-e3.firebaseapp.com",
      projectId: "checkin-e3",
      storageBucket: "checkin-e3.firebasestorage.app",
      messagingSenderId: "534835542585",
      appId: "1:534835542585:web:8bc71b81b2970e02882be8"
    }
  },


  // ---------- NE1 · Sirikorn M. ----------
  "ne1": {
    name: "AM Check-In · Sirikorn M.",
    region: "Northeast",
    ownerEmail: "sirikornmeepon@gmail.com",
    multiZone: false,
    defaultRadius: 200,
    firebaseConfig: {
      apiKey: "AIzaSyCL5me-PtNjAp8FpsHGiA-7TqhT0pWsCH4",
      authDomain: "checkin-ne1.firebaseapp.com",
      projectId: "checkin-ne1",
      storageBucket: "checkin-ne1.firebasestorage.app",
      messagingSenderId: "227296670201",
      appId: "1:227296670201:web:5d3a0e77e1ee5e1ec74d28"
    }
  },

  // ---------- NE2 · Natcharee S. ----------
  "ne2": {
    name: "AM Check-In · Natcharee S.",
    region: "Northeast",
    ownerEmail: "natchaza159@gmail.com",
    multiZone: false,
    defaultRadius: 200,
    firebaseConfig: {
      apiKey: "AIzaSyBaYLFTfEu_kyx0RbIHNBaT696HqBWImus",
      authDomain: "checkin-ne2.firebaseapp.com",
      projectId: "checkin-ne2",
      storageBucket: "checkin-ne2.firebasestorage.app",
      messagingSenderId: "174173425429",
      appId: "1:174173425429:web:a032cbfc9be6e610be231c"
    }
  },

  // ---------- NE3 · Thanawan T. ----------
  "ne3": {
    name: "AM Check-In · Thanawan T.",
    region: "Northeast",
    ownerEmail: "thanawan.thiengtum@gmail.com",
    multiZone: false,
    defaultRadius: 200,
    firebaseConfig: {
      apiKey: "AIzaSyDttzi2TM9Zrv-fz2efRmwMiGrOCwcUeHc",
      authDomain: "checkin-ne3.firebaseapp.com",
      projectId: "checkin-ne3",
      storageBucket: "checkin-ne3.firebasestorage.app",
      messagingSenderId: "1073581270390",
      appId: "1:1073581270390:web:37c294a32744f367194657"
    }
  },

  // ---------- NE4 · Kanyanatt P. ----------
  "ne4": {
    name: "AM Check-In · Kanyanatt P.",
    region: "Northeast",
    ownerEmail: "work.kan168@gmail.com",
    multiZone: false,
    defaultRadius: 200,
    firebaseConfig: {
      apiKey: "AIzaSyAN6NzHMQQPJF-L_gV4hLJmpb3hN03jC08",
      authDomain: "checkin-ne4.firebaseapp.com",
      projectId: "checkin-ne4",
      storageBucket: "checkin-ne4.firebasestorage.app",
      messagingSenderId: "598842047889",
      appId: "1:598842047889:web:ab43dabeb6be0625e22e30"
    }
  },

  // ---------- N1 · Panitsupa T. ----------
  "n1": {
    name: "AM Check-In · Panitsupa T.",
    region: "North",
    ownerEmail: "panit.ice1979@gmail.com",
    multiZone: false,
    defaultRadius: 200,
    firebaseConfig: {
      apiKey: "AIzaSyA2Vp3ReJCQtD2iqEzrhMPkuJJNFXMpkpU",
      authDomain: "checkin-n1.firebaseapp.com",
      projectId: "checkin-n1",
      storageBucket: "checkin-n1.firebasestorage.app",
      messagingSenderId: "798169044449",
      appId: "1:798169044449:web:9e8cf814f1f2b0c4fe6ea0"
    }
  },

  // ---------- N2 · Somreuthai P. ----------
  "n2": {
    name: "AM Check-In · Somreuthai P.",
    region: "North",
    ownerEmail: "somreuthai2432@gmail.com",
    multiZone: false,
    defaultRadius: 200,
    firebaseConfig: {
      apiKey: "AIzaSyCnZn5ZY_KNcSKtc8YcrwU0mqWWU8KZZ8I",
      authDomain: "checkin-n2.firebaseapp.com",
      projectId: "checkin-n2",
      storageBucket: "checkin-n2.firebasestorage.app",
      messagingSenderId: "345443997671",
      appId: "1:345443997671:web:a99040588976803c0c8f42"
    }
  },

  // ---------- N3 · Watcharee V. ----------
  "n3": {
    name: "AM Check-In · Watcharee V.",
    region: "North",
    ownerEmail: "took.watcharee1612@gmail.com",
    multiZone: false,
    defaultRadius: 200,
    firebaseConfig: {
      apiKey: "AIzaSyCzaQJwaxB5iC3vA29eDJ9l_aEstAF5cSE",
      authDomain: "checkin-n3.firebaseapp.com",
      projectId: "checkin-n3",
      storageBucket: "checkin-n3.firebasestorage.app",
      messagingSenderId: "790702741399",
      appId: "1:790702741399:web:9779d39d3c829b248e16d2"
    }
  },

  // ---------- N4 · Kannika O. ----------
  "n4": {
    name: "AM Check-In · Kannika O.",
    region: "North",
    ownerEmail: "kannika.onchim8080@gmail.com",
    multiZone: false,
    defaultRadius: 200,
    firebaseConfig: {
      apiKey: "AIzaSyAuSByoSej_LvZzFLQWV2PDqTgCKllJNhE",
      authDomain: "checkin-n4.firebaseapp.com",
      projectId: "checkin-n4",
      storageBucket: "checkin-n4.firebasestorage.app",
      messagingSenderId: "754877104628",
      appId: "1:754877104628:web:d4c2ea7c20a8722e0139a1"
    }
  },
};
