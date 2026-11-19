import type { Component } from 'svelte';

/** 右键菜单 / 下拉菜单的条目。右键、批量栏、详情面板共用同一份条目表。 */
export type MenuItem =
  | { kind: 'sep' }
  | { kind: 'label'; label: string }
  | {
      kind?: 'item';
      label: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      icon?: Component<any>;
      /** 右侧的快捷键或补充说明 */
      hint?: string;
      danger?: boolean;
      /** 字符串 = 不可用，并作为悬停提示说明原因 */
      disabled?: string | false;
      /** 勾选框：true / false / 'mixed'（多选时部分包含） */
      checked?: boolean | 'mixed';
      /** 单选的当前项，只显示对勾 */
      current?: boolean;
      /** 树形缩进层级 */
      indent?: number;
      run?: () => void;
      items?: MenuItem[];
    };

export type MenuState = { x: number; y: number; items: MenuItem[] } | null;
