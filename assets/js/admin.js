/**
 * Logic panel admin: login, tampilkan tabel rapat, tambah/ubah/hapus.
 * Setiap link bisa diberi password (opsional). Link yang diberi password
 * dienkripsi di browser (lihat crypto.js) sebelum dikirim ke Google Sheet.
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

function showToast(msg) {
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
  }, 1300);
}

let MEETINGS = [];

function escapeHtml(str = "") {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

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

/* ---------------- LIST / TABLE ---------------- */

async function loadMeetings() {
  tableWrap.innerHTML = `<div class="loading-block"><div class="spinner"></div><p>Memuat data...</p></div>`;
  const res = await Api.listMeetingsAdmin();
  if (!res.success) {
    tableWrap.innerHTML = `<p style="color:#C0392B">Gagal memuat data: ${escapeHtml(res.message || "")}</p>`;
    return;
  }
  MEETINGS = (res.data || []).map((m) => ({
    ...m,
    date: normalizeDate(m.date),
    time: normalizeTime(m.time),
  }));
  renderTable();
}

function renderTable() {
  if (MEETINGS.length === 0) {
    tableWrap.innerHTML = `<div class="empty-state" style="margin-left:0">Belum ada rapat. Klik "Tambah Rapat" untuk membuat yang pertama.</div>`;
    return;
  }
  const sorted = [...MEETINGS].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));

  const tag = (label, value) => value && label + (Lock.isLocked(value) ? " 🔒" : "");

  let html = `<table class="admin-table"><thead><tr>
    <th>Judul</th><th>Tanggal</th><th>Jam</th><th>Status</th><th>Link</th><th></th>
  </tr></thead><tbody>`;

  sorted.forEach((m) => {
    const others = parseOtherLinks(m.otherLink).length;
    const links = [
      tag("Zoom", m.zoomLink),
      tag("Virtual BG", m.virtualBgLink),
      tag("YouTube", m.youtubeLink),
      tag("Materi", m.materialLink),
      tag("Daftar Hadir", m.attendanceLink),
      others > 0 && `Lainnya (${others})`,
    ].filter(Boolean).join(", ") || "—";

    html += `<tr>
      <td>${escapeHtml(m.title)}</td>
      <td>${escapeHtml(m.date)}</td>
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

/* ---------------- KUNCI LINK (password opsional) ---------------- */

const LOCKED_TEXT = "🔒 Link terkunci (klik untuk mengganti)";

/**
 * Pasangkan sebuah input URL dengan input password.
 * - Password kosong  -> link disimpan polos (tanpa password).
 * - Password terisi  -> link dienkripsi sebelum disimpan.
 * - Link lama yang sudah terkunci ditampilkan "🔒 terkunci"; kalau tidak
 *   diubah, nilai terenkripsinya disimpan apa adanya (password tetap sama).
 *   Klik kolomnya untuk mengganti link / password.
 */
function bindLockable(urlInput, pwInput) {
  urlInput.addEventListener("click", () => {
    if (!urlInput.dataset.enc) return;
    delete urlInput.dataset.enc;
    urlInput.readOnly = false;
    urlInput.type = "url";
    urlInput.value = "";
    urlInput.classList.remove("is-locked");
    pwInput.placeholder = "🔒 Password baru (kosongkan = tanpa password)";
    urlInput.focus();
  });
}

function setLockableValue(urlInput, pwInput, value) {
  pwInput.value = "";
  delete urlInput.dataset.enc;
  urlInput.readOnly = false;
  urlInput.type = "url";
  urlInput.classList.remove("is-locked");
  pwInput.placeholder = "🔒 Password (kosongkan = tanpa password)";
  if (Lock.isLocked(value)) {
    urlInput.dataset.enc = value;
    urlInput.type = "text";
    urlInput.readOnly = true;
    urlInput.value = LOCKED_TEXT;
    urlInput.classList.add("is-locked");
    pwInput.placeholder = "Terkunci — klik kolom link di atas untuk mengganti";
  } else {
    urlInput.value = value || "";
  }
}

async function readLockable(urlInput, pwInput) {
  if (urlInput.dataset.enc) return urlInput.dataset.enc; // tidak diubah
  const url = urlInput.value.trim();
  const pw = pwInput.value;
  if (!url) return "";
  return pw ? Lock.encrypt(url, pw) : url;
}

// Field link tetap (Zoom, VB, YouTube, Materi, Daftar Hadir)
const FIXED_LINK_IDS = ["zoomLink", "virtualBgLink", "youtubeLink", "materialLink", "attendanceLink"];
const fixedPw = {};

FIXED_LINK_IDS.forEach((id) => {
  const urlInput = document.getElementById(id);
  const pw = document.createElement("input");
  pw.type = "password";
  pw.autocomplete = "new-password";
  pw.className = "lock-pw";
  pw.style.marginTop = "6px";
  pw.placeholder = "🔒 Password (kosongkan = tanpa password)";
  urlInput.insertAdjacentElement("afterend", pw);
  fixedPw[id] = pw;
  bindLockable(urlInput, pw);
});

/* ---------------- LINK LAINNYA (dinamis) ---------------- */

const otherLinksList = document.getElementById("otherLinksList");

// "otherLink" disimpan di sheet sebagai JSON string: [{"label":"...","url":"..."}, ...]
// "url" boleh berisi teks terenkripsi ("enc1:...") kalau diberi password.
function parseOtherLinks(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((x) => x && (x.url || x.label))
        .map((x) => ({ label: x.label || "", url: x.url || "" }));
    }
  } catch (e) {
    // bukan JSON -> URL polos (data lama)
  }
  return [{ label: "Link Lainnya", url: String(raw) }];
}

function addOtherLinkRow(label = "", url = "") {
  const row = document.createElement("div");
  row.className = "other-link-row";
  row.innerHTML = `
    <input type="text" class="other-link-label" placeholder="Judul (misal: Surat Undangan)" value="${escapeHtml(label)}" />
    <input type="url" class="other-link-url" placeholder="https://..." />
    <input type="password" class="other-link-pw" autocomplete="new-password" placeholder="🔒 Password (opsional)" />
    <button type="button" class="other-link-remove" aria-label="Hapus link">&times;</button>
  `;
  const urlInput = row.querySelector(".other-link-url");
  const pwInput = row.querySelector(".other-link-pw");
  bindLockable(urlInput, pwInput);
  setLockableValue(urlInput, pwInput, url);
  row.querySelector(".other-link-remove").addEventListener("click", () => row.remove());
  otherLinksList.appendChild(row);
}

function resetOtherLinks(links = []) {
  otherLinksList.innerHTML = "";
  if (links.length === 0) {
    addOtherLinkRow();
  } else {
    links.forEach((l) => addOtherLinkRow(l.label, l.url));
  }
}

async function collectOtherLinks() {
  const rows = [...otherLinksList.querySelectorAll(".other-link-row")];
  const out = [];
  for (const row of rows) {
    const label = row.querySelector(".other-link-label").value.trim();
    const url = await readLockable(row.querySelector(".other-link-url"), row.querySelector(".other-link-pw"));
    if (url) out.push({ label, url });
  }
  return out;
}

document.getElementById("addOtherLinkBtn").addEventListener("click", () => addOtherLinkRow());

/* ---------------- FORM (ADD / EDIT) ---------------- */

const meetingForm = document.getElementById("meetingForm");
const timeInput = document.getElementById("time");

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
  FIXED_LINK_IDS.forEach((id) => setLockableValue(document.getElementById(id), fixedPw[id], ""));
  resetOtherLinks([]);
  formOverlay.classList.remove("hidden");
}

function openEdit(id) {
  const m = MEETINGS.find((x) => x.id === id);
  if (!m) return;
  document.getElementById("formTitle").textContent = "Ubah Rapat";
  document.getElementById("meetingId").value = m.id;
  document.getElementById("title").value = m.title || "";
  document.getElementById("date").value = m.date || "";
  document.getElementById("time").value = m.time || "";
  document.getElementById("description").value = m.description || "";
  FIXED_LINK_IDS.forEach((fid) => setLockableValue(document.getElementById(fid), fixedPw[fid], m[fid] || ""));
  document.getElementById("status").value = m.status || "upcoming";
  resetOtherLinks(parseOtherLinks(m.otherLink));
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

  if (!window.crypto || !window.crypto.subtle) {
    // crypto.subtle hanya ada di HTTPS / localhost
    const anyPw = [...document.querySelectorAll(".lock-pw, .other-link-pw")].some((i) => i.value);
    if (anyPw) {
      showToast("Fitur password butuh koneksi HTTPS.");
      return;
    }
  }

  const id = document.getElementById("meetingId").value;

  const submitBtn = e.target.querySelector("button[type=submit]");
  const originalLabel = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.style.display = "inline-flex";
  submitBtn.style.alignItems = "center";
  submitBtn.style.justifyContent = "center";
  submitBtn.innerHTML = `<span class="spinner sm" style="border-color:rgba(255,255,255,.4);border-top-color:#fff;"></span>Menyimpan...`;

  try {
    const data = {
      title: document.getElementById("title").value.trim(),
      date: document.getElementById("date").value,
      time: timeVal,
      description: document.getElementById("description").value.trim(),
      status: document.getElementById("status").value,
    };
    for (const fid of FIXED_LINK_IDS) {
      data[fid] = await readLockable(document.getElementById(fid), fixedPw[fid]);
    }
    data.otherLink = JSON.stringify(await collectOtherLinks());

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
