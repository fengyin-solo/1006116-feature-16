import { listRows } from '@/data/local-store'
import type { GasKind, VentHazard, VentUnit } from './types'

/**
 * 通风专属存储。与通用清单分开存，但读数与隐患都收敛到这一份，
 * 通风看板和安全巡检页从同一处取数，超限机组数不会出现两套。
 */
const STORAGE_KEY = 'shield-tunnel-construction:ventilation:v3'

type Persisted = {
  caliber: string
  units: VentUnit[]
  hazards: VentHazard[]
  seq: { unit: number; hazard: number }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function parseNum(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    // 只认真正的数值开头（兼容 “1.2%”“0.8 ppm”），占位文本“洞内通风样例2”不当作读数
    const m = value.trim().match(/^-?\d+(\.\d+)?/)
    if (m) return Number(m[0])
  }
  return null
}

/** 从老版通用清单迁移：兼容只存过「有害气体浓度」一个数/占位文本的记录 */
function migrateLegacyUnits(): VentUnit[] {
  let legacy: ReturnType<typeof listRows> = []
  try {
    legacy = listRows('ventilation')
  } catch {
    legacy = []
  }
  const migrated: VentUnit[] = []
  for (const row of legacy) {
    const code = String(row['机组编号'] ?? `VENT-OLD-${row.id}`)
    const gas = parseNum(row['有害气体浓度'])
    const lastGood: Partial<Record<GasKind, number>> = {}
    if (gas !== null) lastGood.CH4 = gas
    migrated.push({
      id: Number(row.id),
      code,
      status: (['待启动', '运行中', '已停机', '故障'].includes(String(row.status))
        ? String(row.status)
        : '待启动') as VentUnit['status'],
      // 老数据没有安装位置：留空并标记待复核，由存量复核流程补齐
      position: '',
      zone: 'A工区',
      ductLengthM: parseNum(row['风筒长度']) ?? 0,
      ratedAirflow: parseNum(row['送风量']) ?? 0,
      airflow: parseNum(row['送风量']) ?? 0,
      temperature: parseNum(row['洞内温度']),
      operator: typeof row['值守人员'] === 'string' ? String(row['值守人员']) : '未分配',
      lastGood,
      lastSampleAt: null,
      readError: '',
      faultReason: '',
      registeredAt: Date.parse(String(row['检测日期'] ?? '')) || Date.now(),
      positionReviewed: false,
      version: 1,
      migratedFromLegacy: true,
      note: '由老版通风清单迁移，需按安装位置复核',
    })
  }
  return migrated
}

