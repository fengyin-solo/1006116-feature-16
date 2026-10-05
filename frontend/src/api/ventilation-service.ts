import { listRows, saveRows } from '@/data/local-store'
import { SEED_VENTILATION } from '@/data/seed-ventilation'
import {
  BOARD_COLUMNS,
  GAS_LIMITS,
  TEMP_BINS,
  VENT_MODEL_VERSION,
  tempBinKey,
  toRow,
  toVentUnit,
  topBreach,
  type GasBreach,
  type GasType,
  type VentStatus,
  type VentUnit,
} from '@/data/ventilation-model'
import type { ActionResult, EntryRow } from '@/data/types'

/**
 * 通风运行看板的领域服务。页面（看板、巡检页、概览页）只读本服务吐出来的数据，
 * 谁也不自己数超限、不自己判故障，保证「两处读到的超限机组数」永远是同一个数。
 */

const MODULE_KEY = 'ventilation'
const SAFETY_KEY = 'safety'
const VERSION_KEY = 'shield-tunnel-construction:vent-version'
const MAX_READ_ATTEMPTS = 3

export type SessionLike = { name: string; role: string; workArea: string }

export type RegisterInput = {
  code: string
  location: string
  ductLength: number
  airflow: number
  keeper: string
}

export type ReadAttempt = { code: string; ok: boolean; attempts: number; stale: boolean }

export type VentSnapshot = {
  version: string
  units: VentUnit[]
  columns: VentStatus[]
  statusCounts: Record<VentStatus, number>
  gasBreachCount: number
  tempDistribution: { key: string; label: string; count: number }[]
  keeperGroups: { keeper: string; units: VentUnit[] }[]
  hazards: EntryRow[]
  readResults: ReadAttempt[]
  gasLimits: typeof GAS_LIMITS
}

// ---- 会话与权限 ----------------------------------------------------------------

// 只有「本工区的通风负责人」能写（改送风量、登记、处置），其他账号一律只读。
export function canManage(session: SessionLike, workArea: string): boolean {
  return session.role === '通风负责人' && session.workArea === workArea
}

function requireLead(session: SessionLike, workArea: string): ActionResult | null {
  if (session.role !== '通风负责人') {
    return { ok: false, message: '当前账号只有查看权限，调整送风量与处置请联系通风负责人' }
  }
  if (session.workArea !== workArea) {
    return {
      ok: false,
      message: `机组属于${workArea}，${session.workArea}的通风负责人不能跨工区改动`,
    }
  }
  return null
}

// ---- 存量数据迁移（按 v1 口径重新梳理安装位置） ---------------------------------

let migrated = false

function ensureMigration(): void {
  if (migrated || typeof window === 'undefined' || !window.localStorage) return
  const version = window.localStorage.getItem(VERSION_KEY)
  const rows = listRows(MODULE_KEY)
  const isSample = rows.some((row) => JSON.stringify(row).includes('样例'))
  // 老示例数据或缺失口径版本：用按安装位置重梳过的存量台账替换；真实登记不覆盖。
  if (version !== VENT_MODEL_VERSION && (isSample || rows.length === 0)) {
    saveRows(MODULE_KEY, JSON.parse(JSON.stringify(SEED_VENTILATION)) as EntryRow[])
  }
  window.localStorage.setItem(VERSION_KEY, VENT_MODEL_VERSION)
  migrated = true
}

// ---- 隐患待办同步（巡检模块） ---------------------------------------------------

const HAZARD_SOURCE = '通风看板'

function hazardId(unit: VentUnit): string {
  return `HAZ-${unit.code}`
}

function hazardLevel(breach: GasBreach | null): string {
  if (!breach) return '一般'
  return breach.level === '超限' ? '重大' : '较大'
}

function deadlineText(): string {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return formatDate(date)
}

// 同一台机组反复触发/重复提交，隐患只留一条；已闭环的不重新翻开。
function upsertHazard(unit: VentUnit, problem: string, level: string, item: string): void {
  const rows = listRows(SAFETY_KEY)
  const code = hazardId(unit)
  const index = rows.findIndex((row) => String(row['巡检编号']) === code)
  if (index >= 0) {
    const current = rows[index]
    if (
      String(current.status) !== '已闭环' &&
      (String(current['发现问题']) !== problem || String(current['隐患等级']) !== level)
    ) {
      rows[index] = { ...current, 发现问题: problem, 隐患等级: level }
      saveRows(SAFETY_KEY, rows)
    }
    return
  }
  // id 用大偏移，避免与巡检表已有记录的小自增 id 撞号（巡检编号另有业务码去重）。
  const nextId = 900000 + rows.filter((r) => Number(r.id) >= 900000).length + 1
  const hazard: EntryRow = {
    id: nextId,
    status: '待整改',
    pending: true,
    abnormal: true,
    巡检编号: code,
    巡检区域: unit.location,
    巡检项目: item,
    发现问题: problem,
    隐患等级: level,
    整改期限: deadlineText(),
    巡检人员: unit.keeper,
    巡检状态: '待整改',
    来源: HAZARD_SOURCE,
    关联机组: unit.code,
    阈值版本: VENT_MODEL_VERSION,
  }
  saveRows(SAFETY_KEY, [...rows, hazard])
}

