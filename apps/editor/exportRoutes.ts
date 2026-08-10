/**
 * 导出桥的路由 —— **唯一来源**。
 *
 * 两端共用：
 *   · `vite-plugin-export.ts`（dev server 侧，import 了 node:fs / node:child_process）
 *   · `src/exportRoom.ts`（浏览器侧）
 *
 * 之所以单独一个文件而不是让浏览器侧 import 那个插件：插件带着 node 内建模块，
 * 一旦被浏览器侧引用就会进模块图。这个文件**只有常量、零 import**，两端都能吃。
 * （同 `three.alias.ts` 的动机：与其两处各写一遍再靠人记得同步，不如物理上只有一份。）
 */

export const EXPORT_ROUTE = '/__tjre/export';
export const REVEAL_ROUTE = '/__tjre/reveal';