/** 初始演示机组：覆盖四个状态、两个工区、各温度区间 */
function seedUnits(): VentUnit[] {
  const day = 24 * 60 * 60 * 1000
  const now = Date.now()
  const make = (u: Omit<VentUnit, 'version' | 'registeredAt'> & Partial<Pick<VentUnit, 'version' | 'registeredAt'>>): VentUnit => ({
    version: 1,
    registeredAt: now - 12 * day,
    ...u,
  })
  return [
    make({
      id: 1, code: 'TF-A-101', status: '运行中', position: 'DK15+200 左洞', zone: 'A工区',
      ductLengthM: 850, ratedAirflow: 120, airflow: 96, temperature: 26.4, operator: '孙大力',
      lastGood: { CH4: 0.32, CO: 8, H2S: 1.2, CO2: 0.35 }, lastSampleAt: now, readError: '',
      faultReason: '', positionReviewed: true,
    }),
    make({
      id: 2, code: 'TF-A-102', status: '运行中', position: 'DK15+480 右洞', zone: 'A工区',
      ductLengthM: 1100, ratedAirflow: 150, airflow: 142, temperature: 29.1, operator: '周铁柱',
      lastGood: { CH4: 0.41, CO: 12, H2S: 2.0, CO2: 0.46 }, lastSampleAt: now, readError: '',
      faultReason: '', positionReviewed: true,
    }),
    make({
      id: 3, code: 'TF-A-103', status: '待启动', position: 'DK15+600 左洞', zone: 'A工区',
      ductLengthM: 600, ratedAirflow: 90, airflow: 0, temperature: 22.7, operator: '孙大力',
      lastGood: { CH4: 0.18, CO: 4, H2S: 0.6, CO2: 0.28 }, lastSampleAt: now, readError: '',
      faultReason: '', positionReviewed: true,
    }),
    make({
      id: 4, code: 'TF-A-104', status: '已停机', position: 'DK14+950 横通道', zone: 'A工区',
      ductLengthM: 420, ratedAirflow: 75, airflow: 0, temperature: 21.3, operator: '吴进宝',
      lastGood: { CH4: 0.12, CO: 3, H2S: 0.4, CO2: 0.22 }, lastSampleAt: now, readError: '',
      faultReason: '', positionReviewed: true,
    }),
    make({
      id: 5, code: 'TF-B-201', status: '运行中', position: 'DK18+050 左洞', zone: 'B工区',
      ductLengthM: 900, ratedAirflow: 130, airflow: 118, temperature: 32.6, operator: '冯大山',
      lastGood: { CH4: 0.28, CO: 9, H2S: 1.0, CO2: 0.4 }, lastSampleAt: now, readError: '',
      faultReason: '', positionReviewed: true,
    }),
    make({
      id: 6, code: 'TF-A-105', status: '运行中', position: 'DK16+020 右洞', zone: 'A工区',
      ductLengthM: 1250, ratedAirflow: 160, airflow: 88, temperature: 27.8, operator: '周铁柱',
      lastGood: { CH4: 0.36, CO: 10, H2S: 1.6, CO2: 0.42 }, lastSampleAt: now, readError: '',
      faultReason: '', positionReviewed: true,
    }),
    make({
      id: 7, code: 'TF-A-106', status: '运行中', position: 'DK16+300 左洞', zone: 'A工区',
      ductLengthM: 700, ratedAirflow: 110, airflow: 104, temperature: 19.6, operator: '孙大力',
      lastGood: { CH4: 0.22, CO: 6, H2S: 0.8, CO2: 0.3 }, lastSampleAt: now, readError: '',
      faultReason: '', positionReviewed: true,
    }),
  ]
}

function buildInitial(): Persisted {
  // 老清单机组 + 新口径演示机组合并，按「机组编号」去重：重复登记只留最早那条
  const seed = seedUnits()
  let legacy: VentUnit[] = []
  try {
    legacy = migrateLegacyUnits()
  } catch {
    legacy = []
  }
  // 老机组 id 与种子 id 可能撞，统一重排
  legacy = legacy.map((u, i) => ({ ...u, id: 900 + i }))
  const merged = [...seed, ...legacy]

  const byCode = new Map<string, VentUnit>()
  for (const unit of merged) {
    const exist = byCode.get(unit.code)
    if (!exist || unit.registeredAt < exist.registeredAt ||
      (unit.registeredAt === exist.registeredAt && unit.id < exist.id)) {
      byCode.set(unit.code, unit)
    }
  }
  const deduped = [...byCode.values()].sort((a, b) => a.id - b.id)
  return {
    caliber: 'v3-2026-10',
    units: deduped,
    hazards: [],
    seq: {
      unit: deduped.reduce((max, u) => Math.max(max, u.id), 0) + 1,
      hazard: 1,
    },
  }
}

let cache: Persisted | null = null

export function loadStore(): Persisted {
  if (cache) return cache
  if (typeof window === 'undefined' || !window.localStorage) {
    cache = buildInitial()
    return cache
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Persisted
      if (parsed && Array.isArray(parsed.units) && Array.isArray(parsed.hazards)) {
        cache = parsed
        return cache
      }
    } catch {
      // 落盘损坏则重建，不把脏数据顶上来
    }
  }
  cache = buildInitial()
  persist()
  return cache
}

export function persist(): void {
  if (!cache || typeof window === 'undefined' || !window.localStorage) return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
}

export function saveStore(next: Persisted): void {
  cache = next
  persist()
}

export function snapshot(): Persisted {
  return clone(loadStore())
}

export function storageKey(): string {
  return STORAGE_KEY
}
