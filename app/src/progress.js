// Acumulados nutricionales de la sesión. Es la interfaz que posteriormente
// podrá alimentar la sincronización con ESP32; por ahora no persiste nada.

const consumed = { proteina: 0, carbohidratos: 0, grasas: 0 };
const listeners = new Set();

function number(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function snapshot() {
  const proteina = number(consumed.proteina);
  const carbohidratos = number(consumed.carbohidratos);
  const grasas = number(consumed.grasas);
  return {
    proteina,
    carbohidratos,
    grasas,
    kcal: proteina * 4 + carbohidratos * 4 + grasas * 9,
  };
}

function notify() {
  const data = snapshot();
  listeners.forEach((listener) => listener(data));
}

export const Progress = {
  get() { return snapshot(); },

  // Sustituye los acumulados en memoria; no toca State ni localStorage.
  set(patch = {}) {
    ['proteina', 'carbohidratos', 'grasas'].forEach((key) => {
      if (patch[key] !== undefined) consumed[key] = number(patch[key]);
    });
    notify();
    return snapshot();
  },

  // Punto de entrada futuro para un paquete acumulado recibido del ESP32.
  add(patch = {}) {
    ['proteina', 'carbohidratos', 'grasas'].forEach((key) => {
      if (patch[key] !== undefined) consumed[key] += number(patch[key]);
    });
    notify();
    return snapshot();
  },

  reset() {
    consumed.proteina = 0;
    consumed.carbohidratos = 0;
    consumed.grasas = 0;
    notify();
  },

  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  // Metas tomadas exclusivamente del perfil guardado. Una meta inválida se
  // representa como null para que el dashboard no divida entre cero.
  metrics(profile = {}) {
    const data = snapshot();
    const targets = {
      kcal: number(profile.kcal) > 0 ? number(profile.kcal) : null,
      proteina: number(profile.proteina) > 0 ? number(profile.proteina) : null,
      carbohidratos: number(profile.carbohidratos) > 0 ? number(profile.carbohidratos) : null,
      grasas: number(profile.grasas) > 0 ? number(profile.grasas) : null,
    };
    return {
      data,
      targets,
      percent: Object.fromEntries(Object.keys(targets).map((key) => [
        key, targets[key] ? Math.min(100, (data[key] / targets[key]) * 100) : null,
      ])),
    };
  },
};
