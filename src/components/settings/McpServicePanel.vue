<script setup lang="ts">
/**
 * 设置页 · MCP 服务面板。
 *
 * 服务本身的实现全在 Rust（`src-tauri/src/mcp/`），这里只做三件事：
 * 开关它、把地址与令牌写进各家 Agent 客户端的配置、把运行情况摊开给人看。
 *
 * 不在这里另抄一份工具清单：列表来自服务端 schema（`mcp_tools`），
 * 两份清单一定会漂移。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useMcpStore } from "../../stores/mcp";
import { formatDuration, formatTime } from "../../platform/env";
import { t } from "../../i18n";
import UiIcon from "../ui/UiIcon.vue";

const mcp = useMcpStore();

const portDraft = ref(0);
const showToken = ref(false);
const openPreview = ref("");
const showTools = ref(false);

watch(
  () => mcp.status?.port,
  (port) => {
    if (typeof port === "number" && port > 0 && port !== portDraft.value) portDraft.value = port;
  },
  { immediate: true },
);

let stopWatch: (() => void) | null = null;
onMounted(() => {
  stopWatch = mcp.watch();
});
onBeforeUnmount(() => stopWatch?.());

const tokenMasked = computed(() => {
  const token = mcp.status?.token ?? "";
  if (!token) return t("mcp.token.unset");
  return showToken.value ? token : `${token.slice(0, 4)}••••••••${token.slice(-4)}`;
});

const portChanged = computed(
  () => Boolean(mcp.status) && portDraft.value > 0 && portDraft.value !== mcp.status?.port,
);

const configuredClients = computed(() => mcp.clients.filter((client) => client.configured));
const pendingClients = computed(() => mcp.clients.filter((client) => client.detected && !client.configured));

/** 「全选写入」按钮的文案里带上要写几个，点了会写什么一目了然 */
const batchLabel = computed(() =>
  pendingClients.value.length
    ? t("mcp.client.batchWithCount", { count: pendingClients.value.length })
    : t("mcp.client.batch"),
);

function tagOf(client: { configured: boolean; detected: boolean }) {
  if (client.configured) return { text: t("mcp.client.configured"), cls: "tag-success" };
  if (client.detected) return { text: t("mcp.client.detected"), cls: "tag-accent" };
  return { text: t("mcp.client.missing"), cls: "" };
}

async function toggleServer() {
  if (mcp.running) await mcp.stop();
  else await mcp.start();
}

async function applyPort() {
  if (!portChanged.value) return;
  await mcp.configure(portDraft.value);
}

function togglePreview(id: string) {
  openPreview.value = openPreview.value === id ? "" : id;
}

