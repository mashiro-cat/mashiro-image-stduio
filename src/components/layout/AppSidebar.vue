<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import { useHistoryStore } from "../../stores/history";
import { useSettingsStore } from "../../stores/settings";
import { useUiStore } from "../../stores/ui";
import { useUpscaleStore } from "../../stores/upscale";
import { t } from "../../i18n";
import UiIcon from "../ui/UiIcon.vue";

const route = useRoute();
const router = useRouter();
const history = useHistoryStore();
const settings = useSettingsStore();
const ui = useUiStore();
const upscale = useUpscaleStore();
const { sidebarCollapsed } = storeToRefs(ui);

interface NavItem {
  label: string;
  icon: string;
  path: string;
  badge?: string;
}

/**
 * 「图片超分」入口是否列出来。
 *
 * 受设置页「在工作台显示超分入口」控制（`upscale.entryVisible`），
 * 但**人已经在超分页上时必须留着**——侧边栏是唯一的当前位置指示，
 * 把它自己藏掉等于让用户在这一页失去导航。
 *
 * 曾经这里是写死的常量，于是设置里把开关关掉、侧边栏纹丝不动，
 * 开关形同虚设。
 */
const showUpscale = computed(() => upscale.entryVisible || route.path === "/upscale");

/**
 * 导航项。
 *
 * `label` 走 `t()` 而不是写死：整体放在 `computed` 里，
 * 语言一变（`t()` 读的 `current` 是 ref）这个 computed 就会重算，
 * 侧边栏跟着换语言，不需要额外 watch。
 *
 * ⚠️ `icon` 与 `path` 是数据（UiIcon 的键、路由路径），不翻译。
 */
const groups = computed<Array<{ title: string; items: NavItem[] }>>(() => [
  {
    title: "",
    items: [{ label: t("nav.item.home"), icon: "home", path: "/" }],
  },
  {
    title: t("nav.group.create"),
    items: [
      { label: t("nav.item.generate"), icon: "sparkles", path: "/generate" },
      { label: t("nav.item.workflow"), icon: "workflow", path: "/workflow" },
      ...(showUpscale.value ? [{ label: t("nav.item.upscale"), icon: "crop", path: "/upscale" }] : []),
    ],
  },
  {
    title: t("nav.group.resource"),
    items: [
      {
        label: t("nav.item.prompts"),
        icon: "book",
        path: "/prompts",
        badge: settings.state.llm.enabled && settings.hasLlm ? "AI" : undefined,
      },
      { label: t("nav.item.history"), icon: "history", path: "/history" },
    ],
  },
  {
    title: t("nav.group.preference"),
    items: [{ label: t("nav.item.settings"), icon: "settings", path: "/settings" }],
  },
]);

const stats = computed(() => history.stats);
</script>

<template>
  <aside class="sidebar" :class="{ 'is-collapsed': sidebarCollapsed }">
    <nav class="nav scroll-y">
      <div v-for="(group, index) in groups" :key="index" class="nav-group">
        <p v-if="group.title && !sidebarCollapsed" class="nav-group-title">{{ group.title }}</p>
        <RouterLink
          v-for="item in group.items"
          :key="item.path"
          :to="item.path"
          class="nav-item"
          :class="{ 'is-active': route.path === item.path }"
          :title="sidebarCollapsed ? item.label : undefined"
        >
          <UiIcon :name="item.icon" :size="17" />
          <span v-if="!sidebarCollapsed" class="nav-label">{{ item.label }}</span>
          <span v-if="!sidebarCollapsed && item.badge" class="tag tag-brand nav-badge">{{ item.badge }}</span>
        </RouterLink>
      </div>
    </nav>

    <div class="sidebar-foot">
      <button v-if="!sidebarCollapsed" class="workspace-card" @click="router.push('/history')">
        <div class="row-between">
          <span class="workspace-title">{{ t('nav.workspace.title') }}</span>
          <UiIcon name="chevron-right" :size="14" class="t-3rd" />
        </div>
        <div class="workspace-stats">
          <span>{{ t('nav.workspace.runs', { n: stats.total }) }}</span>
          <span>{{ t('nav.workspace.images', { n: stats.images }) }}</span>
        </div>
        <div class="workspace-meter">
          <span class="workspace-meter-fill" :style="{ width: `${stats.rate}%` }" />
        </div>
        <p class="workspace-hint">{{ t('nav.workspace.successRate', { rate: stats.rate }) }}</p>
      </button>

      <button
        class="nav-item foot-action"
        :title="t('nav.action.collapseSidebar')"
        @click="ui.toggleSidebar()"
      >
        <UiIcon :name="sidebarCollapsed ? 'chevron-right' : 'panel-left'" :size="17" />
        <span v-if="!sidebarCollapsed" class="nav-label">{{ t('nav.action.collapseSidebar') }}</span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  width: var(--sidebar-w);
  flex: none;
  background: var(--bg-surface);
  border-right: 1px solid var(--border);
  transition: width 0.22s var(--ease);
}
.sidebar.is-collapsed {
  width: var(--sidebar-w-collapsed);
}

.nav {
  flex: 1;
  padding: 12px 10px 12px;
}
.nav-group + .nav-group {
  margin-top: 14px;
}
.nav-group-title {
  padding: 0 8px 6px;
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.06em;
  color: var(--text-faint);
  text-transform: uppercase;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 34px;
  padding: 0 9px;
  margin-bottom: 2px;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--fs-13);
  font-weight: 500;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.nav-item:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.nav-item.is-active {
  background: var(--accent-soft);
  color: var(--accent-soft-fg);
  font-weight: 600;
}
.sidebar.is-collapsed .nav-item {
  justify-content: center;
  padding: 0;
}
.nav-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nav-badge {
  height: 18px;
  padding: 0 6px;
  font-size: 10px;
}

.sidebar-foot {
  padding: 10px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.workspace-card {
  display: block;
  width: 100%;
  padding: 12px;
  border-radius: var(--r-md);
  border: 1px solid var(--border);
  background: var(--bg-subtle);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.workspace-card:hover {
  border-color: var(--border-strong);
  background: var(--bg-hover);
}
.workspace-title {
  font-size: var(--fs-12);
  font-weight: 600;
}
.workspace-stats {
  display: flex;
  gap: 12px;
  margin-top: 6px;
  font-size: var(--fs-11);
  color: var(--text-tertiary);
}
.workspace-stats b {
  color: var(--text);
  font-weight: 650;
}
.workspace-meter {
  height: 4px;
  margin-top: 9px;
  border-radius: 999px;
  background: var(--bg-muted);
  overflow: hidden;
}
.workspace-meter-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--brand-grad);
  transition: width 0.4s var(--ease);
}
.workspace-hint {
  margin-top: 6px;
  font-size: 10.5px;
  color: var(--text-faint);
}
.foot-action {
  margin-bottom: 0;
}
</style>
