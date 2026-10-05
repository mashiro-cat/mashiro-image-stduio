<script setup lang="ts">
/**
 * 设置页 · 本地超分面板。
 *
 * 推理全在 Rust（`src-tauri/src/upscale/`），这里只管三件事：
 * 让用户下载/删除模型、选默认模型、决定要不要显示超分入口
 * （入口 = 侧边栏「图片超分」+ 工作台按钮 + 历史记录的三处快捷入口，
 * 三处都读 `upscale.entryVisible`，别只改一处）。
 *
 * 模型清单**不在这里硬编码**——列表来自 `upscale_list_models`，
 * 那是注册表的事实；抄一份必然会漂移。
 */
import { computed } from "vue";
import { useUpscaleStore } from "../../stores/upscale";
import { useUiStore } from "../../stores/ui";
import { downloadModel, removeModel } from "../../services/upscale";
import { formatBytes, isTauri } from "../../platform/env";
import { t } from "../../i18n";
import UiIcon from "../ui/UiIcon.vue";
import UiSwitch from "../ui/UiSwitch.vue";

const upscale = useUpscaleStore();
const ui = useUiStore();

const desktop = isTauri();

async function handleDownload(id: string) {
  if (upscale.busy) return;
  upscale.busy = id;
  try {
    const label = await downloadModel(id);
    await upscale.refresh();
    ui.success(t("upscale.msg.downloaded.title", { name: label }), t("upscale.msg.downloaded.desc"));
  } catch (err) {
    ui.requestFailed(t("upscale.msg.downloadFailed"), err);
  } finally {
    upscale.busy = "";
  }
}

async function handleRemove(id: string) {
  if (upscale.busy) return;
  upscale.busy = id;
  try {
    await removeModel(id);
    await upscale.refresh();
    ui.info(t("settings.upscale.removed"), t("upscale.msg.removed.desc"));
  } catch (err) {
    ui.requestFailed(t("upscale.msg.removeFailed"), err);
  } finally {
    upscale.busy = "";
  }
}

/**
 * 开关下方的说明。
 *
 * **默认关闭**，所以这里的首要任务是「说清打开会发生什么」——
 * 用户第一次进设置页看到的是关着的状态，不说明的话就成了
 * 「这功能藏哪了」。
 *
 * 关闭时也要**明写关掉后哪些地方会消失**（侧边栏 + 历史记录快捷入口）：
 * 只说「不显示入口」会让人以为只是工作台少个按钮，
 * 结果在侧边栏发现「图片超分」还在，以为开关没生效（这正是本 bug 的由来）。
 */
const hint = computed(() => {
  if (!upscale.enabled) {
    if (upscale.queue.length) {
      return t("upscale.settings.entryHintHiddenWithQueue", { count: upscale.queue.length });
    }
    return t("upscale.settings.entryHintWillShow");
  }
  if (!upscale.available) return t("upscale.settings.entryHintNoModel");
  const active = upscale.activeModel;
  return active
    ? t("upscale.settings.entryHintActive", { name: active.label, scale: active.scale })
    : "";
});

/** 「检测」按钮上的状态文案：未检测 / 支持 / 不支持 */
const gpuStateLabel = computed(() => {
  if (upscale.gpuSupported === null) return t("upscale.gpu.detect");
  return upscale.gpuSupported ? t("upscale.gpu.available") : t("upscale.gpu.unavailable");
});

/**
 * 开关下方的说明。要把三件事说清：
 * 现在能不能用、开的是什么、以及失败时会怎样。
 */
const gpuHint = computed(() => {
  if (!upscale.installedModels.length) return t("upscale.gpu.hintNeedModel");
  if (upscale.gpuSupported === null) return t("upscale.gpu.hintNotProbed");
  if (!upscale.gpuSupported) return t("upscale.gpu.hintFailed");
  return upscale.useGpu ? t("upscale.gpu.hintOn") : t("upscale.gpu.hintOff");
});
</script>

