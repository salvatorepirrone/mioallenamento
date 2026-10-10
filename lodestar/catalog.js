// Lodestar — allenamenti di base delle tre librerie (corsa, nuoto, palestra).
// Tutte e tre hanno una struttura inviabile a Garmin (la palestra come allenamento di forza con serie, ripetizioni e carichi).
// Il consiglio del giorno (engine.js) genera varianti adattate a forma e andamento; qui c'e' il catalogo di partenza.

const RUN_CATALOG = [
  { id: 'run-facile', title: 'Corsa facile rigenerante', tag: 'Recupero', note: 'Giorni di scarico o rientro: solo per sciogliere le gambe.',
    spec: { sport: 'running', title: 'Corsa facile rigenerante', steps: [{ kind: 'interval', time_s: 1500, hr_zone: 1, note: 'Z1, FC sotto 123' }] } },
  { id: 'run-z2', title: 'Corsa aerobica Z2', tag: 'Base', note: 'Costruisce base senza accumulare fatica: FC sotto 148, senza ritmo né ripetute.',
    spec: { sport: 'running', title: 'Corsa aerobica Z2', steps: [{ kind: 'interval', time_s: 2400, pace: [345, 375], note: 'Z2, FC sotto 148' }] } },
  { id: 'run-lunga', title: 'Lunga Z2', tag: 'Lungo', note: 'Se superi 148 battiti cammina 1-2 minuti e riprendi.',
    spec: { sport: 'running', title: 'Lunga Z2', steps: [{ kind: 'interval', distance_m: 9000, pace: [345, 370], note: 'Z2 puro, FC sotto 148' }] } },
  { id: 'run-velocita', title: 'Velocità 6×400 m', tag: 'Qualità', note: 'Ripetute a ritmo da 3-5 km (Z4), recupero in jogging.',
    spec: { sport: 'running', title: 'Velocità 6×400 m', steps: [
      { kind: 'warmup', time_s: 900, hr_zone: 1 },
      { kind: 'repeat', reps: 4, steps: [{ kind: 'interval', distance_m: 80, note: 'progressivo' }, { kind: 'recovery', time_s: 40 }] },
      { kind: 'repeat', reps: 6, steps: [{ kind: 'interval', distance_m: 400, pace: [270, 290] }, { kind: 'recovery', time_s: 90, note: 'jogging Z1' }] },
      { kind: 'cooldown', time_s: 600, hr_zone: 1 }] } },
  { id: 'run-soglia', title: 'Soglia 3×1000 m', tag: 'Qualità', note: 'Ritmo "comodamente duro" (Z3), seguito da un tratto continuo in Z2.',
    spec: { sport: 'running', title: 'Soglia 3×1000 m', steps: [
      { kind: 'warmup', time_s: 720, hr_zone: 1 },
      { kind: 'repeat', reps: 3, steps: [{ kind: 'interval', distance_m: 1000, pace: [320, 340] }, { kind: 'recovery', time_s: 120, note: 'jogging Z1' }] },
      { kind: 'interval', time_s: 900, pace: [345, 360], note: 'Z2 continuo' },
      { kind: 'cooldown', time_s: 480, hr_zone: 1 }] } },
  { id: 'run-fartlek', title: 'Fartlek 6×(2′ + 1′)', tag: 'Qualità', note: 'Variazioni di ritmo a sensazione: veloce 2 minuti, lento 1 minuto.',
    spec: { sport: 'running', title: 'Fartlek 6×(2′ + 1′)', steps: [
      { kind: 'warmup', time_s: 720, hr_zone: 1 },
      { kind: 'repeat', reps: 6, steps: [{ kind: 'interval', time_s: 120, pace: [268, 280] }, { kind: 'recovery', time_s: 60, note: 'corsa lenta Z1' }] },
      { kind: 'cooldown', time_s: 600, hr_zone: 1 }] } },
  { id: 'run-progressivo', title: 'Progressivo a tre blocchi', tag: 'Qualità', note: 'Ritmo crescente: finisci più veloce di come hai iniziato.',
    spec: { sport: 'running', title: 'Progressivo a tre blocchi', steps: [
      { kind: 'warmup', time_s: 600, hr_zone: 1 },
      { kind: 'interval', time_s: 900, pace: [360, 375], note: 'facile' },
      { kind: 'interval', time_s: 900, pace: [335, 345], note: 'medio' },
      { kind: 'interval', time_s: 600, pace: [310, 322], note: 'sostenuto' },
      { kind: 'cooldown', time_s: 480, hr_zone: 1 }] } },
  { id: 'run-vo2', title: 'Ripetute lunghe 5×800 m', tag: 'Qualità', note: 'Stimolo per il VO2max: ritmo da 5 km, recuperi di 2 minuti.',
    spec: { sport: 'running', title: 'Ripetute lunghe 5×800 m', steps: [
      { kind: 'warmup', time_s: 900, hr_zone: 1 },
      { kind: 'repeat', reps: 5, steps: [{ kind: 'interval', distance_m: 800, pace: [262, 274] }, { kind: 'recovery', time_s: 120, note: 'jogging Z1' }] },
      { kind: 'cooldown', time_s: 600, hr_zone: 1 }] } },
];

