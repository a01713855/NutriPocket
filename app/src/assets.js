// Constantes de la interfaz.
// PROGRESS_PATH: geometría del octágono "persona" extraída del asset
// assets/icons/icon-progreso-personas.svg (Figma → NutriPocket).
export const PROGRESS_PATH =
  'M14.7803 0.00390625L20.9805 5.4502L20.9189 5.50977H21V15.457H20.999C20.9818 20.4808 ' +
  '16.2884 24.5488 10.5 24.5488C4.71163 24.5488 0.0181511 20.4808 0.000976562 15.457H0V5.50977' +
  'H0.0615234L0 5.4502L6.19922 0.00390625L6.21973 0.0234375V0H14.7803V0.00390625ZM10.5 7.26953' +
  'C7.46258 7.26953 5.00025 9.81339 5 12.9512C5.00003 16.0891 7.46245 18.6328 10.5 18.6328' +
  'C13.5374 18.6327 16 16.089 16 12.9512C15.9998 9.81349 13.5373 7.26969 10.5 7.26953Z';

// Geometría de la tira de progreso (8 iconos, paso 25 px, caja 196×25).
export const PROGRESS_ICONS = 8;
export const PROGRESS_PITCH = 25;

// Chevron "›" (assets/icons/icon-angle-small-right.svg).
export const CHEVRON_PATH = 'M0.799988 12.68L6.39999 7.08002L0.799988 1.48002';
export const CHEVRON_VIEWBOX = '0 0 7.2 14.16';

export const ASSETS = {
  userIcon: '../assets/icons/icon-usuario.svg',
  mascot: '../assets/images/img-mascot.png',
  loadingPoster: '../assets/images/img-loading-poster.png',
  loadingVideo: 'assets/videos/loading-nutripocket.mp4',
};

// Colores de los macros, coherentes con la paleta del Design System y con los
// anillos/barras del propio diseño (medidos en los PNG exportados).
export const METRIC_COLORS = ['#0167ef', '#ff7645', '#2c9027', '#ffce60'];

export function rgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
