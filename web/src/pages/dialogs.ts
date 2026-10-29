import type { ApiResult, DuplicateDetails, DuplicatePolicy, Group, Link } from '../lib/api.ts';
import { button } from '../ui/button.ts';
import { el } from '../lib/dom.ts';
import { field } from '../ui/field.ts';
import { openDialog, openDrawer, overlayActions, type OverlayHandle } from '../ui/overlay.ts';
import { toast } from '../ui/toast.ts';

/** 提交防重复：onClick 内先 disable 自己，finally（含异常）恢复 */


export type LinkDraft = { group_id: number; url: string; title: string; description: string; icon?: string };

export function openGroupDialog(options: {
  mode: 'create' | 'rename';
  group?: Group;
  onSubmit: (name: string) => Promise<ApiResult<{ group: Group; merged: boolean }>>;
  onDone: () => Promise<void> | void;
}): OverlayHandle {
  const { mode, group, onSubmit, onDone } = options;
  const handle = openDialog({
    title: mode === 'create' ? '新建分组' : '重命名分组',
    subtitle: mode === 'create' ? '同名分组会自动合并到已有分组' : '改成已存在的名字会触发合并，链接一并迁移',
    index: 0,
  });

  const nameField = field({
    label: '分组名',
    value: group ? group.name : '',
    placeholder: '例如：阅读 / 工具箱 / 待读',
    required: true,
    index: 0,
    autofocus: true,
  });

  const submit = button({
    label: mode === 'create' ? '建组' : '保存',
    iconName: 'check',
    variant: 'primary',
    onClick: async (event) => {
      const btn = event.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      try {
        const name = (nameField.input as HTMLInputElement).value.trim();
        if (!name) {
          toast('分组名不能为空', 'error');
          return;
        }
        const result = await onSubmit(name);
        if (!result.ok) {
          toast(result.error.message, 'error');
          return;
        }
        if (result.data.merged) toast('已合并到同名分组', 'info');
        handle.close();
        await onDone();
      } finally {
        btn.disabled = false;
      }
    },
  });

  nameField.input.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Enter') submit.click();
  });

  handle.body.append(nameField.wrapper, overlayActions(submit));
  return handle;
}

export function openConfirmDialog(options: {
  title: string;
  message: string;
  confirmLabel?: string;
  index?: number;
  onConfirm: () => Promise<void> | void;
}): OverlayHandle {
  const { title, message, confirmLabel = '确认', index = 3, onConfirm } = options;
  const handle = openDialog({ title, subtitle: message, index });
  const confirm = button({
    label: confirmLabel,
    iconName: 'trash',
    variant: 'primary',
    onClick: async (event) => {
      const btn = event.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      try {
        await onConfirm();
        handle.close();
      } finally {
        btn.disabled = false;
      }
    },
  });
  const cancel = button({ label: '取消', variant: 'secondary', onClick: () => handle.close() });
  handle.body.appendChild(overlayActions(cancel, confirm));
  return handle;
}

type DuplicateChoice = { policy: DuplicatePolicy; label: string; hint: string; index: number };

const DUPLICATE_CHOICES: DuplicateChoice[] = [
  { policy: 'allow', label: '仍然添加', hint: '两个分组各留一份', index: 1 },
  { policy: 'ignore', label: '忽略并不再提示', hint: '这次放行，以后同一网址到该分组不再弹窗', index: 2 },
  { policy: 'skip', label: '不添加', hint: '保留已存在的那条', index: 3 },
];

export function openDuplicateDialog(options: {
  details: DuplicateDetails;
  onChoose: (policy: DuplicatePolicy) => void;
}): OverlayHandle {
  const { details, onChoose } = options;
  const handle = openDialog({
    title: '这个网址已经在别的分组里',
    subtitle: '已存在于「' + details.existing.group_name + '」，要不要在目标分组再存一份？',
    index: 4,
    onClose: () => onChoose('skip'),
  });

  const preview = el('div', {
    class: 'panel rounded-2xl border-4 border-tertiary p-4',
  });
  preview.append(
    el('p', { class: 'font-display text-[11px] uppercase tracking-[0.25em] text-tertiary', text: details.existing.group_name }),
    el('p', { class: 'mt-1 text-lg font-bold text-fg', text: details.existing.title }),
    el('p', { class: 'mt-1 break-all text-sm text-fg/60', text: details.existing.url }),
  );

  const choices = el('div', { class: 'mt-5 grid gap-3 sm:grid-cols-3' });
  for (const choice of DUPLICATE_CHOICES) {
    const wrapper = el('div', { class: 'flex flex-col gap-2' });
    wrapper.append(
      button({
        label: choice.label,
        variant: choice.policy === 'allow' ? 'primary' : choice.policy === 'ignore' ? 'secondary' : 'outline',
        size: 'sm',
        onClick: () => {
          handle.close();
          onChoose(choice.policy);
        },
      }),
      el('span', { class: 'text-xs text-fg/60', text: choice.hint }),
    );
    choices.appendChild(wrapper);
  }

  handle.body.append(preview, choices);
  return handle;
}

