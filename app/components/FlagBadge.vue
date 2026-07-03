<script setup lang="ts">
import { flagEmoji } from '~/utils/format'

const props = defineProps<{
  code?: string | null
  name?: string | null
  size?: 'sm' | 'md'
}>()
</script>

<template>
  <span class="inline-flex items-center gap-2 min-w-0">
    <span
      v-if="flagEmoji(props.code)"
      class="leading-none select-none"
      :class="props.size === 'sm' ? 'text-base' : 'text-lg'"
    >{{ flagEmoji(props.code) }}</span>
    <span
      v-else
      class="inline-block rounded-sm bg-white/10 text-zinc-400 font-mono text-[10px] px-1 leading-4"
    >{{ (props.code || '??').toUpperCase() }}</span>
    <span class="truncate text-zinc-200">{{ props.name || '—' }}</span>
  </span>
</template>
