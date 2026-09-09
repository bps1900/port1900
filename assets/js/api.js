/**
 * =====================================================================
 * API — lapisan komunikasi ke Google Apps Script (backend + Google Sheet)
 * =====================================================================
 * Semua request (GET utk baca publik, POST utk login & CRUD admin)
 * dikirim ke satu URL Web App Apps Script.
 *
 * Catatan teknis: POST dikirim dengan Content-Type "text/plain" agar
 * browser TIDAK melakukan CORS preflight (OPTIONS) — Apps Script Web App
 * tidak menangani preflight dengan baik. Ini pola standar untuk kasus ini.
 */

const Api = (() => {
  function getToken() {
    return localStorage.getItem("rapat_admin_token") || "";
  }
  function setToken(token) {
    localStorage.setItem("rapat_admin_token", token || "");
  }
  function clearToken() {
    localStorage.removeItem("rapat_admin_token");
  }

  async function callGet(action, params = {}) {
    const url = new URL(CONFIG.API_URL);
    url.searchParams.set("action", action);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString(), { method: "GET" });
    return res.json();
  }

  async function callPost(action, payload = {}) {
    const body = JSON.stringify({ action, token: getToken(), ...payload });
    const res = await fetch(CONFIG.API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body,
    });
    return res.json();
  }

  return {
    getToken,
    setToken,
    clearToken,

    // ---- Publik ----
    listMeetings: () => callGet("listMeetings"),

    // ---- Auth ----
    login: (username, password) => callPost("login", { username, password }),
    logout: () => {
      clearToken();
    },

    // ---- Admin CRUD ----
    listMeetingsAdmin: () => callPost("listMeetingsAdmin"),
    createMeeting: (data) => callPost("createMeeting", { data }),
    updateMeeting: (id, data) => callPost("updateMeeting", { id, data }),
    deleteMeeting: (id) => callPost("deleteMeeting", { id }),
  };
})();
