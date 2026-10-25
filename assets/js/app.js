/**
 * Logic halaman publik: ambil data rapat dari Apps Script,
 * render sebagai timeline yang dikelompokkan per tanggal,
 * dengan filter status (default: Akan datang) dan paginasi (10 rapat/halaman).
 */

const PER_PAGE = 10;

let ALL_MEETINGS = [];
let currentPage = 1;

document.getElementById("orgName").textContent = CONFIG.NAMA_ORGANISASI;

/**
 * Google Apps Script mengirim tanggal/jam sebagai objek Date yang otomatis
 * diserialisasi ke ISO string UTC (mis. "2026-09-10T17:00:00.000Z").
 * Karena data sebenarnya dalam zona WIB (UTC+7), kita koreksi +7 jam
 * lalu ambil bagian tanggal / jam yang relevan.
 */
function normalizeDate(value) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value; // sudah plain date
  const d = new Date(value);
  if (isNaN(d)) return "";
  const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 10);
}

function normalizeTime(value) {
  if (!value) return "";
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return value.slice(0, 5); // sudah plain time
  const d = new Date(value);
  if (isNaN(d)) return "";
  const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(11, 16); // HH:MM, format 24 jam
}

function formatTanggal(dateStr) {
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  } catch {
    return dateStr;
  }
}

// Tanggal hari ini dalam WIB (UTC+7), format "YYYY-MM-DD".
function todayWIB() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isToday(dateStr) {
  return dateStr === todayWIB();
}

/**
 * Status efektif rapat:
 *  - "done" kalau admin menandai "Sudah selesai", ATAU tanggal rapat sudah lewat
 *    (otomatis, tidak perlu admin mengubah status manual).
 *  - selain itu "upcoming" (termasuk rapat yang tanggalnya hari ini).
 */
function effectiveStatus(m) {
  if (m.status === "done") return "done";
  if (m.date && m.date < todayWIB()) return "done";
  return "upcoming";
}

function escapeHtml(str = "") {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// "otherLink" disimpan sebagai JSON string: [{"label":"...","url":"..."}, ...]
// Data lama yang cuma URL polos (bukan JSON) tetap ditampilkan dengan judul default.
function parseOtherLinks(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((x) => x && x.url).map((x) => ({ label: x.label || "Link Lainnya", url: x.url }));
    }
  } catch (e) {
    // bukan JSON -> data lama, anggap URL polos
  }
  return [{ label: "Link Lainnya", url: String(raw) }];
}

function linkButtonsHtml(m) {
  const btns = [];
  if (m.zoomLink)       btns.push(`<a class="link-btn zoom"       href="${m.zoomLink}"       target="_blank" rel="noopener"><img src="assets/img/zoom.png"          alt="" class="link-btn-icon"> Join Zoom</a>`);
  if (m.virtualBgLink)  btns.push(`<a class="link-btn virtualbg"  href="${m.virtualBgLink}"  target="_blank" rel="noopener"><img src="assets/img/vb.png"            alt="" class="link-btn-icon"> Virtual Background</a>`);
  if (m.youtubeLink)    btns.push(`<a class="link-btn youtube"    href="${m.youtubeLink}"    target="_blank" rel="noopener"><img src="assets/img/youtube.png"        alt="" class="link-btn-icon"> YouTube</a>`);
  if (m.materialLink)   btns.push(`<a class="link-btn material"   href="${m.materialLink}"   target="_blank" rel="noopener"><img src="assets/img/materi.png"         alt="" class="link-btn-icon"> Materi</a>`);
  if (m.attendanceLink) btns.push(`<a class="link-btn attendance" href="${m.attendanceLink}" target="_blank" rel="noopener"><img src="assets/img/daftar%20hadir.png" alt="" class="link-btn-icon"> Daftar Hadir</a>`);
  parseOtherLinks(m.otherLink).forEach((l) => {
    btns.push(`<a class="link-btn" href="${l.url}" target="_blank" rel="noopener">🔗 ${escapeHtml(l.label)}</a>`);
  });
  if (btns.length === 0) return `<span style="color:var(--text-muted);font-size:.85rem;">Belum ada link</span>`;
  // Kalau sisa baris terakhir tidak genap 3, tambah spacer div supaya tombol tidak melebar
  const remainder = btns.length % 3;
  if (remainder !== 0) {
    for (let i = 0; i < 3 - remainder; i++) btns.push(`<div class="link-btn-spacer"></div>`);
  }
  return btns.join("");
}

/* ---------- Hitung jumlah & update pill/opsi filter ---------- */
function updateCounts() {
  const total = ALL_MEETINGS.length;
  const upcoming = ALL_MEETINGS.filter((m) => m.effStatus === "upcoming").length;
  const done = total - upcoming;

  document.getElementById("countAll").textContent = `Semua: ${total}`;
  document.getElementById("countUpcoming").textContent = `Mendatang: ${upcoming}`;
  document.getElementById("countDone").textContent = `Selesai: ${done}`;

  const sel = document.getElementById("filterStatus");
  sel.querySelector('option[value="upcoming"]').textContent = `Akan datang (${upcoming})`;
  sel.querySelector('option[value="done"]').textContent = `Sudah selesai (${done})`;
  sel.querySelector('option[value="all"]').textContent = `Semua (${total})`;

  const hasToday = ALL_MEETINGS.some((m) => m.effStatus === "upcoming" && isToday(m.date));
  document.getElementById("countToday").style.display = hasToday ? "inline-block" : "none";
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
  if (status === "upcoming") return "Belum ada rapat mendatang. Lihat filter “Sudah selesai” untuk rapat sebelumnya.";
  if (status === "done") return "Belum ada rapat yang selesai.";
  return "Belum ada rapat.";
}

function render() {
  const query = document.getElementById("searchInput").value.trim().toLowerCase();
  const status = document.getElementById("filterStatus").value;

  const filtered = ALL_MEETINGS.filter((m) => {
    const matchQuery = !query || m.title.toLowerCase().includes(query);
    const matchStatus = status === "all" || m.effStatus === status;
    return matchQuery && matchStatus;
  });

  // Urutan: rapat mendatang dulu (terdekat di atas), lalu rapat selesai (terbaru di atas).
  const key = (m) => m.date + " " + m.time;
  const upcoming = filtered.filter((m) => m.effStatus === "upcoming").sort((a, b) => key(a).localeCompare(key(b)));
  const done = filtered.filter((m) => m.effStatus === "done").sort((a, b) => key(b).localeCompare(key(a)));
  const sorted = upcoming.concat(done);

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

  // Kelompokkan per tanggal (urutan kemunculan dipertahankan)
  const groups = new Map();
  pageItems.forEach((m) => {
    if (!groups.has(m.date)) groups.set(m.date, []);
    groups.get(m.date).push(m);
  });

  let html = "";
  groups.forEach((items, date) => {
    html += `<div class="day-group">
      <div class="day-label"><div class="day-dot"></div><span>${formatTanggal(date)}</span></div>`;
    items.forEach((m) => {
      const cls = m.effStatus === "done" ? "done" : isToday(m.date) ? "today" : "";
      html += `
        <div class="meeting-card ${cls}">
          <div class="meeting-top">
            <div class="meeting-title">${escapeHtml(m.title)}</div>
            <div class="meeting-time">🕒 ${escapeHtml(m.time || "-")}</div>
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
      const item = {
        ...m,
        title: m.title || "",
        date: normalizeDate(m.date),
        time: normalizeTime(m.time),
      };
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

init();
