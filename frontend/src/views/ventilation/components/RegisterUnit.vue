<template>
  <div v-if="open" class="modal-mask" @click.self="close">
    <section class="modal">
      <header class="modal-head">
        <h3>登记通风机组</h3>
        <button type="button" class="link" @click="close">✕</button>
      </header>
      <form class="modal-body" @submit.prevent="submit">
        <label>
          <span>机组编号 *</span>
          <input v-model="form.code" placeholder="如 TF-A-107（重复登记将被拒绝并原样退回）" />
        </label>
        <label>
          <span>安装位置 *</span>
          <input v-model="form.position" placeholder="如 DK16+500 左洞" />
        </label>
        <div class="form-row">
          <label>
            <span>所属工区 *</span>
            <select v-model="form.zone">
              <option>A工区</option>
              <option>B工区</option>
            </select>
          </label>
          <label>
            <span>值守人员</span>
            <input v-model="form.operator" placeholder="如 孙大力" />
          </label>
        </div>
        <div class="form-row">
          <label>
            <span>风筒长度 (m) *</span>
            <input v-model.number="form.ductLengthM" type="number" min="1" />
          </label>
          <label>
            <span>额定送风量 (m³/min) *</span>
            <input v-model.number="form.ratedAirflow" type="number" min="1" />
          </label>
        </div>
        <label>
          <span>备注</span>
          <input v-model="form.note" placeholder="选填" />
        </label>
        <p class="form-tip">同一编号重复提交只记一条（留最早登记），本次表单内容原样退回。仅本工区通风负责人可登记。</p>
        <p v-if="error" class="form-error">{{ error }}</p>
        <footer class="modal-foot">
          <button type="button" class="btn" @click="close">取消</button>
          <button type="submit" class="btn primary" :disabled="busy">{{ busy ? '提交中…' : '提交登记' }}</button>
        </footer>
      </form>
    </section>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'

import { useVentilationStore } from '../store/ventilation'
import type { UnitDraft } from '../store/types'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'done', message: string): void }>()

const store = useVentilationStore()

function blank(): UnitDraft {
  return { code: '', position: '', zone: store.currentZone, ductLengthM: 0, ratedAirflow: 0, airflow: 0, temperature: null, operator: '', note: '' }
}

const form = reactive<UnitDraft>(blank())
const error = ref('')
const busy = ref(false)

watch(
  () => props.open,
  (val) => {
    if (val) {
      Object.assign(form, blank())
      error.value = ''
    }
  },
)

function close() {
  emit('close')
}

function submit() {
  error.value = ''
  busy.value = true
  // 防重复点击：同一时刻只允许一次提交
  const result = store.registerUnit({ ...form })
  busy.value = false
  if (!result.ok) {
    // 重复/越权/无效：表单输入原样保留退回，不入库
    error.value = result.message
    return
  }
  emit('done', `机组 ${result.data.code} 登记成功，编号 id=${result.data.id}，第 ${result.version} 版`)
  close()
}
</script>

<style scoped>
.modal-mask { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal { background: #fff; border-radius: 10px; width: 520px; max-width: calc(100vw - 32px); box-shadow: 0 12px 32px rgba(15, 23, 42, 0.25); }
.modal-head { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.modal-head h3 { margin: 0; font-size: 15px; }
.modal-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
.modal-body label span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 3px; }
.modal-body input, .modal-body select { width: 100%; padding: 6px 9px; border: 1px solid var(--border); border-radius: 6px; }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.form-tip { font-size: 11px; color: var(--muted); margin: 0; }
.form-error { background: #fef2f2; color: #991b1b; border: 1px solid #fca5a5; border-radius: 6px; padding: 7px 9px; font-size: 12px; margin: 0; }
.modal-foot { display: flex; justify-content: flex-end; gap: 8px; }
</style>
