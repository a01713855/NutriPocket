// Pantallas: decoración de la especificación + cableado de la navegación.
import { SCREENS } from './specs.js';
// La versión identifica explícitamente el módulo que contiene la exportación
// de las ondas y evita mezclarlo con una instancia cacheada anterior.
import { buildScreen, setWaveProgress } from './render.js?wave-progress=1';
import { attachWheel } from './wheels.js';
import { State } from './state.js';
import { Progress } from './progress.js';
import { REC_VARIANTS } from './recommendations.js';
import { calculateNutrition } from './nutrition.js';
import { SerialManager } from './serial.js';
import { go } from './router.js';
import { METRIC_COLORS, rgba, ASSETS } from './assets.js';

/* ------------------------------------------------------------------ *
 *  utilidades
 * ------------------------------------------------------------------ */

const CARD_RE = /^Frame 7\d$/;

function findText(spec, tx) {
  return spec.els.find((e) => e.tx === tx) || null;
}

function findTextStart(spec, prefix) {
  return spec.els.find((e) => typeof e.tx === 'string' && e.tx.startsWith(prefix)) || null;
}

/** Elemento contenedor (sin texto) más pequeño que contiene a `t`. */
function containerOf(spec, t) {
  const cx = t.x + t.w / 2;
  const cy = t.y + t.h / 2;
  let best = null;
  for (const e of spec.els) {
    if (e.i === t.i || e.tx !== undefined) continue;
    if (e.w >= t.w && e.h >= t.h && e.x <= cx && e.x + e.w >= cx && e.y <= cy && e.y + e.h >= cy) {
      if (!best || e.w * e.h < best.w * best.h) best = e;
    }
  }
  return best || t;
}

function nodeOf(byIndex, spec, el) {
  if (!el) return null;
  return byIndex.get(el.i) || byIndex.get(containerOf(spec, el).i) || null;
}

/** Cablea un texto (y su contenedor) a un manejador de clic. */
function wireText(ctx, tx, handler) {
  const t = findText(ctx.spec, tx);
  return wireTextNodes(ctx, t, handler);
}

function wireTextStart(ctx, prefix, handler) {
  const t = findTextStart(ctx.spec, prefix);
  return wireTextNodes(ctx, t, handler);
}

/**
 * Los elementos de Figma se renderizan como hermanos: texto, fondo y marco
 * no comparten DOM. Por eso un botón textual necesita dos hit targets, el
 * texto y el contenedor visual, sin añadir ninguna capa que tape controles.
 */
function wireTextNodes(ctx, textSpec, handler) {
  if (!textSpec) return null;
  const textNode = ctx.byIndex.get(textSpec.i);
  const containerSpec = containerOf(ctx.spec, textSpec);
  const containerNode = containerSpec && ctx.byIndex.get(containerSpec.i);
  const nodes = [...new Set([textNode, containerNode].filter(Boolean))];
  nodes.forEach((node) => {
    node.classList.add('hit');
    node.addEventListener('click', (ev) => { ev.stopPropagation(); handler(ev); });
  });
  return textNode || containerNode || null;
}

/** Cablea un nodo de superficie completa sin alterar su apariencia. */
function wireNode(ctx, node, handler) {
  if (!node) return null;
  node.classList.add('hit');
  node.addEventListener('click', (ev) => { ev.stopPropagation(); handler(ev); });
  return node;
}

/** Cajas de campo de texto del diseño (una por fila, sin duplicados). */
function fieldBoxes(spec) {
  const seen = new Map();
  for (const e of spec.els) {
    if (e.r === 20 && e.h >= 40 && e.h <= 50 && e.w > 300) {
      const k = Math.round(e.y);
      if (!seen.has(k)) seen.set(k, e);
    }
  }
  return [...seen.values()].sort((a, b) => a.y - b.y);
}

/** Sustituye la caja de campo del diseño por un <input> real. */
function makeInput(ctx, box, opts = {}) {
  const input = document.createElement('input');
  input.className = 'field-input' + (opts.numeric ? ' numeric' : '');
  input.type = opts.type || 'text';
  input.style.left = box.x + 'px';
  input.style.top = box.y + 'px';
  input.style.width = box.w + 'px';
  input.style.height = box.h + 'px';
  if (opts.numeric) input.inputMode = 'numeric';
  if (opts.placeholder) input.placeholder = opts.placeholder;
  if (opts.maxlength) input.maxLength = opts.maxlength;
  input.value = opts.value || '';
  ctx.root.appendChild(input);
  const node = ctx.byIndex.get(box.i);
  if (node) node.style.visibility = 'hidden';
  return input;
}

/* ------------------------------------------------------------------ *
 *  decoración de la especificación
 * ------------------------------------------------------------------ */

// Títulos a dos tonos: en Figma la última línea es azul de marca.
// Si el nodo lleva overrides por carácter (e.spans) se respeta ese estilo.
function paintTwoToneTitles(spec) {
  for (const e of spec.els) {
    // e.ln2 puede venir ya decidido de la spec (0 = navy sólido, p09).
    if (e.ln2 === undefined && e.tx !== undefined && !e.spans
        && e.fs >= 30 && e.f === '#173b64' && String(e.tx).includes('\n')) {
      e.ln2 = true;
    }
  }
}

// Barras: pista = color al 50 %, relleno = color sólido.
// Cada bloque (calorías, proteína, carbohidratos, grasas) lleva su color.
function paintBars(spec, palette) {
  // Si la spec trae ondas vectoriales reales (panel principal), éstas ya
  // llevan color: no se pinta ningún rectángulo encima.
  if (spec.els.some((e) => e.wave)) return;
  const bars = spec.els.filter((e) => e.tx === undefined && /^Barra/.test(e.nm || '') && !e.f);
  const groups = new Map();
  for (const b of bars) {
    const key = Math.round(b.y);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }
  const order = [...groups.keys()].sort((a, b) => a - b);
  order.forEach((key, gi) => {
    const color = palette[Math.min(gi, palette.length - 1)];
    const group = groups.get(key).sort((a, b) => b.w - a.w);
    group.forEach((b, k) => { b.f = k === 0 ? rgba(color, 0.5) : color; });
  });
}

// Anillos del historial diario: pista + arco (porcentaje medido en el PNG).
/** De un color `rgba(r, g, b, a)` o hex a hex opaco. */
function solido(v) {
  const m = /rgba?\(([^)]+)\)/.exec(v || '');
  if (!m) return v;
  const p = m[1].split(',').map(Number);
  return '#' + p.slice(0, 3).map((n) => n.toString(16).padStart(2, '0')).join('');
}

