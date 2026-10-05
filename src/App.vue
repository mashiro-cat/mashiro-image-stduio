<script setup lang="ts">
import { t } from "./i18n";
import { onBeforeUnmount, onMounted, watch } from "vue";
import { useRouter } from "vue-router";
import AppSidebar from "./components/layout/AppSidebar.vue";
import AppTitlebar from "./components/layout/AppTitlebar.vue";
import UiToastHost from "./components/ui/UiToastHost.vue";
import UiConfirmHost from "./components/ui/UiConfirmHost.vue";
import DebugLogDrawer from "./components/debug/DebugLogDrawer.vue";
import { useSettingsStore } from "./stores/settings";
import { useHistoryStore } from "./stores/history";
import { useCollectionsStore } from "./stores/collections";
import { usePromptStore } from "./stores/prompts";
import { usePresetsStore } from "./stores/presets";
import { usePromptRepoStore } from "./stores/promptRepos";
import { useDraftStore } from "./stores/draft";
import { useDebugLogStore } from "./stores/debugLog";
import { useMcpStore } from "./stores/mcp";
import { useUiStore } from "./stores/ui";
import { useUpscaleStore } from "./stores/upscale";
import type { GenMode } from "./types";

const router = useRouter();
const settings = useSettingsStore();
const history = useHistoryStore();
const collections = useCollectionsStore();
const prompts = usePromptStore();
const presets = usePresetsStore();
const promptRepos = usePromptRepoStore();
const draft = useDraftStore();
const debugLog = useDebugLogStore();
const mcp = useMcpStore();
const ui = useUiStore();
const upscale = useUpscaleStore();

/** 需要跨页面保活的视图（必须是组件名，与各自 defineOptions 里写的保持一致） */
const WORKBENCH_VIEWS = ["ModelStudioView", "WorkflowView"];

/** 文生图 / 图生图已合并为同一页面（大模型生图），用 query.mode 区分 */
const TARGET_ROUTE: Record<GenMode, { path: string; mode?: "text2img" | "img2img" }> = {
  text2img: { path: "/generate", mode: "text2img" },
  img2img: { path: "/generate", mode: "img2img" },
  workflow: { path: "/workflow" },
};

/** 跨页面交接：任意位置点击「去生图 / 复用参数」后自动跳到对应工作台 */
watch(
  () => draft.pendingTarget,
  (target) => {
    if (!target) return;
    const destination = TARGET_ROUTE[target];
    const current = router.currentRoute.value;
    const alreadyThere =
      current.path === destination.path && (!destination.mode || current.query.mode === destination.mode);
    if (!alreadyThere) {
      void router.push(
        destination.mode ? { path: destination.path, query: { mode: destination.mode } } : { path: destination.path },
      );
    }
    draft.consumeTarget();
  },
);

/** 调试开关变化时同步给平台层（http.ts 每次请求都会读取） */
watch(
  () => settings.state.debug,
  () => debugLog.syncRuntime(),
  { deep: true },
);

/**
 * 语言偏好变化时立即生效。
 *
 * 必须 watch：设置页改语言走的是「直接改 `state.app.locale`」
 * （和主题、默认画幅等偏好一致，不走各自的 setter），
 * 少了这个 watch 就要重启应用才看得到效果。
 */
watch(
  () => settings.state.app.locale,
  () => settings.applyLocale(),
);

onMounted(async () => {
  await Promise.all([
    settings.load(),
    history.load(),
    collections.load(),
    prompts.load(),
    presets.load(),
    draft.load(),
    promptRepos.load(),
    // 超分要问 Rust 侧「哪些模型已下载」，失败时降级成「不可用」而不是挡住启动
    upscale.load().catch(() => undefined),
  ]);
  settings.applyTheme();
  // 语言要在 settings.load() 之后应用：偏好存在磁盘上，
  // 提前应用会先按系统语言渲染一帧再跳变
  settings.applyLocale();
  // 注入日志 sink 并恢复上次的日志
  await debugLog.load();
  // 同步默认参数到工作台草稿
  if (!draft.draft.size) draft.patch({ size: settings.state.app.defaultSize });
  if (!draft.draft.count) draft.patch({ count: settings.state.app.defaultCount });
  if (!draft.draft.quality) draft.patch({ quality: settings.activeModelChannel?.quality ?? "high" });
  if (!draft.draft.style && settings.state.app.defaultStyle) {
    draft.patch({ style: settings.state.app.defaultStyle });
  }
  // 桥必须在数据加载完之后挂上：生图工具要用到渠道配置、历史记录与提示词库。
  // 挂上之前到达的 MCP 调用会被明确拒绝，而不是一直等到超时。
  await mcp.startBridge();
});

// 页面卸载时要主动摘掉监听，否则 Rust 侧会继续等一个已经没人处理的调用
onBeforeUnmount(() => mcp.detachBridge());

/**
 * 外部 Agent 通过 MCP 生图后给一条轻提示。
 * 不问一下的话，用户会看到历史记录里莫名多出几张图，
 * 只能猜「这是谁生成的」。
 */
const notifiedCalls = new Set<string>();
watch(
  () => mcp.calls[0],
  (latest) => {
    if (!latest || !latest.ok || notifiedCalls.has(latest.id)) return;
    notifiedCalls.add(latest.id);
    if (!/^mashiro_(generate_image|edit_image|run_workflow)$/.test(latest.tool)) return;
    ui.success(t("mcp.toast.generated"), t("mcp.toast.generatedDetail"));
  },
);
</script>

<template>
  <div class="app-shell">
    <AppTitlebar />
    <div class="app-body">
      <AppSidebar />
      <main class="app-main">
        <RouterView v-slot="{ Component }">
          <!--
            两个工作台保活：切到设置页 / 提示词库再回来时，正在跑的任务、画布结果、
            面板上的本地状态（当前 tab、增强结果、滚动位置）都还在。
            其余页面照旧每次重新挂载，避免看到过期数据。
            名称见各视图的 defineOptions。
          -->
          <KeepAlive :include="WORKBENCH_VIEWS">
            <component :is="Component" />
          </KeepAlive>
        </RouterView>
      </main>
    </div>
    <UiToastHost />
    <UiConfirmHost />
    <DebugLogDrawer />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}
.app-body {
  display: flex;
  flex: 1;
  min-height: 0;
}
.app-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}
</style>
