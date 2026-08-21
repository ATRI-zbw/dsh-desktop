# remote/ · 手机遥控模块（规划中）

> 状态：**规划中，尚未开始实现**。本文档记录已确认的设计方向，
> 供后续开发直接参照，避免返工。

## 目标

让用户**躺在床上用手机**控制本机：查看工作进度、派发任务、
批准沙箱外请求，无需坐在电脑前。

## 核心设计原则

1. **手机只发命令，电脑干活**：文件操作（复制/压缩/备份）在电脑本地执行，
   手机只收结果摘要 —— 蓝牙带宽（1–10 KB/s）撑不起传输，撑得起命令
2. **传输层与业务解耦**：命令协议（JSON）与链路无关，
   未来可平滑升级：蓝牙（一期）→ WiFi/局域网（二期）→ 远程中继（三期）

## 架构

```
手机 App（Flutter，业务：派任务/看状态/批准）
        ↕ 统一 JSON 命令协议
传输层：BLE GATT（一期，电脑做 server / 手机做 client）
```

## 链路选型

- 主选 **BLE**：Windows 端用 WinRT `GattServiceProvider`（Win10 1803+）做 GATT
  server，两个特征：`command`（可写）+ `response`（可读/通知）
- Android 备选 SPP（RFCOMM 串口）；iOS 不支持 SPP（当前目标用户为 Android）
- 不做 HID 伪装

## 命令协议（示例）

```json
{"id":"a1","cmd":"list_dir","path":"."}
{"id":"a2","cmd":"read_file","path":"README.md","max_bytes":8000}
{"id":"a3","cmd":"dsh_status"}
{"id":"a4","cmd":"dsh_send","prompt":"检查今天的构建产物"}
{"id":"a5","cmd":"file_op","op":"copy","src":"a","dst":"backup/a"}
{"id":"a6","cmd":"approve","req_id":"..."}
```

## 安全（已确认：精简防护档）

- 配对双向确认 + BLE 加密链路
- 路径沙箱（限制在指定工作目录内，拒绝 `..` 逃逸）
- 危险操作白名单枚举（删除/覆盖/执行外部程序）
- 空闲 10 分钟自动断开；电脑端托盘显示连接者与操作日志，可一键踢掉
- 管理员级（UAC）请求不可手机批准，只能提醒

## 分阶段

- P0：WinRT GattServiceProvider 可行性验证
- P1：目录浏览 + 读文本 + dsh 状态查询（只读）
- P2：文件操作 + dsh 任务提交/结果回传 + 批准沙箱请求
- P3：会话管理、日志分页、体验打磨

## 技术要点备忘

- `bleno` 不支持 Windows 做 peripheral → 用 WinRT `GattServiceProvider`
  （C#/PowerShell 薄层）+ Node 业务逻辑
- Android 12+ 需 `BLUETOOTH_SCAN` / `BLUETOOTH_CONNECT` 运行时权限
- ColorOS 等厂商 ROM 的后台蓝牙限制：需前台服务/常驻通知
- APK 分发：自签名侧载 + SHA256 校验和（暂不上商店）
