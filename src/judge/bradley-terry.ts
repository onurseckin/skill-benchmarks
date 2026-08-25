import type {
  BradleyTerryConfig,
  BradleyTerryResult,
  ConfidenceInterval,
  PairwiseMatchMatrix,
  PairwiseMatchOutcome,
  SkillRating,
} from "./types.js";

interface InternalMatrixData {
  readonly models: readonly string[];
  readonly winMatrix: number[][];
  readonly matchMatrix: number[][];
  readonly tieMatrix: number[][];
  readonly totalMatches: number;
}

function getSafeNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  return fallback;
}

function getMatrixCell(matrix: number[][], row: number, col: number): number {
  const r = matrix[row];
  if (r === undefined) return 0;
  const c = r[col];
  return typeof c === "number" ? c : 0;
}

function setMatrixCell(matrix: number[][], row: number, col: number, val: number): void {
  const r = matrix[row];
  if (r !== undefined) r[col] = val;
}

export class BradleyTerryScorer {
  public buildMatrix(
    matches: readonly PairwiseMatchOutcome[],
    explicitModels?: readonly string[]
  ): PairwiseMatchMatrix {
    const modelSet = new Set<string>();
    if (explicitModels !== undefined) {
      for (const m of explicitModels) modelSet.add(m);
    }
    for (const match of matches) {
      modelSet.add(match.modelA);
      modelSet.add(match.modelB);
    }
    const models = Array.from(modelSet).sort();
    const wins: Record<string, Record<string, number>> = {};
    const ties: Record<string, Record<string, number>> = {};
    const totalMatches: Record<string, Record<string, number>> = {};

    for (const a of models) {
      const winRow: Record<string, number> = {};
      const tieRow: Record<string, number> = {};
      const matchRow: Record<string, number> = {};
      for (const b of models) {
        winRow[b] = 0;
        tieRow[b] = 0;
        matchRow[b] = 0;
      }
      wins[a] = winRow;
      ties[a] = tieRow;
      totalMatches[a] = matchRow;
    }

    let totalPairwiseCount = 0;
    for (const match of matches) {
      const modelA = match.modelA;
      const modelB = match.modelB;
      const w = match.weight > 0 ? match.weight : 1;
      const tA = totalMatches[modelA];
      const tB = totalMatches[modelB];
      if (tA === undefined || tB === undefined) continue;

      tA[modelB] = getSafeNumber(tA[modelB], 0) + w;
      tB[modelA] = getSafeNumber(tB[modelA], 0) + w;
      totalPairwiseCount += w;

      if (match.winner === "model_a") {
        const winsA = wins[modelA];
        if (winsA !== undefined) winsA[modelB] = getSafeNumber(winsA[modelB], 0) + w;
      } else if (match.winner === "model_b") {
        const winsB = wins[modelB];
        if (winsB !== undefined) winsB[modelA] = getSafeNumber(winsB[modelA], 0) + w;
      } else {
        const tiesA = ties[modelA];
        const tiesB = ties[modelB];
        if (tiesA !== undefined && tiesB !== undefined) {
          tiesA[modelB] = getSafeNumber(tiesA[modelB], 0) + w;
          tiesB[modelA] = getSafeNumber(tiesB[modelA], 0) + w;
        }
      }
    }
    return { models, wins, ties, totalMatches, totalPairwiseCount };
  }

  public fit(matches: readonly PairwiseMatchOutcome[], config?: BradleyTerryConfig): BradleyTerryResult {
    return this.fitMatrix(this.buildMatrix(matches), config);
  }

