<template>
  <aside v-if="unit" class="detail" :class="{ fault: unit.status === '故障' }">
    <header class="detail-head">
      <div>
        <h3>{{ unit.code }}</h3>
        <p class="detail-status">
          <span class="status-pill" :class="pillClass">{{ unit.status }}</span>
          <span v-if="!unit.positionReviewed" class="badge warn">安装位置待复核</span>
          <span v-if="unit.migratedFromLegacy" class="badge legacy">老数据迁移</span>
        </p>
      </div>
      <button type="button" class="link" @click="$emit('close')">关闭 ✕</button>
    </header>

    <!-- 故障超限：置顶显示是哪一档 -->
    <div v-if="unit.status === '故障'" class="alarm-box">
      <p class="alarm-title">有害气体超限 · 自动进故障待处理</p>
      <p class="alarm-reason">{{ unit.faultReason || '见下方气体读数' }}</p>
      <p class="alarm-hint">处置请前往「安全巡检」页的通风超限隐患待办，闭环后可在此复位。</p>
    </div>

    <dl class="detail-grid">
      <div><dt>安装位置</dt><dd>{{ unit.position || '未登记' }}</dd></div>
      <div><dt>所属工区</dt><dd>{{ unit.zone }}</dd></div>
      <div><dt>风筒长度</dt><dd>{{ unit.ductLengthM ? unit.ductLengthM + ' m' : '待补录' }}</dd></div>
      <div><dt>额定送风量</dt><dd>{{ unit.ratedAirflow || '—' }} m³/min</dd></div>
      <div><dt>洞内温度</dt><dd>{{ unit.temperature === null ? '暂无读数' : unit.temperature + ' ℃' }}</dd></div>
      <div><dt>值守人员</dt><dd>{{ unit.operator }}</dd></div>
      <div><dt>首次登记</dt><dd>{{ formatDate(unit.registeredAt) }}</dd></div>
      <div><dt>数据版本</dt><dd>第 {{ unit.version }} 版</dd></div>
    </dl>

    <!-- 气体读数与档位 -->
    <section class="gas-block">
      <h4>有害气体读数与档位</h4>
      <p class="read-time">
        最近成功取数：{{ formatTime(unit.lastSampleAt) }}
        <span class="caliber">阈值口径 {{ caliberVersion }}</span>
      </p>
      <div v-if="unit.readError" class="read-error">
        本轮取数失败：{{ unit.readError }}。未用上一读数顶替，判定仍基于最近一次成功读数。
      </div>
      <table class="gas-table">
        <thead>
          <tr><th>气体</th><th>读数</th><th>档位</th><th>触发阈值</th></tr>
        </thead>
        <tbody>
          <tr v-for="v in verdicts" :key="v.kind" :class="rowClass(v.level)">
            <td>{{ gasName(v.kind) }}</td>
            <td>{{ v.value === null ? '—' : v.value + ' ' + gasUnit(v.kind) }}</td>
            <td>
              <span class="level-pill" :class="'lv' + v.level">{{ v.label }}</span>
            </td>
            <td>{{ v.threshold === null ? '—' : '≥ ' + v.threshold + ' ' + gasUnit(v.kind) }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 送风量：仅本工区通风负责人可改 -->
    <section class="airflow-block">
      <h4>送风量设定</h4>
      <p class="air-hint" :class="{ bad: !airflowAdvice.ok }">{{ airflowAdvice.text }}</p>
      <form v-if="canControl" class="air-form" @submit.prevent="submitAirflow">
        <input v-model.number="airflowDraft" type="number" min="0" step="0.1" />
        <span class="unit-text">m³/min</span>
        <button class="btn primary small" type="submit" :disabled="submitting">保存</button>
      </form>
      <p v-else class="readonly-hint">
        当前账号「{{ accountName }}」仅可查看；仅{{ unit.zone }}通风负责人可修改送风量。
      </p>
    </section>

    <!-- 运行操作 -->
    <section class="action-block">
      <h4>运行操作</h4>
      <div class="action-row">
        <template v-if="canControl">
          <button class="btn small" type="button" :disabled="unit.status === '待启动'" @click="doChange('待启动')">置待启动</button>
          <button class="btn small" type="button" :disabled="unit.status === '运行中'" @click="doChange('运行中')">启动机组</button>
          <button class="btn small" type="button" :disabled="unit.status === '已停机' || unit.status === '故障'" @click="doChange('已停机')">停机</button>
          <button class="btn small danger" type="button" :disabled="unit.status === '故障'" @click="doChange('故障')">登记故障</button>
          <button v-if="unit.status === '故障'" class="btn small" type="button" @click="doReset">故障复位</button>
        </template>
        <p v-else class="readonly-hint">状态操作同样仅限本工区通风负责人。</p>
      </div>
    </section>

    <!-- 存量机组位置复核 -->
    <section v-if="!unit.positionReviewed" class="review-block">
      <h4>存量机组位置复核</h4>
      <form class="review-form" @submit.prevent="submitReview">
        <label>
          <span>安装位置（里程/部位）</span>
          <input v-model="positionDraft" placeholder="如 DK15+480 右洞" />
        </label>
        <label>
          <span>值守人员</span>
          <input v-model="operatorDraft" placeholder="如 孙大力" />
        </label>
        <button class="btn primary small" type="submit">复核确认</button>
        <p v-if="!canControl" class="readonly-hint">复核需本工区通风负责人账号。</p>
      </form>
    </section>

    <p v-if="message" class="detail-msg" :class="messageTone">{{ message }}</p>
  </aside>

  <aside v-else class="detail empty">
    <p>点击看板或值守视图中的机组，查看详情并处置。</p>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { GAS_SPECS, airflowStatus } from '../store/policy'
import { useVentilationStore } from '../store/ventilation'
import type { GasLevel, UnitStatus, VentUnit } from '../store/types'

const props = defineProps<{ unit: VentUnit | null }>()
defineEmits<{ (e: 'close'): void }>()

const store = useVentilationStore()

const airflowDraft = ref(0)
const positionDraft = ref('')
const operatorDraft = ref('')
const message = ref('')
const messageTone = ref('')
const submitting = ref(false)

const verdicts = computed(() => (props.unit ? store.verdictsOf(props.unit) : []))
const canControl = computed(() => (props.unit ? store.canControl(props.unit) : false))
const accountName = computed(() => store.account?.name ?? '未登录')
const caliberVersion = store.caliberVersion

const airflowAdvice = computed(() =>
  props.unit ? airflowStatus(props.unit.airflow, props.unit.ductLengthM) : { ok: true, text: '' },
)

const pillClass = computed(() => ({
  待启动: 'pill-idle',
  运行中: 'pill-run',
  已停机: 'pill-off',
  故障: 'pill-fault',
}[props.unit?.status ?? '待启动']))

watch(
  () => props.unit?.id,
  () => {
    message.value = ''
    if (props.unit) {
      airflowDraft.value = props.unit.airflow
      positionDraft.value = props.unit.position
      operatorDraft.value = props.unit.operator
    }
  },
  { immediate: true },
)

function gasName(kind: keyof typeof GAS_SPECS): string {
  return GAS_SPECS[kind].name
}
function gasUnit(kind: keyof typeof GAS_SPECS): string {
  return GAS_SPECS[kind].unit
}
function rowClass(level: GasLevel): string {
  return level >= 2 ? 'gas-danger' : level === 1 ? 'gas-warn' : ''
}
function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('zh-CN')
}
function formatTime(ts: number | null): string {
  if (!ts) return '尚无成功读数'
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
}