function closeHazard(unit: VentUnit, closedBy: string): void {
  const rows = listRows(SAFETY_KEY)
  const code = hazardId(unit)
  let changed = false
  const next = rows.map((row) => {
    if (String(row['巡检编号']) !== code || String(row.status) === '已闭环') return row
    changed = true
    return {
      ...row,
      status: '已闭环',
      pending: false,
      abnormal: false,
      巡检状态: '已闭环',
      闭环人: closedBy,
      闭环日期: formatNow(),
    }
  })
  if (changed) saveRows(SAFETY_KEY, next)
}

export function listVentHazards(): EntryRow[] {
  ensureMigration()
  reconcile()
  return listRows(SAFETY_KEY).filter(
    (row) => String(row['来源']) === HAZARD_SOURCE && String(row.status) !== '已闭环',
  )
}

// ---- 自动判故障（超限即故障待处理） ---------------------------------------------

function reconcile(): VentUnit[] {
  const rows = listRows(MODULE_KEY)
  const units = rows.map(toVentUnit)
  let ventChanged = false
  for (const unit of units) {
    if (unit.gasBreaches.length > 0) {
      const breach = topBreach(unit.gasBreaches)!
      if (unit.status !== '故障') {
        unit.status = '故障'
        unit.pending = true
        unit.abnormal = true
        ventChanged = true
      }
      const problem =
        `${unit.code} ${breach.gasName}浓度 ${breach.value} 超过上限 ${breach.limit}` +
        `（${breach.level}档），机组已自动转入故障待处理`
      // 隐患内容/等级以本轮读数为准；同一台机组反复触发只更新同一条。
      upsertHazard(unit, problem, hazardLevel(breach), '有害气体监测')
    }
  }
  if (ventChanged) persistUnits(units)
  return units
}

function persistUnits(units: VentUnit[]): void {
  const byId = new Map(units.map((unit) => [unit.id, toRow(unit)]))
  const rows = listRows(MODULE_KEY).map((row) => byId.get(Number(row.id)) ?? row)
  saveRows(MODULE_KEY, rows)
}

// ---- 查询（看板 / 巡检 / 概览共用这一个出口） ------------------------------------

let lastReadResults: ReadAttempt[] = []

export function getSnapshot(): VentSnapshot {
  ensureMigration()
  const units = reconcile()
  const statusCounts = Object.fromEntries(
    BOARD_COLUMNS.map((status) => [status, units.filter((unit) => unit.status === status).length]),
  ) as Record<VentStatus, number>

  const tempDistribution = TEMP_BINS.map((bin) => ({
    key: bin.key,
    label: bin.label,
    count: units.filter((unit) => tempBinKey(unit.temperature) === bin.key).length,
  }))

  const keeperMap = new Map<string, VentUnit[]>()
  for (const unit of units) {
    const list = keeperMap.get(unit.keeper) ?? []
    list.push(unit)
    keeperMap.set(unit.keeper, list)
  }

  return {
    version: VENT_MODEL_VERSION,
    units,
    columns: BOARD_COLUMNS,
    statusCounts,
    gasBreachCount: units.filter((unit) => unit.gasBreaches.length > 0).length,
    tempDistribution,
    keeperGroups: [...keeperMap.entries()]
      .map(([keeper, group]) => ({ keeper, units: group }))
      .sort((a, b) => a.keeper.localeCompare(b.keeper, 'zh-Hans-CN')),
    hazards: listRows(SAFETY_KEY).filter(
      (row) => String(row['来源']) === HAZARD_SOURCE && String(row.status) !== '已闭环',
    ),
    readResults: lastReadResults,
    gasLimits: GAS_LIMITS,
  }
}

// 巡检页要的口径：超限机组数与通风看板同源，不允许两边各数一套。
export function ventSafetyBrief(): { breachCount: number; hazards: EntryRow[] } {
  const snapshot = getSnapshot()
  return { breachCount: snapshot.gasBreachCount, hazards: snapshot.hazards }
}

// ---- 动作：启动 / 停机 / 登记故障 / 处置恢复 -------------------------------------

function findUnit(units: VentUnit[], id: number): VentUnit | undefined {
  return units.find((unit) => unit.id === id)
}

