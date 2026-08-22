"use strict";
/**
 * 设置窗口 preload —— 通过 contextBridge 暴露最小 API 给渲染进程。
 * sandbox: true 下仅可用 ipcRenderer/contextBridge 子集。
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dshSettings", {
  getStatus: () => ipcRenderer.invoke("settings:get-status"),
  setApiKey: (key) => ipcRenderer.invoke("settings:set-api-key", key),
  checkUpdate: () => ipcRenderer.invoke("settings:check-update"),
  updateDsh: () => ipcRenderer.invoke("settings:update-dsh"),
  openDownload: (url) => ipcRenderer.invoke("settings:open-download", url),
  getPrefs: () => ipcRenderer.invoke("settings:get-prefs"),
  setPrefs: (prefs) => ipcRenderer.invoke("settings:set-prefs", prefs),
  pickImage: () => ipcRenderer.invoke("settings:pick-image"),
  getTokens: () => ipcRenderer.invoke("settings:get-tokens"),
});
