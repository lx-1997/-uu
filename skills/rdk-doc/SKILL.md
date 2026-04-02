---
name: RDK 文档助手（本地文档库）
description: RDK 开发板文档助手。用户询问 X3/X5/S100 使用、烧录、配置、示例等时触发；可指导在板端 /tmp/rdk_doc/docs/ 读取官方文档目录回答问题。
version: 1.0.0
trigger: 文档,怎么用,烧录,安装,配置,GPIO,摄像头,MIPI,RDK X3,RDK X5,S100,Ultra,快速开始,FAQ,远程登录,示例,rdk_doc,本地文档
risk: low
permissions: device_exec,network
delegate_preference: hybrid
requires_board: false
approval_level: none
cooldown_seconds: 0
scheduler_template: none
category: Knowledge
---

# RDK 文档助手

你可以从本地的 RDK 文档库获取答案。文档位于 `/tmp/rdk_doc/docs/`

## 文档结构

```
docs/
├── 01_Quick_start/     # 快速开始 - 系统安装、硬件介绍
├── 02_System_configuration/  # 系统配置
├── 03_Basic_Application/     # 基础应用开发 - IO控制、音视频采集
├── 04_Algorithm_Application/ # 算法应用开发
├── 05_Robot_development/     # 机器人应用开发
├── 06_Application_case/      # 应用案例
├── 07_Advanced_development/  # 进阶开发
├── 08_FAQ/            # 常见问题
├── 09_Appendix/       # 附录 - 常用命令
├── 10_Release_Note/   # 版本发布记录
└── RDK.md            # 总览文档
```

## 支持的产品

- **RDK X3** (旭日X3派) - 5Tops算力
- **RDK X3 Module** (旭日X3模组)
- **RDK X5** - 10Tops算力
- **RDK Ultra** - 96Tops算力
- **RDK S100** - 8Tops算力

## 常用查询

当用户问起时，可以快速定位：

1. **系统烧录** → `01_Quick_start/install_os/`
2. **远程登录** → `01_Quick_start/remote_login.md`
3. **下载资源** → `01_Quick_start/download.md`
4. **GPIO/PWM使用** → `03_Basic_Application/`
5. **MIPI摄像头** → `04_Algorithm_Application/` 或 `03_Basic_Application/`
6. **常见问题** → `08_FAQ/`

## 回答格式

回答时：
- 直接给出答案或解决步骤
- 复杂的可以给出文档路径让用户自行查看
- 可以用 exec 读取具体文档内容
