<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import { useUiStore } from "../../stores/ui";
import { useSettingsStore } from "../../stores/settings";
import { useHistoryStore, MODE_LABEL } from "../../stores/history";
import { usePromptStore } from "../../stores/prompts";
import { useDraftStore } from "../../stores/draft";
import { useDebugLogStore } from "../../stores/debugLog";
import { useMcpStore } from "../../stores/mcp";
import { useUpscaleStore } from "../../stores/upscale";
import { revealDataDir } from "../../platform/storage";
import { formatRelative, isTauri } from "../../platform/env";
import { isMacOS } from "../../platform/window";
import { studioRoute } from "../../router/studio";
import { t } from "../../i18n";
import appIcon from "../../assets/app_icon.png";
import UiIcon from "../ui/UiIcon.vue";
import UiModal from "../ui/UiModal.vue";
import WindowControls from "./WindowControls.vue";

const router = useRouter();
const ui = useUiStore();
const settings = useSettingsStore();
const history = useHistoryStore();
const prompts = usePromptStore();
const draft = useDraftStore();
const debugLog = useDebugLogStore();
const mcp = useMcpStore();
const upscale = useUpscaleStore();
const { sidebarCollapsed } = storeToRefs(ui);

/** macOS 保留原生红绿灯：需要给左侧让出位置，且不画自绘按钮 */
const mac = isMacOS();

/**
 * 品牌区宽度跟随侧边栏（见样式里的 .brand-slot），保证 Logo 与下方导航项居中对齐。
 * macOS 收起侧栏时例外：红绿灯让位（78px）比收起后的槽（62px）还宽，
 * 此时再画 Logo 只会压在红绿灯上，直接不画。
 */
const showBrand = computed(() => !mac || !sidebarCollapsed.value);

/** Ctrl/⌘ + K 打开全局搜索 */
function onKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openSearch();
  }
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

const searchOpen = ref(false);
const keyword = ref("");
const menuOpen = ref<"" | "notice" | "settings">("");

const promptHits = computed(() => {
  const text = keyword.value.trim().toLowerCase();
  if (!text) return [];
  return prompts.items
    .filter((item) => item.title.toLowerCase().includes(text) || item.content.toLowerCase().includes(text))
    .slice(0, 5);
});

const historyHits = computed(() => {
  const text = keyword.value.trim().toLowerCase();
  if (!text) return [];
  return history.records.filter((record) => record.prompt.toLowerCase().includes(text)).slice(0, 5);
});

const recent = computed(() => history.records.slice(0, 6));
const unread = computed(() => history.records.filter((record) => record.status === "failed").length + 1);

function openSearch() {
  keyword.value = "";
  searchOpen.value = true;
}

/** 统一入口：所有偏好配置都收拢在设置页里，这里只负责带 tab 跳过去 */
function gotoSettings(
  tab?: "model" | "workflow" | "llm" | "debug" | "data" | "mcp" | "upscale",
) {
  menuOpen.value = "";
  void router.push(tab ? { path: "/settings", query: { tab } } : "/settings");
}

/** 超分页直达：入口已显示时菜单里点它就该直接进页面，而不是绕设置页 */
function gotoUpscale() {
  menuOpen.value = "";
  void router.push("/upscale");
}

async function openDataDir() {
  const res = await revealDataDir();
  if (!res.ok) {
    ui.warning(
      t("nav.error.dataDirTitle"),
      isTauri() ? (res.error ?? t("nav.error.dataDirUnknown")) : t("nav.error.dataDirBrowser"),
    );
  }
}

function useSearchPrompt(content: string, negative: string) {
  draft.handoff("text2img", { prompt: content, negative, references: [] });
  searchOpen.value = false;
  router.push(studioRoute("text2img"));
}

function gotoHistory(id: string) {
  history.selectedId = id;
  searchOpen.value = false;
  router.push("/history");
}

function quickSearch(text: string) {
  keyword.value = text;
}
</script>