export function startUnit(id: number, session: SessionLike): ActionResult {
  ensureMigration()
  const units = listRows(MODULE_KEY).map(toVentUnit)
  const unit = findUnit(units, id)
  if (!unit) return { ok: false, message: '没有找到这台机组' }
  const denied = requireLead(session, unit.workArea)
  if (denied) return denied
  if (unit.status === '运行中') return { ok: false, message: `${unit.code} 已经在运行` }
  if (unit.status === '故障') return { ok: false, message: `${unit.code} 处于故障态，请先处置再启动` }
  unit.status = '运行中'
  unit.pending = false
  unit.abnormal = false
  persistUnits(units)
  return { ok: true, message: `${unit.code} 已启动，当前状态「运行中」` }
}

export function stopUnit(id: number, session: SessionLike): ActionResult {
  ensureMigration()
  const units = listRows(MODULE_KEY).map(toVentUnit)
  const unit = findUnit(units, id)
  if (!unit) return { ok: false, message: '没有找到这台机组' }
  const denied = requireLead(session, unit.workArea)
  if (denied) return denied
  if (unit.status === '已停机') return { ok: false, message: `${unit.code} 已经是停机状态` }
  unit.status = '已停机'
  persistUnits(units)
  return { ok: true, message: `${unit.code} 已停机检修` }
}

export function markFault(id: number, session: SessionLike): ActionResult {
  ensureMigration()
  const units = listRows(MODULE_KEY).map(toVentUnit)
  const unit = findUnit(units, id)
  if (!unit) return { ok: false, message: '没有找到这台机组' }
  const denied = requireLead(session, unit.workArea)
  if (denied) return denied
  if (unit.status === '故障') return { ok: false, message: `${unit.code} 已经在故障列里` }
  unit.status = '故障'
  unit.pending = true
  unit.abnormal = true
  persistUnits(units)
  upsertHazard(unit, `${unit.code} 设备故障，已停机待修`, '一般', '通风设备运行')
  return { ok: true, message: `${unit.code} 已登记故障，并同步到巡检隐患待办` }
}

// 处置完成：恢复运行。气体超限的机组先把现场处置后的安全读数写回去，再闭环隐患。
export function resolveFault(
  id: number,
  session: SessionLike,
  postReading?: { methane: number; co: number; temperature: number },
): ActionResult {
  ensureMigration()
  const units = listRows(MODULE_KEY).map(toVentUnit)
  const unit = findUnit(units, id)
  if (!unit) return { ok: false, message: '没有找到这台机组' }
  const denied = requireLead(session, unit.workArea)
  if (denied) return denied
  if (unit.status !== '故障') return { ok: false, message: `${unit.code} 当前不是故障态` }
  const gasFault = unit.gasBreaches.length > 0
  unit.gasMethane = gasFault ? postReading?.methane ?? 0.1 : unit.gasMethane
  unit.gasCo = gasFault ? postReading?.co ?? 4 : unit.gasCo
  unit.temperature = postReading?.temperature ?? unit.temperature ?? 28
  unit.readOk = true
  unit.status = '运行中'
  unit.pending = false
  unit.abnormal = false
  unit.checkedAt = formatNow()
  unit.gasBreaches = []
  persistUnits(units)
  closeHazard(unit, session.name)
  return { ok: true, message: `${unit.code} 已处置恢复运行，巡检隐患同步闭环` }
}

// ---- 送风量调整（越权直接拒绝） -------------------------------------------------

export function updateAirflow(id: number, airflow: number, session: SessionLike): ActionResult {
  ensureMigration()
  const value = Number(airflow)
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, message: '送风量必须是大于 0 的数字' }
  }
  const units = listRows(MODULE_KEY).map(toVentUnit)
  const unit = findUnit(units, id)
  if (!unit) return { ok: false, message: '没有找到这台机组' }
  const denied = requireLead(session, unit.workArea)
  if (denied) return denied
  const previous = unit.airflow
  unit.airflow = Math.round(value)
  persistUnits(units)
  return { ok: true, message: `${unit.code} 送风量已由 ${previous} 调整为 ${unit.airflow} m³/min` }
}

// ---- 登记（重复只留最早，存不进原样退回） ---------------------------------------

const submitting = new Set<string>()

export type RegisterResult = ActionResult & { returned?: RegisterInput }

