<template>
  <section class="page" data-module="safety">
    <header class="page-head">
      <div>
        <h2>安全巡检管理</h2>
        <p class="page-desc">维护巡检记录，围绕巡检编号、巡检区域、巡检项目、发现问题做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记巡检记录</button>
        <button class="btn" type="button" @click="exportRows">导出安全巡检清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无安全巡检数据，可先登记巡检记录</td>
        </tr>
      </tbody>
    </table>

    <div class="vent-sync">
      <HazardList :hazards="ventHazards" />
      <p class="sync-note">
        超限机组数 <strong>{{ overLimitCount }}</strong> 台，与
        <RouterLink to="/ventilation" class="link">通风运行看板</RouterLink>
        读的是同一份取数（store revision {{ ventStore.revision }}），不会出现两套数字。
      </p>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条安全巡检记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import HazardList from '@/views/ventilation/components/HazardList.vue'
import { useVentilationStore } from '@/views/ventilation/store/ventilation'

const meta = moduleMeta('safety')
const columns = ["巡检编号", "巡检区域", "巡检项目", "发现问题", "隐患等级", "整改期限", "巡检人员", "巡检状态"]
const actions = ["提交巡检", "派发整改", "确认闭环"]
const statuses = ["待巡检", "已巡检", "待整改", "已闭环"]
const stats = [{"label": "待巡检区域", "value": 0}, {"label": "待整改隐患", "value": 0}, {"label": "已闭环隐患", "value": 0}]

// 通风超限隐患待办：与通风看板是同一个 Pinia store、同一份取数
const ventStore = useVentilationStore()
const ventHazards = computed(() =>
  [...ventStore.hazards].filter((h) => h.zone === ventStore.currentZone).sort((a, b) => b.raisedAt - a.raisedAt),
)
const overLimitCount = computed(() => ventStore.overLimitUnitIds.size)

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '巡检记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '安全巡检列表读取失败'
  }
}

onMounted(() => {
  reload()
  // 从这边进页面也能触发同一套取数：与看板共用，超限数一致
  if (!ventStore.poll.lastOkAt) void ventStore.pollOnce()
})
</script>

<style scoped>
.vent-sync { margin-top: 16px; display: flex; flex-direction: column; gap: 6px; }
.sync-note { margin: 0; font-size: 12px; color: var(--muted); }
.sync-note strong { color: #b42318; }
</style>
