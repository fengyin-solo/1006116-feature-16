<template>
  <section class="hazard-card">
    <header class="hazard-head">
      <h3>通风超限隐患待办</h3>
      <span class="hazard-total" :class="{ danger: open.length }">未闭环 {{ open.length }} 条 · 超限机组 {{ unitIds.size }} 台</span>
    </header>
    <p class="hazard-sub">数据来自通风取数单一源（{{ caliberVersion }}），与通风运行看板为同一份数字。</p>

    <table class="hazard-table" v-if="hazards.length">
      <thead>
        <tr>
          <th>机组编号</th>
          <th>超限气体</th>
          <th>档位</th>
          <th>读数/上限</th>
          <th>上报时间</th>
          <th>状态</th>
          <th>处置</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="h in hazards" :key="h.id" :class="{ closed: h.status === '已闭环' }">
          <td>
            <button v-if="jump" type="button" class="link" @click="$emit('open-unit', h.unitId)">{{ h.unitCode }}</button>
            <span v-else>{{ h.unitCode }}</span>
          </td>
          <td>{{ h.gasLabel }}</td>
          <td><span class="level-pill" :class="'lv' + h.level">{{ h.levelLabel }}</span></td>
          <td>{{ h.value }} / {{ h.threshold }}</td>
          <td>{{ formatTime(h.raisedAt) }}</td>
          <td>
            {{ h.status }}
            <span v-if="h.handleNote" class="note" :title="h.handleNote">📝</span>
          </td>
          <td class="hazard-actions">
            <button
              v-if="h.status === '待处理'"
              type="button"
              class="btn small"
              @click="act(h.id, '已处置待闭环')"
            >标记已处置</button>
            <button
              v-if="h.status !== '已闭环'"
              type="button"
              class="btn small primary"
              @click="act(h.id, '已闭环')"
            >确认闭环</button>
            <span v-else class="closed-by">{{ h.closedBy }} · {{ formatTime(h.closedAt!) }}</span>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="hazard-empty">暂无通风超限隐患</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useVentilationStore } from '../store/ventilation'
import type { HazardStatus, VentHazard } from '../store/types'

const props = withDefaults(defineProps<{
  hazards: VentHazard[]
  openOnly?: boolean
  jump?: boolean
}>(), { openOnly: false, jump: false })

defineEmits<{ (e: 'open-unit', unitId: number): void }>()

const store = useVentilationStore()
const caliberVersion = store.caliberVersion

const hazards = computed(() =>
  props.openOnly ? props.hazards.filter((h) => h.status !== '已闭环') : props.hazards,
)
const open = computed(() => props.hazards.filter((h) => h.status !== '已闭环'))
const unitIds = computed(() => new Set(open.value.map((h) => h.unitId)))

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

function act(id: number, status: HazardStatus) {
  store.changeHazard(id, status, status === '已闭环' ? '巡检确认闭环' : '已加强通风/撤离复查')
}
</script>

<style scoped>
.hazard-card { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; }
.hazard-head { display: flex; justify-content: space-between; align-items: baseline; }
.hazard-head h3 { margin: 0; font-size: 14px; }
.hazard-total { font-size: 12px; color: var(--muted); }
.hazard-total.danger { color: #b42318; font-weight: 600; }
.hazard-sub { margin: 2px 0 8px; font-size: 11px; color: var(--muted); }
.hazard-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.hazard-table th, .hazard-table td { border: 1px solid var(--border); padding: 6px 8px; text-align: left; }
.hazard-table tr.closed { color: var(--muted); }
.hazard-table tr.closed td { background: #f8fafc; }
.level-pill { border-radius: 999px; padding: 0 8px; font-size: 11px; background: #f1f5f9; color: #475569; }
.level-pill.lv1 { background: #fef3c7; color: #92400e; }
.level-pill.lv2 { background: #fed7aa; color: #9a3412; }
.level-pill.lv3 { background: #dc2626; color: #fff; }
.note { cursor: help; }
.hazard-actions { display: flex; gap: 5px; }
.btn.small { padding: 3px 9px; font-size: 12px; }
.btn.primary { background: var(--brand); border-color: var(--brand); color: #fff; }
.closed-by { font-size: 11px; color: var(--muted); }
.hazard-empty { color: var(--muted); font-size: 12px; margin: 12px 0; }
</style>
