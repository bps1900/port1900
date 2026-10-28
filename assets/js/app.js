/**
 * Logic halaman publik: ambil data rapat dari Apps Script,
 * render sebagai timeline yang dikelompokkan per tanggal,
 * dengan status: Hari ini / Akan datang / Selesai, mendukung jadwal rentang,
 * dan paginasi (10 rapat/halaman).
 */

const PER_PAGE = 10;

let ALL_MEETINGS = [];
let currentPage = 1;

document.getElementById("orgName").textContent = CONFIG.NAMA_ORGANISASI;

/**
 * Google Apps Script mengirim tanggal/jam sebagai objek Date yang otomatis
 * diserialisasi ke ISO string UTC. Data sebenarnya WIB (UTC+7), jadi dikoreksi +7 jam.
 */
function normalizeDate(value) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (isNaN(d)) return "";
  const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 10);
}

function normalizeTime(value) {
  if (!value) return "";
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return value.slice(0, 5);
  const d = new Date(value);
  if (isNaN(d)) return "";
  const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(11, 16);
}

function formatTanggal(dateStr, opts) {
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("id-ID", opts || { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  } catch {
    return dateStr;
  }
}

// Label tanggal: 1 hari -> "Selasa, 27 Oktober 2026"; rentang -> "Selasa, 27 – Kamis, 29 Oktober 2026"
function formatRentang(start, end) {
  if (!end || end <= start) return formatTanggal(start);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  if (sameMonth) {
    const a = formatTanggal(start, { weekday: "long", day: "numeric" });
    const b = formatTanggal(end, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    return `${a} – ${b}`;
  }
  return `${formatTanggal(start)} – ${formatTanggal(end)}`;
}

// Tanggal hari ini dalam WIB (UTC+7), format "YYYY-MM-DD".
function todayWIB() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function dayDiff(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/**
 * Status efektif rapat:
 *  - "done"     : admin menandai "Sudah selesai", ATAU seluruh jadwal sudah lewat
 *  - "today"    : hari ini berada di dalam jadwal (tanggal mulai <= hari ini <= tanggal selesai)
 *  - "upcoming" : jadwal mulai setelah hari ini
 */
function effectiveStatus(m) {
  if (m.status === "done") return "done";
  if (!m.date) return "upcoming";
  const t = todayWIB();
  if (m.lastDate < t) return "done";
  if (m.date <= t) return "today";
  return "upcoming";
}

function escapeHtml(str = "") {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/**
 * Kolom "otherLink" di sheet menyimpan salah satu format berikut:
 *  - [{"label":"..","url":".."}, ...]                 (format lama, tanpa rentang)
 *  - {"links":[{label,url},...], "endDate":"YYYY-MM-DD"}  (format baru, jadwal rentang)
 *  - URL polos (data paling lama)
 */
function parseMeta(raw) {
  const meta = { links: [], endDate: "" };
  if (!raw) return meta;
  const clean = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .map((x, i) => (x ? { label: x.label || "Link Lainnya", url: x.url || "", locked: !!x.locked, idx: i } : null))
      .filter((x) => x && (x.url || x.locked));
  try {
    const p = JSON.parse(raw);
    if (Array.isArray(p)) {
      meta.links = clean(p);
      return meta;
    }
    if (p && typeof p === "object") {
      meta.links = clean(p.links);
      meta.endDate = /^\d{4}-\d{2}-\d{2}$/.test(p.endDate || "") ? p.endDate : "";
      return meta;
    }
  } catch (e) {
    // bukan JSON -> URL polos
  }
  meta.links = [{ label: "Link Lainnya", url: String(raw) }];
  return meta;
}

// Warna tombol link custom: dibagi BERURUTAN per kartu (tombol 1 dapat warna 1, tombol 2 warna 2, dst),
// sehingga tidak ada dua tombol dalam satu kartu yang warnanya sama. Palet dipilih agar saling berjauhan
// dan berbeda dari warna tombol bawaan (Zoom, Virtual Background, YouTube, Materi, Daftar Hadir).
const CUSTOM_COLORS = ["#aa1879", "#863913", "#137386", "#867313", "#4d1386", "#1861aa", "#398613", "#861339", "#57534E", "#aa18aa"];

// Ikon tombol link custom: dipilih otomatis dari kata kunci pada judul.
// Urutan penting: aturan paling atas yang cocok dipakai. Tambah baris baru di sini kalau perlu.
const ICON_RULES = [
  [/dokumentasi|foto|galeri|gambar|album/, "📷"],
  [/video|rekaman|record|youtube|streaming/, "🎬"],
  [/undangan|surat|nota dinas|\bsk\b|\btor\b|edaran|\bst\b/, "✉️"],
  [/notulen|notulensi|risalah|catatan|\bmom\b/, "📝"],
  [/absen|hadir|presensi|peserta/, "✅"],
  [/\blk\b|laporan|report|rekap|hasil/, "📑"],
  [/data|dataset|tabel|rincian|\bdds\b/, "📊"],
  [/jadwal|agenda|rundown|susunan acara|kalender/, "🗓️"],
  [/panduan|juknis|petunjuk|manual|pedoman|tutorial|\bsop\b/, "📘"],
  [/paparan|presentasi|slide|\bppt\b|materi/, "📽️"],
  [/form|kuesioner|kuisioner|survei|survey|isian|quiz|kuis/, "📋"],
  [/excel|xls|spreadsheet|sheet/, "📗"],
  [/\bpdf\b/, "📕"],
  [/evaluasi|penilaian|nilai|feedback|umpan/, "⭐"],
  [/grup|group|whatsapp|\bwa\b|telegram|diskusi|chat/, "💬"],
  [/zoom|meet|meeting|webinar|teams/, "🎥"],
  [/background|backdrop|latar/, "🖼️"],
  [/sertifikat|e-?cert/, "🎓"],
  [/website|web|portal|situs|aplikasi|app\b/, "🌐"],
  [/folder|drive|arsip|dokumen|berkas|file/, "📁"],
];
function iconFor(label) {
  const s = String(label).toLowerCase();
  for (const [re, icon] of ICON_RULES) if (re.test(s)) return icon;
  return "🔗";
}

function linkButtonsHtml(m) {
  const btns = [];
  if (m.zoomLink)       btns.push(`<a class="link-btn zoom"       href="${m.zoomLink}"       target="_blank" rel="noopener"><img src="assets/img/zoom.png"          alt="" class="link-btn-icon"> Join Zoom</a>`);
  if (m.virtualBgLink)  btns.push(`<a class="link-btn virtualbg"  href="${m.virtualBgLink}"  target="_blank" rel="noopener"><img src="assets/img/vb.png"            alt="" class="link-btn-icon"> Virtual Background</a>`);
  if (m.youtubeLink)    btns.push(`<a class="link-btn youtube"    href="${m.youtubeLink}"    target="_blank" rel="noopener"><img src="assets/img/youtube.png"        alt="" class="link-btn-icon"> YouTube</a>`);
  if (m.materialLink)   btns.push(`<a class="link-btn material"   href="${m.materialLink}"   target="_blank" rel="noopener"><img src="assets/img/materi.png"         alt="" class="link-btn-icon"> Materi</a>`);
  if (m.attendanceLink) btns.push(`<a class="link-btn attendance" href="${m.attendanceLink}" target="_blank" rel="noopener"><img src="assets/img/daftar%20hadir.png" alt="" class="link-btn-icon"> Daftar Hadir</a>`);
  m.links.forEach((l, i) => {
    const color = CUSTOM_COLORS[i % CUSTOM_COLORS.length];
    if (l.locked) {
      btns.push(`<a class="link-btn custom locked" style="background:${color}" href="#" role="button" data-mid="${escapeHtml(m.id)}" data-idx="${l.idx}" data-label="${escapeHtml(l.label)}">${iconFor(l.label)} ${escapeHtml(l.label)}</a>`);
    } else {
      btns.push(`<a class="link-btn custom" style="background:${color}" href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${iconFor(l.label)} ${escapeHtml(l.label)}</a>`);
    }
  });
  if (btns.length === 0) return `<span style="color:var(--text-muted);font-size:.85rem;">Belum ada link</span>`;
  const remainder = btns.length % 3;
  if (remainder !== 0) {
    for (let i = 0; i < 3 - remainder; i++) btns.push(`<div class="link-btn-spacer"></div>`);
  }
  return btns.join("");
}

/* ---------- Hitung jumlah & update pill/opsi filter ---------- */
function updateCounts() {
  const total = ALL_MEETINGS.length;
  const count = (s) => ALL_MEETINGS.filter((m) => m.effStatus === s).length;
  const today = count("today");
  const upcoming = count("upcoming");
  const done = count("done");

  document.getElementById("countAll").textContent = `Semua: ${total}`;
  document.getElementById("countUpcoming").textContent = `Mendatang: ${upcoming}`;
  document.getElementById("countDone").textContent = `Selesai: ${done}`;

  const sel = document.getElementById("filterStatus");
  sel.querySelector('option[value="active"]').textContent = `Hari ini & akan datang (${today + upcoming})`;
  sel.querySelector('option[value="today"]').textContent = `Hari ini (${today})`;
  sel.querySelector('option[value="upcoming"]').textContent = `Akan datang (${upcoming})`;
  sel.querySelector('option[value="done"]').textContent = `Sudah selesai (${done})`;
  sel.querySelector('option[value="all"]').textContent = `Semua (${total})`;

  const pill = document.getElementById("countToday");
  pill.textContent = `Ada rapat hari ini (${today})`;
  pill.style.display = today > 0 ? "inline-block" : "none";
}

/* ---------- Paginasi ---------- */
function pageNumbers(total, current) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current - 1, current, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push("...");
    out.push(p);
  });
  return out;
}

function renderPagination(totalItems, totalPages) {
  const wrap = document.getElementById("pagination");
  if (totalPages <= 1) {
    wrap.innerHTML = "";
    return;
  }
  const start = (currentPage - 1) * PER_PAGE + 1;
  const end = Math.min(currentPage * PER_PAGE, totalItems);

  let html = `<div class="pagination">`;
  html += `<button type="button" class="page-btn" data-page="${currentPage - 1}" ${currentPage === 1 ? "disabled" : ""} aria-label="Sebelumnya">&lsaquo;</button>`;
  pageNumbers(totalPages, currentPage).forEach((p) => {
    if (p === "...") {
      html += `<span class="page-ellipsis">…</span>`;
    } else {
      html += `<button type="button" class="page-btn ${p === currentPage ? "active" : ""}" data-page="${p}" ${p === currentPage ? 'aria-current="page"' : ""}>${p}</button>`;
    }
  });
  html += `<button type="button" class="page-btn" data-page="${currentPage + 1}" ${currentPage === totalPages ? "disabled" : ""} aria-label="Berikutnya">&rsaquo;</button>`;
  html += `</div>`;
  html += `<p class="page-info">Menampilkan ${start}–${end} dari ${totalItems} rapat</p>`;
  wrap.innerHTML = html;
}

document.getElementById("pagination").addEventListener("click", (e) => {
  const btn = e.target.closest(".page-btn");
  if (!btn || btn.disabled) return;
  const page = Number(btn.dataset.page);
  if (!page || page === currentPage) return;
  currentPage = page;
  render();
  document.getElementById("timeline").scrollIntoView({ behavior: "smooth", block: "start" });
});

/* ---------- Render ---------- */
function emptyMessage(status, query) {
  if (query) return "Tidak ada rapat yang cocok dengan pencarian kamu.";
  if (status === "active") return "Belum ada rapat hari ini maupun mendatang. Lihat filter “Sudah selesai” untuk rapat sebelumnya.";
  if (status === "today") return "Tidak ada rapat hari ini.";
  if (status === "upcoming") return "Belum ada rapat mendatang.";
  if (status === "done") return "Belum ada rapat yang selesai.";
  return "Belum ada rapat.";
}

function rangeChipHtml(m) {
  if (!m.endDate) return "";
  const total = dayDiff(m.date, m.endDate) + 1;
  if (m.effStatus === "today") {
    const now = dayDiff(m.date, todayWIB()) + 1;
    return `<span class="range-chip">Hari ke-${now} dari ${total}</span>`;
  }
  return `<span class="range-chip">${total} hari</span>`;
}

function render() {
  const query = document.getElementById("searchInput").value.trim().toLowerCase();
  const status = document.getElementById("filterStatus").value;

  const filtered = ALL_MEETINGS.filter((m) => {
    const matchQuery = !query || m.title.toLowerCase().includes(query);
    let matchStatus;
    if (status === "all") matchStatus = true;
    else if (status === "active") matchStatus = m.effStatus === "today" || m.effStatus === "upcoming";
    else matchStatus = m.effStatus === status;
    return matchQuery && matchStatus;
  });

  // Urutan: hari ini -> mendatang (terdekat di atas) -> selesai (terbaru di atas).
  const key = (m) => m.date + " " + m.time;
  const asc = (a, b) => key(a).localeCompare(key(b));
  const desc = (a, b) => key(b).localeCompare(key(a));
  const sorted = []
    .concat(filtered.filter((m) => m.effStatus === "today").sort(asc))
    .concat(filtered.filter((m) => m.effStatus === "upcoming").sort(asc))
    .concat(filtered.filter((m) => m.effStatus === "done").sort(desc));

  const timeline = document.getElementById("timeline");

  if (sorted.length === 0) {
    timeline.innerHTML = `<div class="empty-state">${escapeHtml(emptyMessage(status, query))}</div>`;
    renderPagination(0, 0);
    return;
  }

  const totalPages = Math.ceil(sorted.length / PER_PAGE);
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const pageItems = sorted.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);

  // Kelompokkan per rentang tanggal (urutan kemunculan dipertahankan)
  const groups = new Map();
  pageItems.forEach((m) => {
    const k = m.date + "|" + m.endDate;
    if (!groups.has(k)) groups.set(k, { date: m.date, endDate: m.endDate, items: [] });
    groups.get(k).items.push(m);
  });

  let html = "";
  groups.forEach((g) => {
    const isTodayGroup = g.items.some((m) => m.effStatus === "today");
    html += `<div class="day-group ${isTodayGroup ? "is-today" : ""}">
      <div class="day-label"><div class="day-dot"></div><span>${escapeHtml(formatRentang(g.date, g.endDate))}</span></div>`;
    g.items.forEach((m) => {
      const cls = m.effStatus === "done" ? "done" : m.effStatus === "today" ? "today" : "";
      html += `
        <div class="meeting-card ${cls}">
          <div class="meeting-top">
            <div class="meeting-title">${escapeHtml(m.title)}</div>
            <div class="meeting-time">🕒 ${escapeHtml(m.time || "-")}${rangeChipHtml(m)}</div>
          </div>
          ${m.description ? `<div class="meeting-desc">${escapeHtml(m.description)}</div>` : ""}
          <div class="meeting-links">${linkButtonsHtml(m)}</div>
        </div>`;
    });
    html += `</div>`;
  });

  timeline.innerHTML = html;
  renderPagination(sorted.length, totalPages);
}

