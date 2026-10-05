import { defineStore } from 'pinia'

import { ACCOUNTS, ALARM_CALIBER_VERSION, CURRENT_ZONE, FAULT_LEVEL, GAS_KINDS, GAS_SPECS, canControlUnit, judgeGas } from './policy'
import { saveStore, snapshot } from './storage'
import type {
  Account,
  GasKind,
  GasVerdict,
  HazardStatus,
  ServiceResult,
  UnitDraft,
  UnitStatus,
  VentHazard,
  VentUnit,
} from './types'

type PollState = {
  loading: boolean
  lastOkAt: number | null
  /** 本轮取数概要 */
  summary: string
  /** 轮次令牌：异步取数返回时若已换轮则整轮作废，避免把等待期间的人工改动顶回去 */
  token: number
}

const RETRY_LIMIT = 3 // 含首次：最多取 3 次
const RETRY_DELAY_MS = 260

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function fmtTime(ts: number | null): string {
  if (!ts) return '尚无成功读数'
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

/** 模拟一次单机组传感器请求：约 1/3 概率取数失败（现场网络/探头常见情况） */
function mockFetchUnit(unit: VentUnit): Promise<{ ok: true; readings: Record<GasKind, number>; temperature: number } | { ok: false; error: string }> {
  const fail = Math.random() < 0.34
  if (fail) {
    return Promise.resolve({ ok: false, error: '探头无响应（超时）' })
  }
  const readings = {} as Record<GasKind, number>
  const spike = Math.random() < 0.12
  // 预先选定本轮冲高的气体（以 CH4 为主，偶发 CO），同轮只冲高一种
  const spikeKind: GasKind = Math.random() < 0.7 ? 'CH4' : 'CO'
  for (const kind of GAS_KINDS) {
    const spec = GAS_SPECS[kind]
    const base = unit.lastGood[kind] ?? spec.levels[0] * 0.5
    // 正常在基准附近小幅波动；抽风时选定气体冲高
    let v = base * (0.9 + Math.random() * 0.2)
    if (spike && kind === spikeKind) {
      const over = spec.levels[1]
      v = over * (1.02 + Math.random() * 0.45)
    }
    readings[kind] = Math.round(v * 100) / 100
  }
  const baseTemp = unit.temperature ?? 26
  const temperature = Math.round((baseTemp + (Math.random() - 0.5) * 0.6) * 10) / 10
  return Promise.resolve({ ok: true, readings, temperature })
}

export const useVentilationStore = defineStore('ventilation', {
  state: () => ({
    ...snapshot(),
    account: ACCOUNTS[0] as Account | null,
    currentZone: CURRENT_ZONE,
    caliberVersion: ALARM_CALIBER_VERSION,
    poll: { loading: false, lastOkAt: null, summary: '尚未取数', token: 0 } as PollState,
    /** 详情面板选中机组 */
    selectedId: null as number | null,
    /** 数据变更通知计数：两个页面都靠它刷新，避免各取各的 */
    revision: 0,
  }),

  getters: {
    unitsInZone(state): VentUnit[] {
      return state.units.filter((u) => u.zone === state.currentZone)
    },
    /** 故障列置顶标红：故障 > 待启动 > 运行中 > 已停机，组内按编号 */
    boardColumns(state): { status: UnitStatus; units: VentUnit[] }[] {
      const order: UnitStatus[] = ['故障', '待启动', '运行中', '已停机']
      const zoneUnits = state.units.filter((u) => u.zone === state.currentZone)
      return order.map((status) => ({
        status,
        units: zoneUnits
          .filter((u) => u.status === status)
          .sort((a, b) => a.code.localeCompare(b.code)),
      }))
    },
    /** 按值守人员排的值守视图 */
    byOperator(): { operator: string; units: VentUnit[]; running: number; fault: number }[] {
      const map = new Map<string, VentUnit[]>()
      for (const u of this.unitsInZone as VentUnit[]) {
        const key = u.operator || '未分配'
        const list = map.get(key) ?? []
        list.push(u)
        map.set(key, list)
      }
      return [...map.entries()]
        .map(([operator, units]) => ({
          operator,
          units: units.sort((a, b) => a.code.localeCompare(b.code)),
          running: units.filter((u) => u.status === '运行中').length,
          fault: units.filter((u) => u.status === '故障').length,
        }))
        .sort((a, b) => b.fault - a.fault || a.operator.localeCompare(b.operator))
    },
    stats(): { label: string; value: number; tone?: string }[] {
      const zoneUnits = this.unitsInZone as VentUnit[]
      return [
        { label: '运行中机组', value: zoneUnits.filter((u) => u.status === '运行中').length },
        { label: '故障机组', value: zoneUnits.filter((u) => u.status === '故障').length, tone: 'danger' },
        // 超限机组数：存在未闭环超限隐患的机组。看板与巡检页共用这一个 getter，不可能两套数
        { label: '有害气体超限（待闭环）', value: this.overLimitUnitIds.size, tone: 'danger' },
        { label: '待启动', value: zoneUnits.filter((u) => u.status === '待启动').length },
        { label: '已停机', value: zoneUnits.filter((u) => u.status === '已停机').length },
        { label: '位置待复核', value: zoneUnits.filter((u) => !u.positionReviewed).length },
      ]
    },
    /** 未闭环（待处理/已处置待闭环）隐患对应的机组 id —— 两处页面唯一口径 */
    openHazards(state): VentHazard[] {
      return state.hazards.filter((h) => h.status !== '已闭环' && h.zone === state.currentZone)
    },
    overLimitUnitIds(): Set<number> {
      return new Set((this.openHazards as VentHazard[]).map((h) => h.unitId))
    },
    pendingReviewCount(): number {
      return (this.unitsInZone as VentUnit[]).filter((u) => !u.positionReviewed).length
    },
    selected(state): VentUnit | null {
      return state.units.find((u) => u.id === state.selectedId) ?? null
    },
  },

  actions: {
    // ---------- 账号 / 权限 ----------
    setAccount(id: Account['id']) {
      this.account = ACCOUNTS.find((a) => a.id === id) ?? null
    },
    canControl(unit: VentUnit): boolean {
      return canControlUnit(this.account, unit.zone)
    },

    // ---------- 取数：失败重试，绝不拿失败读数顶替上一轮 ----------
    async pollOnce(): Promise<void> {
      if (this.poll.loading) return
      const token = this.poll.token + 1
      this.poll.loading = true
      this.poll.token = token
      const startUnits = snapshot().units
      let okCount = 0
      let failCount = 0
      let faultCount = 0
      // 先收集本轮各机组结果，落库前再与最新库状态合并，避免把等待期间的人工改动顶回去
      const outcomes = new Map<number,
        | { kind: 'fail'; error: string; requests: number; lastSampleAt: number | null }
        | { kind: 'ok'; readings: Partial<Record<GasKind, number>>; temperature: number }
      >()
      const running = startUnits.filter((u) => u.status === '运行中')

      for (const unit of running) {
        let result: Awaited<ReturnType<typeof mockFetchUnit>> | null = null
        let requests = 0
        for (let attempt = 1; attempt <= RETRY_LIMIT; attempt += 1) {
          requests = attempt
          result = await mockFetchUnit(unit)
          if (result.ok) break
          if (attempt < RETRY_LIMIT) await delay(RETRY_DELAY_MS)
          // 重试等待期间若已开始新一轮取数，本轮直接作废
          if (token !== this.poll.token) return
        }
        if (!result || !result.ok) {
          // 关键：失败读数什么都不顶，只记录错误与重试次数，上一轮有效值原样保留
          failCount += 1
          outcomes.set(unit.id, {
            kind: 'fail',
            error: result?.error ?? '取数失败',
            requests,
            lastSampleAt: unit.lastSampleAt,
          })
          continue
        }
        okCount += 1
        outcomes.set(unit.id, { kind: 'ok', readings: result.readings, temperature: result.temperature })
      }

      // 落库前重新取快照：这段时间内的状态/送风量/隐患人工改动都还在
      const next = snapshot()
      const now = Date.now()
      for (const [unitId, outcome] of outcomes) {
        const idx = next.units.findIndex((u) => u.id === unitId)
        if (idx < 0) continue
        const current = next.units[idx]
        if (outcome.kind === 'fail') {
          const retries = outcome.requests - 1
          next.units[idx] = {
            ...current,
            readError: `${outcome.error}，共请求 ${outcome.requests} 次（重试 ${retries} 次）；沿用${fmtTime(outcome.lastSampleAt)}的上一轮有效读数`,
          }
          continue
        }
        // 等待期间机组被停机/改状态：只补读数，不改状态；非运行态不再自动判故障
        next.units[idx] = {
          ...current,
          lastGood: { ...current.lastGood, ...outcome.readings },
          temperature: outcome.temperature,
          lastSampleAt: now,
          readError: '',
        }
        if (current.status !== '运行中') continue

        // 超限判定：只认真实成功的新读数
        const hit = this.findOverLimit(next.units[idx])
        if (hit && hit.verdict.level >= FAULT_LEVEL) {
          const open = next.hazards.find((h) => h.unitId === unitId && h.status !== '已闭环')
          if (!open) {
            // 自动进故障待处理：重复超限只记一条隐患
            next.units[idx] = {
              ...next.units[idx],
              status: '故障',
              airflow: 0,
              faultReason: `${hit.kindName} ${hit.verdict.label}：读数 ${hit.verdict.value}${hit.verdict.spec.unit}，上限 ${hit.verdict.threshold}${hit.verdict.spec.unit}（口径 ${ALARM_CALIBER_VERSION}）`,
            }
            next.hazards.push({
              id: next.seq.hazard++,
              unitId,
              unitCode: current.code,
              gasKind: hit.verdict.kind,
              gasLabel: hit.kindName,
              level: hit.verdict.level,
              levelLabel: hit.verdict.label,
              value: hit.verdict.value as number,
              threshold: hit.verdict.threshold as number,
              zone: current.zone,
              raisedAt: now,
              status: '待处理',
            })
            faultCount += 1
          }
        }
      }

      // 新一轮已经在跑：本旧轮结果整体丢弃，绝不覆盖新轮/人工数据
      if (token !== this.poll.token) return
      saveStore(next)
      this.$patch({ units: next.units, hazards: next.hazards, seq: next.seq, revision: this.revision + 1 })
      this.poll = {
        loading: false,
        token,
        lastOkAt: okCount > 0 ? now : this.poll.lastOkAt,
        summary:
          running.length === 0
            ? '当前无运行中机组需要取数'
            : `成功 ${okCount} 台，失败 ${failCount} 台${faultCount ? `，新超限进故障 ${faultCount} 台` : ''}`,
      }
    },

    findOverLimit(unit: VentUnit): { verdict: GasVerdict; kindName: string } | null {
      let worst: { verdict: GasVerdict; kindName: string } | null = null
      for (const kind of GAS_KINDS) {
        const value = unit.lastGood[kind]
        const judged = judgeGas(kind, value ?? null)
        const verdict: GasVerdict = {
          kind,
          value: value ?? null,
          level: judged.level,
          threshold: judged.threshold,
          label: judged.label,
          spec: { name: judged.spec.name, unit: judged.spec.unit, levels: judged.spec.levels },
        }
        if (judged.level >= FAULT_LEVEL && (!worst || judged.level > worst.verdict.level)) {
          worst = { verdict, kindName: judged.spec.name }
        }
      }
      return worst
    },

    verdictsOf(unit: VentUnit): GasVerdict[] {
      return GAS_KINDS.map((kind) => {
        const value = unit.lastGood[kind] ?? null
        const judged = judgeGas(kind, value)
        return {
          kind,
          value,
          level: judged.level,
          threshold: judged.threshold,
          label: judged.label,
          spec: { name: judged.spec.name, unit: judged.spec.unit, levels: judged.spec.levels },
        }
      })
    },

    // ---------- 机组操作（权限 + 乐观锁） ----------
    mutateUnit(id: number, expectedVersion: number | undefined, apply: (u: VentUnit) => Partial<VentUnit>): ServiceResult<VentUnit> {
      if (!this.account) return { ok: false, message: '未选择登录账号', reason: 'forbidden' }
      const next = snapshot()
      const idx = next.units.findIndex((u) => u.id === id)
      if (idx < 0) return { ok: false, message: `未找到机组 ${id}`, reason: 'notfound' }
      const target = next.units[idx]
      if (!canControlUnit(this.account, target.zone)) {
        return {
          ok: false,
          reason: 'forbidden',
          message: `越权拒绝：仅${target.zone}通风负责人可操作本工区机组，当前账号为「${this.account.name}」`,
        }
      }
      if (expectedVersion !== undefined && expectedVersion !== target.version) {
        return { ok: false, reason: 'conflict', message: `版本冲突：你改的是第 ${expectedVersion} 版，库里已是第 ${target.version} 版（以先改成功的那版作数）` }
      }
      const patch = apply(target)
      next.units[idx] = { ...target, ...patch, version: target.version + 1 }
      saveStore(next)
      this.$patch({ units: next.units, seq: next.seq, revision: this.revision + 1 })
      return { ok: true, data: next.units[idx], version: next.units[idx].version }
    },

    setAirflow(id: number, airflow: number, expectedVersion: number): ServiceResult<VentUnit> {
      if (!Number.isFinite(airflow) || airflow < 0) {
        return { ok: false, message: '送风量必须是不小于 0 的数字', reason: 'invalid' }
      }
      return this.mutateUnit(id, expectedVersion, () => ({ airflow: Math.round(airflow * 10) / 10 }))
    },

    changeStatus(id: number, target: UnitStatus, expectedVersion: number): ServiceResult<VentUnit> {
      return this.mutateUnit(id, expectedVersion, (u) => {
        if (target === '运行中') return { status: target, airflow: u.airflow || u.ratedAirflow }
        if (target === '已停机' || target === '待启动') return { status: target, airflow: 0 }
        return { status: target }
      })
    },

    /** 故障机组隐患闭环后，由本工区负责人复位 */
    resetFault(id: number, expectedVersion: number): ServiceResult<VentUnit> {
      const stillOpen = snapshot().hazards.some((h) => h.unitId === id && h.status !== '已闭环')
      if (stillOpen) {
        return { ok: false, message: '该机组仍有未闭环的超限隐患，需先在巡检页闭环', reason: 'invalid' }
      }
      return this.mutateUnit(id, expectedVersion, () => ({ status: '待启动', faultReason: '' }))
    },

    // ---------- 登记：重复只留最早；冲突/越权原样退回 ----------
    registerUnit(draft: UnitDraft): ServiceResult<VentUnit> {
      if (!this.account) return { ok: false, message: '未选择登录账号', reason: 'forbidden', draft }
      if (!canControlUnit(this.account, draft.zone)) {
        return { ok: false, reason: 'forbidden', draft, message: `越权拒绝：仅${draft.zone}通风负责人可登记本工区机组` }
      }
      const trimmed = draft.code.trim()
      if (!trimmed || !draft.position.trim() || draft.ductLengthM <= 0 || draft.ratedAirflow <= 0) {
        return { ok: false, reason: 'invalid', draft, message: '机组编号、安装位置、风筒长度(>0)、额定送风量(>0)为必填' }
      }
      const next = snapshot()
      const exist = next.units.find((u) => u.code === trimmed)
      if (exist) {
        // 重复登记：库里已有的（最早那条）不动，把提交原样退回去
        return {
          ok: false,
          reason: 'duplicate',
          draft,
          message: `重复登记：机组 ${trimmed} 已于 ${new Date(exist.registeredAt).toLocaleString('zh-CN')} 登记（只保留最早那条），提交内容原样退回`,
        }
      }
      const now = Date.now()
      const unit: VentUnit = {
        id: next.seq.unit++,
        code: trimmed,
        status: '待启动',
        position: draft.position.trim(),
        zone: draft.zone,
        ductLengthM: draft.ductLengthM,
        ratedAirflow: draft.ratedAirflow,
        airflow: 0,
        temperature: draft.temperature,
        operator: draft.operator.trim() || '未分配',
        lastGood: {},
        lastSampleAt: null,
        readError: '',
        faultReason: '',
        registeredAt: now,
        positionReviewed: true,
        version: 1,
        note: draft.note,
      }
      next.units.push(unit)
      saveStore(next)
      this.$patch({ units: next.units, seq: next.seq, revision: this.revision + 1 })
      return { ok: true, data: unit, version: 1 }
    },

    // ---------- 存量机组按安装位置复核 ----------
    reviewPosition(id: number, position: string, operator: string): ServiceResult<VentUnit> {
      if (!position.trim()) return { ok: false, message: '安装位置不能为空', reason: 'invalid' }
      // 复核是数据治理动作：本工区通风负责人才可确认
      if (!this.account || !canControlUnit(this.account, this.currentZone)) {
        return { ok: false, reason: 'forbidden', message: '越权拒绝：仅本工区通风负责人可确认位置复核' }
      }
      const next = snapshot()
      const idx = next.units.findIndex((u) => u.id === id)
      if (idx < 0) return { ok: false, message: '未找到机组', reason: 'notfound' }
      const u = next.units[idx]
      next.units[idx] = {
        ...u,
        position: position.trim(),
        operator: operator.trim() || u.operator,
        positionReviewed: true,
        migratedFromLegacy: false,
        note: u.migratedFromLegacy ? `已按安装位置复核（${new Date().toLocaleDateString('zh-CN')}）` : u.note,
        version: u.version + 1,
      }
      saveStore(next)
      this.$patch({ units: next.units, revision: this.revision + 1 })
      return { ok: true, data: next.units[idx], version: next.units[idx].version }
    },

    // ---------- 隐患处置：反映到巡检那边的隐患待办清单 ----------
    changeHazard(hazardId: number, status: HazardStatus, note?: string): ServiceResult<VentHazard> {
      if (!this.account || !this.account.canCloseHazard) {
        return { ok: false, reason: 'forbidden', message: `越权拒绝：当前账号「${this.account?.name ?? '未登录'}」无隐患处置权限` }
      }
      const next = snapshot()
      const idx = next.hazards.findIndex((h) => h.id === hazardId)
      if (idx < 0) return { ok: false, message: '未找到该隐患', reason: 'notfound' }
      const now = Date.now()
      const h = next.hazards[idx]
      if (status === '已处置待闭环') {
        next.hazards[idx] = { ...h, status, handledBy: this.account.name, handledAt: now, handleNote: note }
      } else {
        next.hazards[idx] = { ...h, status, closedBy: this.account.name, closedAt: now, handleNote: note ?? h.handleNote }
      }
      saveStore(next)
      this.$patch({ hazards: next.hazards, revision: this.revision + 1 })
      return { ok: true, data: next.hazards[idx], version: this.revision }
    },

    select(id: number | null) {
      this.selectedId = id
    },
  },
})
