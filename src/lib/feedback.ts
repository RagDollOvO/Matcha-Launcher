/** 确认框里的结构化内容 */
export interface ConfirmExtra {
  layout?: 'import' | 'destructive';
  /** 要处理的条目；modId 对得上库里的 Mod 时显示缩略图 */
  items?: { modId?: string; trashId?: string; title: string; files: { file: string; size: number }[]; sizeBytes: number }[];
  /** 条目超出显示上限的数量 */
  more?: number;
  /** 要点：左边标签、右边内容 */
  facts?: { label: string; value: string; danger?: boolean }[];
  /** 需要用户先处理的事，例如在 Steam 取消订阅；links 可逐条复制 */
  warn?: { title: string; text: string; links?: string[] };
  /** 带标题的两列清单：平台计划的文件变化、模块调整等 */
  lists?: { title: string; rows: { k: string; v: string }[] }[];
}

export interface ToastAction { label: string; run: () => void }

export interface ActionFeedback {
  confirm(title: string, message: string, ok?: string, extra?: ConfirmExtra): Promise<boolean>;
  toast(text: string, action?: ToastAction, ms?: number): void;
  perform<T>(label: string, run: () => Promise<T>, success?: string, options?: { rescan?: boolean }): Promise<T | undefined>;
}