async function init() {
  if (!CONFIG.API_URL || CONFIG.API_URL.includes("PASTE_URL")) {
    document.getElementById("timeline").innerHTML =
      `<div class="empty-state">⚠️ API_URL belum diatur. Buka <code>assets/js/config.js</code> dan isi dengan URL Apps Script kamu (lihat README.md).</div>`;
    return;
  }
  try {
    const res = await Api.listMeetings();
    if (!res.success) throw new Error(res.message || "Gagal memuat data");
    ALL_MEETINGS = (res.data || []).map((m) => {
      const meta = parseMeta(m.otherLink);
      const item = {
        ...m,
        title: m.title || "",
        date: normalizeDate(m.date),
        time: normalizeTime(m.time),
        links: meta.links,
      };
      item.endDate = meta.endDate && meta.endDate > item.date ? meta.endDate : "";
      item.lastDate = item.endDate || item.date;
      item.effStatus = effectiveStatus(item);
      return item;
    });

    updateCounts();
    render();
  } catch (err) {
    document.getElementById("timeline").innerHTML =
      `<div class="empty-state">Gagal memuat data rapat. Coba refresh halaman.<br><small>${escapeHtml(err.message)}</small></div>`;
  }
}

document.getElementById("searchInput").addEventListener("input", () => {
  currentPage = 1;
  render();
});
document.getElementById("filterStatus").addEventListener("change", () => {
  currentPage = 1;
  render();
});

