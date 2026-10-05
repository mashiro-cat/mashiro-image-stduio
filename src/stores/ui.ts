import { ref } from "vue";
import { defineStore } from "pinia";
import type { ToastItem } from "../types";
import { uid } from "../platform/env";
import { ApiError } from "../platform/http";
import { t } from "../i18n";

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  tone?: "default" | "danger";
}

interface ConfirmState extends Required<Omit<ConfirmOptions, "message">> {
  open: boolean;
  message: string;
  resolve?: (value: boolean) => void;
}

export const useUiStore = defineStore("ui", () => {
  const toasts = ref<ToastItem[]>([]);
  const sidebarCollapsed = ref(false);
  /** 请求日志抽屉 */
  const debugDrawerOpen = ref(false);

  const confirmState = ref<ConfirmState>({
    open: false,
    title: "",
    message: "",
    confirmText: "",
    cancelText: "",
    tone: "default",
  });

  function notify(type: ToastItem["type"], title: string, message?: string, ttl = 3600) {
    const item: ToastItem = { id: uid("toast"), type, title, message };
    toasts.value.push(item);
    window.setTimeout(() => dismiss(item.id), ttl);
    return item.id;
  }

  const success = (title: string, message?: string) => notify("success", title, message);
  const error = (title: string, message?: string) => notify("error", title, message, 5200);
  const info = (title: string, message?: string) => notify("info", title, message);
  const warning = (title: string, message?: string) => notify("warning", title, message, 4400);

  function dismiss(id: string) {
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
  }

  function confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      confirmState.value = {
        open: true,
        title: options.title,
        message: options.message ?? "",
        // 词条在**调用时**取：模块级常量会锁死启动时的语言
        confirmText: options.confirmText ?? t("common.confirm"),
        cancelText: options.cancelText ?? t("common.cancel"),
        tone: options.tone ?? "default",
        resolve,
      };
    });
  }

  function resolveConfirm(value: boolean) {
    confirmState.value.resolve?.(value);
    confirmState.value.open = false;
    confirmState.value.resolve = undefined;
  }

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value;
  }

  function openDebugDrawer() {
    debugDrawerOpen.value = true;
  }

  function closeDebugDrawer() {
    debugDrawerOpen.value = false;
  }

  /**
   * 把异常转成一行可读文案。
   * ApiError 会带上针对 524 / 401 等状态码的排查建议，便于用户自助定位。
   */
  function describe(err: unknown): string {
    if (err instanceof ApiError) {
      return [err.message, err.hint].filter(Boolean).join(" · ");
    }
    return err instanceof Error ? err.message : String(err);
  }

  /** 统一错误提示：把异常转成可读文案 */
  function handleError(err: unknown, fallback = t("mcp.toast.actionFailed")) {
    error(fallback, describe(err).slice(0, 260));
  }

  /**
   * 接口类失败：附带「查看日志」入口，方便一键跳到请求日志排错。
   * 停留时间更长，避免用户还没看清就消失。
   */
  function requestFailed(title: string, err: unknown, fallback = "") {
    const message = err ? describe(err) : fallback;
    const item: ToastItem = {
      id: uid("toast"),
      type: "error",
      title,
      message: message.slice(0, 260),
      action: { label: t("nav.menu.openLog"), kind: "debug" },
    };
    toasts.value.push(item);
    window.setTimeout(() => dismiss(item.id), 7200);
    return item.id;
  }

  return {
    toasts,
    sidebarCollapsed,
    debugDrawerOpen,
    confirmState,
    notify,
    success,
    error,
    info,
    warning,
    dismiss,
    confirm,
    resolveConfirm,
    toggleSidebar,
    openDebugDrawer,
    closeDebugDrawer,
    describe,
    handleError,
    requestFailed,
  };
});
