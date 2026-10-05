<script setup lang="ts">
import { computed, ref } from "vue";
import type { PromptSource } from "../../services/promptRepo";
import { usePromptRepoStore } from "../../stores/promptRepos";
import { usePromptStore } from "../../stores/prompts";
import { useUiStore } from "../../stores/ui";
import { formatRelative, openExternal } from "../../platform/env";
import { t } from "../../i18n";
import UiModal from "../ui/UiModal.vue";
import UiSwitch from "../ui/UiSwitch.vue";
import UiIcon from "../ui/UiIcon.vue";

defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean]; pulled: [] }>();

const prompts = usePromptStore();
const repos = usePromptRepoStore();
const ui = useUiStore();

/** 是否连同分类全集一起拉取（体积更大、内容更全） */
const includeCollections = ref(false);
/** 最近一次拉取中跳过的文档 */
const failures = ref<Array<{ path: string; message: string }>>([]);

const sources = computed(() => repos.sources);
const busy = computed(() => Boolean(repos.pullingId));

function localCount(source: PromptSource) {
  return prompts.countRepo(source.repo);
}

function isPulling(source: PromptSource) {
  return repos.pullingId === source.id;
}

function hasCollections(source: PromptSource) {
  return Boolean(source.collections?.length);
}

async function openRepo(source: PromptSource) {
  const url = `https://github.com/${source.repo}`;
  const ok = await openExternal(url);
  if (!ok) ui.warning(t("prompts.msg.openBrowserFailed"), t("prompts.msg.openBrowserFailedDesc", { url }));
}

async function onPull(source: PromptSource) {
  if (busy.value) return;
  failures.value = [];
  try {
    const result = await repos.pull(source, {
      includeCollections: includeCollections.value && hasCollections(source),
    });
    failures.value = result.failures;
    if (result.added || result.updated) {
      ui.success(
        t("prompts.msg.repoDone.title", { name: source.shortName }),
        t("prompts.msg.repoDone.desc", { added: result.added, updated: result.updated, total: result.total }),
      );
    } else if (result.failures.length) {
      ui.error(t("prompts.msg.repoFailed.title"), result.failures[0].message);
    } else {
      ui.info(t("prompts.msg.repoUpToDate"), t("prompts.msg.repoUpToDate.desc", { total: result.total }));
    }
    emit("pulled");
  } catch (err) {
    ui.requestFailed(t("prompts.msg.repoPullFailed"), err);
  }
}

async function onClear(source: PromptSource) {
  const count = localCount(source);
  if (!count) return;
  const ok = await ui.confirm({
    title: t("prompts.confirm.clearRepo.title", { name: source.shortName, count }),
    message: t("prompts.confirm.clearRepo.desc"),
    confirmText: t("prompts.confirm.clearRepo.action"),
    tone: "danger",
  });
  if (!ok) return;
  const removed = repos.clear(source);
  ui.success(t("prompts.msg.repoCleared"), t("prompts.msg.repoClearedCount", { count: removed }));
}
</script>

<template>
  <UiModal
    :open="open"
    :title="t('prompts.repo.title')"
    :description="t('prompts.repo.desc')"
    :width="680"
    @update:open="emit('update:open', $event)"
  >
    <div class="repo-list">
      <article v-for="source in sources" :key="source.id" class="repo-card">
        <header class="repo-head">
          <span class="repo-mark"><UiIcon name="github" :size="18" /></span>
          <div class="grow" style="min-width: 0">
            <h4 class="repo-name">{{ source.name }}</h4>
            <button class="repo-link" @click="openRepo(source)">
              {{ source.repo }}
              <UiIcon name="external" :size="11" />
            </button>
          </div>
          <span class="tag">{{ source.license }}</span>
        </header>

        <p class="repo-summary">{{ source.summary }}</p>

        <div class="repo-meta">
          <span v-if="repos.recordOf(source.id)" class="t-xs t-3rd">
            {{
              t("prompts.repo.lastPulled", {
                time: formatRelative(repos.recordOf(source.id)!.lastPulledAt),
                added: repos.recordOf(source.id)!.added,
                updated: repos.recordOf(source.id)!.updated,
              })
            }}
          </span>
          <span v-else class="t-xs t-faint">{{ t("prompts.repo.neverPulled") }}</span>
          <span v-if="localCount(source)" class="tag tag-brand">{{
            t("prompts.repo.localCount", { count: localCount(source) })
          }}</span>
        </div>

        <div v-if="isPulling(source)" class="repo-progress">
          <UiIcon name="loader" :size="14" class="spin" />
          <span class="grow t-ellipsis">{{ repos.progress?.step ?? t("prompts.repo.pulling") }}</span>
          <span class="t-xs t-3rd">
            {{
              t("prompts.repo.progress", { done: (repos.progress?.done ?? 0) + 1, total: repos.progress?.total ?? 1 })
            }}
          </span>
        </div>

        <footer class="repo-foot">
          <button class="btn btn-sm btn-soft" :disabled="busy || !localCount(source)" @click="onClear(source)">
            <UiIcon name="trash" :size="13" />{{ t("prompts.repo.clearLocal") }}
          </button>
          <span class="grow" />
          <button class="btn btn-sm btn-primary" :disabled="busy" @click="onPull(source)">
            <UiIcon :name="isPulling(source) ? 'loader' : 'cloud'" :size="13" :class="{ spin: isPulling(source) }" />
            {{
              isPulling(source)
                ? t("prompts.repo.pulling")
                : localCount(source)
                  ? t("prompts.repo.repull")
                  : t("prompts.repo.pull")
            }}
          </button>
        </footer>
      </article>
    </div>

    <UiSwitch
      v-model="includeCollections"
      :label="t('prompts.repo.includeCollections')"
      :hint="t('prompts.repo.includeCollectionsHint')"
    />

    <ul v-if="failures.length" class="failure-list">
      <li v-for="item in failures" :key="item.path">
        <UiIcon name="alert" :size="13" />
        <span class="t-ellipsis">{{ item.message }}</span>
      </li>
    </ul>

    <p class="foot-note">
      {{ t("prompts.repo.footNote") }}
    </p>
  </UiModal>
</template>

<style scoped>
.repo-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.repo-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--bg-subtle);
}
.repo-head {
  display: flex;
  align-items: flex-start;
  gap: 11px;
}
.repo-mark {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: var(--r-sm);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  color: var(--text);
}
.repo-name {
  font-size: var(--fs-14);
  font-weight: 650;
}
.repo-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent);
  font-size: var(--fs-11);
  font-family: var(--font-mono, monospace);
  cursor: pointer;
}
.repo-link:hover {
  text-decoration: underline;
}
.repo-summary {
  font-size: var(--fs-12);
  line-height: 1.7;
  color: var(--text-secondary);
}
.repo-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.repo-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--r-sm);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  font-size: var(--fs-12);
  color: var(--text-secondary);
}
.repo-foot {
  display: flex;
  align-items: center;
  gap: 10px;
}
.failure-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-subtle);
  font-size: var(--fs-12);
  color: var(--text-secondary);
}
.failure-list li {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.foot-note {
  margin-top: 12px;
  font-size: var(--fs-11);
  line-height: 1.7;
  color: var(--text-tertiary);
}
</style>
