import { useCallback, useEffect, useState } from 'react';

/**
 * ============================================================
 *  界面语言（中文 / English）
 * ============================================================
 *
 *  刻意不引入 i18n 库：当前字符串量很小，一个字典 + 一个 hook 就够，
 *  引库反而多一层构建依赖与配置。等字符串量上来（Phase 2 的编辑 UI）再评估。
 *
 *  ⚠️ **范围限制**：这里只覆盖编辑器**界面文案**。
 *  校验诊断（`message` / `hint`）由 `packages/core` 产生，目前是**预格式化的
 *  中文字符串**（已经把具体数值插好了）。要让它们双语，规则必须改成产出
 *  「消息 key + 参数」而不是成品句子 —— 那是一次涉及 29 条规则的改造，
 *  单独一轮做。详见 docs/CONVENTIONS.md。
 */

export const LOCALES = ['zh', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_LABEL: Readonly<Record<Locale, string>> = {
  zh: '中文',
  en: 'English',
};

/** 文案字典。两种语言的键必须完全一致 —— 有测试强制检查。 */
const MESSAGES = {
  zh: {
    'app.title': 'ThreeJsRoomEditor',
    'app.subtitle': 'Phase 1 · 只读视口',

    'field.language': '界面语言',
    'field.room': '房间（每个房间 = 一个独立关卡）',
    'field.level': '关卡文件',

    'section.display': '显示',
    'section.room': '房间',
    'section.diagnostics': '诊断',

    'toggle.structures': '内部结构件（夹层 / 楼梯 / 廊桥）',
    'toggle.lights': '房间灯光（关卡自带布光）',
    'toggle.ssr': '屏幕空间反射 + 时域抗锯齿',
    'toggle.ceiling': '天花（挡住内部，默认关）',
    'toggle.wireframe': '线框模式（核对几何拓扑）',
    'toggle.firstPerson': '第一人称漫游',

    'row.stage': '校验阶段',
    'row.spec': '规格',
    'row.outer': '外廓（含墙）',
    'row.interior': '净内空',
    'row.height': '层高',
    'row.theme': '主题',
    'row.backend': '渲染后端',
    'row.frames': '已渲染帧',
    'row.meshes': 'Mesh 数',
    'row.openings': '其它开口',
    'row.portals': '传送门',
    'row.structures': '结构件',
    'row.props': '道具',
    'row.lights': '光源',
    'row.markers': '标记',

    'unit.cells': '格',
    'unit.shadowCasters': '盏投影',
    'value.derived': '（派生）',
    'value.framesStalled': '0（循环未启动！）',
    'value.none': '无',

    'hint.orbit': '鼠标左键旋转 · 滚轮缩放 · 右键平移',
    'hint.fpsLine1': '点击画面锁定鼠标 · WASD 移动 · Shift 加速',
    'hint.fpsLine2': 'Space 跳 · Esc 退出锁定',

    'error.validationFailed': '关卡在 {stage} 阶段校验失败，无法渲染。见右侧诊断。',
    'error.rendererInit': '✗ 渲染器初始化失败',

    'note.singleRoom':
      '每个房间是独立关卡，房间之间由**传送门**在运行时连接 —— 因此这里只显示当前房间。',
    'note.diagnosticsLang': '诊断信息目前仅有中文（由校验器产生，见 i18n.ts 说明）。',
    'note.postFallback': '⚠ 后处理管线构建失败，已回落到直接渲染（无反射）。房间仍可正常编辑。',
  },
  en: {
    'app.title': 'ThreeJsRoomEditor',
    'app.subtitle': 'Phase 1 · read-only viewport',

    'field.language': 'Language',
    'field.room': 'Room (each room = one standalone level)',
    'field.level': 'Level file',

    'section.display': 'Display',
    'section.room': 'Room',
    'section.diagnostics': 'Diagnostics',

    'toggle.structures': 'Interior structures (mezzanine / stairs / catwalk)',
    'toggle.lights': 'Room lights (the level’s own lighting)',
    'toggle.ssr': 'Screen-space reflections + temporal AA',
    'toggle.ceiling': 'Ceiling (hides the interior, off by default)',
    'toggle.wireframe': 'Wireframe (verify geometry topology)',
    'toggle.firstPerson': 'First-person walkthrough',

    'row.stage': 'Validation stage',
    'row.spec': 'Spec',
    'row.outer': 'Outer (incl. walls)',
    'row.interior': 'Interior (clear)',
    'row.height': 'Clear height',
    'row.theme': 'Theme',
    'row.backend': 'Render backend',
    'row.frames': 'Frames rendered',
    'row.meshes': 'Meshes',
    'row.openings': 'Other openings',
    'row.portals': 'Portals',
    'row.structures': 'Structures',
    'row.props': 'Props',
    'row.lights': 'Lights',
    'row.markers': 'Markers',

    'unit.cells': 'cells',
    'unit.shadowCasters': 'casting shadows',
    'value.derived': '(derived)',
    'value.framesStalled': '0 (loop never started!)',
    'value.none': 'none',

    'hint.orbit': 'LMB orbit · wheel zoom · RMB pan',
    'hint.fpsLine1': 'Click to lock pointer · WASD to move · Shift to sprint',
    'hint.fpsLine2': 'Space to jump · Esc to release pointer',

    'error.validationFailed':
      'Level failed validation at the {stage} stage; nothing to render. See diagnostics on the right.',
    'error.rendererInit': '✗ Renderer failed to initialise',

    'note.singleRoom':
      'Each room is a standalone level; rooms are linked by **portals** at runtime — so only the current room is shown here.',
    'note.diagnosticsLang':
      'Diagnostics are currently Chinese-only (produced by the validator; see i18n.ts).',
    'note.postFallback':
      '⚠ Post-processing pipeline failed to build; fell back to direct rendering (no reflections). The room is still fully editable.',
  },
} as const;

export type MessageKey = keyof (typeof MESSAGES)['zh'];

/** 供测试断言两种语言的键集一致 */
export const MESSAGE_TABLE = MESSAGES;

const STORAGE_KEY = 'tjre.locale';

function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null && (LOCALES as readonly string[]).includes(saved)) return saved as Locale;
  } catch {
    // localStorage 在隐私模式 / 沙箱 iframe 里可能抛异常 —— 回落到浏览器语言
  }
  return typeof navigator !== 'undefined' && navigator.language.startsWith('zh') ? 'zh' : 'en';
}

export type Translate = (key: MessageKey, params?: Record<string, string>) => string;

export interface I18n {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
}

export function useI18n(): I18n {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // 存不进去不影响使用，忽略
    }
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  }, [locale]);

  const t = useCallback<Translate>(
    (key, params) => {
      const template: string = MESSAGES[locale][key];
      if (params === undefined) return template;
      return Object.entries(params).reduce(
        (text, [name, value]) => text.replaceAll(`{${name}}`, value),
        template,
      );
    },
    [locale],
  );

  return { locale, setLocale: setLocaleState, t };
}
