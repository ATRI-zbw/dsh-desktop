"use strict";
/**
 * 右下角挂饰 —— 以字符串方式注入 dsh web 页面。
 * 提供:设置入口 + token 用量 + DeepSeek 余额,点击刷新。
 * 通过 window.dshDesktop(preload 暴露)与主进程通信。
 * 注意:此文件被 main.js 读取后原样注入,必须自包含、无外部依赖。
 */
(function () {
  if (window.__dshWidgetInjected) return;
  window.__dshWidgetInjected = true;

  const api = window.dshDesktop;
  if (!api) return; // preload 未就绪则静默跳过

  function el(tag, attrs, text) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }

  const WIDGET_ID = "dsh-desktop-widget";
  if (document.getElementById(WIDGET_ID)) return;

  const host = el("div", { id: WIDGET_ID });
  const style = el("style");
  style.textContent = [
    `#${WIDGET_ID}{position:fixed;right:14px;bottom:14px;z-index:2147483647;display:flex;flex-direction:column;gap:8px;font-family:"Segoe UI","Microsoft YaHei",sans-serif;user-select:none;}`,
    `#${WIDGET_ID} .w-btn{display:flex;align-items:center;gap:6px;padding:7px 14px;border:none;border-radius:999px;background:rgba(24,26,36,.82);color:#fff;font-size:12px;cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,.28);backdrop-filter:blur(8px);transition:transform .12s ease,background .12s ease;}`,
    `#${WIDGET_ID} .w-btn:hover{background:rgba(50,56,80,.92);transform:translateY(-1px);}`,
    `#${WIDGET_ID} .w-btn:active{transform:translateY(0) scale(.97);}`,
    `#${WIDGET_ID} .w-btn .dot{width:7px;height:7px;border-radius:50%;background:#4ade80;flex-shrink:0;}`,
    `#${WIDGET_ID} .w-btn .dot.err{background:#f87171;}`,
    `#${WIDGET_ID} .w-btn .dot.load{background:#fbbf24;animation:pulse 1s infinite;}`,
    `@keyframes ${"dshwPulse"}{0%,100%{opacity:1}50%{opacity:.35}}`,
    `#${WIDGET_ID} .w-settings{background:linear-gradient(135deg,#4D6BFE,#1D2A6E);}`,
  ].join("\n");
  host.appendChild(style);

  // 设置按钮(与 dsh 自带设置区分,明确为桌面版设置)
  const btnSettings = el("button", { class: "w-btn w-settings" }, "⚙ 桌面设置");
  btnSettings.title = "打开桌面版设置（外观 / 更新 / token 详情）";
  btnSettings.addEventListener("click", () => api.openSettings());

  // token 按钮:显示用量,点击刷新
  const btnTokens = el("button", { class: "w-btn" });
  const dot = el("span", { class: "dot" });
  btnTokens.appendChild(dot);
  btnTokens.appendChild(el("span", { class: "w-txt" }, "token: …"));
  btnTokens.title = "点击刷新 token 用量";

  // 余额按钮
  const btnBalance = el("button", { class: "w-btn" });
  const bdot = el("span", { class: "dot" });
  btnBalance.appendChild(bdot);
  btnBalance.appendChild(el("span", { class: "w-txt" }, "余额: …"));
  btnBalance.title = "点击刷新余额";

  function fmt(n) {
    if (n == null) return "…";
    if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
    return String(n);
  }

  async function refreshTokens() {
    dot.className = "dot load";
    try {
      const t = await api.getTokens();
      if (t && t.totalTokens != null) {
        btnTokens.querySelector(".w-txt").textContent = "token: " + fmt(t.totalTokens);
        dot.className = "dot";
        btnTokens.title = `输入 ${fmt(t.inputTokens)} · 输出 ${fmt(t.outputTokens)} · 缓存 ${fmt(t.cacheReadTokens)} · 推理 ${fmt(t.reasoningTokens)} (${t.sessions} 会话)`;
      } else {
        btnTokens.querySelector(".w-txt").textContent = "token: -";
        dot.className = "dot err";
      }
    } catch {
      btnTokens.querySelector(".w-txt").textContent = "token: -";
      dot.className = "dot err";
    }
  }

  async function refreshBalance() {
    bdot.className = "dot load";
    try {
      const b = await api.getBalance();
      if (b && b.ok) {
        const infos = b.balanceInfos || [];
        if (infos.length > 0) {
          const lines = infos
            .map((i) => `${i.currency || ""} ${i.total_balance ?? "-"}（赠 ${i.granted_balance ?? "-"} / 充 ${i.topped_up_balance ?? "-"}）`)
            .join("\n");
          btnBalance.querySelector(".w-txt").textContent = "余额: " + (infos[0].total_balance ?? "?") + (infos[0].currency || "");
          btnBalance.title = lines + "\n点击刷新";
          bdot.className = "dot" + (b.isAvailable === false ? " err" : "");
        } else {
          btnBalance.querySelector(".w-txt").textContent = "余额: -";
          bdot.className = "dot err";
        }
      } else {
        btnBalance.querySelector(".w-txt").textContent = "余额: -";
        bdot.className = "dot err";
        btnBalance.title = b && b.error ? "查询失败: " + b.error + "\n点击重试" : "查询失败,点击重试";
      }
    } catch {
      btnBalance.querySelector(".w-txt").textContent = "余额: -";
      bdot.className = "dot err";
    }
  }

  btnTokens.addEventListener("click", refreshTokens);
  btnBalance.addEventListener("click", refreshBalance);

  host.appendChild(btnSettings);
  host.appendChild(btnTokens);
  host.appendChild(btnBalance);
  document.body.appendChild(host);

  // 初始加载后延迟刷新(等页面稳定)
  setTimeout(refreshTokens, 1500);
  setTimeout(refreshBalance, 2000);
  // 之后 token 每 30 秒自动刷新,余额不自动(避免频繁调 API)
  setInterval(refreshTokens, 30000);
})();