  public fitMatrix(matrix: PairwiseMatchMatrix, config?: BradleyTerryConfig): BradleyTerryResult {
    const startTime = Date.now();
    const maxIter = getSafeNumber(config?.maxIterations, 500);
    const tol = getSafeNumber(config?.tolerance, 1e-6);
    const prior = getSafeNumber(config?.priorWeight, 0.01);
    const baseElo = getSafeNumber(config?.baseElo, 1500);
    const eloScale = getSafeNumber(config?.eloScale, 400);
    const tieWeight = getSafeNumber(config?.tieWeight, 0.5);
    const confLevel = getSafeNumber(config?.confidenceLevel, 0.95);
    const data = this.prepareInternalData(matrix);
    const n = data.models.length;
    if (n === 0) {
      return {
        ratings: [], iterations: 0, converged: true, logLikelihood: 0,
        aic: 0, bic: 0, baselineModel: "", matrix, executionTimeMs: Date.now() - startTime,
      };
    }

    const effectiveWins = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) {
        if (i !== j) sum += getMatrixCell(data.winMatrix, i, j) + tieWeight * getMatrixCell(data.tieMatrix, i, j);
      }
      effectiveWins[i] = sum;
    }

    let gamma = new Float64Array(n);
    gamma.fill(1.0);
    let converged = false;
    let iterations = 0;

    for (let iter = 0; iter < maxIter; iter++) {
      iterations = iter + 1;
      const nextGamma = new Float64Array(n);
      let maxChange = 0;

      for (let i = 0; i < n; i++) {
        let denom = 0;
        for (let j = 0; j < n; j++) {
          if (i !== j) {
            const m = getMatrixCell(data.matchMatrix, i, j);
            if (m > 0) denom += m / (getSafeNumber(gamma[i], 1.0) + getSafeNumber(gamma[j], 1.0));
          }
        }
        nextGamma[i] = (getSafeNumber(effectiveWins[i], 0) + prior) / (denom + prior);
      }

      let logSum = 0;
      for (let i = 0; i < n; i++) logSum += Math.log(Math.max(1e-12, getSafeNumber(nextGamma[i], 1.0)));
      const norm = Math.exp(logSum / n);
      for (let i = 0; i < n; i++) {
        const val = getSafeNumber(nextGamma[i], 1.0);
        const cur = getSafeNumber(gamma[i], 1.0);
        const newVal = val / norm;
        nextGamma[i] = newVal;
        const diff = Math.abs(newVal - cur);
        if (diff > maxChange) maxChange = diff;
      }
      gamma = nextGamma;
      if (maxChange < tol) {
        converged = true;
        break;
      }
    }

    let baselineModel = "";
    if (typeof config?.baselineModel === "string" && config.baselineModel.length > 0) {
      baselineModel = config.baselineModel;
    } else if (data.models.length > 0) {
      const first = data.models[0];
      if (typeof first === "string") baselineModel = first;
    }

    const baselineIdx = Math.max(0, data.models.indexOf(baselineModel));
    const baselineGamma = getSafeNumber(gamma[baselineIdx], 1.0);
    const logLikelihood = this.computeLogLikelihood(data, gamma, tieWeight);
    const standardErrors = this.computeStandardErrors(data, gamma, baselineIdx);
    const zScore = confLevel >= 0.99 ? 2.576 : confLevel >= 0.95 ? 1.96 : 1.645;
    const ratings: SkillRating[] = [];

    for (let i = 0; i < n; i++) {
      const rawModel = data.models[i];
      const modelId = typeof rawModel === "string" ? rawModel : "";
      const curGamma = getSafeNumber(gamma[i], 1.0);
      const skill = Math.log(Math.max(1e-12, curGamma));
      const baselineSkill = Math.log(Math.max(1e-12, baselineGamma));
      const se = getSafeNumber(standardErrors[i], 0.1);
      const elo = baseElo + (eloScale / Math.LN10) * (skill - baselineSkill);
      const moe = zScore * se * (eloScale / Math.LN10);
      let winsCount = 0;
      let lossesCount = 0;
      let tiesCount = 0;
      let totalMatchCount = 0;

      for (let j = 0; j < n; j++) {
        if (i !== j) {
          winsCount += getMatrixCell(data.winMatrix, i, j);
          lossesCount += getMatrixCell(data.winMatrix, j, i);
          tiesCount += getMatrixCell(data.tieMatrix, i, j);
          totalMatchCount += getMatrixCell(data.matchMatrix, i, j);
        }
      }

      const winRate = totalMatchCount > 0 ? (winsCount + tieWeight * tiesCount) / totalMatchCount : 0.5;
      const ci: ConfidenceInterval = {
        lower: skill - zScore * se, upper: skill + zScore * se,
        confidenceLevel: confLevel, marginOfError: zScore * se,
      };

      ratings.push({
        modelId, skill, standardError: se, confidenceInterval: ci,
        elo: Math.round(elo * 10) / 10,
        eloLower: Math.round((elo - moe) * 10) / 10,
        eloUpper: Math.round((elo + moe) * 10) / 10,
        rank: 0, wins: winsCount, losses: lossesCount, ties: tiesCount,
        totalMatches: totalMatchCount,
        winRate: Math.round(winRate * 10000) / 10000,
      });
    }

    ratings.sort((a, b) => b.elo - a.elo);
    const rankedRatings = ratings.map((r, index) => ({ ...r, rank: index + 1 }));
    const k = n - 1;
    const aic = 2 * k - 2 * logLikelihood;
    const bic = k * Math.log(Math.max(1, data.totalMatches)) - 2 * logLikelihood;

    return {
      ratings: rankedRatings, iterations, converged,
      logLikelihood: Math.round(logLikelihood * 100) / 100,
      aic: Math.round(aic * 100) / 100, bic: Math.round(bic * 100) / 100,
      baselineModel, matrix, executionTimeMs: Date.now() - startTime,
    };
  }

  public predictWinProbability(skillA: number, skillB: number): number {
    return 1.0 / (1.0 + Math.exp(skillB - skillA));
  }

  public predictEloWinProbability(eloA: number, eloB: number, scale = 400): number {
    return 1.0 / (1.0 + Math.pow(10, (eloB - eloA) / scale));
  }

  private prepareInternalData(matrix: PairwiseMatchMatrix): InternalMatrixData {
    const models = matrix.models;
    const n = models.length;
    const winMatrix: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const matchMatrix: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const tieMatrix: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    let totalMatches = 0;

    for (let i = 0; i < n; i++) {
      const rawA = models[i];
      const modelA = typeof rawA === "string" ? rawA : "";
      for (let j = 0; j < n; j++) {
        const rawB = models[j];
        const modelB = typeof rawB === "string" ? rawB : "";
        const winsMap = matrix.wins[modelA];
        const tiesMap = matrix.ties[modelA];
        const totalMap = matrix.totalMatches[modelA];
        const w = winsMap !== undefined ? getSafeNumber(winsMap[modelB], 0) : 0;
        const t = tiesMap !== undefined ? getSafeNumber(tiesMap[modelB], 0) : 0;
        const m = totalMap !== undefined ? getSafeNumber(totalMap[modelB], 0) : 0;
        setMatrixCell(winMatrix, i, j, w);
        setMatrixCell(tieMatrix, i, j, t);
        setMatrixCell(matchMatrix, i, j, m);
        totalMatches += m;
      }
    }
    return { models, winMatrix, matchMatrix, tieMatrix, totalMatches: totalMatches / 2 };
  }

  private computeLogLikelihood(data: InternalMatrixData, gamma: Float64Array, tieWeight: number): number {
    const n = data.models.length;
    let logLikelihood = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const nMatches = getMatrixCell(data.matchMatrix, i, j);
        if (nMatches > 0) {
          const wI = getMatrixCell(data.winMatrix, i, j) + tieWeight * getMatrixCell(data.tieMatrix, i, j);
          const wJ = getMatrixCell(data.winMatrix, j, i) + tieWeight * getMatrixCell(data.tieMatrix, j, i);
          const gI = Math.max(1e-12, getSafeNumber(gamma[i], 1.0));
          const gJ = Math.max(1e-12, getSafeNumber(gamma[j], 1.0));
          logLikelihood += wI * Math.log(gI) + wJ * Math.log(gJ) - nMatches * Math.log(gI + gJ);
        }
      }
    }
    return logLikelihood;
  }

  private computeStandardErrors(data: InternalMatrixData, gamma: Float64Array, baselineIdx: number): Float64Array {
    const n = data.models.length;
    const se = new Float64Array(n);
    if (n <= 1) return se;
    const freeIndices: number[] = [];
    for (let i = 0; i < n; i++) {
      if (i !== baselineIdx) freeIndices.push(i);
    }
    const m = freeIndices.length;
    const hessian: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));

    for (let r = 0; r < m; r++) {
      const i = getSafeNumber(freeIndices[r], 0);
      for (let c = 0; c < m; c++) {
        const j = getSafeNumber(freeIndices[c], 0);
        if (r === c) {
          let sum = 0;
          for (let o = 0; o < n; o++) {
            if (o !== i) {
              const nMatches = getMatrixCell(data.matchMatrix, i, o);
              if (nMatches > 0) {
                const gi = getSafeNumber(gamma[i], 1.0);
                const go = getSafeNumber(gamma[o], 1.0);
                sum += (nMatches * gi * go) / Math.pow(gi + go, 2);
              }
            }
          }
          setMatrixCell(hessian, r, c, sum);
        } else {
          const nMatches = getMatrixCell(data.matchMatrix, i, j);
          if (nMatches > 0) {
            const gi = getSafeNumber(gamma[i], 1.0);
            const gj = getSafeNumber(gamma[j], 1.0);
            setMatrixCell(hessian, r, c, -(nMatches * gi * gj) / Math.pow(gi + gj, 2));
          }
        }
      }
    }

    const cov = this.invertMatrix(hessian, m);
    for (let r = 0; r < m; r++) {
      const i = getSafeNumber(freeIndices[r], 0);
      const variance = Math.max(1e-6, getMatrixCell(cov, r, r));
      se[i] = Math.sqrt(variance);
    }
    se[baselineIdx] = 0;
    return se;
  }

  private invertMatrix(matrix: number[][], size: number): number[][] {
    const identity: number[][] = Array.from({ length: size }, (_, i) =>
      Array.from({ length: size }, (_, j) => (i === j ? 1.0 : 0.0))
    );
    const aug: number[][] = Array.from({ length: size }, (row, i) => {
      const rowM = matrix[i];
      const rowI = identity[i];
      const partM = rowM !== undefined ? rowM : new Array<number>(size).fill(0);
      const partI = rowI !== undefined ? rowI : new Array<number>(size).fill(0);
      return [...partM, ...partI];
    });

    for (let i = 0; i < size; i++) {
      let maxRow = i;
      for (let k = i + 1; k < size; k++) {
        const valK = Math.abs(getMatrixCell(aug, k, i));
        const valMax = Math.abs(getMatrixCell(aug, maxRow, i));
        if (valK > valMax) maxRow = k;
      }
      const temp = aug[i];
      const repl = aug[maxRow];
      aug[i] = repl !== undefined ? repl : [];
      aug[maxRow] = temp !== undefined ? temp : [];

      const curRow = aug[i];
      if (curRow === undefined) continue;
      const pivot = getSafeNumber(curRow[i], 1.0);
      if (Math.abs(pivot) < 1e-12) return identity;

      for (let j = 0; j < 2 * size; j++) {
        curRow[j] = getSafeNumber(curRow[j], 0) / pivot;
      }

      for (let k = 0; k < size; k++) {
        if (k !== i) {
          const rowK = aug[k];
          if (rowK !== undefined) {
            const factor = getSafeNumber(rowK[i], 0);
            for (let j = 0; j < 2 * size; j++) {
              rowK[j] = getSafeNumber(rowK[j], 0) - factor * getSafeNumber(curRow[j], 0);
            }
          }
        }
      }
    }

    const result: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0));
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        setMatrixCell(result, i, j, getMatrixCell(aug, i, size + j));
      }
    }
    return result;
  }
}

export function createBradleyTerryScorer(): BradleyTerryScorer {
  return new BradleyTerryScorer();
}
