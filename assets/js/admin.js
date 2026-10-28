/**
 * Logic panel admin: login, tampilkan tabel rapat, tambah/ubah/hapus.
 * Mendukung jadwal rentang (tanggal mulai - tanggal selesai).
 */

const checkingShell = document.getElementById("checkingShell");
const loginShell = document.getElementById("loginShell");
const dashboardShell = document.getElementById("dashboardShell");
const formOverlay = document.getElementById("formOverlay");
const tableWrap = document.getElementById("tableWrap");
const toastEl = document.getElementById("toast");
const toastTextEl = document.getElementById("toastText");
const toastBackdropEl = document.getElementById("toastBackdrop");

let toastHideTimer = null;

function showToast(msg, ms = 1300) {
  clearTimeout(toastHideTimer);

  toastTextEl.textContent = msg;
  toastBackdropEl.classList.remove("hidden");
  toastEl.classList.remove("hidden");

  const icon = toastEl.querySelector(".toast-icon");
  icon.style.animation = "none";
  requestAnimationFrame(() => {
    icon.style.animation = "";
    toastBackdropEl.classList.add("show");
    toastEl.classList.add("show");
  });

  toastHideTimer = setTimeout(() => {
    toastBackdropEl.classList.remove("show");
    toastEl.classList.remove("show");
    setTimeout(() => {
      toastBackdropEl.classList.add("hidden");
      toastEl.classList.add("hidden");
    }, 250);
  }, ms);
}

let MEETINGS = [];

function escapeHtml(str = "") {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/**
 * Google Apps Script mengirim tanggal/jam sebagai ISO string UTC.
 * Data sebenarnya WIB (UTC+7), jadi dikoreksi +7 jam.
 */
function normalizeDate(value) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (isNaN(d)) return "";
  const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 10);
}

// Selalu dikembalikan dalam format 24 jam "HH:mm".
function normalizeTime(value) {
  if (!value) return "";
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return value.slice(0, 5);
  const d = new Date(value);
  if (isNaN(d)) return "";
  const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(11, 16);
}

function isValidTime24(str) {
  if (!str) return true;
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(str.trim());
}

/* ---------------- AUTH ---------------- */

function checkApiConfigured() {
  if (!CONFIG.API_URL || CONFIG.API_URL.includes("PASTE_URL")) {
    document.getElementById("loginError").textContent =
      "API_URL belum diatur di assets/js/config.js. Lihat README.md.";
    document.getElementById("loginError").classList.remove("hidden");
    return false;
  }
  return true;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

async function tryAutoLogin() {
  if (!checkApiConfigured()) {
    checkingShell.classList.add("hidden");
    loginShell.classList.remove("hidden");
    return;
  }

  const token = Api.getToken();

  if (!token) {
    checkingShell.classList.add("hidden");
    loginShell.classList.remove("hidden");
    return;
  }

  try {
    const res = await withTimeout(Api.listMeetingsAdmin(), 15000);

    if (res.success) {
      showDashboard();
    } else {
      Api.clearToken();
      checkingShell.classList.add("hidden");
      loginShell.classList.remove("hidden");
    }
  } catch (err) {
    checkingShell.classList.add("hidden");
    loginShell.classList.remove("hidden");
    const errBox = document.getElementById("loginError");
    errBox.textContent = "Gagal terhubung ke server (mungkin sedang lambat). Silakan login ulang.";
    errBox.classList.remove("hidden");
  }
}

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!checkApiConfigured()) return;
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  const errBox = document.getElementById("loginError");
  errBox.classList.add("hidden");

  const submitBtn = e.target.querySelector("button[type=submit]");
  const originalLabel = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.style.display = "inline-flex";
  submitBtn.style.alignItems = "center";
  submitBtn.style.justifyContent = "center";
  submitBtn.innerHTML = `<span class="spinner sm" style="border-color:rgba(255,255,255,.4);border-top-color:#fff;"></span>Memproses...`;

  try {
    const res = await Api.login(username, password);
    if (res.success) {
      Api.setToken(res.token);
      showDashboard();
      return;
    } else {
      errBox.textContent = res.message || "Username atau password salah.";
      errBox.classList.remove("hidden");
    }
  } catch (err) {
    errBox.textContent = "Gagal terhubung ke server. Coba lagi.";
    errBox.classList.remove("hidden");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
  }
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  Api.logout();
  window.location.href = "../index.html";
});

