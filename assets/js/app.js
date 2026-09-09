/**
 * Logic halaman publik: ambil data rapat dari Apps Script,
 * render sebagai timeline yang dikelompokkan per tanggal.
 */

let ALL_MEETINGS = [];

document.getElementById("orgName").textContent = CONFIG.NAMA_ORGANISASI;

function formatTanggal(dateStr) {
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function isToday(dateStr) {
  const today = new Date().toISOString().slice(0, 10);
  return dateStr === today;
}

function escapeHtml(str = "") {
  return str.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function linkButtonsHtml(m) {
  let html = "";
  if (m.zoomLink) html += `<a class="link-btn zoom" href="${m.zoomLink}" target="_blank" rel="noopener">🔗 Join Zoom</a>`;
  if (m.youtubeLink) html += `<a class="link-btn youtube" href="${m.youtubeLink}" target="_blank" rel="noopener">▶️ YouTube</a>`;
  if (m.materialLink) html += `<a class="link-btn material" href="${m.materialLink}" target="_blank" rel="noopener">📄 Materi</a>`;
  if (m.otherLink) html += `<a class="link-btn" href="${m.otherLink}" target="_blank" rel="noopener">🔗 Link lain</a>`;
  return html || `<span style="color:var(--text-muted);font-size:.85rem;">Belum ada link</span>`;
}

function render() {
  const query = document.getElementById("searchInput").value.trim().toLowerCase();
  const status = document.getElementById("filterStatus").value;

  let filtered = ALL_MEETINGS.filter((m) => {
    const matchQuery = !query || m.title.toLowerCase().includes(query);
    const matchStatus = status === "all" || m.status === status;
    return matchQuery && matchStatus;
  });

  filtered.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  const timeline = document.getElementById("timeline");

  if (filtered.length === 0) {
    timeline.innerHTML = `<div class="empty-state">Tidak ada rapat yang cocok dengan pencarian kamu.</div>`;
    return;
  }

  // Kelompokkan per tanggal
  const groups = {};
  filtered.forEach((m) => {
    if (!groups[m.date]) groups[m.date] = [];
    groups[m.date].push(m);
  });

  let html = "";
  Object.keys(groups).forEach((date) => {
    html += `<div class="day-group">
      <div class="day-label"><div class="day-dot"></div><span>${formatTanggal(date)}</span></div>`;
    groups[date].forEach((m) => {
      html += `
        <div class="meeting-card ${isToday(m.date) ? "today" : ""}">
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
    ALL_MEETINGS = res.data || [];

    const upcoming = ALL_MEETINGS.filter((m) => m.status === "upcoming");
    document.getElementById("countUpcoming").textContent = `${upcoming.length} rapat mendatang`;
    if (upcoming.some((m) => isToday(m.date))) {
      document.getElementById("countToday").style.display = "inline-block";
    }

    render();
  } catch (err) {
    document.getElementById("timeline").innerHTML =
      `<div class="empty-state">Gagal memuat data rapat. Coba refresh halaman.<br><small>${escapeHtml(err.message)}</small></div>`;
  }
}

document.getElementById("searchInput").addEventListener("input", render);
document.getElementById("filterStatus").addEventListener("change", render);

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