function flash(text: string, ok: boolean) {
  message.value = text
  messageTone.value = ok ? 'ok' : 'bad'
}

function submitAirflow() {
  if (!props.unit) return
  const result = store.setAirflow(props.unit.id, Number(airflowDraft.value), props.unit.version)
  if (!result.ok) {
    if (result.reason === 'conflict') airflowDraft.value = store.selected?.airflow ?? airflowDraft.value
    flash(result.message, false)
    return
  }
  flash(`送风量已更新为 ${result.data.airflow} m³/min（第 ${result.version} 版）`, true)
}

function doChange(target: UnitStatus) {
  if (!props.unit) return
  const result = store.changeStatus(props.unit.id, target, props.unit.version)
  flash(result.ok ? `已操作：当前「${result.data.status}」（第 ${result.version} 版）` : result.message, result.ok)
}

function doReset() {
  if (!props.unit) return
  const result = store.resetFault(props.unit.id, props.unit.version)
  flash(result.ok ? '故障已复位为待启动' : result.message, result.ok)
}

function submitReview() {
  if (!props.unit) return
  const result = store.reviewPosition(props.unit.id, positionDraft.value, operatorDraft.value)
  flash(result.ok ? '位置复核已确认' : result.message, result.ok)
}
</script>

<style scoped>
.detail { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
.detail.fault { border-color: #dc2626; }
.detail.empty { color: var(--muted); font-size: 13px; align-items: center; justify-content: center; min-height: 200px; text-align: center; }
.detail-head { display: flex; justify-content: space-between; align-items: flex-start; }
.detail-head h3 { margin: 0; font-size: 16px; }
.detail-status { margin: 6px 0 0; display: flex; gap: 6px; align-items: center; }
.status-pill { border-radius: 999px; padding: 1px 10px; font-size: 12px; }
.pill-idle { background: #e2e8f0; color: #475569; }
.pill-run { background: #dcfce7; color: #166534; }
.pill-off { background: #f1f5f9; color: #475569; }
.pill-fault { background: #fee2e2; color: #991b1b; }
.badge { border-radius: 4px; padding: 0 6px; font-size: 11px; }
.badge.warn { background: #fef3c7; color: #92400e; }
.badge.legacy { background: #e0e7ff; color: #3730a3; }
.alarm-box { background: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px; padding: 10px; }
.alarm-title { margin: 0; font-weight: 700; color: #b42318; font-size: 13px; }
.alarm-reason { margin: 4px 0; color: #991b1b; font-size: 12px; }
.alarm-hint { margin: 0; color: #7f1d1d; font-size: 11px; }
.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; margin: 0; }
.detail-grid dt { font-size: 11px; color: var(--muted); }
.detail-grid dd { margin: 0; font-size: 13px; }
h4 { margin: 0 0 6px; font-size: 13px; }
.read-time { margin: 0 0 6px; font-size: 11px; color: var(--muted); }
.caliber { margin-left: 8px; background: #eef2ff; color: #3730a3; border-radius: 4px; padding: 0 5px; }
.read-error { background: #fef3c7; color: #92400e; border-radius: 6px; padding: 6px 8px; font-size: 12px; margin-bottom: 6px; }
.gas-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.gas-table th, .gas-table td { border: 1px solid var(--border); padding: 4px 7px; text-align: left; }
.gas-table tr.gas-warn td { background: #fffbeb; }
.gas-table tr.gas-danger td { background: #fef2f2; font-weight: 600; }
.level-pill { border-radius: 999px; padding: 0 8px; font-size: 11px; background: #f1f5f9; color: #475569; }
.level-pill.lv1 { background: #fef3c7; color: #92400e; }
.level-pill.lv2 { background: #fed7aa; color: #9a3412; }
.level-pill.lv3 { background: #dc2626; color: #fff; }
.air-hint { margin: 0 0 6px; font-size: 12px; color: #166534; }
.air-hint.bad { color: #b45309; }
.air-form { display: flex; align-items: center; gap: 6px; }
.air-form input { width: 110px; padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px; }
.unit-text { font-size: 12px; color: var(--muted); }
.btn.small { padding: 4px 10px; font-size: 12px; }
.btn.danger { color: #b42318; border-color: #fca5a5; }
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.readonly-hint { margin: 0; font-size: 12px; color: var(--muted); }
.action-row { display: flex; flex-wrap: wrap; gap: 6px; }
.review-block { background: #f8fafc; border: 1px dashed var(--border); border-radius: 8px; padding: 10px; }
.review-form { display: flex; flex-direction: column; gap: 6px; }
.review-form label span { display: block; font-size: 11px; color: var(--muted); }
.review-form input { padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px; }
.detail-msg { margin: 0; font-size: 12px; padding: 6px 8px; border-radius: 6px; }
.detail-msg.ok { background: #ecfdf5; color: #065f46; }
.detail-msg.bad { background: #fef2f2; color: #991b1b; }
</style>
