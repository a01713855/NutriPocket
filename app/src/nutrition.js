// Estimación orientativa de mantenimiento para adultos.
// No es una prescripción clínica ni incorpora consumos del dispositivo.

const ACTIVITY = {
  'Poco o nada': { 'Bajo impacto': 1.20, Cardio: 1.20, Híbrido: 1.20, Fuerza: 1.20 },
  '1 a 3 días por semana': { 'Bajo impacto': 1.30, Cardio: 1.35, Híbrido: 1.40, Fuerza: 1.35 },
  '4 a 5 días por semana': { 'Bajo impacto': 1.40, Cardio: 1.50, Híbrido: 1.55, Fuerza: 1.50 },
  '6 a 7 días por semana': { 'Bajo impacto': 1.50, Cardio: 1.60, Híbrido: 1.65, Fuerza: 1.60 },
};

const PROTEIN = {
  'Poco o nada': 1.2,
  '1 a 3 días por semana': 1.3,
  '4 a 5 días por semana': 1.5,
  '6 a 7 días por semana': 1.6,
};

function frequency(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return Object.keys(ACTIVITY).find((key) => text === key || text.startsWith(key)) || null;
}

function exercise(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.startsWith('Bajo')) return 'Bajo impacto';
  if (text.startsWith('Cardio')) return 'Cardio';
  if (text.startsWith('Híbrido')) return 'Híbrido';
  if (text.startsWith('Fuerza')) return 'Fuerza';
  return null;
}

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function calculateNutrition(profile = {}) {
  const age = Number(profile.edad);
  const weight = positiveNumber(profile.peso);
  const height = positiveNumber(profile.estatura);
  const gender = profile.genero;
  const freq = frequency(profile.ejercicio);
  const type = exercise(profile.tipo);
  const objective = profile.objetivo;
  const missing = [];
  if (!['Masculino', 'Femenino'].includes(gender)) missing.push('género');
  if (!Number.isInteger(age) || age < 18) {
    if (age >= 15 && age <= 17) throw new Error('Auto-generar solo está disponible para personas de 18 años o más');
    missing.push('edad adulta válida');
  }
  if (!weight) missing.push('peso');
  if (!height) missing.push('estatura');
  if (!freq) missing.push('frecuencia de ejercicio');
  if (!type) missing.push('tipo de ejercicio');
  if (!['maintain', 'lose_fat', 'gain_muscle'].includes(objective)) missing.push('objetivo personal');
  if (missing.length) throw new Error(`Completa: ${missing.join(', ')}`);

  const bmi = weight / ((height / 100) ** 2);
  if (objective === 'lose_fat' && bmi < 18.5) {
    throw new Error('No se genera déficit automático porque el IMC estimado es inferior a 18.5');
  }

  const bmr = 10 * weight + 6.25 * height - 5 * age + (gender === 'Masculino' ? 5 : -161);
  const factor = ACTIVITY[freq][type];
  const tdee = bmr * factor;
  const calorieFactor = objective === 'lose_fat' ? 0.90 : objective === 'gain_muscle' ? 1.05 : 1.00;
  const targetCalories = tdee * calorieFactor;
  const proteinFactor = objective === 'maintain' ? PROTEIN[freq] : 1.8;
  const proteina = Math.round(weight * proteinFactor);
  const grasas = Math.round((targetCalories * 0.30) / 9);
  const carbohidratos = Math.round((targetCalories - proteina * 4 - grasas * 9) / 4);
  const kcal = proteina * 4 + carbohidratos * 4 + grasas * 9;
  const values = { proteina, carbohidratos, grasas, kcal };
  if (Object.values(values).some((v) => !Number.isInteger(v) || v <= 0)) {
    throw new Error('El cálculo produjo metas no válidas');
  }
  const over = Object.entries({ proteina, carbohidratos, grasas })
    .filter(([, value]) => value > 500).map(([key]) => key);
  if (over.length) throw new Error(`El cálculo excede 500 g en: ${over.join(', ')}`);
  return {
    ...values, bmr, tdee, targetCalories, calorieFactor, factor,
    frecuencia: freq, tipo: type, objective, proteinFactor,
  };
}
