// Enrutador por hash (#/nombre-de-ruta).
import { renderRoute } from './screens.js';

function currentRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  return h || 'inicio';
}

function show(name) {
  const vp = document.getElementById('viewport');
  const old = vp.firstElementChild;
  const node = renderRoute(name);
  vp.appendChild(node);
  // La pantalla nueva queda interactiva inmediatamente. La transición
  // auxiliar anterior podía dejar una capa invisible interceptando clics.
  if (old) {
    if (typeof old._cleanup === 'function') old._cleanup();
    old.remove();
  }
}

export function go(name) {
  if (currentRoute() === name) show(name);
  else location.hash = '#/' + name;
}

export function start() {
  window.addEventListener('hashchange', () => show(currentRoute()));
  show(currentRoute());
}