function showDashboard() {
  checkingShell.classList.add("hidden");
  loginShell.classList.add("hidden");
  dashboardShell.classList.remove("hidden");
  loadMeetings();
}

/* ---------------- META (link lainnya + tanggal selesai) ---------------- */

/**
 * Kolom "otherLink" di sheet menyimpan salah satu format berikut:
 *  - [{"label":"..","url":".."}, ...]                     (tanpa rentang)
 *  - {"links":[...], "endDate":"YYYY-MM-DD"}              (jadwal rentang)
 *  - URL polos (data paling lama)
 * Dengan begitu tidak perlu mengubah Apps Script / kolom Google Sheet.
 */
function parseMeta(raw) {
  const meta = { links: [], endDate: "" };
  if (!raw) return meta;
  const clean = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .filter((x) => x && (x.url || x.label))
      .map((x) => ({ label: x.label || "", url: x.url || "", pass: x.pass || "" }));
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

/* ---------------- LIST / TABLE ---------------- */

async function loadMeetings() {
  tableWrap.innerHTML = `<div class="loading-block"><div class="spinner"></div><p>Memuat data...</p></div>`;
  const res = await Api.listMeetingsAdmin();
  if (!res.success) {
    tableWrap.innerHTML = `<p style="color:#C0392B">Gagal memuat data: ${escapeHtml(res.message || "")}</p>`;
    return;
  }
  MEETINGS = (res.data || []).map((m) => {
    const meta = parseMeta(m.otherLink);
    const date = normalizeDate(m.date);
    return {
      ...m,
      date,
      time: normalizeTime(m.time),
      otherLinks: meta.links,
      endDate: meta.endDate && meta.endDate > date ? meta.endDate : "",
    };
  });
  renderTable();
}

function renderTable() {
  if (MEETINGS.length === 0) {
    tableWrap.innerHTML = `<div class="empty-state" style="margin-left:0">Belum ada rapat. Klik "Tambah Rapat" untuk membuat yang pertama.</div>`;
    return;
  }
  const sorted = [...MEETINGS].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));

  let html = `<table class="admin-table"><thead><tr>
    <th>Judul</th><th>Tanggal</th><th>Jam</th><th>Status</th><th>Link</th><th></th>
  </tr></thead><tbody>`;

  sorted.forEach((m) => {
    const links = [
      m.zoomLink && "Zoom",
      m.virtualBgLink && "Virtual BG",
      m.youtubeLink && "YouTube",
      m.materialLink && "Materi",
      m.attendanceLink && "Daftar Hadir",
      m.otherLinks.length > 0 && "Lainnya" + (m.otherLinks.some((l) => l.pass) ? " 🔒" : ""),
    ].filter(Boolean).join(", ") || "—";

    const tgl = m.endDate ? `${m.date} → ${m.endDate}` : m.date;

    html += `<tr>
      <td>${escapeHtml(m.title)}</td>
      <td>${escapeHtml(tgl)}</td>
      <td>${escapeHtml(m.time || "-")}</td>
      <td><span class="status-tag ${m.status}">${m.status === "upcoming" ? "Akan datang" : "Selesai"}</span></td>
      <td>${links}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-outline" style="padding:6px 10px;font-size:.8rem;" onclick="openEdit('${m.id}')">Ubah</button>
        <button class="btn btn-danger" style="padding:6px 10px;font-size:.8rem;" onclick="removeMeeting('${m.id}')">Hapus</button>
      </td>
    </tr>`;
  });

  html += `</tbody></table>`;
  tableWrap.innerHTML = html;
}

/* ---------------- LINK LAINNYA (dinamis, bisa dikunci password) ---------------- */

const otherLinksList = document.getElementById("otherLinksList");

function syncLock(item) {
  const on = item.querySelector(".lock-check").checked;
  item.querySelector(".lock-pass").classList.toggle("hidden", !on);
  const note = item.querySelector(".lock-note");
  note.classList.toggle("hidden", !on);
  note.textContent = "Pengunjung harus memasukkan password ini untuk membuka link. Password tersimpan di database dan bisa dilihat/diubah di sini.";
}

