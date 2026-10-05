<template>
  <div class="chart-card">
    <h3>洞内温度区间分布</h3>
    <p class="chart-sub">本工区全部机组 · 共 {{ total }} 台 · 单位 ℃</p>
    <svg class="temp-chart" :viewBox="`0 0 ${width} ${height}`" role="img" aria-label="洞内温度区间分布柱状图">
      <line :x1="pad.l" :y1="height - pad.b" :x2="width - pad.r" :y2="height - pad.b" stroke="#94a3b8" stroke-width="1" />
      <g v-for="(bin, i) in bins" :key="bin.label">
        <rect
          :x="barX(i)"
          :y="barY(bin.count)"
          :width="barW"
          :height="barH(bin.count)"
          :fill="bin.tone"
          rx="3"
        >
          <title>{{ bin.label }}℃：{{ bin.count }} 台</title>
        </rect>
        <text
          :x="barX(i) + barW / 2"
          :y="barY(bin.count) - 5"
          text-anchor="middle"
          class="bar-num"
        >{{ bin.count }}</text>
        <text
          :x="barX(i) + barW / 2"
          :y="height - pad.b + 16"
          text-anchor="middle"
          class="bar-label"
        >{{ bin.label }}</text>
      </g>
      <text :x="pad.l - 6" :y="pad.t - 4" class="bar-label">台数</text>
    </svg>
    <p v-if="unknown" class="chart-note">另有 {{ unknown }} 台暂无成功温度读数，未计入分桶</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { TEMP_BINS, tempBinIndex } from '../store/policy'
import type { VentUnit } from '../store/types'

const props = defineProps<{ units: VentUnit[] }>()

const width = 460
const height = 200
const pad = { t: 18, r: 12, b: 30, l: 28 }

const bins = computed(() => {
  const counts = TEMP_BINS.map((bin) => ({ ...bin, count: 0 }))
  for (const u of props.units) {
    const idx = tempBinIndex(u.temperature)
    if (idx >= 0) counts[idx].count += 1
  }
  return counts
})

const total = computed(() => props.units.length)
const unknown = computed(() => props.units.filter((u) => u.temperature === null).length)
const maxCount = computed(() => Math.max(1, ...bins.value.map((b) => b.count)))

const innerW = width - pad.l - pad.r
const innerH = height - pad.t - pad.b
const barW = computed(() => (innerW / bins.value.length) * 0.58)

function barX(i: number): number {
  const slot = innerW / bins.value.length
  return pad.l + slot * i + (slot - barW.value) / 2
}
function barH(count: number): number {
  return (count / maxCount.value) * innerH
}
function barY(count: number): number {
  return height - pad.b - barH(count)
}
</script>

<style scoped>
.chart-card { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; }
.chart-card h3 { margin: 0; font-size: 14px; }
.chart-sub { margin: 2px 0 8px; font-size: 12px; color: var(--muted); }
.temp-chart { width: 100%; height: auto; display: block; }
.bar-num { font-size: 12px; fill: #334155; }
.bar-label { font-size: 11px; fill: #64748b; }
.chart-note { margin: 6px 0 0; font-size: 11px; color: #92400e; }
</style>