export function registerUnit(input: RegisterInput, session: SessionLike): RegisterResult {
  const denied = requireLead(session, session.workArea)
  if (denied) return { ...denied, returned: input }
  const code = input.code.trim()
  if (!code) return { ok: false, message: '机组编号不能为空', returned: input }
  if (!Number.isFinite(input.ductLength) || input.ductLength <= 0) {
    return { ok: false, message: '风筒长度必须是大于 0 的数字', returned: input }
  }
  if (!Number.isFinite(input.airflow) || input.airflow <= 0) {
    return { ok: false, message: '送风量必须是大于 0 的数字', returned: input }
  }
  ensureMigration()
  const rows = listRows(MODULE_KEY)
  // 重复登记：已存在同编号机组，只留最早那条，本次内容原样退回、不做任何落库。
  if (rows.some((row) => String(row['机组编号']) === code)) {
    return { ok: false, message: `${code} 已登记过，重复登记只保留最早一条`, returned: input }
  }
  // 同一轮重复提交（双击/连发）也只记一条。
  if (submitting.has(code)) {
    return { ok: false, message: `${code} 正在登记，请勿重复提交`, returned: input }
  }
  submitting.add(code)
  try {
    const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
    const unit: VentUnit = {
      id: nextId,
      code,
      location: input.location.trim() || `${session.workArea}·待补安装位置`,
      ductLength: Math.round(input.ductLength),
      airflow: Math.round(input.airflow),
      temperature: null,
      gasMethane: null,
      gasCo: null,
      checkedAt: '',
      readOk: true,
      status: '待启动',
      keeper: input.keeper.trim() || '未指派',
      workArea: session.workArea,
      gasBreaches: [],
      pending: true,
      abnormal: false,
    }
    saveRows(MODULE_KEY, [...rows, toRow(unit)])
    return { ok: true, message: `${code} 登记成功，进入「待启动」列` }
  } finally {
    submitting.delete(code)
  }
}

// ---- 模拟取数（失败重试，绝不拿上一轮读数顶账） ---------------------------------

// VENT-0102 链路抖动：前 3 个采集轮次全部失败（每轮内部 3 次尝试都失败），第 4 轮起恢复。
const flakyRounds = new Map<string, number>()
const FLKY_CODE = 'VENT-0102'
const FLKY_GIVE_UP = 3

function jitter(value: number, delta: number, min = 0): number {
  const next = value + (Math.random() * 2 - 1) * delta
  return Math.round(Math.max(min, next) * 100) / 100
}

function fetchOnce(unit: VentUnit, round: number): { temperature: number; methane: number; co: number } {
  if (unit.code === FLKY_CODE && round <= FLKY_GIVE_UP) {
    throw new Error('传感器链路超时')
  }
  if (unit.temperature === null || unit.gasMethane === null || unit.gasCo === null) {
    throw new Error('该机位传感器未接入')
  }
  return {
    temperature: jitter(unit.temperature, 0.4, -20),
    methane: jitter(unit.gasMethane, 0.02),
    co: jitter(unit.gasCo, 1),
  }
}

export function refreshReadings(): { results: ReadAttempt[]; message: string } {
  ensureMigration()
  const units = listRows(MODULE_KEY).map(toVentUnit)
  const results: ReadAttempt[] = []
  for (const unit of units) {
    // 待启动且没装传感器的机位不抓数；停机的机组保留最后一轮值。
    if (unit.temperature === null && unit.gasMethane === null) continue
    const round = (flakyRounds.get(unit.code) ?? 0) + 1
    flakyRounds.set(unit.code, round)
    let attempt = 0
    let reading: { temperature: number; methane: number; co: number } | null = null
    while (attempt < MAX_READ_ATTEMPTS && reading === null) {
      attempt += 1
      try {
        reading = fetchOnce(unit, round)
      } catch {
        reading = null
      }
    }
    if (reading === null) {
      // 关键口径：取数失败只重试，不用旧读数冒充新读数；旧值打灰并标“沿用上轮”。
      unit.readOk = false
      results.push({ code: unit.code, ok: false, attempts: attempt, stale: true })
    } else {
      unit.readOk = true
      unit.temperature = reading.temperature
      unit.gasMethane = reading.methane
      unit.gasCo = reading.co
      unit.checkedAt = formatNow()
      results.push({ code: unit.code, ok: true, attempts: attempt, stale: false })
    }
  }
  // 成功的读数落库后由 reconcile 统一判档；失败的不参与判档，旧值不会触发新故障。
  persistUnits(units)
  const failed = results.filter((item) => !item.ok)
  lastReadResults = results
  const message =
    failed.length === 0
      ? `本轮取数完成，${results.length} 台机组读数成功`
      : `取数完成：${results.length - failed.length} 台成功，${failed.length} 台重试 ${MAX_READ_ATTEMPTS} 次仍失败（${failed
          .map((item) => item.code)
          .join('、')}），已沿用上轮读数并标注，未顶为新读数`
  return { results, message }
}

// ---- 时间工具 -------------------------------------------------------------------

function pad(num: number): string {
  return String(num).padStart(2, '0')
}

function formatNow(): string {
  return formatDate(new Date(), true)
}

function formatDate(date: Date, withTime = false): string {
  const text = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return withTime ? `${text} ${pad(date.getHours())}:${pad(date.getMinutes())}` : text
}

export const VENT_GAS_LIMITS = GAS_LIMITS
export type { GasType, VentUnit }
