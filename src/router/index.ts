import { watch } from "vue";
import { createRouter, createWebHashHistory } from "vue-router";
import type { RouteLocationNormalized } from "vue-router";
import { locale, t } from "../i18n";
import type { MessageKey } from "../i18n";

/**
 * 路由表。
 *
 * ⚠️ **`meta` 里只放 `titleKey`（词条键），不放 `title`（文案）**。
 *
 * 路由表是模块级常量，`t()` 在模块求值时就把当时启动语言那一帧的文案算出来了，
 * 写进去等于把标题锁死在启动语言上——用户在设置里切到英文，标题还是中文，
 * 而且因为没有任何地方会再跑一次 `t()`，这个错状态会一直持续到重启。
 *
 * 所以：这里只声明「这条路由的标题对应哪个词条」，文案在**渲染期**查表，
 * 由下面的 `syncRouteTitle` 负责写进已解析路由的 `meta.title`。
 *
 * `path` / `name` 是数据（路由匹配与跳转靠它们），不翻译。
 */
const routes = [
  {
    path: "/",
    name: "home",
    component: () => import("../views/HomeView.vue"),
    meta: { titleKey: "nav.route.home" },
  },
  {
    path: "/generate",
    name: "generate",
    component: () => import("../views/ModelStudioView.vue"),
    meta: { titleKey: "nav.route.generate" },
  },
  // 兼容旧路径：文生图 / 图生图已合并到同一页面，通过 mode 切换
  { path: "/text2img", redirect: { path: "/generate", query: { mode: "text2img" } } },
  { path: "/img2img", redirect: { path: "/generate", query: { mode: "img2img" } } },
  {
    path: "/workflow",
    name: "workflow",
    component: () => import("../views/WorkflowView.vue"),
    meta: { titleKey: "nav.route.workflow" },
  },
  {
    path: "/upscale",
    name: "upscale",
    component: () => import("../views/UpscaleView.vue"),
    meta: { titleKey: "nav.route.upscale" },
  },
  {
    path: "/prompts",
    name: "prompts",
    component: () => import("../views/PromptLibraryView.vue"),
    meta: { titleKey: "nav.route.prompts" },
  },
  {
    path: "/history",
    name: "history",
    component: () => import("../views/HistoryView.vue"),
    meta: { titleKey: "nav.route.history" },
  },
  {
    path: "/settings",
    name: "settings",
    component: () => import("../views/SettingsView.vue"),
    meta: { titleKey: "nav.route.settings" },
  },
  { path: "/:pathMatch(.*)*", redirect: "/" },
];

export const router = createRouter({
  // 桌面端使用 hash 路由，避免 webview 刷新时丢失路径
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

/**
 * 当前路由的标题。
 *
 * 模板里**优先用这个函数**而不是读 `route.meta.title`：
 * 它在渲染期读响应式的 `locale`，切语言会自动重渲染；
 * `meta.title` 只是一个当刻的快照（给调试信息、窗口标题等非模板场合用）。
 */
export function routeTitle(route: RouteLocationNormalized): string {
  const key = route.meta.titleKey;
  return typeof key === "string" ? t(key as MessageKey) : String(route.name ?? "");
}

/**
 * 把当前语言的标题写进已解析路由的 `meta.title`。
 *
 * vue-router 每次导航都会用 `assign({}, record.meta)` 重新合并出一份 meta 快照，
 * 所以这里改的是**本次导航**的那份对象——也正是 `useRoute()` 拿到的那个。
 * 记录本身（`record.meta`）永远只有 `titleKey`，不会被写进任何语言的快照，
 * 免得下一条路由「继承」上一条语言的残留。
 */
function syncRouteTitle(route: RouteLocationNormalized) {
  route.meta.title = routeTitle(route);
}

// 每次导航（含首屏重定向）都刷新一次
router.afterEach(syncRouteTitle);

// 切语言时不会发生导航，afterEach 不会再跑，这里补一次。
// 放在模块顶层而不是组件里：路由标题是全局状态，
// 不该依赖「恰好有一个页面活着」才更新。
watch(locale, () => syncRouteTitle(router.currentRoute.value));
