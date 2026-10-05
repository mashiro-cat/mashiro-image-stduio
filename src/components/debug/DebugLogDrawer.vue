<script setup lang="ts">
import { computed, watch } from "vue";
import type { DebugLogEntry } from "../../types";
import { useDebugLogStore } from "../../stores/debugLog";
import { useUiStore } from "../../stores/ui";
import { useSettingsStore } from "../../stores/settings";
import { copyText, formatTime } from "../../platform/env";
import { t } from "../../i18n";
import UiDrawer from "../ui/UiDrawer.vue";
import UiIcon from "../ui/UiIcon.vue";
import UiSwitch from "../ui/UiSwitch.vue";

const log = useDebugLogStore();
const ui = useUiStore();
const settings = useSettingsStore();

const open = computed({
  get: () => ui.debugDrawerOpen,
  set: (value: boolean) => (value ? ui.openDebugDrawer() : ui.closeDebugDrawer()),
});

/** 抽屉内直接开关，避免用户只能到设置页操作 */
const debugEnabled = computed({
  get: () => settings.state.debug.enabled,
  set: (value: boolean) => {
    settings.state.debug.enabled = value;
    // 立刻同步到平台层，不依赖全局 watcher，确保「打开即生效」
    log.syncRuntime();
    if (value) {
      ui.success(t("debug.toast.modeOn"), t("debug.toast.modeOnDesc"));
    } else {
      ui.info(t("debug.toast.modeOff"), t("debug.toast.modeOffDesc"));
    }
  },
});

const subtitle = computed(() => {
  const params = { total: log.entries.length, errors: log.errorCount };
  return log.enabled ? t("debug.subtitleVerbose", params) : t("debug.subtitleBasic", params);
});

/** 打开抽屉时刷新平台层状态，便于发现「设置已开但请求层未生效」 */
watch(open, (value) => {
  if (value) log.refreshRuntimeState();
});

function statusClass(entry: DebugLogEntry) {
  if (entry.status === 0) return "is-net";
  if (entry.ok) return "is-ok";
  if (entry.status >= 500) return "is-5xx";
  if (entry.status >= 400) return "is-4xx";
  return "is-warn";
}

function headerRows(record?: Record<string, string>) {
  return Object.entries(record ?? {});
}

async function copyEntry(entry: DebugLogEntry) {
  const ok = await copyText(JSON.stringify(entry, null, 2));
  if (ok) ui.success(t("debug.toast.entryCopied"));
  else ui.warning(t("common.copyFailed"));
}

async function copySection(text: string) {
  const ok = await copyText(text);
  if (ok) ui.success(t("common.copied"));
  else ui.warning(t("common.copyFailed"));
}

