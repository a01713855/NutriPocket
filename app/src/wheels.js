// Ruedas numéricas por dígito (Pantallas 4, 5 y 6).
// Cada columna se desplaza de forma independiente, conservando la geometría
// y la apariencia de Figma.

const ROW_H = 87;
const FONT_SIZE = 64;

export function attachWheel(root, spec, config) {
  const { min, max, value, onChange } = config;
  const cols = spec.els.filter((e) => e.ui === 'wheel').slice()
    .sort((a, b) => a.x - b.x);
  const lineEls = spec.els.filter((e) => e.ui === 'wheellines');
  if (!cols.length) return null;

  const band = lineEls.length ? lineEls[0].h : 90;
  const top = cols[0].y;
  const height = cols[0].h;
  const x0 = Math.min(...cols.map((c) => c.x));
  const spanW = Math.max(...cols.map((c) => c.x + c.w)) - x0;
  const colX = cols.map((c) => c.x - x0);
  const colW = cols[0].w;

  const el = document.createElement('div');
  el.className = 'wheel';
  el.style.left = x0 + 'px';
  el.style.top = top + 'px';
  el.style.width = spanW + 'px';
  el.style.height = height + 'px';
  el.tabIndex = 0;
  el.setAttribute('role', 'spinbutton');
  el.setAttribute('aria-label', 'Rueda numérica');

  const columns = [];
  const initial = String(value === undefined ? min : value).padStart(cols.length, '0');

  function emit() {
    const current = readValue();
    el.setAttribute('aria-valuenow', String(current));
    if (onChange) onChange(current);
  }

  function readValue() {
    return Number(columns.map((c) => c.digit).join(''));
  }

  function setDigit(column, digit, animate) {
    const next = Math.max(0, Math.min(9, digit));
    if (next === column.digit && !animate) return;
    column.digit = next;
    column.el.classList.toggle('animate', !!animate);
    column.rows.style.transform = `translateY(${-next * ROW_H}px)`;
    column.el.setAttribute('aria-valuenow', String(next));
    emit();
  }

  cols.forEach((specCol, index) => {
    const column = document.createElement('div');
    column.className = 'wheel-column';
    column.style.left = colX[index] + 'px';
    column.style.width = colW + 'px';
    column.style.height = height + 'px';
    column.tabIndex = 0;
    column.setAttribute('role', 'spinbutton');
    column.setAttribute('aria-label', `Dígito ${index + 1}`);

    const rows = document.createElement('div');
    rows.className = 'wheel-rows';
    for (let digit = 0; digit <= 9; digit++) {
      const row = document.createElement('div');
      row.className = 'wheel-row';
      row.style.top = digit * ROW_H + 'px';
      row.style.height = ROW_H + 'px';

      const glyph = document.createElement('div');
      glyph.className = 'wheel-digit';
      glyph.style.width = colW + 'px';
      glyph.style.lineHeight = ROW_H + 'px';
      glyph.style.fontSize = FONT_SIZE + 'px';
      glyph.textContent = String(digit);
      row.appendChild(glyph);
      rows.appendChild(row);
    }
    column.appendChild(rows);
    el.appendChild(column);

    const state = { el: column, rows, digit: Number(initial[index]) || 0 };
    columns.push(state);

    let acc = 0;
    let wheelTimer = null;
    column.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      acc += ev.deltaY;
      if (Math.abs(acc) >= 24) {
        setDigit(state, state.digit + (acc > 0 ? 1 : -1), true);
        acc = 0;
      }
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => { acc = 0; }, 180);
    }, { passive: false });

    let dragging = false;
    let startY = 0;
    let startDigit = state.digit;
    column.addEventListener('pointerdown', (ev) => {
      dragging = true;
      startY = ev.clientY;
      startDigit = state.digit;
      column.setPointerCapture(ev.pointerId);
      column.classList.remove('animate');
    });
    column.addEventListener('pointermove', (ev) => {
      if (!dragging) return;
      const delta = (startY - ev.clientY) / ROW_H;
      setDigit(state, startDigit + Math.round(delta), false);
    });
    const endDrag = () => {
      if (dragging) { dragging = false; setDigit(state, state.digit, true); }
    };
    column.addEventListener('pointerup', endDrag);
    column.addEventListener('pointercancel', endDrag);

    column.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowUp' || ev.key === 'ArrowRight') {
        setDigit(state, state.digit + 1, true); ev.preventDefault();
      }
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowLeft') {
        setDigit(state, state.digit - 1, true); ev.preventDefault();
      }
    });
  });

  const fade = document.createElement('div');
  fade.className = 'wheel-fade';
  fade.style.top = band + 'px';
  fade.style.height = height - band + 'px';
  el.appendChild(fade);

  const lines = document.createElement('div');
  lines.className = 'wheel-lines';
  const sources = lineEls.length ? lineEls : cols.map((c) => ({ x: c.x, w: c.w }));
  sources.forEach((line) => {
    [0, band].forEach((y) => {
      const bar = document.createElement('div');
      bar.className = 'wheel-line';
      bar.style.left = line.x - x0 + 'px';
      bar.style.width = line.w + 'px';
      bar.style.top = (y - 1) + 'px';
      lines.appendChild(bar);
    });
  });
  el.appendChild(lines);

  columns.forEach((column) => {
    column.rows.style.transform = `translateY(${-column.digit * ROW_H}px)`;
    column.el.setAttribute('aria-valuenow', String(column.digit));
  });
  el.setAttribute('aria-valuenow', String(readValue()));
  el.addEventListener('keydown', (ev) => {
    if (ev.target !== el) return;
    const column = columns[columns.length - 1];
    if (ev.key === 'ArrowUp') { setDigit(column, column.digit + 1, true); ev.preventDefault(); }
    if (ev.key === 'ArrowDown') { setDigit(column, column.digit - 1, true); ev.preventDefault(); }
  });

  root.appendChild(el);
  return {
    el,
    get value() { return readValue(); },
    get valid() { const v = readValue(); return v >= min && v <= max; },
    set value(v) {
      const digits = String(Math.max(0, Math.round(v))).padStart(cols.length, '0').slice(-cols.length);
      columns.forEach((column, i) => setDigit(column, Number(digits[i]), false));
    },
  };
}
