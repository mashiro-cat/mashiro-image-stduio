<script setup lang="ts">
import { computed } from "vue";

/**
 * 内置线性图标集（24×24 网格，stroke 着色）。
 * 不依赖任何外部图标库，保证桌面端离线可用。
 */
const ICONS: Record<string, string> = {
  home: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
  image:
    '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.6" cy="9.6" r="1.5"/><path d="m4.5 17.5 4.6-4.6 3.4 3.4L15.2 13l4.3 4.3"/>',
  images:
    '<rect x="7" y="3" width="14" height="14" rx="2.5"/><path d="M17 20.5H6a2.5 2.5 0 0 1-2.5-2.5V8"/><path d="m8.5 14 3-3 2.6 2.6L16 11.5l2.5 2.5"/>',
  wand: '<path d="m4 20 9.4-9.4"/><path d="m13.6 6.6 3.8 3.8"/><path d="M18 3v3.2M16.4 4.6h3.2M20.6 9.6v2.2M19.5 10.7h2.2"/>',
  sparkles:
    '<path d="M11.6 3.4 13 7.8l4.4 1.4L13 10.6l-1.4 4.4-1.4-4.4L5.8 9.2l4.4-1.4z"/><path d="m18.4 14.4.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9z"/>',
  layers: '<path d="m12 3.5 8 4.3-8 4.3-8-4.3z"/><path d="m4 12.4 8 4.3 8-4.3"/><path d="m4 16.6 8 4.3 8-4.3"/>',
  folder:
    '<path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h3.6l2 2.4h7.4a2 2 0 0 1 2 2v8.6a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2z"/>',
  book: '<path d="M5 5.5A2 2 0 0 1 7 3.5h12v17H7a2 2 0 0 1-2-2z"/><path d="M9 3.5v17"/><path d="M12.5 8.5h4M12.5 12h4"/>',
  compass: '<circle cx="12" cy="12" r="8.4"/><path d="m15.4 8.6-2 4.8-4.8 2 2-4.8z"/>',
  clock: '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.6V12l3.1 1.9"/>',
  history: '<path d="M3.8 12a8.2 8.2 0 1 0 2.5-5.9"/><path d="M3.8 4.4v5h5"/><path d="M12 8.2V12l3.2 1.9"/>',
  settings:
    '<path d="M4 7h7.6M17.2 7H20M4 17h2.6M11.2 17H20"/><circle cx="14.4" cy="7" r="2.3"/><circle cx="8.4" cy="17" r="2.3"/>',
  key: '<path d="M15.4 3.6a4.6 4.6 0 0 1 0 9.2 4.6 4.6 0 0 1-2.3-.6l-2.2 2.2H9.1v1.8H7.3v1.8H4.4v-2.9l6.4-6.4a4.6 4.6 0 0 1 4.6-5.1z"/><circle cx="16.6" cy="7.4" r="0.9" fill="currentColor" stroke="none"/>',
  search: '<circle cx="11" cy="11" r="6.6"/><path d="m16.2 16.2 4 4"/>',
  bell: '<path d="M6.6 9.4a5.4 5.4 0 0 1 10.8 0c0 3.9 1.5 5.4 1.5 5.4H5.1s1.5-1.5 1.5-5.4z"/><path d="M10.2 18a2 2 0 0 0 3.6 0"/>',
  "chevron-down": '<path d="m6 9.5 6 6 6-6"/>',
  "chevron-right": '<path d="m9.5 6 6 6-6 6"/>',
  "chevron-left": '<path d="m14.5 6-6 6 6 6"/>',
  "chevron-up": '<path d="m6 14.5 6-6 6 6"/>',
  "arrow-right": '<path d="M5 12h14"/><path d="m13.5 6.5 5.5 5.5-5.5 5.5"/>',
  "arrow-left": '<path d="M19 12H5"/><path d="m10.5 6.5-5.5 5.5 5.5 5.5"/>',
  "arrow-up-right": '<path d="M7 17 17 7"/><path d="M9.5 7H17v7.5"/>',
  plus: '<path d="M12 5.2v13.6M5.2 12h13.6"/>',
  minus: '<path d="M5.2 12h13.6"/>',
  check: '<path d="m5.5 12.8 4.3 4.3 9-9.4"/>',
  close: '<path d="M6.2 6.2l11.6 11.6M17.8 6.2 6.2 17.8"/>',
  copy: '<rect x="9" y="9" width="11.5" height="11.5" rx="2.4"/><path d="M15 6.6V5.4a2.4 2.4 0 0 0-2.4-2.4H5.4A2.4 2.4 0 0 0 3 5.4v7.2a2.4 2.4 0 0 0 2.4 2.4h1.2"/>',
  download: '<path d="M12 4v11"/><path d="m8 11.4 4 4 4-4"/><path d="M5 19.5h14"/>',
  upload: '<path d="M12 16.5V5"/><path d="m8 9 4-4 4 4"/><path d="M5 19.5h14"/>',
  trash: '<path d="M4.5 7h15"/><path d="M9.4 7V4.8h5.2V7"/><path d="m6.6 7 1 12.6h8.8L17.4 7"/>',
  edit: '<path d="m4.5 19.5.9-4L16.2 4.7l3.1 3.1L8.5 18.6z"/><path d="m14.6 6.3 3.1 3.1"/>',
  star: '<path d="m12 4 2.5 5.2 5.5.8-4 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4-3.9 5.5-.8z"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20.2 3.6v5.2H15"/>',
  play: '<path d="m8.5 5.5 10 6.5-10 6.5z"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 11.5 12.5"/><path d="M18.5 14v4.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.6"/>',
  info: '<circle cx="12" cy="12" r="8.4"/><path d="M12 11.2v5"/><path d="M12 7.9h.01"/>',
  alert: '<path d="M12 3.6 21 19.4H3z"/><path d="M12 9.8v4.2"/><path d="M12 16.9h.01"/>',
  loader:
    '<path d="M12 3.6v3M12 17.4v3M3.6 12h3M17.4 12h3M6.1 6.1l2.1 2.1M15.8 15.8l2.1 2.1M17.9 6.1l-2.1 2.1M8.2 15.8l-2.1 2.1"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2.2M12 19v2.2M2.8 12H5M19 12h2.2M5.5 5.5 7 7M17 17l1.5 1.5M18.5 5.5 17 7M7 17l-1.5 1.5"/>',
  moon: '<path d="M20.4 14.6A8.6 8.6 0 0 1 9.4 3.6a8.6 8.6 0 1 0 11 11z"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2.5"/><rect x="10" y="10" width="4" height="4" rx="1"/><path d="M9.5 3v3M14.5 3v3M9.5 18v3M14.5 18v3M3 9.5h3M3 14.5h3M18 9.5h3M18 14.5h3"/>',
  workflow:
    '<rect x="3.2" y="3.8" width="6.4" height="5.2" rx="1.6"/><rect x="14.4" y="15" width="6.4" height="5.2" rx="1.6"/><path d="M9.6 6.4h4a3 3 0 0 1 3 3v6"/>',
  "git-branch":
    '<circle cx="6.5" cy="6" r="2.5"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="9.5" r="2.5"/><path d="M6.5 8.5v7M9 6h3.5a3 3 0 0 1 3 3v0"/>',
  slider:
    '<path d="M4 8h6M14.5 8H20M4 16h9.5M18 16h2"/><circle cx="12.2" cy="8" r="2.2"/><circle cx="15.8" cy="16" r="2.2"/>',
  more: '<circle cx="5.6" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18.4" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
  heart:
    '<path d="M12 20.2s-7.4-4.5-7.4-9.6A4.3 4.3 0 0 1 12 7.7a4.3 4.3 0 0 1 7.4 2.9c0 5.1-7.4 9.6-7.4 9.6z"/>',
  send: '<path d="M20.6 3.4 3.4 10.6l6.9 2.5 2.5 6.9z"/><path d="m10.3 13.1 4.4-4.4"/>',
  eye: '<path d="M2.8 12S6.2 6.6 12 6.6 21.2 12 21.2 12 17.8 17.4 12 17.4 2.8 12 2.8 12z"/><circle cx="12" cy="12" r="2.6"/>',
  "eye-off":
    '<path d="M4 4.5 20 19.5"/><path d="M9.6 7A9.5 9.5 0 0 1 12 6.6c5.8 0 9.2 5.4 9.2 5.4a15 15 0 0 1-2.6 3.2"/><path d="M6.6 8.8A14.6 14.6 0 0 0 2.8 12s3.4 5.4 9.2 5.4a9 9 0 0 0 3.4-.6"/><path d="M9.9 10.3a2.6 2.6 0 0 0 3.6 3.6"/>',
  link: '<path d="M10.2 13.8a4 4 0 0 1 0-5.7l1.4-1.4a4 4 0 0 1 5.7 5.7l-.8.8"/><path d="M13.8 10.2a4 4 0 0 1 0 5.7l-1.4 1.4a4 4 0 0 1-5.7-5.7l.8-.8"/>',
  grid: '<rect x="3.8" y="3.8" width="7" height="7" rx="1.8"/><rect x="13.2" y="3.8" width="7" height="7" rx="1.8"/><rect x="3.8" y="13.2" width="7" height="7" rx="1.8"/><rect x="13.2" y="13.2" width="7" height="7" rx="1.8"/>',
  list: '<path d="M4 6.5h3M4 12h3M4 17.5h3M10 6.5h10M10 12h10M10 17.5h10"/>',
  filter: '<path d="M4 6h16l-6.2 7.3V19l-3.6-1.9v-3.8z"/>',
  bookmark: '<path d="M6.4 4h11.2v17l-5.6-3.9L6.4 21z"/>',
  zap: '<path d="M13.2 3 5.4 13.4h4.9L10.4 21l7.8-10.4h-4.9z"/>',
  crop: '<path d="M7 3v13.2a1 1 0 0 0 1 1h13.2"/><path d="M3 7h13.2a1 1 0 0 1 1 1V21"/>',
  "image-plus":
    '<path d="M20.5 12.6V6.4a2.4 2.4 0 0 0-2.4-2.4H5.9a2.4 2.4 0 0 0-2.4 2.4v11.2a2.4 2.4 0 0 0 2.4 2.4h6.4"/><circle cx="9" cy="9.6" r="1.4"/><path d="m3.5 17 4.2-4.2 3.1 3.1 2.6-2.6 2.8 2.8"/><path d="M17.5 15.6v6M14.5 18.6h6"/>',
  "folder-open":
    '<path d="M4 8.4V6.6a1.8 1.8 0 0 1 1.8-1.8h3.4l1.8 2.2h6.2a1.8 1.8 0 0 1 1.8 1.8v1.4"/><path d="m4 8.4 2.2 9.4a1.6 1.6 0 0 0 1.6 1.2h11a1.6 1.6 0 0 0 1.6-1.2l1.6-9.4z"/>',
  tag: '<path d="M4.6 6.4A2.4 2.4 0 0 1 7 4h4.6l7.8 7.8a2 2 0 0 1 0 2.8l-4.8 4.8a2 2 0 0 1-2.8 0L4 11.6z"/><circle cx="8.6" cy="8.6" r="1.4"/>',
  square: '<rect x="4" y="4" width="16" height="16" rx="2.8"/>',
  "check-square":
    '<rect x="4" y="4" width="16" height="16" rx="2.8"/><path d="m8.2 12.2 2.6 2.6 5-5.4"/>',
  lightbulb: '<path d="M9.4 18.4h5.2M10.4 21h3.2"/><path d="M12 3.2a6.2 6.2 0 0 1 3.6 11.2v4H8.4v-4A6.2 6.2 0 0 1 12 3.2z"/>',
  palette:
    '<path d="M12 3.6a8.4 8.4 0 0 0 0 16.8c1.6 0 2.2-1.1 1.4-2.2-.7-1 .1-2.3 1.4-2.3h1.7a4.9 4.9 0 0 0 4.9-4.9c0-4.4-4.2-7.4-9.4-7.4z"/><circle cx="8.4" cy="10.4" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="7.6" r="1.1" fill="currentColor" stroke="none"/><circle cx="15.6" cy="10.4" r="1.1" fill="currentColor" stroke="none"/>',
  lock: '<rect x="4.8" y="10.6" width="14.4" height="9.6" rx="2.4"/><path d="M8.2 10.6V8.2a3.8 3.8 0 0 1 7.6 0v2.4"/>',
  maximize:
    '<path d="M9.4 4H5.4A1.4 1.4 0 0 0 4 5.4v4M14.6 4h4A1.4 1.4 0 0 1 20 5.4v4M9.4 20h-4A1.4 1.4 0 0 1 4 18.6v-4M14.6 20h4a1.4 1.4 0 0 0 1.4-1.4v-4"/>',
  minimize: '<path d="M6 17h12"/>',
  restore:
    '<path d="M6.2 9.6h7.2a1.6 1.6 0 0 1 1.6 1.6v7.2a1.6 1.6 0 0 1-1.6 1.6H6.2a1.6 1.6 0 0 1-1.6-1.6v-7.2a1.6 1.6 0 0 1 1.6-1.6z"/><path d="M9.8 6.4h7.6a1.6 1.6 0 0 1 1.6 1.6v7.6"/>',
  type: '<path d="M4.6 6.4h14.8M12 6.4v13.2M9 19.6h6"/>',
  "text-align": '<path d="M4 6.5h16M4 12h11M4 17.5h16"/>',
  brain:
    '<path d="M9.6 4.6a3 3 0 0 0-3 3 2.6 2.6 0 0 0-1.4 4.6 3 3 0 0 0 1.6 5.1 2.8 2.8 0 0 0 5-1.6V6.4a2.8 2.8 0 0 0-2.2-1.8z"/><path d="M14.4 4.6a3 3 0 0 1 3 3 2.6 2.6 0 0 1 1.4 4.6 3 3 0 0 1-1.6 5.1 2.8 2.8 0 0 1-5-1.6"/>',
  cloud: '<path d="M7.2 18.4h10a3.9 3.9 0 0 0 .5-7.8A5.6 5.6 0 0 0 7 9.4a4.5 4.5 0 0 0 .2 9z"/>',
  "file-json":
    '<path d="M13.4 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9.1z"/><path d="M13.4 3.5v5.6H19"/><path d="M10 13.4c-.9 0-1.2.5-1.2 1.2v3.6M14 13.4c.9 0 1.2.5 1.2 1.2v3.6"/>',
  database:
    '<ellipse cx="12" cy="6.4" rx="7.4" ry="3"/><path d="M4.6 6.4v11.2c0 1.7 3.3 3 7.4 3s7.4-1.3 7.4-3V6.4"/><path d="M4.6 12c0 1.7 3.3 3 7.4 3s7.4-1.3 7.4-3"/>',
  "more-vertical":
    '<circle cx="12" cy="5.8" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="18.2" r="1.5" fill="currentColor" stroke="none"/>',
  "panel-left": '<rect x="3.4" y="4.4" width="17.2" height="15.2" rx="2.6"/><path d="M9.6 4.4v15.2"/>',
  "aspect-ratio": '<rect x="3.6" y="5.4" width="16.8" height="13.2" rx="2.4"/><path d="M8 9.6h3.2M8 9.6v3.2M16 14.4h-3.2M16 14.4v-3.2"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><path d="m6.5 6.5 2.6 2.6M14.9 14.9l2.6 2.6M17.5 6.5l-2.6 2.6M9.1 14.9l-2.6 2.6"/>',
  bug: '<rect x="7.6" y="7.6" width="8.8" height="11" rx="4.4"/><path d="M7.6 11.4H4.4M7.6 15.2H4.4M16.4 11.4h3.2M16.4 15.2h3.2M8.8 18.4l-2.3 2M15.2 18.4l2.3 2M9.4 7.6 7.9 4.9M14.6 7.6l1.5-2.7"/>',
  plug: '<path d="M9 3.2v4.6M15 3.2v4.6"/><path d="M6.6 7.8h10.8v3.4a5.4 5.4 0 0 1-10.8 0z"/><path d="M12 16.6v4.2"/>',
  power: '<path d="M12 3.4v7.8"/><path d="M7.1 6.6a7.4 7.4 0 1 0 9.8 0"/>',
  terminal:
    '<rect x="3.4" y="4.4" width="17.2" height="15.2" rx="2.4"/><path d="m7.6 9.8 2.6 2.4-2.6 2.4"/><path d="M12.6 14.8h4"/>',
  server:
    '<rect x="3.6" y="4.2" width="16.8" height="6.2" rx="2"/><rect x="3.6" y="13.6" width="16.8" height="6.2" rx="2"/><path d="M7.2 7.3h.01M7.2 16.7h.01"/>',
  code: '<path d="m8.8 8.2-4.2 3.8 4.2 3.8"/><path d="m15.2 8.2 4.2 3.8-4.2 3.8"/>',
  github:
    '<path fill="currentColor" stroke="none" d="M12 2.2a9.8 9.8 0 0 0-3.1 19.1c.5.1.7-.2.7-.5v-1.8c-2.7.6-3.3-1.2-3.3-1.2-.4-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.3-4.5-1.1-4.5-4.9 0-1.1.4-2 1-2.7-.1-.2-.4-1.2.1-2.5 0 0 .8-.3 2.7 1a9.3 9.3 0 0 1 4.9 0c1.9-1.3 2.7-1 2.7-1 .5 1.3.2 2.3.1 2.5.6.7 1 1.6 1 2.7 0 3.8-2.3 4.6-4.5 4.9.4.3.7 1 .7 1.9v2.8c0 .3.2.6.7.5A9.8 9.8 0 0 0 12 2.2z"/>',
};

const props = withDefaults(
  defineProps<{
    name: string;
    size?: number | string;
    strokeWidth?: number;
  }>(),
  { size: 18, strokeWidth: 1.75 },
);

const inner = computed(() => ICONS[props.name] ?? ICONS.info);
</script>

<template>
  <svg
    class="ui-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="inner"
  />
</template>

<style scoped>
.ui-icon {
  flex: none;
  display: block;
}
</style>
