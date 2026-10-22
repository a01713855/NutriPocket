import { State } from './state.js';
import { Progress } from './progress.js';

let port = null;
let reader = null;
let writer = null;
let buffer = '';
let activeUser = null;
let reading = false;
let serialEventsAttached = false;
const listeners = new Set();

function notify(status, message = '') {
  listeners.forEach((fn) => fn({ status, message }));
}

function normalizeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function totalsFromMessage(msg) {
  const p = normalizeNumber(msg.proteinas_total_g ?? msg.proteina_total_g);
  const c = normalizeNumber(msg.carbohidratos_total_g ?? msg.carbs_total_g);
  const g = normalizeNumber(msg.grasas_total_g ?? msg.grasa_total_g);
  if (p == null && c == null && g == null) return null;
  return { proteina: p ?? 0, carbohidratos: c ?? 0, grasas: g ?? 0 };
}

function consumeMessage(msg) {
  if (!msg || !activeUser || State.currentUser() !== activeUser) return;
  if (msg.tipo === 'estado' || msg.tipo === 'registro') {
    const totals = totalsFromMessage(msg);
    const now = new Date();
    const fecha_local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (totals) {
      if (msg.tipo === 'estado') State.setDeviceState({ ...totals, fecha_local, secuencia: msg.secuencia });
      if (msg.tipo === 'registro') State.addDeviceRecord({ ...msg, fecha_local }, totals);
      Progress.set(totals);
    }
  } else if (msg.tipo === 'usuario' && msg.nombre) {
    notify('connected', `Perfil sincronizado: ${msg.nombre}`);
  } else if (msg.tipo === 'error') {
    notify('error', msg.mensaje || 'El dispositivo reportó un error');
  }
}

function consumeLine(line) {
  try { consumeMessage(JSON.parse(line)); }
  catch (error) { notify('error', 'Se recibió una línea JSON inválida'); }
}

async function readLoop() {
  if (!reader || reading) return;
  reading = true;
  const decoder = new TextDecoder();
  try {
    while (reader) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      lines.map((line) => line.trim()).filter(Boolean).forEach(consumeLine);
    }
  } catch (error) {
    if (activeUser) notify('error', 'La conexión USB se interrumpió');
  } finally {
    reading = false;
  }
}

async function send(message) {
  if (!writer) throw new Error('El dispositivo no está conectado');
  await writer.write(new TextEncoder().encode(JSON.stringify(message) + '\n'));
}

async function openPort(selectedPort) {
  port = selectedPort;
  await port.open({ baudRate: 115200 });
  writer = port.writable.getWriter();
  reader = port.readable.getReader();
  readLoop();
  const profile = State.profile();
  const draft = State.draft();
  await send({ tipo: 'usuario', nombre: profile.nombre || draft.nombre || State.currentUser() });
  await send({ tipo: 'estado' });
  notify('connected', 'NutriPocket conectado');
}

export const SerialManager = {
  supported() { return 'serial' in navigator; },
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },

  async connect() {
    if (!this.supported()) throw new Error('Web Serial no está disponible. Usa Chrome o Edge.');
    if (!State.currentUser()) throw new Error('Inicia sesión antes de conectar el dispositivo.');
    if (port && port.opened) { notify('connected', 'NutriPocket ya está conectado'); return; }
    const selected = await navigator.serial.requestPort();
    await openPort(selected);
  },

  async reconnectAuthorized() {
    if (!this.supported() || !State.currentUser() || (port && port.opened)) return;
    const ports = await navigator.serial.getPorts();
    if (ports.length) {
      try { await openPort(ports[0]); } catch (error) { notify('error', 'No se pudo reconectar el dispositivo'); }
    }
  },

  async disconnect(clearView = false) {
    const savedState = State.deviceState();
    reading = false;
    activeUser = null;
    try { if (reader) await reader.cancel(); } catch (e) { /* puerto ya cerrado */ }
    try { if (writer) writer.releaseLock(); } catch (e) { /* sin writer */ }
    try { if (port && port.opened) await port.close(); } catch (e) { /* desconexión externa */ }
    reader = null; writer = null; port = null; buffer = '';
    // Desconectar no significa borrar el último consumo sincronizado. Solo
    // se limpia la vista al cambiar/cerrar cuenta explícitamente.
    if (clearView) Progress.reset();
    else if (savedState) Progress.set(savedState);
    notify('disconnected', 'Dispositivo desconectado');
  },

  bindUser(user) {
    if (!serialEventsAttached && this.supported()) {
      serialEventsAttached = true;
      navigator.serial.addEventListener('disconnect', (event) => {
        if (port && event.port === port) this.disconnect();
      });
    }
    if (activeUser && activeUser !== user) this.disconnect(true);
    activeUser = user || null;
    if (activeUser) this.reconnectAuthorized();
  },
};