<template>
  <section class="upscale">
    <!-- 浏览器预览：没有 Rust 侧推理能力 -->
    <div v-if="!desktop" class="card card-pad notice">
      <UiIcon name="info" :size="16" />
      <div>
        <p class="notice-title">{{ t('upscale.empty.desktopOnly.title') }}</p>
        <p class="notice-text">{{ t('upscale.settings.desktopOnlyDesc') }}</p>
      </div>
    </div>

    <template v-else>
      <!-- ============================================ 开关 -->
      <div class="card card-pad">
        <header class="panel-head">
          <div>
            <h2 class="panel-title">{{ t('upscale.settings.panelTitle') }}</h2>
            <p class="panel-sub">{{ t('upscale.settings.panelDesc') }}</p>
          </div>
          <span class="tag" :class="upscale.available ? 'tag-success' : 'tag-warning'">
            {{ upscale.available ? t('upscale.settings.ready') : t('upscale.settings.noModel') }}
          </span>
        </header>

        <UiSwitch
          :model-value="upscale.enabled"
          :label="t('upscale.settings.entryLabel')"
          :hint="hint"
          @update:model-value="upscale.setEnabled($event)"
        />
      </div>

      <!-- ============================================ GPU 加速 -->
      <div class="card card-pad">
        <header class="panel-head">
          <div>
            <h2 class="panel-title">{{ t('upscale.gpu.title') }}</h2>
            <p class="panel-sub">{{ t('upscale.gpu.desc') }}</p>
          </div>
          <button
            class="btn btn-ghost btn-sm"
            :disabled="upscale.gpuProbing || !upscale.installedModels.length"
            @click="upscale.detectGpu()"
          >
            <UiIcon name="refresh" :size="14" />
            {{ upscale.gpuProbing ? t('upscale.gpu.probing') : gpuStateLabel }}
          </button>
        </header>

        <UiSwitch
          :model-value="upscale.useGpu"
          :label="t('upscale.gpu.switchLabel')"
          :hint="gpuHint"
          :disabled="upscale.gpuProbing"
          @update:model-value="upscale.setUseGpu($event)"
        />

        <p v-if="upscale.gpuReason" class="gpu-reason">{{ upscale.gpuReason }}</p>
      </div>

      <!-- ============================================ 模型列表 -->
      <div class="card card-pad">
        <header class="panel-head">
          <div>
            <h2 class="panel-title">{{ t('upscale.model.sectionTitle') }}</h2>
            <p class="panel-sub">{{ t('upscale.model.sectionDesc') }}</p>
          </div>
        </header>

        <p v-if="!upscale.models.length" class="empty-hint">{{ t('upscale.model.listLoading') }}</p>

        <ul v-else class="model-list">
          <li v-for="item in upscale.models" :key="item.id" class="model-row">
            <div class="model-info">
              <div class="model-title">
                <span>{{ item.label }}</span>
                <span class="tag" :class="item.installed ? 'tag-success' : ''">
                  {{ item.installed ? t('upscale.model.installed') : `${formatBytes(item.sizeBytes)}` }}
                </span>
                <span v-if="upscale.activeModel?.id === item.id" class="tag tag-accent">{{ t('upscale.model.inUse') }}</span>
              </div>
              <p class="model-note">{{ item.note }}</p>
            </div>

            <div class="row gap-2">
              <button
                v-if="!item.installed"
                class="btn btn-primary btn-sm"
                :disabled="Boolean(upscale.busy)"
                @click="handleDownload(item.id)"
              >
                {{ upscale.busy === item.id ? t('upscale.model.downloading') : t('upscale.model.download') }}
              </button>
              <template v-else>
                <button
                  class="btn btn-ghost btn-sm"
                  :disabled="Boolean(upscale.busy)"
                  @click="upscale.selectModel(item.id)"
                >
                  {{ upscale.modelId === item.id ? t('upscale.model.selected') : t('upscale.model.select') }}
                </button>
                <button
                  class="icon-btn"
                  :title="t('upscale.model.remove')"
                  :disabled="Boolean(upscale.busy)"
                  @click="handleRemove(item.id)"
                >
                  <UiIcon name="trash" :size="15" />
                </button>
              </template>
            </div>
          </li>
        </ul>

        <p class="panel-foot">{{ t('upscale.model.footNote') }}</p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.upscale {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.panel-title {
  margin: 0 0 4px;
  font-size: var(--fs-14);
  font-weight: 650;
}
.panel-sub {
  margin: 0;
  max-width: 62ch;
  font-size: var(--fs-12);
  line-height: 1.6;
  color: var(--text-tertiary);
}
.panel-foot {
  margin: 14px 0 0;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  font-size: var(--fs-12);
  line-height: 1.6;
  color: var(--text-tertiary);
}
.notice {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.notice-title {
  margin: 0 0 4px;
  font-size: var(--fs-13);
  font-weight: 600;
}
.notice-text {
  margin: 0;
  font-size: var(--fs-12);
  line-height: 1.65;
  color: var(--text-tertiary);
}
.empty-hint {
  margin: 0;
  font-size: var(--fs-12);
  color: var(--text-tertiary);
}
.model-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.model-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-subtle);
}
.model-info {
  min-width: 0;
}
.model-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-13);
  font-weight: 600;
}
.model-note {
  margin: 4px 0 0;
  font-size: var(--fs-12);
  color: var(--text-tertiary);
}
.gpu-reason {
  margin: 10px 0 0;
  padding: 8px 10px;
  border-radius: var(--r-sm);
  background: var(--danger-soft);
  color: var(--danger);
  font-size: var(--fs-12);
  line-height: 1.6;
  white-space: pre-wrap;
}
</style>
