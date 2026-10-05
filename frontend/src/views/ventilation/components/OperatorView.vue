<template>
  <div class="op-card">
    <h3>值守视图</h3>
    <p class="op-sub">按值守人员排列 · 点击机组打开详情</p>
    <div class="op-groups">
      <section v-for="group in groups" :key="group.operator" class="op-group">
        <header class="op-head">
          <strong>{{ group.operator }}</strong>
          <span class="op-meta">
            <span>负责 {{ group.units.length }} 台</span>
            <span class="tag run">运行 {{ group.running }}</span>
            <span v-if="group.fault" class="tag fault">故障 {{ group.fault }}</span>
          </span>
        </header>
        <div class="op-units">
          <button
            v-for="unit in group.units"
            :key="unit.id"
            type="button"
            class="op-chip"
            :class="['s-' + statusKey(unit.status), { picked: unit.id === selectedId }]"
            @click="$emit('select', unit.id)"
          >
            <span class="chip-code">{{ unit.code }}</span>
            <span class="chip-pos">{{ unit.position || '位置待复核' }}</span>
            <span class="chip-air">{{ unit.status === '运行中' ? unit.airflow + ' m³/min' : unit.status }}</span>
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { VentUnit } from '../store/types'

defineProps<{
  groups: { operator: string; units: VentUnit[]; running: number; fault: number }[]
  selectedId: number | null
}>()

defineEmits<{ (e: 'select', id: number): void }>()

function statusKey(status: VentUnit['status']): string {
  return { 待启动: 'idle', 运行中: 'run', 已停机: 'off', 故障: 'fault' }[status]
}
</script>

<style scoped>
.op-card { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; }
.op-card h3 { margin: 0; font-size: 14px; }
.op-sub { margin: 2px 0 10px; font-size: 12px; color: var(--muted); }
.op-groups { display: flex; flex-direction: column; gap: 12px; max-height: 420px; overflow-y: auto; }
.op-group { border: 1px solid #e5eaf1; border-radius: 8px; padding: 8px 10px; }
.op-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 13px; }
.op-meta { display: flex; gap: 6px; align-items: center; color: var(--muted); font-size: 12px; }
.tag { border-radius: 999px; padding: 0 8px; font-size: 11px; }
.tag.run { background: #dcfce7; color: #166534; }
.tag.fault { background: #fee2e2; color: #991b1b; }
.op-units { display: flex; flex-wrap: wrap; gap: 6px; }
.op-chip { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; border: 1px solid var(--border); border-left-width: 3px; border-radius: 6px; background: #fff; padding: 5px 9px; cursor: pointer; font-size: 11px; min-width: 128px; text-align: left; }
.op-chip:hover { border-color: var(--brand); }
.op-chip.picked { outline: 2px solid var(--brand); }
.chip-code { font-weight: 600; font-size: 12px; }
.chip-pos { color: var(--muted); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.s-idle { border-left-color: #94a3b8; }
.s-run { border-left-color: #16a34a; }
.s-off { border-left-color: #64748b; }
.s-fault { border-left-color: #dc2626; background: #fff7f7; }
</style>
