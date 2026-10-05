<template>
  <section class="page vent-page" data-module="ventilation">
    <header class="page-head">
      <div>
        <h2>通风运行看板</h2>
        <p class="page-desc">
          按待启动、运行中、已停机、故障分列盯守机组；有害气体超限自动转故障待处理，处置同步巡检隐患待办。
          阈值口径：{{ snapshot.version }} · 甲烷报警 ≥{{ limits.methane.alarm }}%（超限
          &gt;{{ limits.methane.alarm * 1.5 }}%）· CO 报警 ≥{{ limits.co.alarm }}ppm（超限
          &gt;{{ limits.co.alarm * 1.5 }}ppm）
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" :disabled="reading" @click="refreshReadings">
          {{ reading ? '取数重试中…' : '重新采集读数' }}
        </button>
        <button class="btn primary" type="button" @click="openRegister">登记机组</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">运行中机组</span>
        <strong class="stat-value">{{ snapshot.statusCounts['运行中'] }}</strong>
      </article>
      <article class="stat-card danger" :class="{ active: snapshot.gasBreachCount > 0 }">
        <span class="stat-label">有害气体超限（与巡检同源）</span>
        <strong class="stat-value">{{ snapshot.gasBreachCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">故障待处理</span>
        <strong class="stat-value">{{ snapshot.statusCounts['故障'] }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待启动 / 已停机</span>
        <strong class="stat-value">
          {{ snapshot.statusCounts['待启动'] }} / {{ snapshot.statusCounts['已停机'] }}
        </strong>
      </article>
    </div>

    <p v-if="toast" class="read-toast" :class="{ error: toastError }">{{ toast }}</p>

    <div class="view-switch">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="btn"
        :class="{ primary: viewMode === tab.key }"
        @click="viewMode = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- 温度区间分布小图：两种视图下都挂着 -->
    <section class="temp-panel">
      <h3>洞内温度区间分布（℃）</h3>
      <div class="temp-bars">
        <div v-for="bin in snapshot.tempDistribution" :key="bin.key" class="temp-bin">
          <span class="temp-count">{{ bin.count }}</span>
          <div class="temp-bar-track">
            <div class="temp-bar" :style="{ height: barHeight(bin.count) }"></div>
          </div>
          <span class="temp-label">{{ bin.label }}</span>
        </div>
      </div>
    </section>

    <!-- 分列看板 -->
    <section v-if="viewMode === 'board'" class="board">
      <div
        v-for="status in snapshot.columns"
        :key="status"
        class="board-col"
        :class="{ fault: status === '故障' }"
      >
        <header class="col-head">
          <strong>{{ status }}</strong>
          <span class="col-count">{{ unitsOf(status).length }}</span>
        </header>
        <div v-if="status === '故障'" class="col-flag">故障列置顶标红</div>
        <div class="col-body">
          <button
            v-for="unit in unitsOf(status)"
            :key="unit.id"
            type="button"
            class="unit-card"
            :class="{
              fault: status === '故障',
              stale: !unit.readOk,
              chosen: selectedId === unit.id,
            }"
            @click="openDetail(unit.id)"
          >
            <span class="card-top">
              <strong>{{ unit.code }}</strong>
              <em v-if="topLevel(unit)" class="gas-tag" :class="tagClass(unit)">{{ topLevel(unit) }}</em>
            </span>
            <span class="card-loc">{{ unit.location }}</span>
            <span class="card-metric">风筒长度：{{ unit.ductLength }} m</span>
            <span class="card-metric">送风量：{{ unit.airflow }} m³/min</span>
            <span v-if="!unit.readOk" class="stale-tag">读数失败·沿用上轮</span>
          </button>
          <p v-if="!unitsOf(status).length" class="col-empty">暂无机组</p>
        </div>
      </div>
    </section>

    <!-- 按值守人员排的值守视图 -->
    <section v-else class="keeper-view">
      <article v-for="group in snapshot.keeperGroups" :key="group.keeper" class="keeper-card">
        <header class="keeper-head">
          <strong>{{ group.keeper }}</strong>
          <span class="keeper-meta">值守 {{ group.units.length }} 台 ·
            运行 {{ group.units.filter((u) => u.status === '运行中').length }} ·
            故障 {{ group.units.filter((u) => u.status === '故障').length }}</span>
        </header>
        <div class="keeper-units">
          <button
            v-for="unit in group.units"
            :key="unit.id"
            type="button"
            class="unit-chip"
            :class="chipClass(unit)"
            @click="openDetail(unit.id)"
          >
            <span>{{ unit.code }}</span>
            <small>{{ unit.status }}</small>
          </button>
        </div>
      </article>
      <p v-if="!snapshot.keeperGroups.length" class="empty-state">暂无值守机组</p>
    </section>

    <!-- 详情面板 -->
    <div v-if="selected" class="drawer-mask" @click.self="closeDetail">
      <aside class="drawer">
        <header class="drawer-head">
          <div>
            <h3>{{ selected.code }}</h3>
            <span class="status-badge" :class="badgeClass(selected)">{{ selected.status }}</span>
          </div>
          <button type="button" class="link" @click="closeDetail">关闭</button>
        </header>

        <div v-for="breach in selected.gasBreaches" :key="breach.gas" class="breach-box">
          <strong :class="tagClass(selected)">{{ breach.level }}档超限</strong>：{{ breach.gasName }}
          浓度 {{ breach.value }}，超过上限 {{ breach.limit }}（口径 {{ snapshot.version }}），已自动转入故障待处理
        </div>

        <dl class="detail-grid">
          <dt>安装位置</dt><dd>{{ selected.location }}</dd>
          <dt>所属工区</dt><dd>{{ selected.workArea }}</dd>
          <dt>值守人员</dt><dd>{{ selected.keeper }}</dd>
          <dt>风筒长度</dt><dd>{{ selected.ductLength }} m</dd>
          <dt>洞内温度</dt><dd>{{ selected.temperature === null ? '缺测' : `${selected.temperature} ℃` }}</dd>
          <dt>甲烷 CH₄</dt>
          <dd>
            {{ selected.gasMethane === null ? '缺测' : `${selected.gasMethane} %` }}
            <small>（报警线 {{ limits.methane.alarm }}%）</small>
          </dd>
          <dt>一氧化碳</dt>
          <dd>
            {{ selected.gasCo === null ? '缺测' : `${selected.gasCo} ppm` }}
            <small>（报警线 {{ limits.co.alarm }}ppm）</small>
          </dd>
          <dt>最近读数</dt>
          <dd>
            {{ selected.checkedAt || '—' }}
            <span v-if="!selected.readOk" class="stale-tag">本轮取数失败，展示为上轮值</span>
          </dd>
        </dl>

        <div class="airflow-edit">
          <label>
            送风量（m³/min）
            <input v-model.number="airflowDraft" type="number" min="1" :disabled="!canManage(session(), selected.workArea)" />
          </label>
          <button
            type="button"
            class="btn primary"
            :disabled="!canManage(session(), selected.workArea)"
            @click="saveAirflow"
          >
            调整送风量
          </button>
          <span v-if="!canManage(session(), selected.workArea)" class="hint">仅{{ selected.workArea }}通风负责人可改，当前账号只读</span>
        </div>

        <div v-if="!resolving" class="detail-actions">
          <button type="button" class="btn" :disabled="!canManage(session(), selected.workArea)" @click="apply('start')">启动机组</button>
          <button type="button" class="btn" :disabled="!canManage(session(), selected.workArea)" @click="apply('stop')">停机检修</button>
          <button type="button" class="btn" :disabled="!canManage(session(), selected.workArea)" @click="apply('fault')">登记故障</button>
          <button
            type="button"
            class="btn primary"
            :disabled="!canManage(session(), selected.workArea) || selected.status !== '故障'"
            @click="resolving = true"
          >
            处置恢复
          </button>
        </div>

        <div v-else class="resolve-box">
          <h4>处置后复测读数</h4>
          <label>甲烷（%）<input v-model.number="resolveDraft.methane" type="number" step="0.01" min="0" /></label>
          <label>CO（ppm）<input v-model.number="resolveDraft.co" type="number" step="1" min="0" /></label>
          <label>洞内温度（℃）<input v-model.number="resolveDraft.temperature" type="number" step="0.1" /></label>
          <div class="resolve-actions">
            <button type="button" class="btn primary" @click="confirmResolve">确认处置并闭环隐患</button>
            <button type="button" class="btn ghost" @click="resolving = false">取消</button>
          </div>
        </div>
      </aside>
    </div>

    <!-- 登记机组 -->
    <div v-if="registerOpen" class="drawer-mask" @click.self="closeRegister">
      <aside class="drawer">
        <header class="drawer-head">
          <h3>登记通风机组</h3>
          <button type="button" class="link" @click="closeRegister">关闭</button>
        </header>
        <form class="register-form" @submit.prevent="submitRegister">
          <label>机组编号<input v-model="registerForm.code" placeholder="如 VENT-0107" /></label>
          <label>安装位置<input v-model="registerForm.location" placeholder="如 一工区·左洞 K2+700" /></label>
          <label>风筒长度（m）<input v-model.number="registerForm.ductLength" type="number" min="1" /></label>
          <label>送风量（m³/min）<input v-model.number="registerForm.airflow" type="number" min="1" /></label>
          <label>值守人员<input v-model="registerForm.keeper" /></label>
          <p class="hint">登记到当前账号所属工区：{{ store.account.workArea }}；重复编号只保留最早一条。</p>
          <div class="resolve-actions">
            <button type="submit" class="btn primary">提交登记</button>
            <button type="button" class="btn ghost" @click="closeRegister">取消</button>
          </div>
        </form>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'

import {
  canManage,
  getSnapshot,
  markFault,
  refreshReadings as pullReadings,
  registerUnit,
  resolveFault,
  startUnit,
  stopUnit,
  updateAirflow,
  type RegisterInput,
  type SessionLike,
  type VentSnapshot,
  type VentUnit,
} from '@/api/ventilation-service'
import { topBreach, type GasLevel } from '@/data/ventilation-model'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()

const EMPTY_SNAPSHOT: VentSnapshot = {
  version: 'v1',
  units: [],
  columns: ['故障', '待启动', '运行中', '已停机'],
  statusCounts: { 待启动: 0, 运行中: 0, 已停机: 0, 故障: 0 },
  gasBreachCount: 0,
  tempDistribution: [],
  keeperGroups: [],
  hazards: [],
  readResults: [],
  gasLimits: {
    methane: { notice: 0.5, alarm: 1.0 },
    co: { notice: 12, alarm: 24 },
  },
}

const snapshot = ref<VentSnapshot>(EMPTY_SNAPSHOT)
const viewMode = ref<'board' | 'keeper'>('board')
const tabs = [
  { key: 'board' as const, label: '运行看板' },
  { key: 'keeper' as const, label: '值守视图' },
]
const selectedId = ref<number | null>(null)
const airflowDraft = ref<number | null>(null)
const resolving = ref(false)
const resolveDraft = reactive({ methane: 0.1, co: 4, temperature: 28 })
const registerOpen = ref(false)
const registerForm = reactive<RegisterInput>({
  code: '',
  location: '',
  ductLength: 0,
  airflow: 0,
  keeper: '',
})
const toast = ref('')
const toastError = ref(false)
const reading = ref(false)

const limits = computed(() => snapshot.value.gasLimits)
const selected = computed(() =>
  selectedId.value === null ? null : snapshot.value.units.find((u) => u.id === selectedId.value) ?? null,
)

function session(): SessionLike {
  return { name: store.operator, role: store.account.role, workArea: store.account.workArea }
}

function reload() {
  snapshot.value = getSnapshot()
}

function unitsOf(status: string): VentUnit[] {
  return snapshot.value.units.filter((unit) => unit.status === status)
}

function topLevel(unit: VentUnit): GasLevel | '' {
  return unit.gasBreaches.length ? topBreach(unit.gasBreaches)!.level : ''
}

function tagClass(unit: VentUnit): string {
  const level = topLevel(unit)
  return level === '超限' ? 'over' : 'alarm'
}

function badgeClass(unit: VentUnit): string {
  if (unit.status === '故障') return 'fault-badge'
  if (unit.status === '运行中') return 'running-badge'
  return 'muted-badge'
}

function chipClass(unit: VentUnit): string {
  const map: Record<string, string> = {
    故障: 'fault',
    运行中: 'running',
    待启动: 'pending',
    已停机: 'stopped',
  }
  return map[unit.status] ?? ''
}

function barHeight(count: number): string {
  const max = Math.max(1, ...snapshot.value.tempDistribution.map((bin) => bin.count))
  return `${Math.max(6, (count / max) * 90)}px`
}

function openDetail(id: number) {
  selectedId.value = id
  const unit = snapshot.value.units.find((item) => item.id === id)
  airflowDraft.value = unit ? unit.airflow : null
  resolving.value = false
}

function closeDetail() {
  selectedId.value = null
}

function flash(message: string, error = false) {
  toast.value = message
  toastError.value = error
  if (!error) {
    window.setTimeout(() => {
      if (toast.value === message) toast.value = ''
    }, 5000)
  }
}

function apply(action: 'start' | 'stop' | 'fault') {
  if (!selected.value) return
  const runner = action === 'start' ? startUnit : action === 'stop' ? stopUnit : markFault
  const result = runner(selected.value.id, session())
  flash(result.message, !result.ok)
  if (result.ok) {
    reload()
    openDetail(selected.value.id)
  }
}

function saveAirflow() {
  if (!selected.value || airflowDraft.value === null) return
  const result = updateAirflow(selected.value.id, airflowDraft.value, session())
  flash(result.message, !result.ok)
  if (result.ok) reload()
}

function confirmResolve() {
  if (!selected.value) return
  const result = resolveFault(selected.value.id, session(), { ...resolveDraft })
  flash(result.message, !result.ok)
  if (result.ok) {
    resolving.value = false
    reload()
    if (selectedId.value !== null) openDetail(selectedId.value)
  }
}

function openRegister() {
  if (!store.isVentLead) {
    flash('当前账号只有查看权限，登记机组请使用本工区通风负责人账号', true)
    return
  }
  registerOpen.value = true
}

function closeRegister() {
  registerOpen.value = false
}

// 存不进去原样退回：失败时保留表单内容，不关闭弹层。
function submitRegister() {
  const result = registerUnit({ ...registerForm }, session())
  flash(result.message, !result.ok)
  if (result.ok) {
    registerOpen.value = false
    Object.assign(registerForm, { code: '', location: '', ductLength: 0, airflow: 0, keeper: '' })
    reload()
  }
}

function refreshReadings() {
  reading.value = true
  // 让出一帧给按钮置灰，避免“点了没反应”。
  window.setTimeout(() => {
    const outcome = pullReadings()
    reading.value = false
    reload()
    const failed = outcome.results.some((item) => !item.ok)
    flash(outcome.message, failed)
  }, 120)
}

reload()
</script>

<style scoped>
.vent-page { display: flex; flex-direction: column; gap: 12px; }
.stat-card.danger.active { border-color: #d92d20; background: #fef3f2; }
.stat-card.danger.active .stat-value { color: #d92d20; }
.read-toast {
  margin: 0; padding: 8px 12px; border-radius: 6px; font-size: 13px;
  background: #ecfdf3; color: #027a48; border: 1px solid #abefc6;
}
.read-toast.error { background: #fef3f2; color: #b42318; border-color: #fda29b; }
.view-switch { display: flex; gap: 8px; }

.temp-panel {
  background: #fff; border: 1px solid var(--border); border-radius: 8px;
  padding: 12px;
}
.temp-panel h3 { margin: 0 0 10px; font-size: 14px; }
.temp-bars { display: flex; gap: 18px; align-items: flex-end; }
.temp-bin { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 90px; }
.temp-count { font-size: 13px; font-weight: 600; }
.temp-bar-track { height: 90px; display: flex; align-items: flex-end; }
.temp-bar { width: 42px; background: var(--brand); border-radius: 4px 4px 0 0; }
.temp-label { font-size: 12px; color: var(--muted); }

.board { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.board-col {
  background: #fff; border: 1px solid var(--border); border-radius: 8px;
  display: flex; flex-direction: column; min-height: 220px;
}
.board-col.fault { border-color: #d92d20; box-shadow: 0 0 0 1px #fda29b inset; }
.col-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 14px;
}
.board-col.fault .col-head { background: #fef3f2; color: #b42318; border-radius: 8px 8px 0 0; }
.col-count {
  background: #eef2f7; border-radius: 999px; padding: 1px 9px; font-size: 12px;
}
.board-col.fault .col-count { background: #fee4e2; color: #b42318; }
.col-flag { font-size: 12px; color: #b42318; padding: 4px 10px 0; }
.col-body { padding: 8px; display: flex; flex-direction: column; gap: 8px; }
.col-empty { color: var(--muted); font-size: 12px; text-align: center; margin: 12px 0; }

.unit-card {
  text-align: left; border: 1px solid var(--border); border-radius: 8px;
  background: #fbfcfe; padding: 8px 10px; cursor: pointer; display: flex;
  flex-direction: column; gap: 3px; width: 100%; font: inherit;
}
.unit-card:hover { border-color: var(--brand); }
.unit-card.chosen { outline: 2px solid var(--brand); }
.unit-card.fault { border-color: #fda29b; background: #fef3f2; }
.card-top { display: flex; justify-content: space-between; align-items: center; }
.card-loc { font-size: 12px; color: var(--muted); }
.card-metric { font-size: 13px; }
.gas-tag {
  font-style: normal; font-size: 12px; border-radius: 4px; padding: 1px 7px;
  background: #fef0c7; color: #b54708;
}
.gas-tag.over { background: #fee4e2; color: #b42318; }
.stale-tag {
  font-size: 12px; color: #b54708; background: #fef0c7; border-radius: 4px;
  padding: 0 6px; margin-left: 4px;
}
.unit-card.stale { opacity: 0.72; }

.keeper-view { display: flex; flex-direction: column; gap: 10px; }
.keeper-card { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; }
.keeper-head { display: flex; gap: 10px; align-items: baseline; margin-bottom: 8px; }
.keeper-meta { font-size: 12px; color: var(--muted); }
.keeper-units { display: flex; flex-wrap: wrap; gap: 8px; }
.unit-chip {
  border: 1px solid var(--border); border-radius: 6px; background: #fbfcfe;
  padding: 6px 10px; cursor: pointer; display: flex; flex-direction: column;
  align-items: flex-start; gap: 2px; font: inherit;
}
.unit-chip small { color: var(--muted); font-size: 11px; }
.unit-chip.running { border-color: #abefc6; }
.unit-chip.fault { border-color: #fda29b; background: #fef3f2; }
.unit-chip.stopped { opacity: 0.7; }

.drawer-mask {
  position: fixed; inset: 0; background: rgba(16, 24, 40, 0.45);
  display: flex; justify-content: flex-end; z-index: 50;
}
.drawer {
  width: 460px; max-width: 92vw; background: #fff; height: 100%;
  padding: 16px 18px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px;
}
.drawer-head { display: flex; justify-content: space-between; align-items: center; }
.drawer-head h3 { margin: 0 0 4px; font-size: 17px; }
.status-badge { border-radius: 999px; padding: 2px 10px; font-size: 12px; }
.running-badge { background: #ecfdf3; color: #027a48; }
.fault-badge { background: #fee4e2; color: #b42318; }
.muted-badge { background: #eef2f7; color: var(--muted); }
.breach-box {
  border: 1px solid #fda29b; background: #fef3f2; color: #b42318;
  border-radius: 6px; padding: 8px 10px; font-size: 13px;
}
.breach-box .over { color: #b42318; }
.detail-grid {
  display: grid; grid-template-columns: 90px 1fr; gap: 6px 10px; margin: 0;
  font-size: 13px;
}
.detail-grid dt { color: var(--muted); }
.detail-grid dd { margin: 0; }
.airflow-edit { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.airflow-edit label { font-size: 13px; }
.airflow-edit input { width: 130px; margin-left: 6px; padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px; }
.hint { color: var(--muted); font-size: 12px; flex-basis: 100%; }
.detail-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.resolve-box { border: 1px solid var(--border); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.resolve-box h4 { margin: 0; font-size: 14px; }
.resolve-box label, .register-form label { font-size: 13px; display: flex; flex-direction: column; gap: 4px; }
.resolve-box input, .register-form input { padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; }
.resolve-actions { display: flex; gap: 8px; }
.register-form { display: flex; flex-direction: column; gap: 10px; }
</style>
