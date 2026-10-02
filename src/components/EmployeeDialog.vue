<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Employee } from '../types/employee'
import type { EmployeeDraft } from '../data/employeeRepository'

type DialogMode = 'create' | 'edit' | 'delete' | 'position'

const props = defineProps<{
  open: boolean
  mode: DialogMode
  employee: Employee | null
  currentPosition: number
  totalPositions: number
  saving: boolean
  error: string
}>()

const emit = defineEmits<{
  close: []
  create: [employee: EmployeeDraft]
  update: [employee: EmployeeDraft]
  remove: [id: string]
  movePosition: [position: number]
}>()

const dialog = ref<HTMLDialogElement | null>(null)
const confirmUpdate = ref(false)
const draft = ref<EmployeeDraft>(emptyDraft())
const targetPosition = ref(1)

function emptyDraft(): EmployeeDraft {
  return {
    dataNumber: '',
    name: '',
    position: '',
    location: '',
    age: 30,
    dateStart: new Date().toISOString().slice(0, 10),
  }
}

function resetDraft(): void {
  draft.value = props.employee
    ? {
        dataNumber: props.employee.dataNumber,
        name: props.employee.name,
        position: props.employee.position,
        location: props.employee.location,
        age: props.employee.age,
        dateStart: props.employee.dateStart,
      }
    : emptyDraft()
}

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    resetDraft()
    confirmUpdate.value = false
    targetPosition.value = props.currentPosition
    if (dialog.value && !dialog.value.open) dialog.value.showModal()
  } else if (dialog.value?.open) {
    dialog.value.close()
  }
})

watch(() => props.employee, () => {
  if (props.open) resetDraft()
})

function submitForm(): void {
  if (props.mode === 'edit') {
    confirmUpdate.value = true
    return
  }

  emit('create', { ...draft.value })
}

function confirmEdit(): void {
  emit('update', { ...draft.value })
}

function submitPosition(): void {
  const position = Math.floor(Number(targetPosition.value))
  emit('movePosition', Math.min(props.totalPositions, Math.max(1, position || 1)))
}
</script>

