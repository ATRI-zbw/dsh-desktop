"use strict";
/**
 * 主窗口(dsh web 页面)的 preload —— 通过 contextBridge 暴露极小的 API,
 * 供注入的右下角挂饰调用。sandbox: true 下仅可用 ipcRenderer/contextBridge。
 * 只暴露白名单方法,不暴露任何 Node 能力。
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dshDesktop", {
  // 打开设置窗口(托盘同款入口)
  openSettings: () => ipcRenderer.invoke("dsh:open-settings"),
  // 统计 token 用量
  getTokens: () => ipcRenderer.invoke("dsh:get-tokens"),
  // 查询 DeepSeek 余额
  getBalance: () => ipcRenderer.invoke("dsh:get-balance"),
});