/* ---------- Modal Login Admin ---------- */
const loginOverlay = document.getElementById("loginOverlay");
const loginError = document.getElementById("loginError");

function openLogin() {
  loginError.classList.add("hidden");
  document.getElementById("loginForm").reset();
  loginOverlay.classList.remove("hidden");
  document.getElementById("username").focus();
}
function closeLogin() {
  loginOverlay.classList.add("hidden");
}

document.getElementById("openLoginBtn").addEventListener("click", openLogin);
document.getElementById("closeLoginBtn").addEventListener("click", closeLogin);
loginOverlay.addEventListener("click", (e) => {
  if (e.target === loginOverlay) closeLogin();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !loginOverlay.classList.contains("hidden")) closeLogin();
});

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!CONFIG.API_URL || CONFIG.API_URL.includes("PASTE_URL")) {
    loginError.textContent = "API_URL belum diatur di assets/js/config.js.";
    loginError.classList.remove("hidden");
    return;
  }
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  loginError.classList.add("hidden");

  const submitBtn = e.target.querySelector("button[type=submit]");
  const originalLabel = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<span class="spinner sm" style="border-top-color:#fff;border-color:rgba(255,255,255,.4);border-top-color:#fff;"></span>Memproses...`;
  submitBtn.style.display = "inline-flex";
  submitBtn.style.alignItems = "center";
  submitBtn.style.justifyContent = "center";

  try {
    const res = await Api.login(username, password);
    if (res.success) {
      Api.setToken(res.token);
      window.location.href = "admin/index.html";
      return;
    } else {
      loginError.textContent = res.message || "Username atau password salah.";
      loginError.classList.remove("hidden");
    }
  } catch (err) {
    loginError.textContent = "Gagal terhubung ke server. Coba lagi.";
    loginError.classList.remove("hidden");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
  }
});

/* ---------- Buka link terkunci (password dicek di server) ---------- */
const unlockOverlay = document.getElementById("unlockOverlay");
const unlockError = document.getElementById("unlockError");
const unlockForm = document.getElementById("unlockForm");
let pending = null;

function closeUnlock() {
  unlockOverlay.classList.add("hidden");
  pending = null;
}

document.getElementById("timeline").addEventListener("click", (e) => {
  const a = e.target.closest("a[data-mid]");
  if (!a) return;
  e.preventDefault();
  pending = { mid: a.dataset.mid, idx: Number(a.dataset.idx) };
  document.getElementById("unlockTitle").textContent = `Masukkan password untuk membuka "${a.dataset.label || "link"}".`;
  unlockError.classList.add("hidden");
  unlockForm.reset();
  unlockOverlay.classList.remove("hidden");
  document.getElementById("unlockPassword").focus();
});

document.getElementById("closeUnlockBtn").addEventListener("click", closeUnlock);
unlockOverlay.addEventListener("click", (e) => {
  if (e.target === unlockOverlay) closeUnlock();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !unlockOverlay.classList.contains("hidden")) closeUnlock();
});

unlockForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!pending) return;
  const pw = document.getElementById("unlockPassword").value;
  const btn = unlockForm.querySelector("button[type=submit]");
  unlockError.classList.add("hidden");
  // Buka tab dulu (selagi masih dalam klik pengguna) supaya tidak diblokir popup blocker.
  const w = window.open("", "_blank");
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = "Memeriksa...";
  try {
    const res = await Api.unlockLink(pending.mid, pending.idx, pw);
    if (!res.success || !/^https?:\/\//i.test(res.url || "")) {
      throw new Error(res.message || "Password salah.");
    }
    if (w) {
      w.opener = null;
      w.location.href = res.url;
    } else {
      window.location.href = res.url;
    }
    closeUnlock();
  } catch (err) {
    if (w) w.close();
    unlockError.textContent = err.message === "Failed to fetch" ? "Gagal terhubung ke server. Coba lagi." : err.message;
    unlockError.classList.remove("hidden");
    document.getElementById("unlockPassword").select();
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
});

init();
