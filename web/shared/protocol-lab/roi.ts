import type { LabResult, RoiInput, RoiRow } from './types'
export function calculateRoi(input: RoiInput, results: LabResult[]): RoiRow[] {
  for (const key of [
    'devices',
    'eventsPerDay',
    'daysPerYear',
    'cellularPercent',
    'costPerMB',
    'minimumPerDevice',
    'incrementBytes',
  ] as const)
    if (typeof input[key] !== 'number') throw Error(`Enter a number for ROI ${key}.`)
  for (const key of ['measuredBytesPerEvent', 'measuredMBPerMonth'] as const)
    if (input[key] !== null && typeof input[key] !== 'number') throw Error(`Invalid ROI ${key}.`)
  for (const [key, value] of Object.entries(input))
    if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) throw Error(`Invalid ROI ${key}`)
  if (
    input.cellularPercent > 100 ||
    input.daysPerYear > 366 ||
    input.devices > 1e9 ||
    input.eventsPerDay > 1e9
  )
    throw Error('ROI inputs exceed supported limits.')
  const annualEvents = (input.devices * input.eventsPerDay * input.daysPerYear * input.cellularPercent) / 100
  const baseline = results.find((r) => r.id === input.baseline)
  const baselineBytes =
    input.measuredBytesPerEvent ??
    (baseline?.boundary === 'network' ? baseline.metrics.effective?.value : null) ??
    null
  const currentAnnualMB =
    input.measuredMBPerMonth !== null
      ? input.measuredMBPerMonth * 12
      : baselineBytes === null
        ? null
        : (annualEvents * baselineBytes) / 1e6
  const cost = (mb: number) =>
    input.billing === 'flat'
      ? input.devices * input.minimumPerDevice * 12
      : Math.max(mb * input.costPerMB, input.devices * input.minimumPerDevice * 12)
  return results.map((r) => {
    const bytes = r.boundary === 'network' ? (r.metrics.effective?.value ?? null) : null
    const eligible = baseline && baseline.id !== r.id ? r.eligibilityKey === baseline.eligibilityKey : true
    const userBaseline = input.measuredBytesPerEvent !== null || input.measuredMBPerMonth !== null
    if (bytes === null)
      return {
        id: r.id,
        bytesPerEvent: null,
        monthlyMB: null,
        annualMB: null,
        currentAnnualMB,
        annualSavedMB: null,
        monthlyCost: null,
        annualCost: null,
        annualSavings: null,
        reduction: null,
        note: 'Full network bytes unavailable. Stream bytes cannot establish cellular costs.',
      }
    // Rounding is per charged logical event, an explicit conservative user assumption.
    const billed = input.incrementBytes
      ? Math.ceil(bytes / input.incrementBytes) * input.incrementBytes
      : bytes
    const annualMB = (annualEvents * bytes) / 1e6
    const annualCost = cost((annualEvents * billed) / 1e6)
    const baseBilled =
      baselineBytes !== null && input.incrementBytes
        ? Math.ceil(baselineBytes / input.incrementBytes) * input.incrementBytes
        : baselineBytes
    const currentCost =
      currentAnnualMB === null
        ? null
        : cost(input.measuredMBPerMonth !== null ? currentAnnualMB : (annualEvents * (baseBilled ?? 0)) / 1e6)
    const comparable = userBaseline || eligible
    return {
      id: r.id,
      bytesPerEvent: bytes,
      monthlyMB: annualMB / 12,
      annualMB,
      currentAnnualMB,
      annualSavedMB: comparable && currentAnnualMB !== null ? currentAnnualMB - annualMB : null,
      monthlyCost: annualCost / 12,
      annualCost,
      annualSavings: comparable && currentCost !== null ? currentCost - annualCost : null,
      reduction:
        comparable && currentAnnualMB && currentAnnualMB > 0
          ? ((currentAnnualMB - annualMB) / currentAnnualMB) * 100
          : null,
      note:
        input.billing === 'flat'
          ? 'Flat-rate cost stays unchanged as traffic falls.'
          : !comparable
            ? 'Savings withheld: security/delivery profiles differ.'
            : 'Modeled metered cost; decimal MB. Provisioning, unmeasured retries, and carrier-specific session rounding excluded.',
    }
  })
}