const SWIM_TAGS = { tecnica: 'Tecnica', leggero: 'Recupero', velocitaPura: 'Velocità', sprintVirate: 'Velocità', bracciataVelocita: 'Velocità', resistenza: 'Resistenza', gambePull: 'Tecnica', piramide: 'Resistenza', misti: 'Stili' };
const SWIM_CATALOG = Object.entries(SWIM_ALL_SPECS).map(([key, spec]) => ({ id: 'swim-' + key, title: spec.title, tag: SWIM_TAGS[key] || 'Nuoto', note: '', spec }));

const GYM_CATALOG = [
  { id: 'gym-a', title: 'Forza · Sessione A', tag: 'Forza', note: 'Core, spinta e tirata per sostenere corsa e nuoto. 3 serie, recupero ~60-90″.',
    spec: { sport: 'strength', title: 'Forza · Sessione A', exercises: [
      { name: 'Plank centrale', sets: 3, seconds: 60 }, { name: 'Plank laterale', sets: 3, seconds: 40 }, { name: 'Hollow body hold', sets: 3, seconds: 40 },
      { name: 'Piegamenti', sets: 3, reps: 20 }, { name: 'Trazioni alla sbarra', sets: 3, reps: 6 },
      { name: 'Lat pulldown', sets: 3, reps: 10, weight_kg: 50 }, { name: 'Rear delt row', sets: 3, reps: 12, weight_kg: 40 },
      { name: 'Face pull', sets: 3, reps: 15 }, { name: 'Squat goblet', sets: 3, reps: 10 }] } },
  { id: 'gym-b', title: 'Forza · Sessione B', tag: 'Forza', note: 'Come la A, con più lavoro di spinta e di anche. Alternale.',
    spec: { sport: 'strength', title: 'Forza · Sessione B', exercises: [
      { name: 'Plank centrale', sets: 3, seconds: 75 }, { name: 'Plank laterale', sets: 3, seconds: 55 }, { name: 'Hollow body hold', sets: 3, seconds: 45 },
      { name: 'Plank con rotazione', sets: 3, reps: 8 }, { name: 'Piegamenti declinati', sets: 3, reps: 20 },
      { name: 'Pectoral machine', sets: 2, reps: 10, weight_kg: 45 }, { name: 'Trazioni alla sbarra', sets: 3, reps: 6 },
      { name: 'Lat pulldown', sets: 3, reps: 10, weight_kg: 52 }, { name: 'Rear delt row', sets: 3, reps: 12, weight_kg: 43 },
      { name: 'Face pull', sets: 3, reps: 15 }, { name: 'Squat goblet', sets: 3, reps: 10, weight_kg: 16 },
      { name: 'Hip thrust', sets: 3, reps: 12, weight_kg: 20 }] } },
];

const SPORT_CONFIG = {
  running: { api: 'running', catalog: RUN_CATALOG, noun: 'corsa', placeholder: "Es. riscaldamento 15' Z1, poi 6x400 a 4:30-4:50 recupero 90'' jogging, defaticamento 10' Z1" },
  swimming: { api: 'swimming', catalog: SWIM_CATALOG, noun: 'nuoto', placeholder: "Es.\n200 sciolti\n8x50 (1 contando le bracciate, 1 nuotando senza pensare alla tecnica)\n2x100 pinne gambe (tavola davanti)\n4x200 aerobici (dispari senza nulla, pari con pull e palette)" },
  strength: { api: 'strength', catalog: GYM_CATALOG, noun: 'palestra', placeholder: 'Es. plank 3x60", piegamenti 3x20, trazioni 3x6, lat machine 3x10 con 50 kg, recupero 60"' },
};
