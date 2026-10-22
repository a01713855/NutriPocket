// Punto de entrada: encuadra el lienzo de 420×912 y arranca el enrutador.
import { start } from './router.js';

const DESIGN_W = 420;
const DESIGN_H = 912;

function fit() {
  const phone = document.getElementById('phone');
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // En escritorio deja aire alrededor; en móvil ocupa todo lo que pueda.
  const pad = vw > 520 ? 48 : 0;
  const scale = Math.min(1, (vh - pad) / DESIGN_H, (vw - pad) / DESIGN_W);
  phone.style.transform = `scale(${scale})`;
}

window.addEventListener('resize', fit);
fit();
start();