/** 快捷复制：只带 Agent 需要的最小信息，便于贴进对话里让客户端自己配 */
function quickSnippet() {
  const token = mcp.status?.token ?? "";
  return [
    t("mcp.guide.intro"),
    t("mcp.guide.name"),
    t("mcp.guide.transport"),
    t("mcp.guide.endpoint", { endpoint: mcp.endpoint }),
    token ? t("mcp.guide.header", { token }) : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function copyQuick() {
  await mcp.copy(quickSnippet(), t("mcp.action.copied"));
}
</script>

<template>
  <section class="mcp">
    <!-- 浏览器预览：没有宿主进程可监听端口 -->
    <div v-if="!mcp.supported" class="card card-pad notice">
      <UiIcon name="info" :size="16" />
      <div>
        <p class="notice-title">{{ t("mcp.desktopOnly.title") }}</p>
        <p class="notice-text">{{ t("mcp.desktopOnly.text") }}</p>
      </div>
    </div>

    <template v-else>
      <!-- ============================================ 服务开关与接入信息 -->
      <div class="card card-pad">
        <header class="panel-head">
          <div>
            <h2 class="panel-title">{{ t("mcp.title") }}</h2>
            <p class="panel-sub">{{ t("mcp.sub") }}</p>
          </div>
          <div class="row gap-2">
            <span class="tag" :class="mcp.running ? 'tag-success' : 'tag-warning'">
              <UiIcon :name="mcp.running ? 'check' : 'close'" :size="11" />
              {{ mcp.running ? t("mcp.status.running") : t("mcp.status.stopped") }}
            </span>
            <button
              class="btn btn-sm"
              :class="{ 'btn-primary': !mcp.running }"
              :disabled="mcp.busy === 'power' || !mcp.status"
              @click="toggleServer"
            >
              <UiIcon
                :name="mcp.busy === 'power' ? 'loader' : mcp.running ? 'stop' : 'power'"
                :size="14"
                :class="{ spin: mcp.busy === 'power' }"
              />
              {{ mcp.running ? t("mcp.action.stop") : t("mcp.action.start") }}
            </button>
          </div>
        </header>

        <p v-if="mcp.error" class="alert alert-danger">
          <UiIcon name="alert" :size="13" />{{ mcp.error }}
        </p>
        <p v-else-if="mcp.status?.lastError" class="alert alert-warn">
          <UiIcon name="alert" :size="13" />{{ t("mcp.lastError", { error: mcp.status.lastError }) }}
        </p>
        <p v-if="mcp.running && !mcp.bridgeReady" class="alert alert-warn">
          <UiIcon name="alert" :size="13" />
          {{ t("mcp.bridgeNotReady") }}
        </p>

        <div class="kv-grid">
          <div class="kv-item">
            <span class="kv-label">{{ t("mcp.endpoint.label") }}</span>
            <div class="row gap-1">
              <code class="t-mono grow t-ellipsis">{{ mcp.endpoint || t("mcp.endpoint.empty") }}</code>
              <button
                class="icon-btn"
                :title="t('mcp.endpoint.copy')"
                @click="mcp.copy(mcp.endpoint, t('mcp.endpoint.copied'))"
              >
                <UiIcon name="copy" :size="14" />
              </button>
            </div>
          </div>

          <div class="kv-item">
            <span class="kv-label">{{ t("mcp.token.label") }}</span>
            <div class="row gap-1">
              <code class="t-mono grow t-ellipsis">{{ tokenMasked }}</code>
              <button
                class="icon-btn"
                :title="showToken ? t('common.hideTitle') : t('common.showTitle')"
                @click="showToken = !showToken"
              >
                <UiIcon :name="showToken ? 'eye-off' : 'eye'" :size="14" />
              </button>
              <button
                class="icon-btn"
                :title="t('common.copy')"
                @click="mcp.copy(mcp.status?.token ?? '', t('mcp.token.copied'))"
              >
                <UiIcon name="copy" :size="14" />
              </button>
            </div>
          </div>

          <div class="kv-item">
            <span class="kv-label">{{ t("mcp.port.label") }}</span>
            <div class="row gap-1">
              <input
                v-model.number="portDraft"
                class="input"
                type="number"
                min="1024"
                max="65535"
                :placeholder="t('mcp.port.placeholder')"
                :disabled="!mcp.status"
              />
              <button class="btn" :disabled="!portChanged || mcp.busy === 'config'" @click="applyPort">
                {{ t("mcp.port.apply") }}
              </button>
            </div>
          </div>

          <div class="kv-item">
            <span class="kv-label">{{ t("mcp.tools.label") }}</span>
            <div class="row gap-1">
              <span class="t-strong">{{ t("mcp.tools.count", { count: mcp.tools.length }) }}</span>
              <button class="link-btn" @click="showTools = !showTools">
                {{ showTools ? t("mcp.tools.hide") : t("mcp.tools.show") }}
              </button>
            </div>
          </div>
        </div>

        <ul v-if="showTools" class="tool-list">
          <li v-for="tool in mcp.tools" :key="tool.name">
            <div class="tool-head">
              <code class="tool-name">{{ tool.name }}</code>
              <span class="tool-title">{{ tool.title }}</span>
            </div>
            <p class="tool-desc">{{ tool.description }}</p>
          </li>
        </ul>

        <div class="stat-row">
          <span class="tag tag-info">{{ t("mcp.stat.requests", { count: mcp.status?.requestCount ?? 0 }) }}</span>
          <span class="tag tag-info">{{ t("mcp.stat.calls", { count: mcp.status?.callCount ?? 0 }) }}</span>
          <span v-if="mcp.status?.startedAt" class="tag">{{ t("mcp.stat.startedAt", { time: formatTime(mcp.status.startedAt) }) }}</span>
          <span v-if="configuredClients.length" class="tag tag-success">
            {{ t("mcp.stat.configuredClients", { count: configuredClients.length }) }}
          </span>
        </div>

        <p class="hint">
          <UiIcon name="lock" :size="12" />
          {{ t("mcp.security.hint") }}
        </p>
        <div class="row gap-2" style="margin-top: 12px">
          <button class="btn btn-sm" @click="copyQuick">
            <UiIcon name="copy" :size="14" />{{ t("mcp.action.copyGuide") }}
          </button>
          <button
            class="btn btn-sm"
            :disabled="mcp.busy === 'config'"
            @click="mcp.configure(mcp.status?.port ?? 0, true)"
          >
            <UiIcon name="refresh" :size="14" />{{ t("mcp.action.rotateToken") }}
          </button>
        </div>
      </div>

      <!-- ============================================ 客户端配置 -->
      <div class="card card-pad">
        <header class="panel-head">
          <div>
            <h2 class="panel-title">{{ t("mcp.client.title") }}</h2>
            <p class="panel-sub">{{ t("mcp.client.sub") }}</p>
          </div>
          <button
            class="btn btn-sm"
            :disabled="mcp.busy === 'batch' || !pendingClients.length"
            @click="mcp.applyDetected()"
          >
            <UiIcon :name="mcp.busy === 'batch' ? 'loader' : 'zap'" :size="14" :class="{ spin: mcp.busy === 'batch' }" />
            {{ batchLabel }}
          </button>
        </header>

        <div class="client-list">
          <article v-for="client in mcp.clients" :key="client.id" class="client">
            <div class="client-head">
              <div class="client-title">
                <span class="client-name">{{ client.name }}</span>
                <span class="tag" :class="tagOf(client).cls">{{ tagOf(client).text }}</span>
                <span v-if="client.stdioBridge" class="tag tag-warning">{{ t("mcp.client.needsNode") }}</span>
              </div>
              <div class="row gap-1">
                <button
                  class="btn btn-sm"
                  :class="{ 'btn-primary': !client.configured }"
                  :disabled="mcp.busy === client.id"
                  @click="mcp.applyClient(client.id)"
                >
                  <UiIcon
                    :name="mcp.busy === client.id ? 'loader' : 'download'"
                    :size="14"
                    :class="{ spin: mcp.busy === client.id }"
                  />
                  {{ client.configured ? t("mcp.client.action.reapply") : t("mcp.client.action.apply") }}
                </button>
                <button class="icon-btn" :title="t('mcp.client.action.preview')" @click="togglePreview(client.id)">
                  <UiIcon :name="openPreview === client.id ? 'chevron-up' : 'code'" :size="14" />
                </button>
                <button class="icon-btn" :title="t('mcp.client.action.reveal')" @click="mcp.revealClient(client.id)">
                  <UiIcon name="folder-open" :size="14" />
                </button>
                <button
                  v-if="client.configured"
                  class="icon-btn"
                  :title="t('mcp.client.action.remove')"
                  @click="mcp.removeClient(client.id)"
                >
                  <UiIcon name="trash" :size="14" />
                </button>
              </div>
            </div>

            <p class="client-path t-mono t-ellipsis">{{ client.path }}</p>
            <p class="client-note">{{ client.note }}</p>

            <pre v-if="openPreview === client.id" class="snippet">{{ client.preview }}</pre>
          </article>
        </div>

        <p class="hint">
          <UiIcon name="info" :size="12" />
          {{ t("mcp.client.restartHint") }}
        </p>
      </div>

      <!-- ============================================ 调用记录 -->
      <div class="card card-pad">
        <header class="panel-head">
          <div>
            <h2 class="panel-title">{{ t("mcp.calls.title") }}</h2>
            <p class="panel-sub">{{ t("mcp.calls.sub") }}</p>
          </div>
          <button class="btn btn-sm" :disabled="!mcp.calls.length" @click="mcp.clearCalls()">
            <UiIcon name="trash" :size="14" />{{ t("mcp.calls.clear") }}
          </button>
        </header>

        <div v-if="!mcp.calls.length" class="empty-log">
          <UiIcon name="plug" :size="22" class="t-faint" />
          <p class="t-2nd">{{ t("mcp.calls.empty") }}</p>
          <p class="t-xs t-3rd">{{ t("mcp.calls.emptyHint") }}</p>
        </div>

        <ul v-else class="log-list">
          <li v-for="call in mcp.calls" :key="call.id" class="log">
            <span class="log-dot" :class="call.ok ? 'is-ok' : 'is-fail'" />
            <div class="log-main">
              <div class="log-line">
                <code class="log-tool">{{ call.tool }}</code>
                <span class="t-xs t-3rd">{{ formatDuration(call.durationMs) }}</span>
                <span class="t-xs t-3rd">{{ formatTime(call.at) }}</span>
              </div>
              <p class="log-args t-mono t-ellipsis">{{ call.args }}</p>
              <p class="log-summary" :class="{ 'is-fail': !call.ok }">{{ call.summary }}</p>
            </div>
          </li>
        </ul>
      </div>

      <!-- ============================================ 怎么用 -->
      <div class="card card-pad">
        <h2 class="panel-title">{{ t("mcp.howto.title") }}</h2>
        <ol class="steps">
          <li>{{ t("mcp.howto.step1") }}</li>
          <li>{{ t("mcp.howto.step2") }}</li>
          <li>{{ t("mcp.howto.step3") }}</li>
          <li>{{ t("mcp.howto.step4") }}</li>
          <li>{{ t("mcp.howto.step5") }}</li>
        </ol>
        <p class="hint">
          <UiIcon name="alert" :size="12" />
          {{ t("mcp.howto.warning") }}
        </p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.mcp {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* -------------------------------------------------- 通用标题 */

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}
.panel-title {
  font-size: var(--fs-16);
  font-weight: 680;
  letter-spacing: -0.015em;
}
.panel-sub {
  margin-top: 4px;
  font-size: var(--fs-12);
  color: var(--text-tertiary);
  line-height: 1.6;
  max-width: 68ch;
}
.panel-sub code,
.hint code,
.notice code,
.steps code {
  padding: 1px 5px;
  border-radius: var(--r-xs);
  background: var(--bg-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
}

/* -------------------------------------------------- 提示条 */

.alert {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin-bottom: 14px;
  padding: 10px 12px;
  border-radius: var(--r-md);
  font-size: var(--fs-12);
  line-height: 1.55;
  word-break: break-word;
}
.alert-danger {
  background: var(--danger-soft);
  color: var(--danger);
}
.alert-warn {
  background: var(--warning-soft);
  color: var(--warning);
}

.notice {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  color: var(--text-secondary);
}
.notice-title {
  font-size: var(--fs-14);
  font-weight: 620;
  color: var(--text);
}
.notice-text {
  margin-top: 4px;
  font-size: var(--fs-12);
  line-height: 1.65;
}

/* -------------------------------------------------- 接入信息 */

.kv-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 24px;
}
.kv-item {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.kv-label {
  font-size: var(--fs-12);
  color: var(--text-tertiary);
}
.kv-item code {
  height: 30px;
  /* 单行垂直居中用 line-height（30px 高 - 上下各 1px 边框）；
     刻意不用 flex 居中——那会让 .t-ellipsis 的省略号失效，长地址会被硬裁 */
  line-height: 28px;
  padding: 0 9px;
  border-radius: var(--r-sm);
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-secondary);
}
.kv-item .input {
  /* 端口输入框同理：与同行的 .btn（34px）等高，别用 .btn-sm 配 34px 的输入框 */
  height: 34px;
}

.stat-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 18px;
}

.hint {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin-top: 14px;
  font-size: var(--fs-11);
  line-height: 1.65;
  color: var(--text-tertiary);
}
.hint strong {
  font-weight: 620;
  color: var(--text-secondary);
}

/* -------------------------------------------------- 工具清单 */

.tool-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
  padding: 14px;
  border-radius: var(--r-md);
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  /* 项目里没有全局 ul 重置：不显式清掉，列表会带项目符号与 40px 缩进 */
  list-style: none;
}
.tool-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tool-name {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--accent-soft-fg);
  background: var(--accent-soft);
  padding: 1px 6px;
  border-radius: var(--r-xs);
}
.tool-title {
  font-size: var(--fs-12);
  font-weight: 560;
}
.tool-desc {
  margin-top: 4px;
  font-size: var(--fs-11);
  line-height: 1.6;
  color: var(--text-tertiary);
}

