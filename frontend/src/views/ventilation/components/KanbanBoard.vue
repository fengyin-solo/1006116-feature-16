<template>
  <div class="board">
    <section
      v-for="col in columns"
      :key="col.status"
      class="board-col"
      :class="{ 'col-fault': col.status === '故障' }"
    >
      <header class="col-head">
        <span class="col-name">
          <i v-if="col.status === '故障'" class="fault-dot" />
          {{ col.status }}
        </span>
        <span class="col-count" :class="{ danger: col.status === '故障' }">{{ col.units.length }}</span>
      </header>
      <div class="col-body">
        <button
          v-for="unit in col.units"
          :key="unit.id"
          type="button"
          class="unit-card"
          :class="{
            fault: col.status === '故障',
            selected: unit.id === selectedId,
            stale: !!unit.readError,
          }"
          @click="$emit('select', unit.id)"
        >
          <div class="card-line card-top">
            <strong>{{ unit.code }}</strong>
            <span v-if="!unit.positionReviewed" class="badge warn">待复核</span>
            <span v-else-if="unit.zone !== currentZone" class="badge">{{ unit.zone }}</span>
          </div>
          <div class="card-line">
            <span class="card-label">风筒长度</span>
            <span>{{ unit.ductLengthM ? unit.ductLengthM + ' m' : '待补录' }}</span>
          </div>
          <div class="card-line">
            <span class="card-label">送风量</span>
            <span :class="{ 'air-low': col.status === '运行中' && airflowStatus(unit.airflow, unit.ductLengthM).ok === false }">
              {{ unit.status === '运行中' || unit.status === '故障' ? unit.airflow + ' m³/min' : '停机（0）' }}
            </span>
          </div>
          <div class="card-line">
            <span class="card-label">位置</span>
            <span class="ellipsis">{{ unit.position || '未登记' }}</span>
          </div>
          <div v-if="col.status === '故障'" class="card-reason ellipsis" :title="unit.faultReason">
            {{ unit.faultReason || '故障待处理' }}
          </div>
          <div v-if="unit.readError" class="card-error ellipsis" :title="unit.readError">取数失败，沿用上一有效读数</div>
        </button>
        <p v-if="!col.units.length" class="col-empty">暂无机组</p>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { airflowStatus } from '../store/policy'
import type { UnitStatus, VentUnit } from '../store/types'

defineProps<{
  columns: { status: UnitStatus; units: VentUnit[] }[]
  selectedId: number | null
  currentZone: string
}>()

defineEmits<{ (e: 'select', id: number): void }>()
</script>

<style scoped>
.board { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; align-items: start; }
.board-col { background: #fff; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.board-col.col-fault { border-color: #dc2626; box-shadow: 0 0 0 1px #fecaca; order: -1; }
.col-head { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 14px; }
.col-fault .col-head { background: #fef2f2; color: #b42318; }
.col-count { background: #eef2f7; border-radius: 999px; padding: 0 9px; font-size: 12px; }
.col-count.danger { background: #dc2626; color: #fff; }
.fault-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #dc2626; margin-right: 5px; animation: blink 1.2s infinite; }
@keyframes blink { 50% { opacity: 0.25; } }
.col-body { display: flex; flex-direction: column; gap: 8px; padding: 10px; min-height: 90px; max-height: 520px; overflow-y: auto; }
.col-empty { color: var(--muted); font-size: 12px; text-align: center; margin: 12px 0; }
.unit-card { text-align: left; border: 1px solid var(--border); border-radius: 8px; background: #fff; padding: 8px 10px; cursor: pointer; display: flex; flex-direction: column; gap: 3px; font-size: 12px; }
.unit-card:hover { border-color: var(--brand); }
.unit-card.selected { outline: 2px solid var(--brand); }
.unit-card.fault { border-color: #fca5a5; background: #fff7f7; }
.unit-card.stale { border-style: dashed; }
.card-top { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.card-line { display: flex; justify-content: space-between; gap: 8px; }
.card-label { color: var(--muted); flex-shrink: 0; }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.badge { background: #eef2f7; border-radius: 4px; padding: 0 5px; font-size: 11px; color: var(--muted); }
.badge.warn { background: #fef3c7; color: #92400e; }
.air-low { color: #b45309; font-weight: 600; }
.card-reason { color: #b42318; margin-top: 2px; }
.card-error { color: #92400e; background: #fef3c7; border-radius: 4px; padding: 1px 5px; margin-top: 2px; }
</style>
