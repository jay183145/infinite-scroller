<template>
  <!-- 純裝飾：狀態文字由呼叫端的 live region 或可見文字提供。減少動態效果時停止旋轉。 -->
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" class="shrink-0 animate-spin motion-reduce:animate-none">
    <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" class="opacity-25" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
  </svg>
</template>
