// Aggregate-only paired evaluation. No inference, fitting or persistence.
const { metrics } = require('./reportQuestionPredictions');
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const SEED = 20261117, REPLICATES = 1000;

function calibration(rows, key) {
  const bins = Array.from({ length: 10 }, (_, bin) => ({ bin, n: 0, sum_p: 0, correct: 0 }));
  for (const r of rows) {
    const b = bins[Math.min(9, Math.floor(r[key] * 10))];
    b.n++; b.sum_p += r[key]; b.correct += r.actual;
  }
  const populated = bins.filter(b => b.n).map(b => ({ bin: b.bin, n: b.n,
    mean_probability: b.sum_p / b.n, correct_rate: b.correct / b.n }));
  return { bins: populated, ece: rows.length ? populated.reduce((sum, b) =>
    sum + b.n * Math.abs(b.mean_probability - b.correct_rate), 0) / rows.length : null };
}

function compare(rows) {
  const groups = new Map();
  for (const r of rows) {
    if (![r.probability, r.baseline_probability].every(p => typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1) || ![0, 1].includes(r.actual) || r.user == null) {
      throw Error('Paired evaluation requires valid probabilities, binary labels and learner clusters');
    }
    if (!groups.has(r.user)) groups.set(r.user, []);
    groups.get(r.user).push(r);
  }
  const clusters = [...groups.values()].map(rs => ({ n: rs.length,
    model: metrics(rs, 'probability'), baseline: metrics(rs, 'baseline_probability') }));
  const macro = key => ({ learners: clusters.length,
    log_loss: mean(clusters.map(c => c[key].log_loss)),
    brier_score: mean(clusters.map(c => c[key].brier_score)),
    roc_auc: mean(clusters.map(c => c[key].roc_auc).filter(x => x !== null)),
    auc_eligible_learners: clusters.filter(c => c[key].roc_auc !== null).length });
  const samples = { micro_log_loss: [], micro_brier: [], macro_log_loss: [], macro_brier: [] };
  if (clusters.length >= 2) {
    // Resample entire learners once per replicate; model and baseline stay paired.
    let seed = SEED;
    const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let b = 0; b < REPLICATES; b++) {
      let n = 0, ll = 0, bs = 0, macroLL = 0, macroBS = 0;
      for (let j = 0; j < clusters.length; j++) {
        const c = clusters[Math.floor(random() * clusters.length)];
        const dl = c.model.log_loss - c.baseline.log_loss, db = c.model.brier_score - c.baseline.brier_score;
        n += c.n; ll += c.n * dl; bs += c.n * db; macroLL += dl; macroBS += db;
      }
      samples.micro_log_loss.push(ll / n); samples.micro_brier.push(bs / n);
      samples.macro_log_loss.push(macroLL / clusters.length); samples.macro_brier.push(macroBS / clusters.length);
    }
  }
  const interval = xs => { xs.sort((a, b) => a - b); return xs.length ? [xs[24], xs[974]] : null; };
  const model = metrics(rows, 'probability'), baseline = metrics(rows, 'baseline_probability');
  const cm = calibration(rows, 'probability'), cb = calibration(rows, 'baseline_probability');
  return { model, baseline, learners: clusters.length,
    attempts: new Set(rows.filter(r => r.attempt != null).map(r => `${r.user}:${r.attempt}`)).size,
    distinct_questions: new Set(rows.filter(r => r.question != null).map(r => r.question)).size,
    correct: rows.filter(r => r.actual === 1).length, incorrect: rows.filter(r => r.actual === 0).length,
    macro_per_learner: { model: macro('model'), baseline: macro('baseline') },
    delta_log_loss_model_minus_baseline: rows.length ? model.log_loss - baseline.log_loss : null,
    delta_brier_model_minus_baseline: rows.length ? model.brier_score - baseline.brier_score : null,
    paired_user_bootstrap_95: interval(samples.micro_log_loss),
    paired_user_brier_bootstrap_95: interval(samples.micro_brier),
    paired_user_macro_log_loss_bootstrap_95: interval(samples.macro_log_loss),
    paired_user_macro_brier_bootstrap_95: interval(samples.macro_brier),
    bootstrap: { seed: SEED, replicates: REPLICATES, unit: 'learner', delta: 'model_minus_baseline' },
    uncertainty_note: clusters.length < 2 ? 'Not estimable from fewer than two learners.' :
      'Exploratory user-cluster bootstrap; two learners are not sufficient validation. Shared items and passages can still correlate learners.',
    calibration: cm.bins, baseline_calibration: cb.bins, ece: { model: cm.ece, baseline: cb.ece } };
}
module.exports = { compare };
