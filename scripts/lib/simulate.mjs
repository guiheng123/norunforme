import { buildPath } from './route.mjs'
import { generateRun } from './gen.mjs'
import { rng } from './geo.mjs'
import { analyzeTrack, diagnose } from './track-analysis.mjs'

export function simulate(o = {}) {
  const {
    checkpoints = [],
    routePoints = [],
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
    paceSecPerKm = 330,
    targetKm = 2,
    mode = 'free',
    radius = 30,
    sensorHz = 10,
    startTime = null,
    compactSensors = false,
  } = o

  const seed = Number.isFinite(o.seed) && o.seed != null ? Number(o.seed) : Math.floor(Math.random() * 1e6)

  const path = buildPath({
    points: mode === 'auto' ? [] : routePoints,
    checkpoints,
    targetKm: 0,
    mode,
    r: rng(seed),
  })

  const run = generateRun({
    route: path.points,
    checkpoints,
    targetKm,
    seed,
    paceSecPerKm,
    sensorHz,
    checkpointRadius: radius,
    startTime,
  })

  const analysis = analyzeTrack(run.points, {
    time: run.meta.duration,
    distance: run.meta.distanceKm,
  })
  const diagnosis = diagnose(analysis, run.sensors.steps.total)

  let sensors = run.sensors
  if (compactSensors) {
    const imu = run.sensors.imu
    const step = Math.max(1, Math.round(imu.length / 240))
    sensors = {
      timescale: run.sensors.timescale,
      steps: run.sensors.steps,
      imu: imu.filter((_, i) => i % step === 0),
      heartRate: run.sensors.heartRate,
      imuDecimated: step,
    }
  }

  return {
    seed,
    points: run.points,
    meta: run.meta,
    sensors,
    analysis,
    diagnosis,
    path: {
      laps: path.laps,
      lengthKm: path.lengthKm,
      loopLengthKm: path.loopLengthKm,
      checkpointReport: path.checkpointReport,
      points: path.points,
    },
  }
}

export function toView(result) {
  return {
    seed: result.seed,
    meta: result.meta,
    analysis: result.analysis,
    diagnosis: result.diagnosis,
    path: result.path,
    sensors: {
      timescale: result.sensors.timescale,
      steps: result.sensors.steps,
      heartRate: result.sensors.heartRate,
      imu: result.sensors.imu,
    },
    points: result.points.map((p) => ({ o: p.o, a: p.a, s: p.s, p: p.p })),
  }
}