function addOtherLinkRow(label = "", url = "", pass = "") {
  const item = document.createElement("div");
  item.className = "other-link-item";
  item.innerHTML = `
    <div class="other-link-row">
      <input type="text" class="other-link-label" placeholder="Judul (misal: Surat Undangan)" value="${escapeHtml(label)}" />
      <input type="url" class="other-link-url" placeholder="https://..." value="${escapeHtml(url)}" />
      <button type="button" class="other-link-remove" aria-label="Hapus link">&times;</button>
    </div>
    <div class="other-link-lock">
      <label class="lock-toggle"><input type="checkbox" class="lock-check" ${pass ? "checked" : ""} /> 🔒 Kunci dengan password</label>
      <input type="text" class="lock-pass hidden" placeholder="Password link ini" autocomplete="off" value="${escapeHtml(pass)}" />
    </div>
    <p class="lock-note hidden"></p>
  `;
  item.querySelector(".other-link-remove").addEventListener("click", () => item.remove());
  item.querySelector(".lock-check").addEventListener("change", () => syncLock(item));
  otherLinksList.appendChild(item);
  syncLock(item);
}

function resetOtherLinks(links = []) {
  otherLinksList.innerHTML = "";
  if (links.length === 0) {
    addOtherLinkRow();
  } else {
    links.forEach((l) => addOtherLinkRow(l.label, l.url, l.pass));
  }
}

