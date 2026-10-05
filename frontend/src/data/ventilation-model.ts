import type { EntryRow } from './types'

/**
 * 洞内通风领域口径（v1，2026-10 生效）。
 * 阈值口径以本文件为唯一准头：换页面、换看板都从这里取，不允许各自再抄一份。
 * 老数据（缺字段或字段里写着“洞内通风样例x”这类示例串）读取时按这里的规则兜底兼容。
 */
export const VENT_MODEL_VERSION = 'v1'

// 气体档位阈值（体积分数，%）。达到 notice 进关注，达到 alarm 自动判故障。
export const GAS_LIMITS = {
  methane: { notice: 0.5, alarm: 1.0 }, // 甲烷 CH4
  co: { notice: 12, alarm: 24 }, // 一氧化碳 CO，10^-6（ppm）
} as const

export type GasType = keyof typeof GAS_LIMITS

// 洞内温度分箱（℃），小图与统计都按这一份区间走。
export const TEMP_BINS = [
  { key: 'below28', label: '<28℃', min: -Infinity, max: 28 },
  { key: '28to32', label: '28–32℃', min: 28, max: 32 },
  { key: '32to35', label: '32–35℃', min: 32, max: 35 },
  { key: 'above35', label: '≥35℃', min: 35, max: Infinity },
] as const

export const VENT_STATUSES = ['待启动', '运行中', '已停机', '故障'] as const
export type VentStatus = (typeof VENT_STATUSES)[number]
// 看板列序：故障置顶标红，其余按施工关注顺序排。
export const BOARD_COLUMNS: VentStatus[] = ['故障', '待启动', '运行中', '已停机']

export type GasLevel = '正常' | '关注' | '报警' | '超限'

export type GasBreach = {
  gas: GasType
  gasName: string
  value: number
  limit: number
  level: Exclude<GasLevel, '正常' | '关注'>
}

export type VentUnit = {
  id: number
  code: string
  location: string
  ductLength: number // 风筒长度 m
  airflow: number // 送风量 m³/min
  temperature: number | null // 洞内温度 ℃
  gasMethane: number | null // 甲烷 %
  gasCo: number | null // 一氧化碳 ppm
  checkedAt: string // 最近读数时间 ISO
  readOk: boolean // 最近一轮读数是否成功
  status: VentStatus
  keeper: string // 值守人员
  workArea: string // 所属工区
  gasBreaches: GasBreach[]
  pending: boolean
  abnormal: boolean
  raw?: EntryRow
}

const GAS_NAMES: Record<GasType, string> = { methane: '甲烷(CH4)', co: '一氧化碳(CO)' }

// 老数据兼容：示例串、空串、无法解析的数值一律视为缺测，不硬顶一个假值。
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const text = String(value).trim()
  if (text === '' || text.includes('样例')) return null
  const num = Number(text.replace(/[^\d.-]/g, ''))
  return Number.isFinite(num) ? num : null
}

export function textOr(value: unknown, fallback = '—'): string {
  if (value === null || value === undefined) return fallback
  const text = String(value).trim()
  if (text === '' || text.includes('样例')) return fallback
  return text
}

// 单一气体判档：达到报警阈值即“报警”，超过报警上限 50% 记“超限”。
function gradeGas(gas: GasType, value: number | null): GasBreach | null {
  if (value === null) return null
  const { notice, alarm } = GAS_LIMITS[gas]
  if (value < notice) return null
  if (value < alarm) return null // 关注档不进故障，只在详情里提示
  const level: GasBreach['level'] = value > alarm * 1.5 ? '超限' : '报警'
  return { gas, gasName: GAS_NAMES[gas], value, limit: alarm, level }
}

// 取多台里“最重”的档：超限 > 报警。
export function topBreach(breaches: GasBreach[]): GasBreach | null {
  return breaches.reduce<GasBreach | null>((worst, item) => {
    if (!worst) return item
    const rank = (level: GasBreach['level']) => (level === '超限' ? 2 : 1)
    return rank(item.level) > rank(worst.level) ? item : worst
  }, null)
}

export function gasLevelOf(unit: Pick<VentUnit, 'gasMethane' | 'gasCo' | 'gasBreaches'>): GasLevel {
  if (unit.gasBreaches.length) return topBreach(unit.gasBreaches)!.level
  const readings: number[] = []
  ;(
    [
      ['methane', unit.gasMethane],
      ['co', unit.gasCo],
    ] as [GasType, number | null][]
  ).forEach(([gas, value]) => {
    if (value !== null && value >= GAS_LIMITS[gas].notice) readings.push(value)
  })
  return readings.length ? '关注' : '正常'
}

export function tempBinKey(temperature: number | null): string {
  if (temperature === null) return 'unknown'
  const bin = TEMP_BINS.find((item) => temperature >= item.min && temperature < item.max)
  return bin ? bin.key : 'unknown'
}

// 行 -> 领域对象：老数据缺字段时给安全兜底，不修改原始行。
export function toVentUnit(row: EntryRow): VentUnit {
  const gasMethane = toNumber(row['有害气体浓度']) // 老数据只有一个气体字段，优先按甲烷口径兼容
  const gasCo = toNumber(row['一氧化碳'])
  const methane = toNumber(row['甲烷']) ?? gasMethane
  const breaches = [gradeGas('methane', methane), gradeGas('co', gasCo)].filter(
    (item): item is GasBreach => item !== null,
  )
  const status = VENT_STATUSES.includes(row.status as VentStatus)
    ? (row.status as VentStatus)
    : '待启动'
  return {
    id: Number(row.id),
    code: textOr(row['机组编号'], `VENT-${String(row.id).padStart(4, '0')}`),
    location: textOr(row['安装位置']),
    ductLength: toNumber(row['风筒长度']) ?? 0,
    airflow: toNumber(row['送风量']) ?? 0,
    temperature: toNumber(row['洞内温度']),
    gasMethane: methane,
    gasCo,
    checkedAt: textOr(row['检测日期'], ''),
    readOk: row['读数状态'] !== '失败',
    status,
    keeper: textOr(row['值守人员'], '未指派'),
    workArea: textOr(row['所属工区'], '一工区'),
    gasBreaches: breaches,
    pending: Boolean(row.pending),
    abnormal: Boolean(row.abnormal),
    raw: row,
  }
}

// 领域对象回写为存储行（保留登记时的其它原始字段）。
export function toRow(unit: VentUnit): EntryRow {
  const base: EntryRow = {
    ...(unit.raw ?? {}),
    id: unit.id,
    status: unit.status,
    pending: unit.pending,
    abnormal: unit.abnormal,
  }
  return {
    ...base,
    机组编号: unit.code,
    安装位置: unit.location,
    风筒长度: unit.ductLength,
    送风量: unit.airflow,
    洞内温度: unit.temperature ?? '',
    甲烷: unit.gasMethane ?? '',
    一氧化碳: unit.gasCo ?? '',
    检测日期: unit.checkedAt,
    读数状态: unit.readOk ? '成功' : '失败',
    值守人员: unit.keeper,
    所属工区: unit.workArea,
  }
}
