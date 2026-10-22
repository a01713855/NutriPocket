// Renderiza la especificación de una pantalla (specs.js) como DOM real.
import { SCREENS } from './specs.js';
import { PROGRESS_PATH, PROGRESS_ICONS, PROGRESS_PITCH, CHEVRON_PATH, CHEVRON_VIEWBOX, ASSETS } from './assets.js';

export function getSpec(key) {
  return SCREENS[key];
}

/** ¿Es un color CSS utilizable? (la API de Figma devuelve "IMG" para rellenos de imagen). */
function isColor(v) {
  return typeof v === 'string' && /^(#|rgb|okrgb|hsl|color)/i.test(v);
}

function progressSvg(count) {
  let paths = '';
  for (let i = 0; i < PROGRESS_ICONS; i++) {
    const fill = i < count ? '#0167ef' : '#d3dfe9';
    paths += `<path transform="translate(${i * PROGRESS_PITCH} 0)" d="${PROGRESS_PATH}" fill="${fill}"/>`;
  }
  return `<svg viewBox="0 0 196 25" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;
}

function chevronSvg(color) {
  return `<svg viewBox="${CHEVRON_VIEWBOX}" xmlns="http://www.w3.org/2000/svg">
    <path d="${CHEVRON_PATH}" stroke="${color}" stroke-width="3" fill="none"
      stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** Dibuja una onda intensa recortada por porcentaje, sin cambiar su trazado. */
export function setWaveProgress(node, wave, percent, color) {
  if (!node || !wave) return;
  const p = Math.max(0, Math.min(100, Number(percent) || 0)) / 100;
  const id = `wave-progress-${wave.i || Math.random().toString(36).slice(2)}`;
  const cap = wave.cap === 'ROUND' ? 'round' : 'butt';
  // Esta función se usa para el trazado completado: nunca debe heredar la
  // opacidad de la onda pendiente (Figma marca esa pista al 50 %).
  const op = '';
  const width = wave.w || 301;
  const stroke = wave.sw || 15;
  // La tapa ROUND del último punto sobresale del viewBox. Solo al 100 % se
  // extiende el clip por el grosor del trazo para cubrir completamente la
  // curva final; los porcentajes parciales conservan su límite proporcional.
  const reveal = p === 0 ? stroke : (p >= 1 ? width + stroke : width * p);
  node.innerHTML =
    `<svg viewBox="0 0 ${wave.w || 301} ${wave.h || 8}" xmlns="http://www.w3.org/2000/svg"`
    + ` style="overflow:visible"><defs><clipPath id="${id}"><rect x="0" y="-8"`
    + ` width="${reveal}" height="24"/></clipPath></defs>`
    + `<path d="${wave.d}" fill="none" stroke="${color || wave.c}"`
    + ` stroke-width="${wave.sw}" stroke-linecap="${cap}" stroke-linejoin="round"`
    + `${op} clip-path="url(#${id})"/></svg>`;
}

/**
 * Construye la pantalla.
 * @param {string} key clave en SCREENS (p03, p11, …)
 * @returns {{root: HTMLElement, byIndex: Map<number, HTMLElement>}}
 */
export function buildScreen(key) {
  const spec = SCREENS[key];
  const root = document.createElement('div');
  root.className = 'screen';
  root.style.background = isColor(spec.bg) ? spec.bg : '#faf9f6';
  const byIndex = new Map();

  for (const e of spec.els) {
    if (e.ui === 'wheellines') continue; // las dibuja el componente de rueda

    const node = document.createElement('div');
    node.className = 'el';
    node.style.left = e.x + 'px';
    node.style.top = e.y + 'px';
    node.style.width = e.w + 'px';
    node.style.height = e.h + 'px';
    node.dataset.idx = String(e.i);
    if (e.nm) node.dataset.name = e.nm;

    // Recomendaciones: el scroller horizontal va recortado por su
    // contenedor de Figma (Frame 54, clipsContent) en x=410.
    if (e.hide) node.style.display = 'none';
    if (e.clipr != null) {
      node.style.clipPath = `inset(-40px ${(e.x + e.w) - e.clipr}px -40px -40px)`;
    }

    // El fill de un nodo de texto es el color de la letra; los demás nodos
    // sí llevan su relleno como fondo (los botones, tarjetas, barras…).
    // Los vectores (e.vp) se pintan en su SVG: el fondo del div los taparia.
    if (e.tx === undefined && !e.vp && e.ui !== 'chevron' && isColor(e.f)) node.style.background = e.f;
    if (e.grad) {
      // Relleno degradado de Figma: [[posición, color, opacidad], …]
      const g = e.grad;
      const ang = g.w ? 90 : 180;
      node.style.background = `linear-gradient(${ang}deg, `
        + g.stops.map((s) => {
          const c = s[1];
          const col = s[2] != null && s[2] < 1
            ? `color-mix(in srgb, ${c} ${Math.round(s[2] * 100)}%, transparent)`
            : c;
          return `${col} ${(s[0] * 100).toFixed(1)}%`;
        }).join(', ') + ')';
    }
    if (e.r) node.style.borderRadius = (e.r >= 1000 ? 9999 : e.r) + 'px';
    if (e.bd) node.style.border = `${e.bw || 1}px solid ${e.bd}`;
    if (Array.isArray(e.sh)) {
      // Sombras reales de Figma: [(x, y, desenfoque, color)]
      node.style.boxShadow = e.sh.map((s) => `${s.x}px ${s.y}px ${s.b || 0}px ${s.c}`).join(', ');
    } else if (e.sh) {
      node.classList.add('shadow');
    }
    if (e.o) node.style.opacity = String(e.o);

    if (e.tx !== undefined) {
      node.classList.add('tx');
      node.style.color = isColor(e.f) ? e.f : '#173b64';
      node.style.fontSize = e.fs + 'px';
      node.style.fontWeight = String(e.fw);
      node.style.lineHeight = e.lh + 'px';
      if (e.ff) node.style.fontFamily = `'${e.ff}', 'Epilogue', sans-serif`;
      if (e.ls) node.style.letterSpacing = e.ls + 'px';
      // Cajas de texto con alineación vertical centrada en Figma: si la
      // caja es más baja que la línea (h < lh) el glifo se centra, no se
      // ancla arriba como haría CSS.
      if (e.vc) { node.style.display = 'flex'; node.style.alignItems = 'center'; }
      if (e.ta) node.style.textAlign = e.ta;
      // Texto de ancho automático en el diseño: una sola línea, como en
      // Figma.  nw=2 conserva los saltos de línea explícitos sin envolver.
      if (e.nw) node.style.whiteSpace = e.nw === 2 ? 'pre' : 'nowrap';
      // Títulos a dos tonos: la última línea va en azul de marca (así están
      // compuestos en Figma, que guarda un solo fill por nodo).
      if (e.spans) {
        // characterStyleOverrides de Figma: segmentos con color/peso/tamaño
        // propios (títulos con la última palabra en azul, tarjetas con líneas
        // en peso ligero, signos de interrogación extra bold...).
        node.textContent = '';
        node.style.whiteSpace = 'pre';
        // Figma con lineHeight INTRINSIC_% (100 %) escala la altura de línea
        // con el tamaño de cada línea (etiquetas de tarjeta p08: 20.5 px en
        // la línea fs20 y 16.4 px en las líneas fs16).  En CSS el strut del
        // nodo impone una única altura; para reproducir a Figma se baja el
        // strut a 1 px y se fija line-height explícito en cada span.
        const mixedFs = !!(e.lh && e.fs) &&
          e.spans.some((s) => s[1] && s[1].fs && s[1].fs !== e.fs);
        if (mixedFs) node.style.lineHeight = '1px';
        e.spans.forEach((seg) => {
          const span = document.createElement('span');
          span.textContent = seg[0];
          const st = seg[1];
          if (mixedFs) {
            span.style.lineHeight =
              (e.lh * ((st && st.fs ? st.fs : e.fs) / e.fs)).toFixed(2) + 'px';
          }
          if (st) {
            if (st.f) span.style.color = st.f;
            if (st.fw) span.style.fontWeight = String(st.fw);
            if (st.fs) span.style.fontSize = st.fs + 'px';
          }
          node.appendChild(span);
        });
      } else if (e.ln2) {
        const lines = e.tx.split('\n');
        node.textContent = '';
        for (let i = 0; i < lines.length; i++) {
          const span = document.createElement('span');
          span.textContent = lines[i] + (i < lines.length - 1 ? '\n' : '');
          if (i === lines.length - 1) span.className = 'ln2';
          node.appendChild(span);
        }
      } else if (e.lastc) {
        // Último carácter en otro color (la "P" de NutriPocket: el nodo de
        // Figma lleva un override de fill por carácter).
        const head = e.tx.slice(0, -1);
        const tail = e.tx.slice(-1);
        node.textContent = '';
        node.appendChild(document.createTextNode(head));
        const span = document.createElement('span');
        span.style.color = e.lastc;
        span.textContent = tail;
        node.appendChild(span);
      } else {
        node.textContent = e.tx;
      }
    }

    if (e.img) {
      const img = document.createElement('img');
      img.className = 'asset';
      img.src = '../' + e.img.replace(/^assets\//, 'assets/');
      img.alt = '';
      node.appendChild(img);
    } else if (e.ui === 'progress') {
      node.classList.add('progress');
      node.innerHTML = progressSvg(spec.prog || 0);
    } else if (e.ui === 'chevron') {
      node.innerHTML = chevronSvg(e.f === '#faf9f6' ? '#faf9f6' : (e.f || '#0167ef'));
    } else if (e.ui === 'usericon') {
      const img = document.createElement('img');
      img.className = 'asset';
      img.src = ASSETS.userIcon;
      img.alt = 'Perfil';
      // El SVG exportado es azul marino; sobre fondo oscuro (barra lateral
      // azul) el propio diseño lo pinta en blanco.
      if (e.inv) img.style.filter = 'brightness(0) invert(1)';
      node.appendChild(img);
    } else if (e.wave) {
      // Onda de progreso del panel: trazo vectorial real de Figma
      // (stroke-width/cap/join del nodo; el stroke sobresale del bbox,
      // igual que en Figma, así que el SVG se desborda a propósito).
      const w = e.wave;
      const cap = w.cap === 'ROUND' ? 'round' : 'butt';
      const op = (w.op != null && w.op !== 1) ? ` opacity="${w.op}"` : '';
      node.innerHTML =
        `<svg viewBox="0 0 ${e.w} ${e.h}" xmlns="http://www.w3.org/2000/svg"`
        + ` style="overflow:visible"><path d="${w.d}" fill="none" stroke="${w.c}"`
        + ` stroke-width="${w.sw}" stroke-linecap="${cap}" stroke-linejoin="round"${op}/></svg>`;
    } else if (e.vp) {
      // Vectores reales de Figma (iconos de la barra de estado).
      const paths = e.vp.map((p) =>
        `<path d="${p.d}" fill="${e.f || '#1c1c1c'}" fill-rule="${p.w === 'EVENODD' ? 'evenodd' : 'nonzero'}"/>`
      ).join('');
      node.innerHTML = `<svg viewBox="0 0 ${e.w} ${e.h}" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;
    }

    root.appendChild(node);
    byIndex.set(e.i, node);
  }

  return { root, byIndex };
}