<template>
  <!-- data-tauri-drag-region="deep"：整条顶栏可拖动窗口，双击最大化；
       BUTTON / INPUT 等可点击元素会自动阻断拖拽，下拉面板显式排除。 -->
  <header class="titlebar" :class="{ 'is-mac': mac, 'is-collapsed': sidebarCollapsed }" data-tauri-drag-region="deep">
    <!-- 品牌区宽度跟随侧栏；收起时只留 Logo 居中。
         macOS 收起时红绿灯让位(78px)比收起后的槽(62px)还宽，这一格退化成纯占位、不画 Logo 也不画右边框，
         免得 78px 溢出把 Logo 顶到红绿灯上。 -->
    <div class="brand-slot" :class="{ 'is-collapsed': sidebarCollapsed, 'is-spacer': !showBrand }">
      <div v-if="showBrand" class="brand" :title="t('nav.action.backHome')" @click="router.push('/')">
        <img class="brand-mark" :src="appIcon" alt="Mashiro Studio" />
        <span v-if="!sidebarCollapsed" class="brand-text">
          <span class="brand-name">Mashiro Studio</span>
          <span class="brand-sub">{{ t('nav.brand.tagline') }}</span>
        </span>
      </div>
    </div>

    <button class="icon-btn" :title="t('nav.action.toggleSidebar')" @click="ui.toggleSidebar()">
      <UiIcon :name="sidebarCollapsed ? 'panel-left' : 'arrow-left'" :size="17" />
    </button>

    <button class="search-trigger" @click="openSearch">
      <UiIcon name="search" :size="15" />
      <span class="search-text">{{ t('nav.search.placeholder') }}</span>
      <span class="search-kbd">Ctrl K</span>
    </button>

    <div class="topbar-right">
      <span
        v-if="settings.useDemo"
        class="tag tag-warning demo-flag"
        :title="t('nav.demo.tooltip')"
      >
        <UiIcon name="lightbulb" :size="12" />{{ t('nav.demo.badge') }}
      </span>

      <div class="menu-wrap">
        <button
          class="icon-btn"
          :class="{ 'is-active': menuOpen === 'notice' }"
          :title="t('nav.notice.title')"
          @click="menuOpen = menuOpen === 'notice' ? '' : 'notice'"
        >
          <UiIcon name="bell" :size="17" />
          <span v-if="unread > 1" class="badge-dot" />
        </button>
        <div v-if="menuOpen === 'notice'" class="menu-panel" data-tauri-drag-region="false">
          <p class="menu-title">{{ t('nav.notice.recentTitle') }}</p>
          <div v-if="!recent.length" class="menu-empty t-sm t-3rd">{{ t('nav.notice.empty') }}</div>
          <button
            v-for="record in recent"
            :key="record.id"
            class="menu-row"
            @click="gotoHistory(record.id); menuOpen = ''"
          >
            <span class="row gap-2 grow" style="min-width: 0">
              <span class="dot" :class="`is-${record.status}`" />
              <span class="clamp-2 menu-row-text">{{ record.prompt || t('nav.notice.emptyPrompt') }}</span>
            </span>
            <span class="t-xs t-faint">{{ formatRelative(record.createdAt) }}</span>
          </button>
          <button class="menu-foot" @click="router.push('/history'); menuOpen = ''">
            {{ t('nav.notice.viewAll') }}
          </button>
        </div>
      </div>

      <!-- 设置入口：密钥、日志、数据目录等能力统一收拢到设置页 -->
      <div class="menu-wrap">
        <button
          class="icon-btn settings-btn"
          :class="{ 'is-active': menuOpen === 'settings' }"
          :title="t('nav.menu.title')"
          @click="menuOpen = menuOpen === 'settings' ? '' : 'settings'"
        >
          <UiIcon name="settings" :size="17" />
          <span v-if="debugLog.errorCount" class="badge-dot" />
        </button>
        <div v-if="menuOpen === 'settings'" class="menu-panel is-wide" data-tauri-drag-region="false">
          <button class="menu-head" @click="gotoSettings()">
            <span class="avatar">M</span>
            <span class="grow" style="min-width: 0">
              <span class="menu-head-title">Mashiro Studio</span>
              <span class="menu-head-sub t-ellipsis">{{ t('nav.menu.localFirst') }}</span>
            </span>
            <UiIcon name="chevron-right" :size="14" class="t-3rd" />
          </button>

          <p class="menu-title">{{ t('nav.menu.quickTitle') }}</p>
          <button class="menu-row" @click="gotoSettings('model')">
            <UiIcon name="sparkles" :size="15" />
            <span class="grow">{{ t('nav.menu.modelChannels') }}</span>
            <span class="tag" :class="settings.enabledModelChannels.length ? 'tag-success' : 'tag-warning'">
              {{ settings.enabledModelChannels.length || t('nav.status.notEnabled') }}
            </span>
          </button>
          <button class="menu-row" @click="gotoSettings('workflow')">
            <UiIcon name="workflow" :size="15" />
            <span class="grow">{{ t('nav.menu.workflowChannels') }}</span>
            <span class="tag" :class="settings.enabledWorkflowChannels.length ? 'tag-success' : 'tag-warning'">
              {{ settings.enabledWorkflowChannels.length || t('nav.status.notEnabled') }}
            </span>
          </button>
          <button class="menu-row" @click="gotoSettings('debug')">
            <UiIcon name="bug" :size="15" />
            <span class="grow">{{ t('nav.menu.requestLog') }}</span>
            <span v-if="debugLog.errorCount" class="tag tag-danger">
              {{ t('nav.status.failedCount', { n: debugLog.errorCount }) }}
            </span>
            <span v-else class="tag" :class="debugLog.enabled ? 'tag-info' : ''">
              {{ debugLog.enabled ? t('nav.status.recording') : t('nav.status.off') }}
            </span>
          </button>
          <button class="menu-row" @click="gotoSettings('data')">
            <UiIcon name="folder-open" :size="15" />
            <span class="grow">{{ t('nav.menu.dataDir') }}</span>
            <UiIcon name="chevron-right" :size="14" class="t-faint" />
          </button>
          <button class="menu-row" @click="gotoSettings('mcp')">
            <UiIcon name="plug" :size="15" />
            <span class="grow">{{ t('nav.menu.mcp') }}</span>
            <span
              class="tag"
              :class="mcp.running ? 'tag-success' : ''"
            >{{ mcp.running ? t('nav.status.running') : t('nav.status.stopped') }}</span>
          </button>
          <!--
            超分入口在设置里默认关闭（离线重活，多数人不用），
            但**功能不能因此变得无处可达**——否则用户根本不知道它存在。
            这里就是那条路径：关着时点进设置页，开着时直接去超分页。
          -->
          <button
            class="menu-row"
            @click="upscale.entryVisible ? gotoUpscale() : gotoSettings('upscale')"
          >
            <UiIcon name="crop" :size="15" />
            <span class="grow">{{ t('nav.menu.upscale') }}</span>
            <span class="tag" :class="upscale.available ? (upscale.entryVisible ? 'tag-success' : '') : 'tag-warning'">
              {{
                !upscale.available
                  ? t('nav.status.modelMissing')
                  : upscale.entryVisible
                    ? t('nav.status.entryShown')
                    : t('nav.status.entryHidden')
              }}
            </span>
          </button>

          <div class="menu-divider" />
          <button class="menu-row" @click="settings.toggleTheme(); menuOpen = ''">
            <UiIcon :name="settings.state.app.theme === 'light' ? 'moon' : 'sun'" :size="15" />
            <span class="grow">
              {{ settings.state.app.theme === 'light' ? t('nav.menu.themeDark') : t('nav.menu.themeLight') }}
            </span>
          </button>
          <button class="menu-row" @click="ui.openDebugDrawer(); menuOpen = ''">
            <UiIcon name="list" :size="15" />
            <span class="grow">{{ t('nav.menu.openLog') }}</span>
            <UiIcon name="arrow-up-right" :size="14" class="t-faint" />
          </button>
          <button class="menu-row" @click="openDataDir(); menuOpen = ''">
            <UiIcon name="folder-open" :size="15" />
            <span class="grow">{{ t('nav.menu.openDataDir') }}</span>
            <UiIcon name="arrow-up-right" :size="14" class="t-faint" />
          </button>
          <button class="menu-row" @click="router.push('/prompts'); menuOpen = ''">
            <UiIcon name="book" :size="15" />
            <span class="grow">{{ t('nav.menu.prompts') }}</span>
          </button>

          <div class="menu-divider" />
          <p class="menu-meta t-xs t-faint">{{ t('nav.menu.footnote') }}</p>
        </div>
      </div>
    </div>

    <WindowControls />

    <!-- 全局搜索 -->
    <UiModal v-model:open="searchOpen" :width="620">
      <template #header>
        <div class="search-head grow">
          <UiIcon name="search" :size="17" />
          <input
            v-model="keyword"
            class="search-input"
            :placeholder="t('nav.search.modalPlaceholder')"
            autofocus
            @keydown.esc="searchOpen = false"
          />
        </div>
      </template>

      <div class="search-body">
        <template v-if="keyword.trim()">
          <div v-if="promptHits.length" class="search-group">
            <p class="section-label">{{ t('nav.search.groupPrompts') }}</p>
            <button
              v-for="item in promptHits"
              :key="item.id"
              class="search-row"
              @click="useSearchPrompt(item.content, item.negative)"
            >
              <UiIcon name="book" :size="15" class="t-3rd" />
              <span class="grow" style="min-width: 0">
                <span class="search-row-title">{{ item.title }}</span>
                <span class="search-row-desc t-ellipsis">{{ item.content }}</span>
              </span>
              <UiIcon name="arrow-right" :size="15" class="t-faint" />
            </button>
          </div>

          <div v-if="historyHits.length" class="search-group">
            <p class="section-label">{{ t('nav.search.groupHistory') }}</p>
            <button v-for="record in historyHits" :key="record.id" class="search-row" @click="gotoHistory(record.id)">
              <UiIcon name="history" :size="15" class="t-3rd" />
              <span class="grow" style="min-width: 0">
                <!-- MODE_LABEL 是枚举映射表（数据），不翻译 -->
                <span class="search-row-title">{{ MODE_LABEL[record.mode] }} · {{ record.params.model }}</span>
                <span class="search-row-desc t-ellipsis">{{ record.prompt }}</span>
              </span>
              <UiIcon name="arrow-right" :size="15" class="t-faint" />
            </button>
          </div>

          <div v-if="!promptHits.length && !historyHits.length" class="empty" style="padding: 32px 0">
            <p class="t-2nd">{{ t('nav.search.noResult') }}</p>
            <p class="t-xs t-3rd">{{ t('nav.search.noResultHint') }}</p>
          </div>
        </template>

        <template v-else>
          <p class="section-label">{{ t('nav.search.quickTitle') }}</p>
          <div class="search-quick">
            <!-- 快捷搜索词是**搜索输入**而不是文案：翻成英文就搜不到中文语料了，保持原样 -->
            <button class="quick-chip" @click="quickSearch('夜景')">夜景</button>
            <button class="quick-chip" @click="quickSearch('人像')">人像</button>
            <button class="quick-chip" @click="quickSearch('产品')">产品</button>
            <button class="quick-chip" @click="quickSearch('动漫')">动漫</button>
            <button class="quick-chip" @click="quickSearch('概念')">概念</button>
          </div>
        </template>
      </div>
    </UiModal>

    <div v-if="menuOpen" class="menu-backdrop" data-tauri-drag-region="false" @click="menuOpen = ''" />
  </header>
