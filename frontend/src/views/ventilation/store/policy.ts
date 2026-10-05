import type { Account, GasKind, GasLevel } from './types'

/**
 * 阈值口径（本版作数：v3 口径，见 ALARM_CALIBER_VERSION）。
 * 兼容老数据：老记录里只有一个「有害气体浓度」字符串，迁移时无法区分气体，
 * 统一按 CH4（甲烷，隧道施工最常见超限项）口径判定；能解析成数值才参与判定，
 * 解析不了（如占位文本“洞内通风样例1”）保留原值、不参与超限计算。
 *
 * 档位含义：
 *  - 一档预警：加强观测
 *  - 二档报警：达到/超过上限 → 机组自动进「故障（待处理）」并生成巡检隐患
 *  - 三档险情：立即撤人级别，同样进故障，面板标最高档
 */
export const ALARM_CALIBER_VERSION = 'v3-2026-10'

type GasSpec = {
  kind: GasKind
  name: string
  unit: string
  /** [一档, 二档（上限）, 三档]，阈值含本数 */
  levels: [number, number, number]
}

export const GAS_SPECS: Record<GasKind, GasSpec> = {
  CH4: { kind: 'CH4', name: '甲烷 CH4', unit: '%VOL', levels: [0.5, 1.0, 1.5] },
  CO: { kind: 'CO', name: '一氧化碳 CO', unit: 'ppm', levels: [15, 24, 30] },
  H2S: { kind: 'H2S', name: '硫化氢 H2S', unit: 'ppm', levels: [5, 10, 15] },
  CO2: { kind: 'CO2', name: '二氧化碳 CO2', unit: '%VOL', levels: [0.5, 1.0, 1.5] },
}

export const GAS_KINDS = Object.keys(GAS_SPECS) as GasKind[]

export const LEVEL_LABEL: Record<GasLevel, string> = {
  0: '正常',
  1: '一档预警',
  2: '二档报警（超上限）',
  3: '三档险情',
}

/** 达到此档即超上限，自动进故障待处理 */
export const FAULT_LEVEL: GasLevel = 2

export function judgeGas(kind: GasKind, value: number | null | undefined) {
  const spec = GAS_SPECS[kind]
  let level: GasLevel = 0
  let threshold: number | null = null
  if (value !== null && value !== undefined && Number.isFinite(value)) {
    if (value >= spec.levels[2]) {
      level = 3
      threshold = spec.levels[2]
    } else if (value >= spec.levels[1]) {
      level = 2
      threshold = spec.levels[1]
    } else if (value >= spec.levels[0]) {
      level = 1
      threshold = spec.levels[0]
    }
  }
  return { spec, level, threshold, label: LEVEL_LABEL[level] }
}

/** 送风量合规区间（m³/min）：面板上提示用，不改变状态机 */
export function airflowStatus(airflow: number, ductLengthM: number): { ok: boolean; text: string } {
  // 经验口径：风筒每 100m 至少 8 m³/min，且不低于额定值 70%
  const needByDuct = (ductLengthM / 100) * 8
  if (airflow < needByDuct) {
    return { ok: false, text: `偏低：按风筒长度应≥${needByDuct.toFixed(1)} m³/min` }
  }
  return { ok: true, text: '达标' }
}

/** 洞内温度区间（℃）分布小图的分桶 */
export const TEMP_BINS: { label: string; min: number; max: number; tone: string }[] = [
  { label: '<20', min: -Infinity, max: 20, tone: '#3b82f6' },
  { label: '20–24', min: 20, max: 24, tone: '#22c55e' },
  { label: '24–28', min: 24, max: 28, tone: '#eab308' },
  { label: '28–32', min: 28, max: 32, tone: '#f97316' },
  { label: '≥32', min: 32, max: Infinity, tone: '#dc2626' },
]

export function tempBinIndex(temperature: number | null): number {
  if (temperature === null || !Number.isFinite(temperature)) return -1
  const idx = TEMP_BINS.findIndex((bin) => temperature >= bin.min && temperature < bin.max)
  return idx
}

/** 账号：两个工区（A 工区为本工区）各一名通风负责人，另有巡检、只读账号 */
export const ACCOUNTS: Account[] = [
  { id: 'vent-lead-a', name: '李通风（A工区通风负责人）', role: '通风负责人', zone: 'A工区', canControl: true, canCloseHazard: true },
  { id: 'vent-lead-b', name: '王通风（B工区通风负责人）', role: '通风负责人', zone: 'B工区', canControl: true, canCloseHazard: true },
  { id: 'inspector', name: '赵巡检（安全员）', role: '安全员', zone: 'A工区', canControl: false, canCloseHazard: true },
  { id: 'viewer', name: '钱值班（值班长/只读）', role: '值班长', zone: 'A工区', canControl: false, canCloseHazard: false },
]

export const CURRENT_ZONE = 'A工区'

/** 只有本工区的通风负责人能改 */
export function canControlUnit(account: Account | null, zone: string): boolean {
  return !!account && account.canControl && account.zone === zone
}
