# 贡献指南（Contributing）

感谢你愿意参与本项目！这是一个个人开源项目，维护节奏取决于反馈量。
在动手之前，请花两分钟读完这份指南。

## 如何提交 Issue

- 先搜索已有 Issue，避免重复
- 标题简明扼要；正文包含：
  - 复现步骤（越具体越好）
  - 期望行为 vs 实际行为
  - 环境信息：Windows 版本、Node 版本、dsh CLI 版本、桌面版版本
  - 相关日志（`%APPDATA%\dsh-desktop\logs\` 下的日志内容）
- Bug 请带上完整报错文本，不要只截图

## 如何提交 PR

1. Fork 本仓库，从 `main` 切一个功能分支（如 `fix/port-detection`）
2. 保持改动聚焦：一个 PR 只解决一个问题
3. 代码风格：与现有代码一致（CommonJS、`"use strict"`、中文注释、Windows 友好）
4. 如果改了构建/打包逻辑，请本地跑通 `npm run dist` 并附上结果
5. PR 描述里说明改了什么、为什么、怎么验证

## 开发环境

```powershell
npm install
npm start                     # 开发运行
npm run icon                  # 生成图标（改图标后）
npm run dist                  # 构建便携版 + NSIS
npm start -- --smoke-test     # 冒烟测试：起服务→打印就绪地址→退出
```

> 注意：桌面版依赖本机已安装的全局 `@deepseek-ai/dsh` CLI。
> 如遇沙箱/权限问题（Windows 上执行 node.exe 被拒、GitHub 下载超时），
> 参考项目文档中的镜像与权限说明。

## 提交信息规范

建议使用 Conventional Commits 风格：

- `feat: ...` 新功能
- `fix: ...` 修复
- `docs: ...` 文档
- `chore: ...` 构建/杂项
- `refactor: ...` 重构（不改变行为）

## 行为准则

保持友善、就事论事。本项目拒绝任何形式的骚扰与歧视。
