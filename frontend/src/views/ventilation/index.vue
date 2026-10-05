<template>
  <section class="page vent-page">
    <header class="page-head">
      <div>
        <h2>通风运行看板</h2>
        <p class="page-desc">
          按 待启动 / 运行中 / 已停机 / 故障 分列盯办；有害气体超限自动进故障待处理，隐患与安全巡检共用同一份取数。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="registerOpen = true">登记机组</button>
        <button class="btn" type="button" :disabled="store.poll.loading" @click="manualPoll">
          {{ store.poll.loading ? '取数中…（失败自动重试）' : '立即取数' }}
        </button>
      </div>
    </header>

    <!-- 账号切换：用于演示「仅本工区通风负责人可改送风量」 -->
    <div class="account-bar">
      <span class="account-label">当前账号</span>
      <select :value="store.account?.id" @change="onAccountChange(($event.target as HTMLSelectElement).value as RoleId)">
        <option v-for="acc in ACCOUNTS" :key="acc.id" :value="acc.id">
          {{ acc.name }}（{{ acc.role }}）
        </option>
      </select>
      <span class="poll-summary">
        {{ store.poll.summary }}
        <template v-if="store.poll.lastOkAt"> · 最近成功 {{ formatClock(store.poll.lastOkAt) }}</template>
      </span>
    </div>

    <div class="stat-row">
      <article
        v-for="item in store.stats"
        :key="item.label"
        class="stat-card"
        :class="{ 'stat-danger': item.tone === 'danger' && item.value > 0 }"
      >
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <!-- 存量机组复核提示 -->
    <div v-if="store.pendingReviewCount" class="review-banner">
      有 {{ store.pendingReviewCount }} 台存量机组未按安装位置复核（含老数据迁移记录），
      点开卡片在详情面板补录位置；风筒长度、额定送风量为 0 的也需一并核实。
    </div>

    <!-- 四列看板：故障列标红置顶 -->
    <KanbanBoard :columns="store.boardColumns" :selected-id="store.selectedId" :current-zone="store.currentZone" @select="openDetail" />

    <!-- 小图 + 值守视图 -->
    <div class="insight-row">
      <TempChart :units="store.unitsInZone" />
      <OperatorView :groups="store.byOperator" :selected-id="store.selectedId" @select="openDetail" />
    </div>

    <!-- 超限隐患：与安全巡检页同一份 -->
    <HazardList :hazards="zoneHazards" jump @open-unit="openDetail" />

    <!-- 详情面板 -->
    <Transition name="slide">
      <div v-if="drawerOpen" class="drawer-mask" @click.self="closeDetail">
        <div class="drawer">
          <UnitDetail :unit="store.selected" @close="closeDetail" />
        </div>
      </div>
    </Transition>

    <RegisterUnit :open="registerOpen" @close="registerOpen = false" @done="onRegistered" />

    <footer class="page-foot">
      <span>阈值口径：{{ store.caliberVersion }} · 二档（超上限）自动进故障 · 取数失败重试，不顶替上一轮读数</span>
      <span v-if="toast" class="toast">{{ toast }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import HazardList from './components/HazardList.vue'
import KanbanBoard from './components/KanbanBoard.vue'
import OperatorView from './components/OperatorView.vue'
import RegisterUnit from './components/RegisterUnit.vue'
import TempChart from './components/TempChart.vue'
import UnitDetail from './components/UnitDetail.vue'
import { ACCOUNTS } from './store/policy'
import { useVentilationStore } from './store/ventilation'
import type { RoleId } from './store/types'

const store = useVentilationStore()

const registerOpen = ref(false)
const drawerOpen = ref(false)
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | undefined
let pollTimer: ReturnType<typeof setInterval> | undefined

const zoneHazards = computed(() =>
  [...store.hazards].filter((h) => h.zone === store.currentZone).sort((a, b) => b.raisedAt - a.raisedAt),
)

function onAccountChange(id: RoleId) {
  store.setAccount(id)
}

function openDetail(id: number) {
  store.select(id)
  drawerOpen.value = true
}
function closeDetail() {
  drawerOpen.value = false
}

function flashToast(text: string) {
  toast.value = text
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 4000)
}

function onRegistered(message: string) {
  flashToast(message)
}

async function manualPoll() {
  await store.pollOnce()
  flashToast(store.poll.summary)
}

function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
}

onMounted(() => {
  // 进页面先取一轮，之后每 20 秒自动取；失败在 store 内重试
  void store.pollOnce()
  pollTimer = setInterval(() => void store.pollOnce(), 20000)
})

onUnmounted(() => {
  clearInterval(pollTimer)
  clearTimeout(toastTimer)
})
</script>

<style scoped>
.vent-page { display: flex; flex-direction: column; gap: 12px; }
.page-actions { display: flex; gap: 8px; }
.account-bar { display: flex; align-items: center; gap: 10px; background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 7px 12px; font-size: 13px; }
.account-label { color: var(--muted); }
.account-bar select { padding: 4px 8px; border: 1px solid var(--border); border-radius: 6px; min-width: 240px; }
.poll-summary { color: var(--muted); font-size: 12px; margin-left: auto; }
.stat-danger { border-color: #fca5a5; background: #fff7f7; }
.stat-danger .stat-value { color: #b42318; }
.review-banner { background: #fffbeb; border: 1px solid #fcd34d; color: #92400e; border-radius: 8px; padding: 8px 12px; font-size: 12px; }
.insight-row { display: grid; grid-template-columns: 1.2fr 1fr; gap: 12px; align-items: start; }
.drawer-mask { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.35); z-index: 40; display: flex; justify-content: flex-end; }
.drawer { width: 480px; max-width: 92vw; height: 100%; overflow-y: auto; background: #f6f8fb; padding: 14px; }
.slide-enter-active, .slide-leave-active { transition: opacity 0.18s; }
.slide-enter-from, .slide-leave-to { opacity: 0; }
.toast { color: #166534; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 6px; padding: 2px 10px; }
</style>
