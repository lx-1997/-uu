# RDK文档助手（优化版）

## 📋 概述

这是原始 `rdk-doc` skill 的优化版本，主要改进点：
1. **包含GitHub文档引用** - 每个回答都提供可验证的官方文档链接
2. **标准化回答格式** - 一致的格式使信息更易读
3. **增强可信度** - 用户可以直接查看原始文档验证答案

## 🚀 主要特性

### 1. GitHub文档引用
- 自动将本地文档路径转换为GitHub链接
- 支持文档标题提取和锚点链接
- 提供完整的引用信息：标题 + URL + 本地路径

### 2. 标准化回答格式
```
问题: [用户问题]

答案: [简洁明了的答案]

📚 文档来源:
📖 参考文档: [文档标题](GitHub链接)
📁 本地路径: `/path/to/local/file.md`

🔍 详细说明:
[详细的解释、步骤或配置]

💡 相关提示:
- 实用建议
- 注意事项
- 相关命令
```

### 3. 工具函数支持
- `github_url_mapper.py`: 本地路径 ↔ GitHub链接转换
- 文档标题提取
- 锚点查找功能

## 📁 文件结构

```
rdk-doc-optimized/
├── SKILL.md                    # 主要技能文件
├── README.md                   # 说明文档
├── references/
│   └── github_url_mapper.py    # GitHub链接转换工具
└── examples/
    └── example_response.py     # 示例回答生成
```

## 🔧 使用方法

### 1. 激活技能
当用户询问RDK相关问题时，自动触发此技能。

### 2. 查找文档
使用 `exec` 或 `read` 命令搜索相关文档：
```bash
# 查找包含特定关键词的文档
find /tmp/rdk_doc -name "*.md" -type f | xargs grep -l "波特率" | head -5
```

### 3. 生成引用
```python
from references.github_url_mapper import format_reference

# 将本地路径转换为引用
ref = format_reference("/tmp/rdk_doc/docs/01_Quick_start/hardware_introduction/rdk_x3.md")

# 输出格式化的引用
print(f"📖 参考文档: [{ref['title']}]({ref['url']})")
print(f"📁 本地路径: `{ref['local_path']}`")
```

### 4. 生成完整回答
使用 `generate_response_with_references()` 函数创建标准化的回答。

## 🎯 示例

### 用户问题:
"RDK X3的调试串口波特率是多少？"

### 优化后的回答:
```
**问题**: RDK X3的调试串口波特率是多少？

**答案**: RDK X3开发板的调试串口波特率是 **921600**。

📚 **文档来源**:
📖 **参考文档**: [RDK X3硬件介绍 - 调试串口章节](https://github.com/D-Robotics/rdk-doc/blob/main/docs/01_Quick_start/hardware_introduction/rdk_x3.md#debug_uart)
📁 **本地路径**: `/tmp/rdk_doc/docs/01_Quick_start/hardware_introduction/rdk_x3.md`

🔍 **详细说明**:
**调试串口配置**:
- 波特率（Baud rate）: 921600
- 数据位（Data bits）: 8
- 奇偶校验（Parity）: None
- 停止位（Stop bits）: 1
- 流控（Flow Control）: 无

**相关命令**:
如果需要修改波特率，可以在 `/boot/boot.cmd` 文件中配置，然后重新生成 boot.scr 文件：
```bash
mkimage -C none -A arm -T script -d boot.cmd boot.scr
```

💡 **相关提示**:
- 以上信息基于RDK官方文档
- 具体实现可能因版本不同有所差异
- 建议在实际操作前查阅相关文档
```

## 🌟 优势对比

| 特性 | 原始版本 | 优化版本 |
|------|----------|----------|
| GitHub引用 | ❌ 不支持 | ✅ 支持 |
| 标准化格式 | ❌ 不一致 | ✅ 一致 |
| 文档可验证性 | ❌ 低 | ✅ 高 |
| 信息完整性 | ⚠️ 一般 | ✅ 完整 |
| 用户体验 | ⚠️ 一般 | ✅ 优秀 |

## 🔗 GitHub仓库映射

本地文档与GitHub仓库的对应关系：

| 本地目录 | GitHub仓库 | 主要用途 |
|----------|------------|----------|
| `/tmp/rdk_doc/docs/` | [rdk-doc/docs/](https://github.com/D-Robotics/rdk-doc/tree/main/docs) | 主文档（X3/X5/Ultra） |
| `/tmp/rdk_doc/docs_s/` | [rdk-doc/docs_s/](https://github.com/D-Robotics/rdk-doc/tree/main/docs_s) | S100专用文档 |
| `/tmp/rdk_model_zoo/` | [rdk_model_zoo/](https://github.com/D-Robotics/rdk_model_zoo) | 算法模型库 |
| `/tmp/rdk_imu/` | [rdk_imu/](https://github.com/D-Robotics/rdk_imu) | IMU模块驱动 |

## 📝 最佳实践

1. **先搜索后回答**: 使用 `find` 和 `grep` 快速定位相关文档
2. **多重验证**: 如果可能，从多个文档来源验证信息
3. **提供上下文**: 不仅给出答案，还要解释为什么
4. **标注注意事项**: 重要的警告和限制条件要明确标出
5. **保持更新**: 定期检查文档更新，确保信息准确

## 🚨 注意事项

1. **GitHub链接有效性**: 确保映射的GitHub仓库存在且可访问
2. **版本差异**: 文档版本可能与实际系统版本有差异
3. **权限问题**: 某些操作可能需要root权限
4. **硬件差异**: 不同批次或型号的硬件可能有细微差异

## 🔄 更新计划

- [ ] 添加更多GitHub仓库映射
- [ ] 支持离线模式（当GitHub不可访问时）
- [ ] 添加文档版本检测
- [ ] 创建文档摘要生成功能
- [ ] 添加用户反馈机制

## 📊 效果评估

使用此优化版skill后：
- ✅ 回答的可信度显著提升
- ✅ 用户可以轻松验证信息来源
- ✅ 减少了重复解释的需要
- ✅ 提高了问题解决的效率

---

**开发团队**: OpenClaw AI助手  
**最后更新**: 2026-03-18  
**版本**: v1.0.0-optimized  
**许可证**: MIT