/**
 * Lock — enkripsi link per-item (AES-GCM + PBKDF2) langsung di browser.
 * Link terkunci disimpan di Google Sheet sebagai teks "enc1:salt:iv:ciphertext",
 * jadi URL aslinya TIDAK pernah tersimpan polos. Password tidak disimpan di mana pun.
 */
const Lock = (() => {
  const PREFIX = "enc1:";
  const ITER = 150000;
  const te = new TextEncoder();
  const td = new TextDecoder();

  const b64 = (buf) => {
    let s = "";
    new Uint8Array(buf).forEach((b) => (s += String.fromCharCode(b)));
    return btoa(s);
  };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function deriveKey(password, salt) {
    const base = await crypto.subtle.importKey("raw", te.encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  function isLocked(v) {
    return typeof v === "string" && v.startsWith(PREFIX);
  }

  async function encrypt(url, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(url));
    return PREFIX + b64(salt) + ":" + b64(iv) + ":" + b64(ct);
  }

  // Melempar error kalau password salah.
  async function decrypt(value, password) {
    const [salt, iv, ct] = value.slice(PREFIX.length).split(":").map(unb64);
    const key = await deriveKey(password, salt);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return td.decode(pt);
  }

  return { isLocked, encrypt, decrypt };
})();
