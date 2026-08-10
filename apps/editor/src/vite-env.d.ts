/// <reference types="vite/client" />

/** `?raw` 导入的类型声明 —— 关卡 YAML 以纯文本引入 */
declare module '*?raw' {
  const content: string;
  export default content;
}
