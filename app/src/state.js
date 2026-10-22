// Estado local de la aplicación (localStorage).
// Cada cuenta tiene su propio perfil y su propio historial: los datos de una
// cuenta nunca se mezclan con los de otra (decisión del usuario, §10).
const KEY = 'nutripocket.v1';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
}
function save(d) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* modo privado */ }
}
// Hash de demostración: la app es local, pero no guardamos la contraseña en claro.
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return 'h' + h.toString(16);
}

export const State = {
  currentUser() { return load().session || null; },

  createAccount(user, pass) {
    const d = load();
    d.accounts = d.accounts || {};
    if (d.accounts[user]) return { ok: false, msg: 'Ese usuario ya existe' };
    d.accounts[user] = { hash: hash(pass), createdAt: new Date().toISOString().slice(0, 10), profile: {}, history: {} };
    d.session = user;
    d.drafts = d.drafts || {};
    d.drafts[user] = {};
    delete d.draft;
    save(d);
    return { ok: true };
  },

  login(user, pass) {
    const d = load();
    const acc = d.accounts && d.accounts[user];
    if (!acc) return { ok: false, msg: 'Usuario inexistente' };
    if (acc.hash !== hash(pass)) return { ok: false, msg: 'Contraseña incorrecta' };
    d.session = user;
    d.drafts = d.drafts || {};
    delete d.draft;
    save(d);
    return { ok: true };
  },

  logout() {
    const d = load();
    const user = d.session;
    d.drafts = d.drafts || {};
    // Migración única de instalaciones antiguas que tenían un borrador global.
    if (user && d.draft && !d.drafts[user]) d.drafts[user] = d.draft;
    delete d.draft;
    d.session = null;
    save(d);
  },

  profile() {
    const u = this.currentUser();
    const d = load();
    return (u && d.accounts && d.accounts[u] && d.accounts[u].profile) || {};
  },

  accountCreatedAt() {
    const u = this.currentUser();
    const d = load();
    return (u && d.accounts && d.accounts[u] && d.accounts[u].createdAt) || null;
  },

  setProfile(patch) {
    const d = load();
    const u = d.session;
    if (!u || !d.accounts || !d.accounts[u]) return false;
    d.accounts[u].profile = Object.assign({}, d.accounts[u].profile, patch);
    save(d);
    return true;
  },

  history() {
    const u = this.currentUser();
    const d = load();
    return (u && d.accounts && d.accounts[u] && d.accounts[u].history) || {};
  },

  deviceState() {
    const h = this.history();
    return h.deviceState || null;
  },

  historyForDate(dateKey) {
    const h = this.history();
    const records = h.records || [];
    const dated = records.filter((r) => r.fecha_local === dateKey).sort((a, b) => (a.secuencia || 0) - (b.secuencia || 0));
    const latest = dated[dated.length - 1];
    if (latest) {
      if (latest.totals) return latest.totals;
      return {
        proteina: Number(latest.proteinas_total_g || latest.proteina_total_g || 0),
        carbohidratos: Number(latest.carbohidratos_total_g || latest.carbs_total_g || 0),
        grasas: Number(latest.grasas_total_g || latest.grasa_total_g || 0),
      };
    }
    const current = h.deviceState;
    if (current && current.fecha_local === dateKey) return current;
    return { proteina: 0, carbohidratos: 0, grasas: 0 };
  },

  setDeviceState(totals = {}) {
    const d = load(); const u = d.session;
    if (!u || !d.accounts || !d.accounts[u]) return false;
    const acc = d.accounts[u];
    acc.history = acc.history || {};
    const previous = acc.history.deviceState || {};
    const sameDay = previous.fecha_local && totals.fecha_local && previous.fecha_local === totals.fecha_local;
    const incomingZero = Number(totals.proteina || 0) === 0
      && Number(totals.carbohidratos || 0) === 0
      && Number(totals.grasas || 0) === 0;
    const previousNonZero = Number(previous.proteina || 0) > 0
      || Number(previous.carbohidratos || 0) > 0
      || Number(previous.grasas || 0) > 0;
    // El estado inicial del ESP32 puede llegar en cero al reconectar. No debe
    // borrar el acumulado persistido del mismo día.
    if (!(sameDay && incomingZero && previousNonZero)) {
      acc.history.deviceState = Object.assign({}, previous, totals);
    }
    save(d);
    return true;
  },

  addDeviceRecord(record, totals) {
    const d = load(); const u = d.session;
    if (!u || !d.accounts || !d.accounts[u] || !record) return false;
    const acc = d.accounts[u];
    acc.history = acc.history || {};
    acc.history.records = acc.history.records || [];
    const device = record.dispositivo || record.deviceId || 'esp32';
    const key = record.secuencia != null
      ? `${device}:${record.fecha_local || 'sin-fecha'}:seq:${record.secuencia}`
      : `${device}:${record.fecha_local || 'sin-fecha'}:${JSON.stringify(record)}`;
    const duplicate = acc.history.records.some((item) => item._deviceKey === key
      || (record.secuencia != null && item.secuencia === record.secuencia
        && item.fecha_local === record.fecha_local && (item.dispositivo || item.deviceId || 'esp32') === device));
    if (!duplicate) {
      acc.history.records.push({ ...record, totals, _deviceKey: key });
      save(d);
    }
    return true;
  },

  // Borrador aislado por cuenta (se conserva al cerrar sesión para reanudar).
  draft() {
    const d = load();
    return (d.session && d.drafts && d.drafts[d.session]) || {};
  },
  setDraft(patch) {
    const d = load();
    const user = d.session;
    if (!user) return false;
    d.drafts = d.drafts || {};
    d.drafts[user] = Object.assign({}, d.drafts[user] || {}, patch);
    save(d);
    return true;
  },
  clearDraft() {
    const d = load();
    if (d.session) {
      d.drafts = d.drafts || {};
      d.drafts[d.session] = {};
    }
    delete d.draft;
    save(d);
  },
};