/* -------------------------------------------------- 客户端卡片 */

.client-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.client {
  padding: 14px;
  border-radius: var(--r-md);
  border: 1px solid var(--border);
  background: var(--bg-subtle);
}
.client-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.client-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.client-name {
  font-size: var(--fs-14);
  font-weight: 620;
}
.client-path {
  margin-top: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-tertiary);
}
.client-note {
  margin-top: 6px;
  font-size: var(--fs-11);
  line-height: 1.6;
  color: var(--text-tertiary);
}
.snippet {
  margin-top: 12px;
  padding: 12px;
  border-radius: var(--r-sm);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
  overflow-x: auto;
}

/* -------------------------------------------------- 调用记录 */

.empty-log {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 30px 0;
  text-align: center;
}
.log-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 320px;
  overflow-y: auto;
  /* 同 tool-list：清掉浏览器默认的项目符号与左缩进（行本身用 flex 布局） */
  list-style: none;
  margin: 0;
  padding: 0;
}
.log {
  display: flex;
  gap: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}
.log:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}
.log-dot {
  flex: none;
  width: 7px;
  height: 7px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--text-faint);
}
.log-dot.is-ok {
  background: var(--success);
}
.log-dot.is-fail {
  background: var(--danger);
}
.log-main {
  min-width: 0;
  flex: 1;
}
.log-line {
  display: flex;
  align-items: center;
  gap: 10px;
}
.log-tool {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 560;
}
.log-args {
  margin-top: 3px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-tertiary);
}
.log-summary {
  margin-top: 3px;
  font-size: var(--fs-11);
  line-height: 1.6;
  color: var(--text-secondary);
  word-break: break-word;
}
.log-summary.is-fail {
  color: var(--danger);
}

/* -------------------------------------------------- 步骤 */

.steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
  padding-left: 20px;
  font-size: var(--fs-12);
  line-height: 1.7;
  color: var(--text-secondary);
}
.steps b {
  color: var(--text);
  font-weight: 620;
}

@media (max-width: 900px) {
  .kv-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