export type LinkDrawerOptions = {
  mode: 'create' | 'edit';
  groups: Group[];
  link?: Link;
  defaultGroupId?: number;
  submit: (draft: LinkDraft, policy?: DuplicatePolicy) => Promise<ApiResult<unknown>>;
  remove?: () => Promise<ApiResult<unknown>>;
  onDone: () => Promise<void> | void;
};

export function openLinkDrawer(options: LinkDrawerOptions): OverlayHandle {
  const { mode, groups, link, defaultGroupId, submit, remove, onDone } = options;
  const handle = openDrawer({
    title: mode === 'create' ? '收一条新书签' : '编辑书签',
    subtitle: mode === 'create' ? '网址会自动归一化去重，同组重复直接合并' : link ? link.url : '',
    index: 1,
  });

  const urlField = field({
    label: '网址',
    type: 'url',
    value: link ? link.url : '',
    placeholder: 'https://example.com/page',
    required: true,
    index: 0,
    autofocus: mode === 'create',
  });

  const titleField = field({
    label: '标题（留空自动取域名路径）',
    value: link ? link.title : '',
    placeholder: '给这条书签一个名字',
    index: 1,
  });

  const descField = field({
    label: '备注',
    value: link && link.description ? link.description : '',
    placeholder: '为什么收藏它',
    index: 2,
    textarea: true,
    rows: 3,
  });

  const iconField = field({
    label: '自定义图标 URL（留空自动抓取 favicon）',
    type: 'url',
    value: link && link.icon ? link.icon : '',
    placeholder: 'https://example.com/logo.png',
    index: 3,
  });

  const groupSelect = el('select', {
    class: 'w-full border border-[var(--c-line)] bg-[var(--c-panel)] px-3 h-10 text-fg',
  });
  for (const group of groups) {
    const option = el('option', { value: String(group.id), text: group.name });
    if ((link ? link.group_id : defaultGroupId) === group.id) (option as HTMLOptionElement).selected = true;
    groupSelect.appendChild(option);
  }
  const groupLabel = el('label', { class: 'mb-2 inline-block font-display text-[12px] uppercase tracking-[0.2em] text-quinary', text: '所在分组' });
  const groupWrap = el('div', { class: 'w-full' }, groupLabel, groupSelect);

  const submitButton = button({
    label: mode === 'create' ? '收藏' : '保存',
    iconName: 'check',
    variant: 'primary',
    onClick: (event) => {
      const btn = event.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      void run().finally(() => {
        btn.disabled = false;
      });
    },
  });

  const run = async (policy?: DuplicatePolicy): Promise<void> => {
    const draft: LinkDraft = {
      group_id: Number((groupSelect as HTMLSelectElement).value),
      url: (urlField.input as HTMLInputElement).value.trim(),
      title: (titleField.input as HTMLInputElement).value.trim(),
      description: (descField.input as HTMLTextAreaElement).value.trim(),
      icon: (iconField.input as HTMLInputElement).value.trim() || undefined,
    };
    if (!draft.url) {
      toast('网址不能为空', 'error');
      return;
    }
    const result = await submit(draft, policy);
    if (!result.ok) {
      if (result.error.code === 'CROSS_GROUP_DUPLICATE' && result.error.details) {
        openDuplicateDialog({
          details: result.error.details as DuplicateDetails,
          onChoose: (choice) => {
            if (choice === 'skip') {
              toast('已保留原有书签', 'info');
              handle.close();
              void onDone();
              return;
            }
            void run(choice);
          },
        });
        return;
      }
      toast(result.error.message, 'error');
      return;
    }
    toast(mode === 'create' ? '已收藏' : '已保存', 'success');
    handle.close();
    void onDone();
  };

  handle.body.append(
    urlField.wrapper,
    titleField.wrapper,
    descField.wrapper,
    iconField.wrapper,
    groupWrap,
    overlayActions(
      remove
        ? button({
            label: '删除',
            iconName: 'trash',
            variant: 'secondary',
            onClick: () => {
              openConfirmDialog({
                title: '删除这条书签',
                message: '删除后不可恢复（备份除外）',
                onConfirm: async () => {
                  const result = await remove();
                  if (!result.ok) {
                    toast(result.error.message, 'error');
                    return;
                  }
                  toast('已删除', 'success');
                  handle.close();
                  void onDone();
                },
              });
            },
          })
        : null,
      submitButton,
    ),
  );

  return handle;
}