<template>
  <dialog
    ref="dialog"
    aria-labelledby="employee-dialog-title"
    class="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-136 overflow-y-auto rounded-md border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-ink/35"
    @cancel.prevent="emit('close')"
  >
    <div class="border-b border-line bg-accent-soft px-5 py-4 sm:px-6">
      <h2 id="employee-dialog-title" class="text-lg font-semibold">
        {{ mode === 'create' ? '新增人員' : mode === 'edit' ? (confirmUpdate ? '確認更新' : '編輯人員') : mode === 'position' ? '調整資料位置' : '確認刪除' }}
      </h2>
    </div>

    <form v-if="(mode === 'create' || mode === 'edit') && !confirmUpdate" class="grid gap-4 px-5 py-5 sm:px-6" @submit.prevent="submitForm">
      <label class="grid gap-1.5 text-sm font-medium">
        資料編號
        <input v-model.trim="draft.dataNumber" name="dataNumber" required maxlength="32" autocomplete="off" class="rounded-md border border-line bg-surface px-3 py-2.5 font-normal outline-none focus-visible:ring-2 focus-visible:ring-accent">
      </label>
      <label class="grid gap-1.5 text-sm font-medium">
        姓名
        <input v-model.trim="draft.name" name="name" required maxlength="120" autocomplete="name" class="rounded-md border border-line bg-surface px-3 py-2.5 font-normal outline-none focus-visible:ring-2 focus-visible:ring-accent">
      </label>
      <label class="grid gap-1.5 text-sm font-medium">
        職位
        <input v-model.trim="draft.position" name="position" required maxlength="120" class="rounded-md border border-line bg-surface px-3 py-2.5 font-normal outline-none focus-visible:ring-2 focus-visible:ring-accent">
      </label>
      <label class="grid gap-1.5 text-sm font-medium">
        地點
        <input v-model.trim="draft.location" name="location" required maxlength="120" class="rounded-md border border-line bg-surface px-3 py-2.5 font-normal outline-none focus-visible:ring-2 focus-visible:ring-accent">
      </label>
      <div class="grid grid-cols-2 gap-4">
        <label class="grid gap-1.5 text-sm font-medium">
          年齡
          <input v-model.number="draft.age" name="age" type="number" min="18" max="100" step="1" required class="min-w-0 rounded-md border border-line bg-surface px-3 py-2.5 font-normal outline-none focus-visible:ring-2 focus-visible:ring-accent">
        </label>
        <label class="grid gap-1.5 text-sm font-medium">
          到職日
          <input v-model="draft.dateStart" name="dateStart" type="date" required class="min-w-0 rounded-md border border-line bg-surface px-3 py-2.5 font-normal outline-none focus-visible:ring-2 focus-visible:ring-accent">
        </label>
      </div>

      <p v-if="error" role="alert" class="text-sm text-red-700">{{ error }}</p>
      <div class="flex justify-end gap-2 border-t border-line pt-4">
        <button type="button" class="rounded-md border border-line px-4 py-2 text-sm font-medium hover:bg-canvas disabled:opacity-50" :disabled="saving" @click="emit('close')">取消</button>
        <button type="submit" class="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-[#1d6045] disabled:opacity-50" :disabled="saving">
          {{ mode === 'edit' ? '檢視更新' : saving ? '新增中…' : '新增人員' }}
        </button>
      </div>
    </form>

    <div v-else class="grid gap-4 px-5 py-5 sm:px-6">
      <template v-if="mode === 'delete'">
        <p class="text-sm leading-6 text-muted">確定刪除「<span class="font-semibold text-ink">{{ employee?.name }}</span>」？此操作無法復原。</p>
        <p v-if="error" role="alert" class="text-sm text-red-700">{{ error }}</p>
        <div class="flex justify-end gap-2 border-t border-line pt-4">
          <button type="button" class="rounded-md border border-line px-4 py-2 text-sm font-medium hover:bg-canvas disabled:opacity-50" :disabled="saving" @click="emit('close')">取消</button>
          <button type="button" class="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50" :disabled="saving" @click="employee && emit('remove', employee.id)">
            {{ saving ? '刪除中…' : '確認刪除' }}
          </button>
        </div>
      </template>

      <template v-else-if="mode === 'edit'">
        <p class="text-sm leading-6 text-muted">即將更新「<span class="font-semibold text-ink">{{ employee?.name }}</span>」的資料，請確認變更內容後再繼續。</p>
        <dl class="grid grid-cols-2 gap-x-4 gap-y-3 rounded-md bg-canvas p-4 text-sm">
          <dt class="text-muted">資料編號</dt><dd class="wrap-break-word font-medium">{{ draft.dataNumber }}</dd>
          <dt class="text-muted">姓名</dt><dd class="wrap-break-word font-medium">{{ draft.name }}</dd>
          <dt class="text-muted">職位</dt><dd class="wrap-break-word font-medium">{{ draft.position }}</dd>
          <dt class="text-muted">地點</dt><dd class="wrap-break-word font-medium">{{ draft.location }}</dd>
          <dt class="text-muted">年齡</dt><dd class="font-medium tabular-nums">{{ draft.age }}</dd>
          <dt class="text-muted">到職日</dt><dd class="font-medium tabular-nums">{{ draft.dateStart }}</dd>
        </dl>
        <p v-if="error" role="alert" class="text-sm text-red-700">{{ error }}</p>
        <div class="flex justify-end gap-2 border-t border-line pt-4">
          <button type="button" class="rounded-md border border-line px-4 py-2 text-sm font-medium hover:bg-canvas disabled:opacity-50" :disabled="saving" @click="confirmUpdate = false">返回修改</button>
          <button type="button" class="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-[#1d6045] disabled:opacity-50" :disabled="saving" @click="confirmEdit">
            {{ saving ? '更新中…' : '確認更新' }}
          </button>
        </div>
      </template>

      <form v-else class="grid gap-4" @submit.prevent="submitPosition">
        <p class="text-sm leading-6 text-muted">
          將「<span class="font-semibold text-ink">{{ employee?.name }}</span>」移至指定列號。其他資料會依序順移，不會互換。
        </p>
        <label class="grid gap-1.5 text-sm font-medium">
          目標位置（第幾筆）
          <input
            v-model.number="targetPosition"
            name="targetPosition"
            type="number"
            min="1"
            :max="totalPositions"
            step="1"
            required
            class="rounded-md border border-line bg-surface px-3 py-2.5 font-normal tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
        </label>
        <p class="text-xs text-muted">目前位於第 {{ currentPosition.toLocaleString('en-US') }} 筆，共 {{ totalPositions.toLocaleString('en-US') }} 筆。</p>
        <p v-if="error" role="alert" class="text-sm text-red-700">{{ error }}</p>
        <div class="flex justify-end gap-2 border-t border-line pt-4">
          <button type="button" class="rounded-md border border-line px-4 py-2 text-sm font-medium hover:bg-canvas disabled:opacity-50" :disabled="saving" @click="emit('close')">取消</button>
          <button type="submit" class="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-[#1d6045] disabled:opacity-50" :disabled="saving || totalPositions < 1">確認調整</button>
        </div>
      </form>
    </div>
  </dialog>
</template>