function paintRings(root, spec) {
  for (const e of spec.els) {
    if (e.nm !== 'Anillo de progreso') continue;
    const node = root.querySelector(`.el[data-idx="${e.i}"]`);
    if (!node) continue;
    const kids = spec.els.filter((k) => k.i !== e.i && k.x >= e.x - 1 && k.y >= e.y - 1
      && k.x + k.w <= e.x + e.w + 1 && k.y + k.h <= e.y + e.h + 1);
    const fondo = kids.find((k) => k.nm === 'Fondo del anillo' && k.f);
    const prog = kids.find((k) => k.nm === 'Progreso' && k.f);
    // El fill del nodo "Progreso" es una pintura oculta en Figma (en el panel
    // sale azul para la Proteína, y el PNG la pinta naranja): el tono real es
    // el de la pista "Fondo del anillo", que la API sí trae al 50 %.
    const color = (fondo && solido(fondo.f)) || (prog && prog.f) || '#0167ef';
    const arc = typeof e.arc === 'number' ? e.arc : 0;
    const r = 39.5;
    const circ = 2 * Math.PI * r;
    node.classList.add('ring');
    node.innerHTML =
      `<svg viewBox="0 0 90 90" xmlns="http://www.w3.org/2000/svg">
         <circle cx="45" cy="45" r="${r}" fill="none" stroke="${rgba(color, 0.5)}" stroke-width="11"/>
         <circle cx="45" cy="45" r="${r}" fill="none" stroke="${color}" stroke-width="11"
           stroke-linecap="round" stroke-dasharray="${(circ * arc).toFixed(1)} ${circ.toFixed(1)}"
           transform="rotate(-90 45 45)"/>
       </svg>`;
    for (const k of kids) {
      if (k.nm === 'Fondo del anillo' || k.nm === 'Progreso') {
        const n = root.querySelector(`.el[data-idx="${k.i}"]`);
        if (n) n.style.visibility = 'hidden';
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 *  calendario del historial mensual
 *  Las instancias "Día del mes" venían sin hijos del extractor, así que
 *  el mapa de calor de 5 tonos y el color del número se recuperaron del
 *  PNG del diseño; los números son los del mes mostrado (fechas reales).
 * ------------------------------------------------------------------ */

const CAL_TONES = [
  ['#c8dcf5', '#c8dcf5', '#c8dcf5', '#65a2f1', '#0167ef', '#96bef4', '#3384f0'],
  ['#0167ef', '#96bef4', '#3384f0', '#c8dcf5', '#65a2f1', '#0167ef', '#96bef4'],
  ['#65a2f1', '#0167ef', '#96bef4', '#3384f0', '#c8dcf5', '#65a2f1', '#0167ef'],
  ['#c8dcf5', '#65a2f1', '#0167ef', '#96bef4', '#3384f0', '#c8dcf5', '#65a2f1'],
  ['#3384f0', '#c8dcf5', '#65a2f1', '#c8dcf5', '#c8dcf5', '#c8dcf5', '#c8dcf5'],
];
const CAL_DARK = ['#0167ef'];   // solo sobre este tono el número va crema

function paintCalendar(root, spec) {
  const cells = spec.els.filter((e) => e.nm === 'Día del mes')
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));
  // geometría de la rejilla del diseño (5 filas); se guarda para poder
  // restaurarla si el mes mostrado necesita menos filas
  if (cells.length > 7) {
    root._cal = { y0: cells[0].y, h: cells[0].h, pitch: cells[7].y - cells[0].y };
  }
  cells.forEach((cell, k) => {
    const tone = (CAL_TONES[Math.floor(k / 7)] || [])[k % 7] || '#c8dcf5';
    const node = root.querySelector(`.el[data-idx="${cell.i}"]`);
    if (node) {
      node.classList.add('cal-cell');
      node.style.background = tone;
      node.style.borderRadius = '2px';
    }
    const day = document.createElement('div');
    day.className = 'tx cal-day';
    day.dataset.day = String(k);
    day.style.cssText = `left:${cell.x}px;top:${cell.y}px;width:${cell.w}px;height:${cell.h}px;`
      + `font-size:17px;font-weight:700;line-height:${cell.h}px;text-align:center;`
      + `color:${CAL_DARK.includes(tone) ? '#faf9f6' : '#173b64'};`;
    root.appendChild(day);
  });
}

/* ------------------------------------------------------------------ *
 *  pantalla 3.5 — GÉNERO (nueva, fuera de Figma)
 *  Construida con los componentes de opción única de la Pantalla 7,
 *  tal como pidió el usuario.
 * ------------------------------------------------------------------ */

const GENDER_LABELS = ['Masculino', 'Femenino'];
const GENDER_TOP = 362; // centrado entre el progreso (213) y el título (682)
const OBJECTIVE_OPTIONS = [
  ['maintain', 'Mantener mi peso', 'Conservar mi peso actual y mantener una alimentación equilibrada.'],
  ['lose_fat', 'Perder peso', 'Reducir mi grasa de manera gradual.'],
  ['gain_muscle', 'Ganar músculo', 'Aumentar mi músculo de manera gradual.'],
];

function objectiveSpec() {
  if (SCREENS.objetivo) return SCREENS.objetivo;
  const base = JSON.parse(JSON.stringify(SCREENS.p08));
  const cards = base.els.filter((e) => CARD_RE.test(e.nm || '') && e.h > 150);
  const remove = [];
  cards.forEach((card) => {
    remove.push(card.i);
    base.els.forEach((e) => {
      if (e.tx !== undefined && e.x >= card.x - 1 && e.x < card.x + card.w
          && e.y >= card.y - 1 && e.y < card.y + card.h) remove.push(e.i);
    });
  });
  const title = base.els.find((e) => e.tx !== undefined && e.fs >= 30);
  if (title) title.tx = '¿Cuál es tu\nobjetivo?';
  const els = base.els.filter((e) => !remove.includes(e.i));
  OBJECTIVE_OPTIONS.forEach(([id, heading, detail], index) => {
    const y = [283, 401, 528][index];
    const cardI = 100 + index * 3;
    els.push({ i: cardI, ty: 'RECTANGLE', nm: `Objetivo ${id}`, x: 54.5, y, w: 311, h: 108,
      f: '#faf9f6', bd: '#173b64', bw: 1.5, r: 50, sh: [{ x: 4, y: 4, b: 0, c: 'rgba(0,0,0,0.25)' }] });
    els.push({ i: cardI + 1, ty: 'TEXT', nm: `Objetivo título ${id}`, x: 80, y: y + 25, w: 260, h: 22,
      f: '#173b64', tx: heading, fs: 20, fw: 700, lh: 20.5, nw: 1 });
    els.push({ i: cardI + 2, ty: 'TEXT', nm: `Objetivo descripción ${id}`, x: 80, y: y + 53, w: 260, h: 34,
      f: '#173b64', tx: detail, fs: 16, fw: 400, lh: 16.4 });
  });
  const spec = { bg: base.bg, prog: 7, els };
  SCREENS.objetivo = spec;
  // Insertar esta pantalla desplaza P9 una posición en el progreso.
  SCREENS.p09.prog = 8;
  return spec;
}

function genderSpec() {
  if (SCREENS['p3.5']) return SCREENS['p3.5'];
  const base = SCREENS.p07;
  const els = JSON.parse(JSON.stringify(base.els));

  const cards = els.filter((e) => CARD_RE.test(e.nm || '') && e.h > 150);
  const top = cards.filter((c) => c.y < 400).sort((a, b) => a.x - b.x);
  const bottom = cards.filter((c) => c.y >= 400);
  // se descartan las dos tarjetas de la fila inferior y sus textos
  const drop = [];
  bottom.forEach((c) => {
    drop.push(c.i);
    els.forEach((e) => {
      if (e.tx !== undefined && e.x >= c.x - 1 && e.x < c.x + c.w && e.y >= c.y - 1 && e.y < c.y + c.h) {
        drop.push(e.i);
      }
    });
  });
  const wrapper = els.find((e) => e.nm === 'Component 6');

  top.forEach((card, k) => {
    const t = els.find((e) => e.tx !== undefined && e.x >= card.x - 1 && e.x < card.x + card.w
      && e.y >= card.y - 1 && e.y < card.y + card.h);
    if (!t) return;
    t.tx = GENDER_LABELS[k];
    t.x = card.x;
    t.y = GENDER_TOP + 64;
    t.w = card.w;
    t.h = 42;
    t.ta = 'CENTER';
    t.lh = 42;
    t.f = '#173b64';
    card.y = GENDER_TOP;
  });

  const title = els.find((e) => e.tx !== undefined && e.fs >= 30);
  if (title) title.tx = '¿Cuál es tu\ngénero?';

  const skip = drop.concat(wrapper ? [wrapper.i] : []);
  const spec = { bg: base.bg, prog: 1, els: els.filter((e) => !skip.includes(e.i)) };
  SCREENS['p3.5'] = spec;
  return spec;
}

/* ------------------------------------------------------------------ *
 *  fechas (no hay selector de mes/año: solo avanzar/retroceder)
 * ------------------------------------------------------------------ */

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const pad2 = (n) => String(n).padStart(2, '0');
const fmtDay = (d) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
const fmtMonth = (d) => `${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
function fmtWeek(d) {
  const a = new Date(d); a.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const b = new Date(a); b.setDate(a.getDate() + 6);
  return `${pad2(a.getDate())}/${pad2(a.getMonth() + 1)}–${pad2(b.getDate())}/${pad2(b.getMonth() + 1)}/${b.getFullYear()}`;
}

function dateKeyLocal(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function historyMetrics(date) {
  const consumed = State.historyForDate(dateKeyLocal(date));
  const profile = State.profile();
  const targets = {
    proteina: Number(profile.proteina) > 0 ? Number(profile.proteina) : null,
    carbohidratos: Number(profile.carbohidratos) > 0 ? Number(profile.carbohidratos) : null,
    grasas: Number(profile.grasas) > 0 ? Number(profile.grasas) : null,
    kcal: Number(profile.kcal) > 0 ? Number(profile.kcal) : null,
  };
  const kcal = consumed.proteina * 4 + consumed.carbohidratos * 4 + consumed.grasas * 9;
  const data = { ...consumed, kcal };
  return { data, targets, percent: Object.fromEntries(Object.keys(targets).map((key) => [
    key, targets[key] ? Math.min(1, data[key] / targets[key]) : 0,
  ])) };
}

function updateDailyHistory(ctx, date) {
  const spec = ctx.spec;
  const m = historyMetrics(date);
  const macros = ['proteina', 'carbohidratos', 'grasas'];
  const valueNodes = spec.els.filter((e) => e.tx !== undefined && /0 \/ ___ ?g/.test(e.tx)).sort((a, b) => a.y - b.y);
  macros.forEach((key, i) => {
    const n = valueNodes[i] && ctx.byIndex.get(valueNodes[i].i);
    if (n) n.textContent = `${Math.round(m.data[key])} / ${m.targets[key] == null ? '___' : Math.round(m.targets[key])} g`;
  });
  const kcal = spec.els.find((e) => e.nm === 'val');
  if (kcal) {
    const n = ctx.byIndex.get(kcal.i);
    if (n) n.textContent = `${Math.round(m.data.kcal)} / ${m.targets.kcal == null ? '___' : Math.round(m.targets.kcal)} kcal`;
  }
  const rings = spec.els.filter((e) => e.nm === 'Anillo de progreso').sort((a, b) => a.y - b.y);
  rings.forEach((ring, i) => {
    const node = ctx.byIndex.get(ring.i);
    const circle = node && node.querySelector('circle:nth-of-type(2)');
    if (!circle) return;
    const r = 39.5; const circumference = 2 * Math.PI * r;
    const p = m.percent[macros[i]] || 0;
    circle.setAttribute('stroke-dasharray', `${(circumference * p).toFixed(1)} ${circumference.toFixed(1)}`);
  });
  const bars = spec.els.filter((e) => e.nm === 'Barra' && Math.round(e.y) === 787).sort((a, b) => a.w - b.w);
  const fill = bars[0] && ctx.byIndex.get(bars[0].i);
  if (fill) {
    const p = m.percent.kcal || 0;
    fill.style.width = `${320 * p}px`;
  }
}

function updateWeeklyHistory(ctx, date, filter = 'Todas') {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const profile = State.profile();
  const targets = [Number(profile.proteina), Number(profile.carbohidratos), Number(profile.grasas)];
  const fills = ctx.spec.els.filter((e) => String(e.nm || '').startsWith('Consumo ·'));
  const tracks = ctx.spec.els.filter((e) => String(e.nm || '').startsWith('Pista ·'));
  const macroColors = { '#ff7043': 0, '#2e9e3e': 1, '#ffc94d': 2 };
  const fillFor = (day, macro) => fills.find((e) => {
    const mappedDay = Math.floor((e.x - 90) / 39);
    return mappedDay === day && macroColors[String(e.f).toLowerCase()] === macro;
  });
  const trackHeight = 228.6;
  ctx.spec.els.filter((e) => String(e.nm || '').startsWith('Meta cumplida')).forEach((e) => {
    const node = ctx.byIndex.get(e.i);
    if (node) node.style.display = 'none';
  });
  if (!ctx.root._weekDots) {
    ctx.root._weekDots = Array.from({ length: 21 }, (_, index) => {
      const day = Math.floor(index / 3);
      const macro = index % 3;
      const e = fillFor(day, macro);
      const dot = document.createElement('div');
      dot.className = 'week-goal-dot';
      dot.style.left = ((e ? e.x : 90 + day * 39 + macro * 12) + 2.5) + 'px';
      dot.style.top = '453px';
      dot.style.background = e?.f || '#173b64';
      dot.style.display = 'none';
      ctx.root.appendChild(dot);
      return dot;
    });
  }
  const activeMacro = filter === 'Proteína' ? 0 : filter === 'Carbos' ? 1 : filter === 'Grasas' ? 2 : null;
  const weekly = { proteina: 0, carbohidratos: 0, grasas: 0, kcal: 0 };
  for (let day = 0; day < 7; day++) {
    const current = new Date(start); current.setDate(start.getDate() + day);
    const data = State.historyForDate(dateKeyLocal(current));
    weekly.proteina += data.proteina;
    weekly.carbohidratos += data.carbohidratos;
    weekly.grasas += data.grasas;
    weekly.kcal += data.proteina * 4 + data.carbohidratos * 4 + data.grasas * 9;
    [data.proteina, data.carbohidratos, data.grasas].forEach((value, macro) => {
      const nodeSpec = fillFor(day, macro);
      const node = nodeSpec && ctx.byIndex.get(nodeSpec.i);
      if (!node) return;
      const ratio = targets[macro] > 0 ? Math.min(1, value / targets[macro]) : 0;
      const visible = activeMacro == null || activeMacro === macro;
      const x = activeMacro == null ? nodeSpec.x : 90 + day * 39;
      const width = activeMacro == null ? 10 : 34;
      node.style.left = x + 'px';
      node.style.width = width + 'px';
      node.style.top = (460 + trackHeight * (1 - ratio)) + 'px';
      node.style.height = (trackHeight * ratio) + 'px';
      node.style.display = visible ? '' : 'none';
      const trackSpec = tracks.find((e) => Math.round(e.x) === Math.round(nodeSpec.x));
      const track = trackSpec && ctx.byIndex.get(trackSpec.i);
      if (track) {
        track.style.left = x + 'px';
        track.style.width = width + 'px';
        track.style.display = visible ? '' : 'none';
      }
      const dot = ctx.root._weekDots[day * 3 + macro];
      if (dot) {
        dot.style.left = (x + width / 2 - 2.5) + 'px';
        dot.style.display = visible && targets[macro] > 0 && value >= targets[macro] ? 'block' : 'none';
      }
    });
  }
  const kcalTarget = Number(profile.kcal) > 0 ? Number(profile.kcal) * 7 : 0;
  const kcalFill = ctx.spec.els.filter((e) => e.nm === 'Barra' && Math.round(e.y) === 787)
    .sort((a, b) => a.w - b.w)[0];
  const kcalNode = kcalFill && ctx.byIndex.get(kcalFill.i);
  if (kcalNode) kcalNode.style.width = `${320 * (kcalTarget ? Math.min(1, weekly.kcal / kcalTarget) : 0)}px`;
}

function updateMonthlyHistory(ctx, date) {
  const cells = ctx.root.querySelectorAll('.cal-cell');
  const profile = State.profile();
  const target = Number(profile.kcal);
  const tones = ['#c8dcf5', '#96bef4', '#65a2f1', '#3384f0', '#0167ef'];
  cells.forEach((node, index) => {
    const day = index - ((new Date(date.getFullYear(), date.getMonth(), 1).getDay() + 6) % 7) + 1;
    if (day < 1 || day > new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()) return;
    const current = new Date(date.getFullYear(), date.getMonth(), day);
    const data = State.historyForDate(dateKeyLocal(current));
    const ratio = target > 0 ? Math.min(1, (data.proteina * 4 + data.carbohidratos * 4 + data.grasas * 9) / target) : 0;
    node.style.background = tones[Math.min(4, Math.floor(ratio * 5))];
  });
}

/* ------------------------------------------------------------------ *
 *  avisos de validación
 * ------------------------------------------------------------------ */

function flash(ctx, msg) {
  let el = ctx.root.querySelector('.flash');
  if (!el) {
    el = document.createElement('div');
    el.className = 'flash';
    el.style.cssText = 'position:absolute;left:40px;right:40px;bottom:24px;z-index:9;'
      + 'background:#173b64;color:#faf9f6;font-size:14px;font-weight:500;'
      + 'padding:10px 14px;border-radius:12px;text-align:center;pointer-events:none;'
      + 'transition:opacity .25s ease-out;';
    ctx.root.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, 2200);
}

/* ------------------------------------------------------------------ *
 *  cableado por pantalla
 * ------------------------------------------------------------------ */

function wInicio(ctx) {
  let transitioned = false;
  let timer = null;
  const next = () => {
    if (transitioned) return;
    transitioned = true;
    if (timer !== null) clearTimeout(timer);
    go(State.currentUser() ? 'panel' : 'empezar');
  };
  // P1 permanece visible exactamente 2000 ms y no necesita interacción.
  timer = setTimeout(next, 2000);
  ctx.root._cleanup = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
}

function wEmpezar(ctx) {
  wireText(ctx, 'Crear cuenta', () => go('crear-cuenta'));
  wireText(ctx, 'Log In', () => go('login'));
}

function resumeRoute(draft, profile) {
  if (profile && profile.proteina && profile.carbohidratos && profile.grasas) return 'panel';
  if (!draft.nombre) return 'nombre';
  if (!draft.genero) return 'genero';
  if (draft.edad === undefined) return 'edad';
  if (draft.estatura === undefined) return 'estatura';
  if (draft.peso === undefined) return 'peso';
  if (!draft.ejercicio) return 'ejercicio';
  if (!draft.tipo) return 'tipo-ejercicio';
  if (!draft.objetivo) return 'objetivo';
  return 'macros';
}

function wLogin(ctx) {
  const boxes = fieldBoxes(ctx.spec);
  const user = makeInput(ctx, boxes[0], { maxlength: 20 });
  const pass = makeInput(ctx, boxes[1], { type: 'password', maxlength: 20 });
  wireText(ctx, 'Regresar', () => go('empezar'));
  wireText(ctx, 'Log In', () => {
    const res = State.login(user.value.trim(), pass.value);
    if (!res.ok) { flash(ctx, res.msg); return; }
    go(resumeRoute(State.draft(), State.profile()));
  });
}

function wCrearCuenta(ctx) {
  const boxes = fieldBoxes(ctx.spec);
  const inputs = boxes.map((b) => makeInput(ctx, b, { maxlength: 40 }));
  wireText(ctx, 'Crear cuenta', () => {
    const [user, mail, pass, confirm] = inputs.map((i) => i.value.trim());
    if (!user || !mail || !pass || !confirm) { flash(ctx, 'Completa todos los campos'); return; }
    if (pass !== confirm) { flash(ctx, 'Las contraseñas no coinciden'); return; }
    const res = State.createAccount(user, pass);
    if (!res.ok) { flash(ctx, res.msg); return; }
    State.setDraft({ usuario: user, correo: mail });
    go('nombre');
  });
  wireText(ctx, 'Regresar', () => go('empezar'));
}

function wNombre(ctx) {
  const input = makeInput(ctx, fieldBoxes(ctx.spec)[0], {
    placeholder: 'Escribe aquí', value: State.draft().nombre || '', maxlength: 40,
  });
  // En Figma este campo (p03) sí lleva DROP_SHADOW 4/4/0 al 25 % sobre el
  // "Frame" hijo; los de login/crear-cuenta no. Se restaura solo aquí.
  input.classList.add('shadowed');
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') next(); });
  function next() {
    const v = input.value.trim();
    if (!v) { flash(ctx, 'Escribe tu nombre'); return; }
    State.setDraft({ nombre: v });
    go('genero');
  }
  wireText(ctx, 'Siguiente', next);
  wireText(ctx, '‹', () => go('crear-cuenta'));
}

function wGenero(ctx) {
  let selected = State.draft().genero || null;
  const titleSpec = ctx.spec.els.find((e) => e.tx !== undefined && e.fs >= 30);
  const titleNode = titleSpec && ctx.byIndex.get(titleSpec.i);
  if (titleNode) {
    titleNode.textContent = '';
    const firstLine = document.createElement('span');
    firstLine.textContent = '¿Cuál es tu\n';
    firstLine.style.color = '#173b64';
    const highlightedLine = document.createElement('span');
    highlightedLine.textContent = 'género?';
    highlightedLine.className = 'ln2';
    highlightedLine.style.color = '#0167ef';
    titleNode.append(firstLine, highlightedLine);
    titleNode.style.whiteSpace = 'pre';
    titleNode.style.width = '325px';
    titleNode.style.height = '98px';
    titleNode.style.textAlign = 'left';
  }
  const cards = ctx.spec.els.filter((e) => CARD_RE.test(e.nm || '') && e.h > 150).sort((a, b) => a.x - b.x);
  const nodes = cards.map((c) => nodeOf(ctx.byIndex, ctx.spec, c)).filter(Boolean);

  function paint() {
    nodes.forEach((n, k) => {
      const active = GENDER_LABELS[k] === selected;
      n.classList.toggle('selected', active);
      n.style.background = active ? '#173b64' : '#faf9f6';
      const text = ctx.spec.els.find((e) => e.tx === GENDER_LABELS[k]);
      const textNode = text && ctx.byIndex.get(text.i);
      if (textNode) textNode.style.color = active ? '#faf9f6' : '#173b64';
    });
    const btn = nodeOf(ctx.byIndex, ctx.spec, findText(ctx.spec, 'Siguiente'));
    if (btn) btn.classList.toggle('disabled', !selected);
  }
  nodes.forEach((n, k) => {
    n.classList.add('hit', 'card-option');
    n.addEventListener('click', () => { selected = GENDER_LABELS[k]; paint(); });
  });
  paint();

  function next() {
    if (!selected) { flash(ctx, 'Selecciona una opción'); return; }
    State.setDraft({ genero: selected });
    go('edad');
  }
  wireText(ctx, 'Siguiente', next);
  wireText(ctx, '‹', () => go('nombre'));
}

function wObjetivo(ctx) {
  let selected = State.draft().objetivo || null;
  const titleSpec = ctx.spec.els.find((e) => e.tx !== undefined && e.fs >= 30);
  const titleNode = titleSpec && ctx.byIndex.get(titleSpec.i);
  if (titleNode) {
    titleNode.textContent = '';
    const first = document.createElement('span');
    first.textContent = '¿Cuál es tu\n';
    first.style.color = '#173b64';
    const highlight = document.createElement('span');
    highlight.textContent = 'objetivo?';
    highlight.className = 'ln2';
    highlight.style.color = '#0167ef';
    titleNode.append(first, highlight);
    titleNode.style.whiteSpace = 'pre';
  }
  const pairs = OBJECTIVE_OPTIONS.map(([id]) => {
    const card = ctx.spec.els.find((e) => e.nm === `Objetivo ${id}`);
    const title = ctx.spec.els.find((e) => e.nm === `Objetivo título ${id}`);
    const desc = ctx.spec.els.find((e) => e.nm === `Objetivo descripción ${id}`);
    return { id, card, title, desc, node: card && ctx.byIndex.get(card.i) };
  });
  function paint() {
    pairs.forEach((p) => {
      const active = p.id === selected;
      if (p.node) {
        p.node.classList.toggle('selected', active);
        p.node.classList.add('hit', 'card-option');
        p.node.style.background = active ? '#173b64' : '#faf9f6';
      }
      [p.title, p.desc].forEach((spec) => {
        const node = spec && ctx.byIndex.get(spec.i);
        if (node) node.style.color = active ? '#faf9f6' : '#173b64';
      });
    });
    const next = nodeOf(ctx.byIndex, ctx.spec, findText(ctx.spec, 'Siguiente'));
    if (next) next.classList.toggle('disabled', !selected);
  }
  pairs.forEach((p) => {
    if (p.node) p.node.addEventListener('click', () => { selected = p.id; paint(); });
  });
  paint();
  wireText(ctx, 'Siguiente', () => {
    if (!selected) { flash(ctx, 'Selecciona un objetivo'); return; }
    State.setDraft({ objetivo: selected });
    go('macros');
  });
  wireText(ctx, '‹', () => go('tipo-ejercicio'));
}

function wRueda(ctx, cfg) {
  const draft = State.draft();
  const wheel = attachWheel(ctx.root, ctx.spec, {
    min: cfg.min,
    max: cfg.max,
    value: draft[cfg.key] !== undefined ? draft[cfg.key] : cfg.min,
  });
  wireText(ctx, 'Siguiente', () => {
    if (!wheel.valid) {
      flash(ctx, `El valor debe estar entre ${cfg.min} y ${cfg.max}`);
      return;
    }
    State.setDraft({ [cfg.key]: wheel.value });
    go(cfg.next);
  });
  wireText(ctx, '‹', () => go(cfg.back));
}

function wOpciones(ctx, cfg) {
  let selected = State.draft()[cfg.key] || null;
  const cards = ctx.spec.els.filter((e) => CARD_RE.test(e.nm || '') && e.h > 150);
  const pairs = cards.map((card) => ({
    card,
    text: ctx.spec.els.find((e) => e.tx !== undefined && e.x >= card.x - 1 && e.x < card.x + card.w
      && e.y >= card.y - 1 && e.y < card.y + card.h),
  })).filter((p) => p.text);

  pairs.forEach((p) => {
    const n = nodeOf(ctx.byIndex, ctx.spec, p.card);
    if (!n) return;
    n.classList.add('hit', 'card-option');
    n.addEventListener('click', () => { selected = p.text.tx; paint(); });
  });

  function paint() {
    pairs.forEach((p) => {
      const n = nodeOf(ctx.byIndex, ctx.spec, p.card);
      const active = p.text.tx === selected;
      if (n) {
        n.classList.toggle('selected', active);
        n.style.background = active ? '#173b64' : '#faf9f6';
      }
      const textNode = ctx.byIndex.get(p.text.i);
      if (textNode) textNode.style.color = active ? '#faf9f6' : '#173b64';
    });
    const btn = nodeOf(ctx.byIndex, ctx.spec, findText(ctx.spec, 'Siguiente'));
    if (btn) btn.classList.toggle('disabled', !selected);
  }
  paint();

  wireText(ctx, 'Siguiente', () => {
    if (!selected) { flash(ctx, 'Selecciona una opción'); return; }
    State.setDraft({ [cfg.key]: selected });
    go(cfg.next);
  });
  wireText(ctx, '‹', () => go(cfg.back));
}

function wMacros(ctx) {
  const edad = Number(State.draft().edad);
  const underageMessage = 'La generación automática de metas está disponible únicamente para mayores de 18 años. Si eres menor de edad, puedes ingresar tus metas manualmente con orientación de un profesional de la salud.';
  const manual = () => {
    // P9.2 comienza explícitamente con las tres entradas en cero.
    State.setDraft({ macros: { proteina: 0, carbohidratos: 0, grasas: 0 }, suggestedMacros: null });
    go('macros-manual');
  };

  // Los grupos de Figma son la superficie completa de cada tarjeta. El texto
  // sigue cableado por separado porque todos los elementos se renderizan como
  // hermanos DOM, no como hijos del grupo.
  const autoCard = ctx.spec.els.find((e) => e.nm === 'Auto- generar');
  const manualCard = ctx.spec.els.find((e) => e.nm === 'Ingresar manual');

  if (edad >= 15 && edad <= 17) {
    // 15–17 años: solo ingreso manual (decisión del usuario).
    const auto = nodeOf(ctx.byIndex, ctx.spec, findText(ctx.spec, 'Auto-\ngenerar'));
    if (auto) {
      auto.classList.add('disabled');
      auto.dataset.pending = 'solo-ingreso-manual-15-17';
      auto.title = 'Con 15–17 años solo está disponible el ingreso manual';
      wireText(ctx, 'Auto-\ngenerar', () => flash(ctx, underageMessage));
    }
  } else {
    const autoHandler = () => {
      try {
        const result = calculateNutrition(State.draft());
        State.setDraft({ suggestedMacros: result });
        go('metas-sugeridas');
      } catch (error) {
        flash(ctx, error.message);
      }
    };
    wireNode(ctx, nodeOf(ctx.byIndex, ctx.spec, autoCard), autoHandler);
    wireText(ctx, 'Auto-\ngenerar', autoHandler);
  }
  wireNode(ctx, nodeOf(ctx.byIndex, ctx.spec, manualCard), manual);
  wireText(ctx, 'Ingresar\nmanual', manual);
  wireText(ctx, '‹', () => go('objetivo'));
}

function wMetas(ctx) {
  const edad = Number(State.draft().edad);
  if (edad >= 15 && edad <= 17) {
    // Protección de la ruta directa: un menor no puede reutilizar ni fabricar
    // resultados automáticos navegando manualmente a P9.1.
    go('macros');
    return;
  }
  const suggested = State.draft().suggestedMacros || null;
  const values = ctx.spec.els.filter((e) => e.tx === ' ___ g').sort((a, b) => a.y - b.y);
  const kcal = ctx.spec.els.find((e) => e.tx === '≈ ___ kcal');
  if (suggested) {
    values.forEach((e, i) => {
      const node = ctx.byIndex.get(e.i);
      if (node) node.textContent = `${[suggested.proteina, suggested.carbohidratos, suggested.grasas][i]} g`;
    });
    const kcalNode = kcal && ctx.byIndex.get(kcal.i);
    if (kcalNode) kcalNode.textContent = `≈ ${suggested.kcal} kcal`;
  } else {
    flash(ctx, 'No hay metas sugeridas calculadas para este perfil.');
  }
  wireText(ctx, 'Guardar perfil nutricional', () => {
    if (!suggested) { flash(ctx, 'Genera metas desde P9 antes de guardarlas.'); return; }
    const saved = State.setProfile({
      proteina: suggested.proteina,
      carbohidratos: suggested.carbohidratos,
      grasas: suggested.grasas,
      kcal: suggested.kcal,
    });
    if (!saved) { flash(ctx, 'No se pudo guardar el perfil'); return; }
    State.setDraft({ macros: {
      proteina: suggested.proteina,
      carbohidratos: suggested.carbohidratos,
      grasas: suggested.grasas,
    }, suggestedMacros: null });
    go('carga');
  });
  wireText(ctx, 'Editar metas sugeridas', () => go('macros-manual'));
  wireText(ctx, '‹', () => go('macros'));
}

function wManual(ctx) {
  const spec = ctx.spec;
  // Cajas de entrada del diseño (Frame "field", 60×32) para cada macro.
  const boxes = spec.els.filter((e) => e.nm === 'field').sort((a, b) => a.y - b.y);
  const inputs = boxes.map((box, inputIndex) => {
    const shell = ctx.byIndex.get(box.i);
    if (shell) shell.classList.add('field-shell');
    const zero = spec.els.find((e) => e.tx === '0' && e.x >= box.x && e.x < box.x + box.w
      && e.y >= box.y && e.y < box.y + box.h);
    if (zero) { const n = ctx.byIndex.get(zero.i); if (n) n.style.visibility = 'hidden'; }
    const input = document.createElement('input');
    input.className = 'field-input inline';
    input.inputMode = 'numeric';
    input.maxLength = 3;
    input.style.left = box.x + 'px';
    input.style.top = box.y + 'px';
    input.style.width = box.w + 'px';
    input.style.height = box.h + 'px';
    const suggested = State.draft().suggestedMacros;
    input.value = suggested
      ? String([suggested.proteina, suggested.carbohidratos, suggested.grasas][inputIndex])
      : '0';
    // Al entrar o hacer clic se selecciona todo el contenido. Así, el cero
    // inicial se reemplaza directamente por el primer dígito escrito.
    const selectAll = () => input.select();
    input.addEventListener('focus', selectAll);
    input.addEventListener('click', selectAll);
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 3);
      recompute();
    });
    ctx.root.appendChild(input);
    return input;
  });

  const kcalNode = nodeOf(ctx.byIndex, spec, findTextStart(spec, '≈'));
  const guardNode = nodeOf(ctx.byIndex, spec, findText(spec, 'Guardar perfil nutricional'));

  function recompute() {
    const v = inputs.map((i) => parseInt(i.value, 10) || 0);
    const kcal = 4 * v[0] + 4 * v[1] + 9 * v[2];
    // En el diseño el total arranca como marcador de posición ("≈ ___ kcal")
    // y solo muestra cifra cuando hay macros definidas.
    if (kcalNode) kcalNode.textContent = kcal > 0 ? `≈ ${kcal} kcal` : '≈ ___ kcal';
    const ok = v.length === 3 && v.every((x) => Number.isInteger(x) && x >= 1 && x <= 500);
    if (guardNode) guardNode.classList.toggle('disabled', !ok);
    return { v, kcal, ok };
  }
  inputs.forEach((i) => i.addEventListener('input', recompute));
  recompute();

  wireText(ctx, 'Guardar perfil nutricional', () => {
    const { v, kcal, ok } = recompute();
    if (!ok) { flash(ctx, 'Los tres valores deben ser mayores a 0'); return; }
    const saved = State.setProfile({ proteina: v[0], carbohidratos: v[1], grasas: v[2], kcal });
    if (!saved) { flash(ctx, 'No se pudo guardar el perfil'); return; }
    State.setDraft({ macros: { proteina: v[0], carbohidratos: v[1], grasas: v[2] }, suggestedMacros: null });
    go('carga');
  });
  wireText(ctx, '‹', () => go('macros'));
}

function wCarga(ctx) {
  const video = document.createElement('video');
  video.className = 'loading-video';
  video.src = ASSETS.loadingVideo;
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.loop = false;
  video.controls = false;
  video.poster = ASSETS.loadingPoster;
  video.setAttribute('aria-label', 'Cargando tu perfil nutricional');
  video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;';
  ctx.root.appendChild(video);

  let finished = false;
  let started = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    go('panel');
  };
  video.addEventListener('ended', finish, { once: true });
  const start = () => {
    if (!started) video.currentTime = 0;
    const play = video.play();
    if (play && typeof play.then === 'function') {
      play.then(() => { started = true; }).catch(() => {
        // Los navegadores suelen permitir autoplay al estar muted. Si una
        // política local lo bloquea, canplay o una interacción lo reintentan.
      });
    }
  };
  video.addEventListener('loadedmetadata', start);
  video.addEventListener('canplay', start);
  ctx.root.addEventListener('click', start);
  start();
}

function wPanel(ctx) {
  SerialManager.bindUser(State.currentUser());
  // P11 debe reconstruirse desde el mismo registro diario que usa Historial
  // Día, no solo desde el último mensaje `estado` recibido por USB.
  const today = new Date();
  const storedToday = State.historyForDate(dateKeyLocal(today));
  Progress.set(storedToday);
  const greetingSpec = ctx.spec.els.find((e) => e.tx === '¡Bienvenidx!');
  const greetingNode = greetingSpec && ctx.byIndex.get(greetingSpec.i);
  if (greetingNode) {
    const profile = State.profile();
    const draft = State.draft();
    const source = String(profile.nombre || draft.nombre || State.currentUser() || '').trim();
    const firstName = source.split(/\s+/).filter(Boolean)[0] || '';
    greetingNode.textContent = firstName ? `¡Hola ${firstName}!` : '¡Hola!';
  }
  const update = () => updatePanelProgress(ctx);
  update();
  const stop = Progress.subscribe(() => {
    if (!ctx.root.isConnected) { stop(); return; }
    update();
  });
  wireText(ctx, 'Historial', () => go('historial-dia'));
  wireTextStart(ctx, 'Recomendaciones', () => go('recomendaciones'));
  const icon = ctx.spec.els.find((e) => e.ui === 'usericon');
  const n = icon && nodeOf(ctx.byIndex, ctx.spec, icon);
  let sidebar = null;
  if (n) {
    n.classList.add('hit');
    n.addEventListener('click', () => {
      if (sidebar) {
        sidebar.close();
        sidebar = null;
      } else {
        sidebar = openSidebar(ctx, () => { sidebar = null; });
      }
    });
  }
}

const PANEL_PROGRESS = [
  { key: 'kcal', unit: 'kcal', color: METRIC_COLORS[0] },
  { key: 'proteina', unit: 'g', color: METRIC_COLORS[1] },
  { key: 'carbohidratos', unit: 'g', color: METRIC_COLORS[2] },
  { key: 'grasas', unit: 'g', color: METRIC_COLORS[3] },
];

function updatePanelProgress(ctx) {
  const spec = ctx.spec;
  const metrics = Progress.metrics(State.profile());
  const values = spec.els.filter((e) => e.nm === 'val').sort((a, b) => a.y - b.y);
  const remaining = spec.els.filter((e) => e.nm === 'Wave — remaining').sort((a, b) => a.y - b.y);
  const filled = spec.els.filter((e) => e.nm === 'Wave — filled').sort((a, b) => a.y - b.y);

  PANEL_PROGRESS.forEach((item, index) => {
    const valueNode = values[index] && ctx.byIndex.get(values[index].i);
    const target = metrics.targets[item.key];
    const consumed = Math.round(metrics.data[item.key]);
    if (valueNode) valueNode.textContent = `${consumed} / ${target == null ? '___' : Math.round(target)} ${item.unit}`;

    const base = remaining[index];
    const fill = filled[index] && ctx.byIndex.get(filled[index].i);
    const pct = metrics.percent[item.key];
    if (fill && base) {
      // El nodo "filled" exportado por Figma solo mide el tramo inicialmente
      // coloreado; para poder revelar hasta el 100 % conservamos su posición
      // y le damos el ancho de la onda completa.
      fill.style.width = base.w + 'px';
      setWaveProgress(fill, {
        ...base.wave,
        i: fill.i,
        w: base.w,
        h: base.h,
      }, pct == null ? 0 : pct, item.color);
    }
  });
}

function wProgressDev(ctx) {
  const update = () => updatePanelProgress(ctx);
  update();
  const stop = Progress.subscribe(() => {
    if (!ctx.root.isConnected) { stop(); return; }
    update();
  });
  const panel = document.createElement('section');
  panel.className = 'progress-dev-panel';
  panel.innerHTML = '<h1>Prueba de progreso</h1>'
    + '<p>Valores simulados en memoria; no modifican la cuenta ni el historial.</p>'
    + '<div class="progress-dev-fields">'
    + '<label>Proteínas (g)<input data-progress="proteina" type="number" min="0" step="1" value="0"></label>'
    + '<label>Carbohidratos (g)<input data-progress="carbohidratos" type="number" min="0" step="1" value="0"></label>'
    + '<label>Grasas (g)<input data-progress="grasas" type="number" min="0" step="1" value="0"></label>'
    + '</div><p class="progress-dev-kcal">Calorías simuladas: <strong>0 kcal</strong></p>'
    + '<p class="progress-dev-targets"></p>'
    + '<button type="button" data-progress-reset>Restablecer a cero</button>';
  ctx.root.appendChild(panel);

  const inputs = [...panel.querySelectorAll('input[data-progress]')];
  const kcal = panel.querySelector('.progress-dev-kcal strong');
  const targets = panel.querySelector('.progress-dev-targets');
  const refresh = (data = Progress.get()) => {
    inputs.forEach((input) => { input.value = String(data[input.dataset.progress]); });
    kcal.textContent = `${data.kcal} kcal`;
    const m = Progress.metrics(State.profile()).targets;
    targets.textContent = Object.values(m).every((v) => v != null)
      ? 'Metas cargadas desde el perfil guardado.'
      : 'Configura metas válidas en el perfil para visualizar porcentajes.';
  };
  inputs.forEach((input) => input.addEventListener('input', () => {
    Progress.set({ [input.dataset.progress]: input.value });
    refresh();
  }));
  panel.querySelector('[data-progress-reset]').addEventListener('click', () => {
    Progress.reset();
    refresh();
  });
  refresh();
}

function openSidebar(ctx, onClose) {
  const { root, byIndex } = buildScreen('sidebar');
  // El marco "Usuario franja" mide 245×912 y se ancla al borde derecho del
  // viewport de 420 px; sus coordenadas internas siguen siendo las de Figma.
  root.style.width = '245px';
  root.style.left = '175px';
  root.style.right = 'auto';
  root.style.zIndex = '6';
  root.classList.add('sidebar-panel');

  const spec = SCREENS.sidebar;

  const scrim = document.createElement('div');
  scrim.className = 'scrim sidebar-scrim';
  ctx.root.appendChild(scrim);
  ctx.root.appendChild(root);

  let closed = false;
  let stopSerial = () => {};
  const close = () => {
    if (closed) return;
    closed = true;
    root.classList.remove('open');
    scrim.classList.remove('open');
    stopSerial();
    setTimeout(() => { scrim.remove(); root.remove(); }, 240);
    if (onClose) onClose();
  };
  scrim.addEventListener('click', close);
  root.addEventListener('click', (ev) => ev.stopPropagation());

  const side = { spec, byIndex, root };
  const sideIcon = spec.els.find((e) => e.ui === 'usericon');
  wireNode(side, sideIcon && byIndex.get(sideIcon.i), close);
  wireText(side, 'Cerrar sesión', () => { close(); SerialManager.disconnect(true); State.logout(); go('inicio'); });

  const serialButton = document.createElement('button');
  serialButton.className = 'serial-connect';
  serialButton.type = 'button';
  serialButton.textContent = 'Conectar NutriPocket';
  root.appendChild(serialButton);
  const updateSerialButton = ({ status, message }) => {
    serialButton.textContent = status === 'connected' ? 'NutriPocket conectado' : 'Conectar NutriPocket';
    if (status === 'error') serialButton.title = message;
  };
  stopSerial = SerialManager.subscribe(updateSerialButton);
  serialButton.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    try { await SerialManager.connect(); }
    catch (error) { updateSerialButton({ status: 'error', message: error.message }); }
  });
  requestAnimationFrame(() => {
    root.classList.add('open');
    scrim.classList.add('open');
  });
  return { close };
}

/**
 * Historiales: segmentado de vista, chips de filtro y stepper de período.
 * El rótulo conserva el texto del diseño en el periodo actual ("Hoy",
 * "Últimos 7 días") y pasa a fecha real al navegar.
 */
function wHistorial(ctx, cfg) {
  const spec = ctx.spec;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let offset = 0;               // días (o meses en la vista mensual)
  let historyFilter = 'Todas';
  const stopProgress = Progress.subscribe(() => refresh());
  ctx.root._cleanup = stopProgress;

  // Segmentado Día / Semanal / Mensual
  wireHistorySegmented(ctx);

  // Chips de filtro de macros: selección simple
  if (cfg.chips) wireHistoryFilters(ctx, cfg.chips, (label) => {
    historyFilter = label;
    if (ctx.name === 'historial-semana') updateWeeklyHistory(ctx, current(), historyFilter);
  });

  const label = spec.els.find((e) => e.tx !== undefined && e.y > 265 && e.y < 300 && e.x > 90 && e.x < 330);
  const steppers = spec.els.filter((e) => e.tx === '‹' && e.y > 265 && e.y < 300);
  const created = State.accountCreatedAt && State.accountCreatedAt();
  const minDate = created ? new Date(`${created}T00:00:00`) : null;

  function current() {
    const d = new Date(today);
    if (cfg.monthly) d.setMonth(d.getMonth() + offset);
    else d.setDate(d.getDate() + offset);
    return d;
  }
  function periodStart(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    if (cfg.monthly) return new Date(d.getFullYear(), d.getMonth(), 1);
    if (cfg.step === 7) d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  }
  function canMove(dir) {
    const nextOffset = offset + dir * (cfg.monthly ? 1 : cfg.step);
    if (dir > 0 && nextOffset > 0) return false;
    if (dir < 0 && minDate) {
      const candidate = new Date(today);
      if (cfg.monthly) candidate.setMonth(candidate.getMonth() + nextOffset);
      else candidate.setDate(candidate.getDate() + nextOffset);
      if (periodStart(candidate) < periodStart(minDate)) return false;
    }
    return true;
  }
  function refresh() {
    const node = label && ctx.byIndex.get(label.i);
    if (node) {
      node.style.left = '70px';
      node.style.width = '280px';
      node.style.textAlign = 'center';
      node.style.whiteSpace = 'nowrap';
      node.textContent = offset === 0 ? cfg.base : cfg.fmt(current());
    }
    const left = steppers.find((e) => e.x < 200);
    const right = steppers.find((e) => e.x >= 200);
    const leftNode = left && ctx.byIndex.get(left.i);
    const rightNode = right && ctx.byIndex.get(right.i);
    if (leftNode) { leftNode.textContent = '‹'; leftNode.classList.toggle('disabled', !canMove(-1)); }
    if (rightNode) { rightNode.textContent = '›'; rightNode.classList.toggle('disabled', !canMove(1)); }
    if (cfg.monthly) renumberCalendar(ctx.root, current());
    if (ctx.name === 'historial-dia') updateDailyHistory(ctx, current());
    if (ctx.name === 'historial-semana') updateWeeklyHistory(ctx, current(), historyFilter);
    if (ctx.name === 'historial-mes') updateMonthlyHistory(ctx, current());
  }
  const bind = (el, dir) => {
    const node = el && ctx.byIndex.get(el.i);
    if (!node) return;
    node.classList.add('hit');
    node.addEventListener('click', () => {
      if (!canMove(dir)) return;
      offset += dir * (cfg.monthly ? 1 : cfg.step);
      refresh();
    });
  };
  bind(steppers.find((e) => e.x < 200), -1);
  bind(steppers.find((e) => e.x >= 200), 1);
  refresh();

  wireText(ctx, '‹', () => go('panel'));
}

/** Reenumera la rejilla del calendario según el mes mostrado (lunes primero). */
function renumberCalendar(root, date) {
  const offset = (new Date(date.getFullYear(), date.getMonth(), 1).getDay() + 6) % 7;
  const days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const cells = [...root.querySelectorAll('.el.cal-cell')];
  const nums = [...root.querySelectorAll('.cal-day')];

  // La rejilla del diseño tiene 5 filas (35 celdas, 496..780). Meses como
  // noviembre de 2026 (empieza en domingo) necesitan 6: se clona la última
  // fila y se comprime el paso para seguir dentro del mismo hueco, con lo
  // que se ven todos los días en su columna correcta y la leyenda de
  // niveles (y=801) no se mueve.
  const geo = root._cal;
  if (offset + days > 35) {
    if (geo && cells.length === 35) {
      for (let k = 0; k < 7; k++) {
        const c = cells[k].cloneNode(true);
        c.dataset.idx = 'x' + k;
        root.appendChild(c);
        cells.push(c);
        const n = nums[k].cloneNode(true);
        root.appendChild(n);
        nums.push(n);
      }
      const gap = geo.pitch - geo.h;
      const h = (4 * geo.pitch + geo.h - 5 * gap) / 6;
      const pitch = h + gap;
      cells.forEach((c, k) => {
        c.style.top = (geo.y0 + Math.floor(k / 7) * pitch) + 'px';
        c.style.height = h + 'px';
      });
      nums.forEach((n, k) => {
        n.style.top = (geo.y0 + Math.floor(k / 7) * pitch) + 'px';
        n.style.height = h + 'px';
        n.style.lineHeight = h + 'px';
      });
    }
  } else if (geo && cells.length > 35) {
    cells.splice(35).forEach((c) => c.remove());
    nums.splice(35).forEach((n) => n.remove());
    cells.forEach((c, k) => {
      c.style.top = (geo.y0 + Math.floor(k / 7) * geo.pitch) + 'px';
      c.style.height = geo.h + 'px';
    });
    nums.forEach((n, k) => {
      n.style.top = (geo.y0 + Math.floor(k / 7) * geo.pitch) + 'px';
      n.style.height = geo.h + 'px';
      n.style.lineHeight = geo.h + 'px';
    });
  }

  nums.forEach((node, k) => {
    const day = k - offset + 1;
    node.textContent = (day >= 1 && day <= days) ? String(day) : '';
  });
}

const REC_SECTIONS = ['Carnes Blancas y Rojas', 'Pescado y Mariscos',
  'Legumbres y Vegetales', 'Suplementos y Lácteos'];

/** Grupo de chips de selección simple (contenedor + su texto). */
function wireChipSet(ctx, labels, onSelect) {
  const pairs = labels.map((tx) => {
    const t = findText(ctx.spec, tx);
    // En Recomendaciones el texto es hermano del segmento, no su contenedor.
    // Usar el texto como hit dejaba el fondo seleccionado cuadrado y hacía
    // clicable solo el área de las letras.
    const container = t && containerOf(ctx.spec, t);
    const node = container ? ctx.byIndex.get(container.i) : nodeOf(ctx.byIndex, ctx.spec, t);
    const textNode = t ? ctx.byIndex.get(t.i) : null;
    return node ? { node, textNode, text: tx } : null;
  }).filter(Boolean);

  const shell = ctx.spec.els.find((e) => e.nm === 'Botones proteinas');
  const shellNode = shell && ctx.byIndex.get(shell.i);
  if (shellNode) shellNode.classList.add('chip-segmented-shell');

  pairs.forEach((p, index) => {
    p.node.classList.add('hit', 'chip-hit', 'chip-segment');
    if (index === 0) p.node.classList.add('chip-first');
    if (index === pairs.length - 1) p.node.classList.add('chip-last');
    // El primer segmento llega desde Figma como "Opción seleccionada", por
    // lo que su fill original es navy. Su fondo no seleccionado, sin embargo,
    // debe ser el mismo claro que los otros dos segmentos.
    p.node.dataset.bg = index === 0
      ? '#faf9f6'
      : (p.node.style.background || '#faf9f6');
    // Proteínas llega desde Figma en su variante seleccionada (texto blanco),
    // pero necesita recuperar navy al pasar a un estado no seleccionado.
    p.textColor = index === 0
      ? '#173b64'
      : (p.textNode ? p.textNode.style.color : '#173b64');
  });

  function select(selected) {
    pairs.forEach((p) => {
      p.node.classList.toggle('selected', p === selected);
      p.node.style.background = p === selected ? '#173b64' : p.node.dataset.bg;
      if (p.textNode) p.textNode.style.color = p === selected ? '#faf9f6' : p.textColor;
    });
    if (onSelect) onSelect(selected.text);
  }

  pairs.forEach((p) => {
    p.node.addEventListener('click', () => select(p));
  });
  if (pairs.length) select(pairs[0]);
  return pairs;
}

function wireHistorySegmented(ctx) {
  const routes = { Día: 'historial-dia', Semanal: 'historial-semana', Mensual: 'historial-mes' };
  const pairs = Object.entries(routes).map(([text, route]) => {
    const t = findText(ctx.spec, text);
    const container = t && containerOf(ctx.spec, t);
    const node = container ? ctx.byIndex.get(container.i) : null;
    const textNode = t && ctx.byIndex.get(t.i);
    return node && textNode ? { text, route, node, textNode } : null;
  }).filter(Boolean);
  const shell = ctx.spec.els.find((e) => e.nm === 'Botón multiopción');
  const shellNode = shell && ctx.byIndex.get(shell.i);
  if (shellNode) shellNode.classList.add('chip-segmented-shell');
  const selectedText = Object.entries(routes).find(([, route]) => route === ctx.name)?.[0];
  pairs.forEach((p, index) => {
    p.node.classList.add('hit', 'chip-hit', 'chip-segment');
    if (index === 0) p.node.classList.add('chip-first');
    if (index === pairs.length - 1) p.node.classList.add('chip-last');
    p.node.addEventListener('click', () => go(p.route));
  });
  pairs.forEach((p) => {
    const active = p.text === selectedText;
    p.node.style.background = active ? '#173b64' : '#faf9f6';
    p.textNode.style.color = active ? '#faf9f6' : '#173b64';
    p.node.classList.toggle('selected', active);
  });
}

function wireHistoryFilters(ctx, labels, onSelect) {
  const chips = ctx.spec.els.filter((e) => e.nm === 'Chip macro').sort((a, b) => a.x - b.x);
  const pairs = labels.map((text) => {
    const t = ctx.spec.els.find((e) => e.tx === text && e.y > 380 && e.y < 430);
    if (!t) return null;
    const cx = t.x + t.w / 2; const cy = t.y + t.h / 2;
    const chip = chips.find((e) => e.x <= cx && e.x + e.w >= cx && e.y <= cy && e.y + e.h >= cy);
    const node = chip && ctx.byIndex.get(chip.i);
    return node ? { text, node, textNode: ctx.byIndex.get(t.i) } : null;
  }).filter(Boolean);
  const select = (chosen) => {
    pairs.forEach((p) => {
      const active = p === chosen;
      p.node.classList.toggle('selected', active);
      p.node.classList.add('hit', 'chip-hit');
      p.node.style.background = active ? '#173b64' : '#faf9f6';
      if (p.textNode) p.textNode.style.color = active ? '#faf9f6' : '#173b64';
    });
    if (onSelect) onSelect(chosen.text);
  };
  pairs.forEach((p) => p.node.addEventListener('click', () => select(p)));
  if (pairs.length) select(pairs[0]);
}

function attachRecDrag(scroller) {
  let dragging = false;
  let startX = 0;
  let startScroll = 0;
  scroller.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType !== 'mouse' || ev.button !== 0) return;
    dragging = true;
    startX = ev.clientX;
    startScroll = scroller.scrollLeft;
    scroller.classList.add('dragging');
    scroller.setPointerCapture(ev.pointerId);
  });
  scroller.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    scroller.scrollLeft = startScroll - (ev.clientX - startX);
    ev.preventDefault();
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    scroller.classList.remove('dragging');
  };
  scroller.addEventListener('pointerup', endDrag);
  scroller.addEventListener('pointercancel', endDrag);
}

function wRecomendaciones(ctx) {
  const spec = ctx.spec;
  ctx.root.classList.add('scrollable');

  // Cada sección de tarjetas se desborda del lienzo -> carrusel horizontal.
  const titles = REC_SECTIONS.map((tx) => findText(spec, tx)).filter(Boolean);
  const scrollers = [];
  titles.forEach((t, i) => {
    const top = t.y;
    const bottom = i + 1 < titles.length ? titles[i + 1].y : 1990;
    const scroller = document.createElement('div');
    scroller.className = 'scroller-x';
    scroller.style.cssText = `left:0;top:${top}px;width:420px;height:${bottom - top}px;`;
    const track = document.createElement('div');
    track.className = 'track';
    scroller.appendChild(track);
    let maxRight = 420;
    for (const e of spec.els) {
      if (e.y < top || e.y >= bottom || e.i === t.i) continue;
      const node = ctx.byIndex.get(e.i);
      if (!node || node.dataset.moved) continue;
      node.dataset.moved = '1';
      // clipr reproduce el recorte del frame de Figma (x=410). Al mover el
      // elemento a un track desplazable, ese recorte ya no corresponde y
      // dejaba las tarjetas posteriores permanentemente incompletas.
      node.style.clipPath = 'none';
      // El extractor marcó como ocultos los hijos que quedaban fuera del
      // viewport original. Aquí sí forman parte del carrusel y deben volver a
      // ser visibles al desplazarse.
      if (e.hide) node.style.display = 'block';
      node.style.top = (e.y - top) + 'px';
      if (/^Frame \d+$/.test(e.nm || '') && e.w >= 260 && e.w < 300 && e.h >= 250) {
        node.classList.add('rec-card');
      }
      maxRight = Math.max(maxRight, e.x + e.w);
      track.appendChild(node);
    }
    track.style.width = maxRight + 'px';
    let dragging = false;
    let startX = 0;
    let startScroll = 0;
    scroller.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType !== 'mouse' || ev.button !== 0) return;
      dragging = true;
      startX = ev.clientX;
      startScroll = scroller.scrollLeft;
      scroller.classList.add('dragging');
      scroller.setPointerCapture(ev.pointerId);
    });
    scroller.addEventListener('pointermove', (ev) => {
      if (!dragging) return;
      scroller.scrollLeft = startScroll - (ev.clientX - startX);
      ev.preventDefault();
    });
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      scroller.classList.remove('dragging');
    };
    scroller.addEventListener('pointerup', endDrag);
    scroller.addEventListener('pointercancel', endDrag);
    ctx.root.appendChild(scroller);
    scrollers.push(scroller);
  });

  // Chips de categoría (Proteínas / Carbs / Grasas): selección simple.
  const description = findText(spec, 'La proteína reconstruye tejidos y defensas, sacia el hambre y acelera el metabolismo, por lo que es esencial para perder grasa o ganar músculo; la encuentras en carnes, pescado, huevo, lácteos y legumbres.');
  const contentTitles = titles.map((t) => ctx.byIndex.get(t.i)).filter(Boolean);
  const contentDescription = description && ctx.byIndex.get(description.i);
  const emptyState = document.createElement('div');
  emptyState.className = 'rec-empty-state';
  ctx.root.appendChild(emptyState);
  const variantNodes = new Map();

  function showVariant(category) {
    if (variantNodes.has(category)) return variantNodes.get(category);
    const variant = REC_VARIANTS[category];
    if (!variant) return [];
    const nodes = [];
    const intro = document.createElement('div');
    intro.className = 'rec-variant-description';
    intro.textContent = variant.description;
    ctx.root.appendChild(intro);
    nodes.push(intro);

    let top = 470;
    variant.sections.forEach((section) => {
      const title = document.createElement('div');
      title.className = 'rec-variant-title';
      title.textContent = section.title;
      title.style.top = top + 'px';
      ctx.root.appendChild(title);
      nodes.push(title);

      const scroller = document.createElement('div');
      scroller.className = 'scroller-x rec-variant-scroller';
      scroller.style.cssText = `left:0;top:${top + 41}px;width:420px;height:250px;`;
      const track = document.createElement('div');
      track.className = 'track';
      track.style.width = Math.max(420, 10 + (section.cards.length - 1) * 295 + 268) + 'px';
      section.cards.forEach(([name, detail, image], index) => {
        const card = document.createElement('div');
        card.className = 'rec-variant-card rec-card';
        card.style.left = (10 + index * 295) + 'px';
        card.style.top = '0px';

        const img = document.createElement('img');
        img.className = 'rec-variant-image';
        img.src = '../assets/images/' + image;
        img.alt = name;
        card.appendChild(img);

        const info = document.createElement('div');
        info.className = 'rec-variant-info';
        const heading = document.createElement('div');
        heading.className = 'rec-variant-name';
        heading.textContent = name;
        const copy = document.createElement('div');
        copy.className = 'rec-variant-detail';
        copy.textContent = detail;
        info.append(heading, copy);
        card.appendChild(info);
        track.appendChild(card);
      });
      scroller.appendChild(track);
      attachRecDrag(scroller);
      ctx.root.appendChild(scroller);
      nodes.push(scroller);
      top += 332;
    });
    variantNodes.set(category, nodes);
    return nodes;
  }

  function showCategory(category) {
    // El nodo de Figma solo contiene contenido respaldado para Proteínas.
    // No se reutiliza ese contenido bajo Carbs/Grasas.
    const hasDesignContent = category === 'Proteínas';
    scrollers.forEach((node) => { node.style.display = hasDesignContent ? '' : 'none'; });
    contentTitles.forEach((node) => { node.style.display = hasDesignContent ? '' : 'none'; });
    if (contentDescription) contentDescription.style.display = hasDesignContent ? '' : 'none';
    emptyState.style.display = 'none';
    variantNodes.forEach((nodes) => nodes.forEach((node) => { node.style.display = 'none'; }));
    if (!hasDesignContent) showVariant(category).forEach((node) => { node.style.display = ''; });
  }
  wireChipSet(ctx, ['Proteínas', 'Carbs', 'Grasas'], showCategory);
  wireText(ctx, '‹', () => go('panel'));
}

/* ------------------------------------------------------------------ *
 *  tabla de rutas
 * ------------------------------------------------------------------ */

const ROUTES = {
  inicio: { spec: 'p01', wire: wInicio },
  empezar: { spec: 'p02', wire: wEmpezar },
  login: { spec: 'p02-1', wire: wLogin },
  'crear-cuenta': { spec: 'p02-2', wire: wCrearCuenta },
  nombre: { spec: 'p03', wire: wNombre },
  genero: { spec: 'p3.5', wire: wGenero },
  edad: { spec: 'p04', wire: (c) => wRueda(c, { key: 'edad', min: 15, max: 100, next: 'estatura', back: 'genero' }) },
  estatura: { spec: 'p05', wire: (c) => wRueda(c, { key: 'estatura', min: 100, max: 230, next: 'peso', back: 'edad' }) },
  peso: { spec: 'p06', wire: (c) => wRueda(c, { key: 'peso', min: 30, max: 300, next: 'ejercicio', back: 'estatura' }) },
  ejercicio: { spec: 'p07', wire: (c) => wOpciones(c, { key: 'ejercicio', next: 'tipo-ejercicio', back: 'peso' }) },
  'tipo-ejercicio': { spec: 'p08', wire: (c) => wOpciones(c, { key: 'tipo', next: 'objetivo', back: 'ejercicio' }) },
  objetivo: { spec: 'objetivo', wire: wObjetivo },
  macros: { spec: 'p09', wire: wMacros },
  'metas-sugeridas': { spec: 'p09-1', wire: wMetas },
  'macros-manual': { spec: 'p09-2', wire: wManual },
  carga: { spec: 'p10', wire: wCarga },
  panel: { spec: 'p11', wire: wPanel },
  '__dev/progreso': { spec: 'p11', wire: wProgressDev },
  'historial-dia': {
    spec: 'hist-dia',
    wire: (c) => wHistorial(c, { base: 'Hoy', step: 1, fmt: fmtDay }),
  },
  'historial-semana': {
    spec: 'hist-sem',
    wire: (c) => wHistorial(c, {
      base: 'Últimos 7 días', step: 7, fmt: fmtWeek,
      chips: ['Todas', 'Proteína', 'Carbos', 'Grasas'],
    }),
  },
  'historial-mes': {
    spec: 'hist-mes',
    wire: (c) => wHistorial(c, {
      base: 'Últimos 7 días', monthly: true, fmt: fmtMonth,
      chips: ['Kcal', 'Proteína', 'Carbos', 'Grasas'],
    }),
  },
  recomendaciones: { spec: 'rec', wire: wRecomendaciones },
};

/** Prepara y cablea una ruta; devuelve el nodo de la pantalla. */
export function renderRoute(name) {
  const route = ROUTES[name] || ROUTES.inicio;
  const key = route.spec;
  if (key === 'p3.5') genderSpec();
  if (key === 'objetivo') objectiveSpec();

  const spec = SCREENS[key];
  paintTwoToneTitles(spec);
  if (key === 'p11') paintBars(spec, METRIC_COLORS);
  if (key === 'hist-dia' || key === 'hist-sem') paintBars(spec, [METRIC_COLORS[0]]);

  const { root, byIndex } = buildScreen(key);
  if (key === 'hist-dia') paintRings(root, spec);
  if (key === 'hist-mes') paintCalendar(root, spec);

  route.wire({ spec, byIndex, root, name });
  return root;
}
