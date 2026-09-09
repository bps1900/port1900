/**
 * Logic panel admin: login, tampilkan tabel rapat, tambah/ubah/hapus.
 */

const checkingShell = document.getElementById("checkingShell");
const loginShell = document.getElementById("loginShell");
const dashboardShell = document.getElementById("dashboardShell");
const formOverlay = document.getElementById("formOverlay");
const tableWrap = document.getElementById("tableWrap");
const toastEl = document.getElementById("toast");

let MEETINGS = [];

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  setTimeout(() => toastEl.classList.add("hidden"), 2600);
}

function escapeHtml(str = "") {
  return str.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

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

// Selalu dikembalikan dalam format 24 jam "HH:mm" (bukan AM/PM).
function normalizeTime(value) {
  if (!value) return "";
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return value.slice(0, 5); // sudah plain time 24 jam
  const d = new Date(value);
  if (isNaN(d)) return "";
  const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(11, 16); // HH:MM, format 24 jam
}

// Validasi input jam dari form (harus format 24 jam HH:mm, mis. "09:00" / "14:30").
function isValidTime24(str) {
  if (!str) return true; // jam boleh kosong
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
  // Kalau API belum dikonfigurasi, langsung tampilkan form login dengan pesan error
  if (!checkApiConfigured()) {
    checkingShell.classList.add("hidden");
    loginShell.classList.remove("hidden");
    return;
  }

  const token = Api.getToken();

  // Tidak ada token tersimpan -> memang belum login, tampilkan form login
  if (!token) {
    checkingShell.classList.add("hidden");
    loginShell.classList.remove("hidden");
    return;
  }

  // Ada token -> validasi ke server dulu, jangan tampilkan form login dulu.
  // Dikasih batas waktu 15 detik supaya tidak macet selamanya kalau
  // Google Apps Script sedang "cold start" / lambat merespons.
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
    // Timeout atau error jaringan -> jangan hapus token (mungkin cuma lambat),
    // tapi tampilkan form login supaya user tidak terjebak di layar loading.
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
      m.otherLink && "Lainnya",
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

/* ---------------- FORM (ADD / EDIT) ---------------- */

const meetingForm = document.getElementById("meetingForm");
const timeInput = document.getElementById("time");

// Rapikan otomatis input jam saat user selesai mengetik (blur),
// misal "9:5" -> "09:05", biar tetap konsisten format 24 jam.
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
  document.getElementById("zoomLink").value = m.zoomLink || "";
  document.getElementById("virtualBgLink").value = m.virtualBgLink || "";
  document.getElementById("youtubeLink").value = m.youtubeLink || "";
  document.getElementById("materialLink").value = m.materialLink || "";
  document.getElementById("attendanceLink").value = m.attendanceLink || "";
  document.getElementById("otherLink").value = m.otherLink || "";
  document.getElementById("status").value = m.status || "upcoming";
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

  const id = document.getElementById("meetingId").value;
  const data = {
    title: document.getElementById("title").value.trim(),
    date: document.getElementById("date").value,
    time: timeVal,
    description: document.getElementById("description").value.trim(),
    zoomLink: document.getElementById("zoomLink").value.trim(),
    virtualBgLink: document.getElementById("virtualBgLink").value.trim(),
    youtubeLink: document.getElementById("youtubeLink").value.trim(),
    materialLink: document.getElementById("materialLink").value.trim(),
    attendanceLink: document.getElementById("attendanceLink").value.trim(),
    otherLink: document.getElementById("otherLink").value.trim(),
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