// Mengumpulkan link tambahan. Link yang dikunci membawa field "pass" (disimpan di database).
function collectOtherLinks() {
  const out = [];
  for (const item of otherLinksList.querySelectorAll(".other-link-item")) {
    const label = item.querySelector(".other-link-label").value.trim();
    const url = item.querySelector(".other-link-url").value.trim();
    const locked = item.querySelector(".lock-check").checked;
    const pass = item.querySelector(".lock-pass").value.trim();
    if (!url) continue;
    if (!locked) {
      out.push({ label, url });
      continue;
    }
    const name = label || "tanpa judul";
    if (!/^https?:\/\//i.test(url)) throw new Error(`Link "${name}": URL harus diawali http:// atau https://`);
    if (!pass) throw new Error(`Link "${name}": isi password untuk mengunci.`);
    out.push({ label, url, pass });
  }
  return out;
}

document.getElementById("addOtherLinkBtn").addEventListener("click", () => addOtherLinkRow());

/* ---------------- FORM (ADD / EDIT) ---------------- */

const meetingForm = document.getElementById("meetingForm");
const timeInput = document.getElementById("time");
const dateInput = document.getElementById("date");
const isRangeEl = document.getElementById("isRange");
const endDateEl = document.getElementById("endDate");
const endDateWrap = document.getElementById("endDateWrap");
const dateLabel = document.getElementById("dateLabel");

// Tampilkan/sembunyikan "Tanggal Selesai" sesuai checkbox rentang
function syncRange() {
  const on = isRangeEl.checked;
  endDateWrap.classList.toggle("hidden", !on);
  endDateEl.required = on;
  dateLabel.textContent = on ? "Tanggal Mulai *" : "Tanggal *";
  if (on) {
    endDateEl.min = dateInput.value || "";
    if (!endDateEl.value && dateInput.value) endDateEl.value = dateInput.value;
  }
}
isRangeEl.addEventListener("change", syncRange);
dateInput.addEventListener("change", () => {
  if (isRangeEl.checked) {
    endDateEl.min = dateInput.value || "";
    if (endDateEl.value && endDateEl.value < dateInput.value) endDateEl.value = dateInput.value;
  }
});

// Rapikan input jam saat blur, misal "9:5" -> "09:05"
timeInput.addEventListener("blur", () => {
  const val = timeInput.value.trim();
  if (!val) return;
  const match = val.match(/^([0-1]?\d|2[0-3]):([0-5]?\d)$/);
  if (match) {
    timeInput.value = match[1].padStart(2, "0") + ":" + match[2].padStart(2, "0");
  }
});

function openAdd() {
  document.getElementById("formTitle").textContent = "Tambah Rapat";
  meetingForm.reset();
  document.getElementById("meetingId").value = "";
  resetOtherLinks([]);
  syncRange();
  formOverlay.classList.remove("hidden");
}

function openEdit(id) {
  const m = MEETINGS.find((x) => x.id === id);
  if (!m) return;
  document.getElementById("formTitle").textContent = "Ubah Rapat";
  document.getElementById("meetingId").value = m.id;
  document.getElementById("title").value = m.title || "";
  dateInput.value = m.date || "";
  document.getElementById("time").value = m.time || "";
  document.getElementById("description").value = m.description || "";
  document.getElementById("zoomLink").value = m.zoomLink || "";
  document.getElementById("virtualBgLink").value = m.virtualBgLink || "";
  document.getElementById("youtubeLink").value = m.youtubeLink || "";
  document.getElementById("materialLink").value = m.materialLink || "";
  document.getElementById("attendanceLink").value = m.attendanceLink || "";
  document.getElementById("status").value = m.status || "upcoming";
  resetOtherLinks(m.otherLinks);
  isRangeEl.checked = !!m.endDate;
  endDateEl.value = m.endDate || "";
  syncRange();
  formOverlay.classList.remove("hidden");
}

document.getElementById("addMeetingBtn").addEventListener("click", openAdd);
document.getElementById("cancelFormBtn").addEventListener("click", () => formOverlay.classList.add("hidden"));

meetingForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const timeVal = timeInput.value.trim();
  if (!isValidTime24(timeVal)) {
    showToast("Format jam salah. Pakai format 24 jam, contoh: 14:30");
    timeInput.focus();
    return;
  }

  const startDate = dateInput.value;
  let endDate = "";
  if (isRangeEl.checked) {
    endDate = endDateEl.value;
    if (!endDate) {
      showToast("Isi tanggal selesai untuk jadwal rentang.");
      endDateEl.focus();
      return;
    }
    if (endDate < startDate) {
      showToast("Tanggal selesai tidak boleh sebelum tanggal mulai.");
      endDateEl.focus();
      return;
    }
    if (endDate === startDate) endDate = ""; // sama dengan 1 hari
  }

  let links;
  try {
    links = collectOtherLinks();
    // Pengaman: kalau Apps Script belum diperbarui, link berpassword akan tersimpan TERBUKA.
    if (links.some((l) => l.pass)) {
      const v = await Api.version().catch(() => null);
      if (!v || !(v.version >= 2)) {
        throw new Error("Apps Script belum diperbarui (Code.gs versi baru belum di-deploy), jadi link berpassword tidak disimpan.");
      }
    }
  } catch (err) {
    showToast(err.message, 4500);
    return;
  }
  // Tanpa rentang: tetap format lama (array) supaya kompatibel. Dengan rentang: objek.
  const otherLink = JSON.stringify(endDate ? { links, endDate } : links);

  const id = document.getElementById("meetingId").value;
  const data = {
    title: document.getElementById("title").value.trim(),
    date: startDate,
    time: timeVal,
    description: document.getElementById("description").value.trim(),
    zoomLink: document.getElementById("zoomLink").value.trim(),
    virtualBgLink: document.getElementById("virtualBgLink").value.trim(),
    youtubeLink: document.getElementById("youtubeLink").value.trim(),
    materialLink: document.getElementById("materialLink").value.trim(),
    attendanceLink: document.getElementById("attendanceLink").value.trim(),
    otherLink,
    status: document.getElementById("status").value,
  };

  const submitBtn = e.target.querySelector("button[type=submit]");
  const originalLabel = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.style.display = "inline-flex";
  submitBtn.style.alignItems = "center";
  submitBtn.style.justifyContent = "center";
  submitBtn.innerHTML = `<span class="spinner sm" style="border-color:rgba(255,255,255,.4);border-top-color:#fff;"></span>Menyimpan...`;

  try {
    const res = id ? await Api.updateMeeting(id, data) : await Api.createMeeting(data);
    if (res.success) {
      formOverlay.classList.add("hidden");
      showToast(id ? "Rapat berhasil diubah." : "Rapat berhasil ditambahkan.");
      loadMeetings();
    } else {
      showToast(res.message || "Gagal menyimpan data.");
    }
  } catch (err) {
    showToast("Gagal terhubung ke server.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
  }
});

async function removeMeeting(id) {
  if (!confirm("Yakin ingin menghapus rapat ini?")) return;
  const res = await Api.deleteMeeting(id);
  if (res.success) {
    showToast("Rapat dihapus.");
    loadMeetings();
  } else {
    showToast(res.message || "Gagal menghapus data.");
  }
}

tryAutoLogin();