function exportLogs() {
  const blob = new Blob([log.exportJson()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `mashiro-debug-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  ui.success(t("debug.toast.exported"), t("debug.toast.exportedDesc", { count: log.entries.length }));
}

async function clearLogs() {
  const ok = await ui.confirm({
    title: t("debug.confirm.clearTitle"),
    message: t("debug.confirm.clearMessage"),
    confirmText: t("debug.confirm.clearConfirm"),
    tone: "danger",
  });
  if (!ok) return;
  log.clear();
  ui.success(t("debug.toast.cleared"));
}
</script>

<template>
  <UiDrawer v-model:open="open" :width="860" :title="t('debug.title')" :subtitle="subtitle">
    <div class="toolbar">
      <div class="search-box">
        <UiIcon name="search" :size="15" />
        <input
          v-model="log.keyword"
          class="search-field"
          :placeholder="t('debug.toolbar.searchPlaceholder')"
        />
        <button
          v-if="log.keyword"
          class="icon-btn"
          :title="t('debug.toolbar.clearSearch')"
          @click="log.keyword = ''"
        >
          <UiIcon name="close" :size="14" />
        </button>
      </div>
      <button
        class="tag tag-clickable"
        :class="{ 'tag-active': log.onlyErrors }"
        @click="log.onlyErrors = !log.onlyErrors"
      >
        <UiIcon name="alert" :size="11" />{{ t('debug.toolbar.onlyErrors') }}
      </button>
      <button class="btn btn-sm" :disabled="!log.entries.length" @click="exportLogs">
        <UiIcon name="download" :size="14" />{{ t('debug.action.export') }}
      </button>
      <button class="btn btn-sm btn-danger" :disabled="!log.entries.length" @click="clearLogs">
        <UiIcon name="trash" :size="14" />{{ t('debug.action.clear') }}
      </button>
    </div>

    <div class="debug-toggle" :class="{ 'is-on': log.enabled }">
      <span class="toggle-icon"><UiIcon name="bug" :size="16" /></span>
      <span class="toggle-text grow">
        <!-- 词条是「调试模式」+「已开启 / 未开启」两段，英文要靠中间的空格分开，
             中文多一个空格也不影响阅读，因此不再为「拼接」单独造 key -->
        <span class="toggle-title">
          {{ t('debug.mode.label') }} {{ log.enabled ? t('debug.mode.on') : t('debug.mode.off') }}
          <span v-if="log.enabled && !log.platformEnabled" class="tag tag-danger">
            {{ t('debug.mode.notApplied') }}
          </span>
        </span>
        <span class="toggle-sub">
          <template v-if="log.enabled">{{ t('debug.mode.descOn') }}</template>
          <template v-else>{{ t('debug.mode.descOff') }}</template>
        </span>
        <span v-if="log.enabled && !log.platformEnabled" class="toggle-warn">
          {{ t('debug.mode.mismatch') }}
        </span>
      </span>
      <UiSwitch v-model="debugEnabled" :aria-label="t('debug.mode.label')" />
    </div>

    <div v-if="log.filtered.length" class="list">
      <article
        v-for="entry in log.filtered"
        :key="entry.id"
        class="entry"
        :class="{ 'is-error': !entry.ok, 'is-open': log.expandedId === entry.id }"
      >
        <button class="entry-head" @click="log.toggleExpanded(entry.id)">
          <span class="status" :class="statusClass(entry)">{{ entry.status || "NET" }}</span>
          <span class="method">{{ entry.method }}</span>
          <span class="grow source-line" style="min-width: 0">
            <span class="source t-ellipsis">{{ entry.source }}</span>
            <span class="url t-ellipsis">{{ entry.url }}</span>
          </span>
          <span class="metric">{{ entry.durationMs }} ms</span>
          <span class="metric time">{{ formatTime(entry.at) }}</span>
          <UiIcon :name="log.expandedId === entry.id ? 'chevron-up' : 'chevron-down'" :size="15" class="t-faint" />
        </button>

        <p v-if="entry.error" class="entry-error">
          <UiIcon name="alert" :size="13" />{{ entry.error }}
        </p>
        <p v-if="entry.hint" class="entry-hint">{{ entry.hint }}</p>

        <div v-if="log.expandedId === entry.id" class="entry-detail">
          <div class="meta-grid">
            <span>{{ t('debug.entry.duration') }}</span><b>{{ entry.durationMs }} ms</b>
            <span>{{ t('debug.entry.timeout') }}</span
            ><b>{{ entry.timeoutMs ? `${entry.timeoutMs} ms` : t('debug.entry.timeoutDefault') }}</b>
            <span>{{ t('debug.entry.level') }}</span>
            <b>{{ entry.verbose ? t('debug.entry.levelVerbose') : t('debug.entry.levelBasic') }}</b>
            <span>{{ t('debug.entry.url') }}</span><b class="t-mono break">{{ entry.url }}</b>
          </div>

          <section v-if="headerRows(entry.requestHeaders).length" class="section">
            <div class="section-head">
              <span class="section-label">{{ t('debug.section.requestHeaders') }}</span>
              <button class="link-btn" @click="copySection(JSON.stringify(entry.requestHeaders, null, 2))">
                {{ t('common.copy') }}
              </button>
            </div>
            <dl class="head-list">
              <template v-for="[name, value] in headerRows(entry.requestHeaders)" :key="name">
                <dt>{{ name }}</dt>
                <dd>{{ value }}</dd>
              </template>
            </dl>
          </section>

          <section v-if="entry.requestBody" class="section">
            <div class="section-head">
              <span class="section-label">
                {{ entry.truncated ? t('debug.section.requestBodyTruncated') : t('debug.section.requestBody') }}
              </span>
              <button class="link-btn" @click="copySection(entry.requestBody!)">{{ t('common.copy') }}</button>
            </div>
            <pre class="code">{{ entry.requestBody }}</pre>
          </section>

          <section v-if="headerRows(entry.responseHeaders).length" class="section">
            <div class="section-head">
              <span class="section-label">{{ t('debug.section.responseHeaders') }}</span>
              <button class="link-btn" @click="copySection(JSON.stringify(entry.responseHeaders, null, 2))">
                {{ t('common.copy') }}
              </button>
            </div>
            <dl class="head-list">
              <template v-for="[name, value] in headerRows(entry.responseHeaders)" :key="name">
                <dt>{{ name }}</dt>
                <dd>{{ value }}</dd>
              </template>
            </dl>
          </section>

          <section v-if="entry.responseBody" class="section">
            <div class="section-head">
              <span class="section-label">
                {{
                  entry.truncated
                    ? t('debug.section.responseBodyTruncated')
                    : t('debug.section.responseBody')
                }}
              </span>
              <button class="link-btn" @click="copySection(entry.responseBody!)">{{ t('common.copy') }}</button>
            </div>
            <pre class="code">{{ entry.responseBody }}</pre>
          </section>

          <p v-if="!entry.verbose" class="field-hint">
            {{ t('debug.section.needsVerbose') }}
          </p>

          <button class="btn btn-sm" @click="copyEntry(entry)">
            <UiIcon name="copy" :size="13" />{{ t('debug.action.copyFull') }}
          </button>
        </div>
      </article>
    </div>

    <div v-else class="empty">
      <span class="empty-icon"><UiIcon name="list" :size="22" /></span>
      <p class="t-md t-2nd">
        {{ log.entries.length ? t('debug.empty.noMatch') : t('debug.empty.title') }}
      </p>
      <p class="t-xs t-3rd">
        {{
          log.entries.length
            ? t('debug.empty.noMatchDesc')
            : settings.useDemo
              ? t('debug.empty.demoDesc')
              : t('debug.empty.idleDesc')
        }}
      </p>
    </div>

    <template #footer>
      <span class="t-xs t-3rd grow">
        {{ t('debug.footer.privacy') }}
      </span>
      <RouterLink to="/settings" class="btn btn-sm" @click="ui.closeDebugDrawer()">
        <UiIcon name="settings" :size="14" />{{ t('debug.action.debugSettings') }}
      </RouterLink>
    </template>
  </UiDrawer>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}
.search-box {
  display: flex;
  align-items: center;
  gap: 9px;
  flex: 1;
  min-width: 0;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--border-input);
  border-radius: var(--r-sm);
  background: var(--bg-subtle);
  color: var(--text-tertiary);
}
.search-box:focus-within {
  border-color: var(--accent);
  background: var(--bg-surface);
}
.search-field {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  font-size: var(--fs-13);
}
.search-field:focus {
  outline: none;
}

.debug-toggle {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 12px 13px;
  margin-bottom: 14px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-md);
  background: var(--bg-subtle);
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.debug-toggle.is-on {
  border-color: var(--accent);
  background: var(--brand-grad-soft);
}
.toggle-icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: var(--r-sm);
  background: var(--bg-surface);
  color: var(--text-secondary);
}
.debug-toggle.is-on .toggle-icon {
  color: var(--accent);
}
.toggle-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.toggle-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-13);
  font-weight: 600;
}
.toggle-sub {
  font-size: var(--fs-11);
  line-height: 1.5;
  color: var(--text-tertiary);
}
.toggle-sub strong {
  color: var(--text-secondary);
}
.toggle-warn {
  margin-top: 2px;
  font-size: var(--fs-11);
  line-height: 1.5;
  color: var(--danger);
}

.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.entry {
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-surface);
  overflow: hidden;
}
.entry.is-error {
  border-color: color-mix(in srgb, var(--danger) 45%, var(--border));
}
.entry.is-open {
  box-shadow: var(--shadow-sm);
}
.entry-head {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.entry-head:hover {
  background: var(--bg-hover);
}
.status {
  flex: none;
  min-width: 44px;
  padding: 2px 7px;
  border-radius: var(--r-sm);
  text-align: center;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 650;
}
.status.is-ok {
  background: var(--success-soft);
  color: var(--success);
}
.status.is-4xx {
  background: var(--warning-soft);
  color: var(--warning);
}
.status.is-5xx {
  background: var(--danger-soft);
  color: var(--danger);
}
.status.is-warn {
  background: var(--bg-muted);
  color: var(--text-secondary);
}
.status.is-net {
  background: var(--danger-soft);
  color: var(--danger);
}
.method {
  flex: none;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-tertiary);
}
.source-line {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.source {
  font-size: var(--fs-12);
  font-weight: 600;
}
.url {
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
}
.metric {
  flex: none;
  font-size: 11px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.time {
  color: var(--text-faint);
}

.entry-error {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0 12px 8px;
  padding: 9px 11px;
  border-radius: var(--r-sm);
  background: var(--danger-soft);
  color: var(--danger);
  font-size: var(--fs-12);
  line-height: 1.55;
  word-break: break-word;
}
.entry-hint {
  margin: 0 12px 10px;
  padding: 9px 11px;
  border-radius: var(--r-sm);
  border: 1px dashed var(--border-strong);
  background: var(--bg-subtle);
  color: var(--text-secondary);
  font-size: var(--fs-11);
  line-height: 1.6;
}

.entry-detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  border-top: 1px solid var(--border);
  background: var(--bg-subtle);
}
.meta-grid {
  display: grid;
  grid-template-columns: 80px 1fr;
  gap: 6px 12px;
  font-size: var(--fs-11);
}
.meta-grid > span {
  color: var(--text-tertiary);
}
.meta-grid > b {
  font-weight: 550;
  color: var(--text);
  word-break: break-word;
}
.break {
  word-break: break-all;
}
.section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.code {
  margin: 0;
  max-height: 260px;
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bg-surface);
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
}
.head-list {
  display: grid;
  grid-template-columns: minmax(120px, 190px) 1fr;
  gap: 4px 12px;
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bg-surface);
  font-size: 11px;
}
.head-list dt {
  font-family: var(--font-mono);
  color: var(--text-tertiary);
  word-break: break-all;
}
.head-list dd {
  margin: 0;
  color: var(--text);
  word-break: break-all;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 60px 20px;
  text-align: center;
}
</style>