</template>

<style scoped>
.titlebar {
  position: relative;
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 10px;
  height: var(--titlebar-h);
  flex: none;
  padding-right: 0;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
  user-select: none;
}

/* 品牌区：宽度与侧边栏一致（同一组 token、同一条 transition，避免两边动画错拍），
   Logo 与下方导航项左对齐；macOS 给红绿灯让位 */
.brand-slot {
  display: flex;
  align-items: center;
  flex: none;
  width: var(--sidebar-w);
  height: 100%;
  padding: 0 12px;
  border-right: 1px solid var(--border);
  transition: width 0.22s var(--ease);
}
.brand-slot.is-collapsed {
  width: var(--sidebar-w-collapsed);
  padding: 0;
  justify-content: center;
}
.titlebar.is-mac .brand-slot {
  padding-left: var(--traffic-lights-w);
}
/* 收起 + macOS：让位区已经宽过整格，这一格退化成纯占位 */
.brand-slot.is-spacer {
  border-right-color: transparent;
}

.brand {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  overflow: hidden;
  cursor: pointer;
}
.brand-mark {
  display: block;
  width: 26px;
  height: 26px;
  flex: none;
  object-fit: contain;
  filter: drop-shadow(0 2px 7px rgba(37, 99, 235, 0.28));
}
.brand-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.brand-name {
  font-size: var(--fs-12);
  font-weight: 680;
  letter-spacing: -0.01em;
  line-height: 1.25;
  white-space: nowrap;
}
.brand-sub {
  font-size: 10px;
  line-height: 1.3;
  color: var(--text-tertiary);
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.search-trigger {
  display: flex;
  align-items: center;
  gap: 9px;
  width: min(420px, 42vw);
  height: 30px;
  padding: 0 11px;
  border: 1px solid var(--border-input);
  border-radius: var(--r-sm);
  background: var(--bg-subtle);
  color: var(--text-faint);
  font-size: var(--fs-13);
  cursor: pointer;
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.search-trigger:hover {
  border-color: var(--border-strong);
  background: var(--bg-surface);
}
.search-text {
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-kbd {
  padding: 2px 6px;
  border-radius: var(--r-xs);
  border: 1px solid var(--border);
  background: var(--bg-surface);
  font-size: 10.5px;
  color: var(--text-tertiary);
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.demo-flag {
  height: 24px;
}
.menu-wrap {
  position: relative;
  z-index: 2;
}
.badge-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--danger);
  border: 1.5px solid var(--bg-surface);
}

.avatar {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--brand-grad);
  color: #fff;
  font-size: var(--fs-12);
  font-weight: 700;
}
.menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1;
}
.menu-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 3;
  width: 320px;
  padding: 6px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-pop);
  animation: pop-in 0.18s var(--ease) both;
}
.menu-panel.is-narrow {
  width: 232px;
}
.menu-panel.is-wide {
  width: 274px;
}
.menu-head {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 9px 10px;
  margin-bottom: 4px;
  border: 0;
  border-radius: var(--r-sm);
  background: var(--bg-subtle);
  text-align: left;
  cursor: pointer;
}
.menu-head:hover {
  background: var(--bg-hover);
}
.menu-head-title {
  display: block;
  font-size: var(--fs-13);
  font-weight: 650;
  color: var(--text);
}
.menu-head-sub {
  display: block;
  font-size: var(--fs-11);
  color: var(--text-tertiary);
}
.menu-title {
  padding: 8px 10px 6px;
  font-size: var(--fs-11);
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.menu-empty {
  padding: 12px 10px;
}
.menu-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 9px 10px;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text);
  font-size: var(--fs-13);
  text-align: left;
  cursor: pointer;
}
.menu-row:hover {
  background: var(--bg-hover);
}
.menu-row-text {
  font-size: var(--fs-12);
  line-height: 1.45;
  color: var(--text-secondary);
}
.menu-foot {
  width: 100%;
  margin-top: 4px;
  padding: 8px;
  border: 0;
  border-top: 1px solid var(--border);
  background: transparent;
  color: var(--accent);
  font-size: var(--fs-12);
  font-weight: 550;
  cursor: pointer;
}
.menu-divider {
  height: 1px;
  margin: 5px 0;
  background: var(--border);
}
.menu-meta {
  padding: 4px 10px 6px;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
}
.dot.is-success {
  background: var(--success);
}
.dot.is-failed {
  background: var(--danger);
}
.dot.is-running,
.dot.is-queued {
  background: var(--warning);
}
.dot.is-canceled {
  background: var(--text-faint);
}

.search-head {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-tertiary);
}
.search-input {
  flex: 1;
  border: 0;
  background: transparent;
  font-size: var(--fs-15);
}
.search-input:focus {
  outline: none;
}
.search-body {
  min-height: 180px;
}
.search-group + .search-group {
  margin-top: 16px;
}
.search-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.search-row:hover {
  background: var(--bg-hover);
}
.search-row-title {
  display: block;
  font-size: var(--fs-13);
  font-weight: 550;
  color: var(--text);
}
.search-row-desc {
  display: block;
  font-size: var(--fs-12);
  color: var(--text-tertiary);
}
.search-quick {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.quick-chip {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-full);
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: var(--fs-12);
  cursor: pointer;
}
.quick-chip:hover {
  border-color: var(--accent);
  color: var(--accent);
}
</style>
