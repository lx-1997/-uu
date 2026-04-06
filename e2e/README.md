# RDK Studio E2E 自动化测试

## 快速开始

### 1. 安装 Playwright 浏览器

```bash
npm run playwright:install
```

### 2. 运行所有测试

```bash
npm run e2e
```

### 3. 仅运行 Windows / macOS 模拟

```bash
npm run e2e:win     # Desktop Chrome (模拟 Windows 环境)
npm run e2e:mac     # Desktop Safari (模拟 macOS 环境)
```

### 4. 查看测试报告

```bash
npm run e2e:report
```

报告位于 `e2e-report/` 目录，包含:
- **HTML 报告** (`index.html`) — 可视化用例结果、截图、视频
- **JSON 报告** (`results.json`) — 可对接 CI/CD 流水线

## 测试矩阵

| 测试集 | 覆盖范围 |
|--------|---------|
| TC-01 应用启动与健康检查 | 后端 /api/health、首页渲染、Dashboard 加载、主题切换 |
| TC-02 Tab 导航 | 8 个核心 Tab（工作台/OpenClaw/技能/终端/文件/VNC/IDE/烧录）切换 |
| TC-03 设备管理 UI | DeviceGuard 引导、添加设备弹窗 |
| TC-04 AI Dock | 对话坞面板展开、输入框聚焦 |
| TC-05 设置面板 | 设置面板打开/关闭 |
| TC-06 OpenClaw | 页面加载 |
| TC-07 Flasher | 烧录页面加载 |
| TC-08 窗口尺寸适配 | 1024×768 最小 / 1920×1080 最大 |

## 自定义 Fixtures

`fixtures.ts` 提供:
- `studioPage` — 已导航到首页并等待 Icon Rail 可见的 Page 实例
- `switchTab(page, tabName)` — 切换 Tab 导航
- `checkApiHealth(page)` — 检查 /api/health 端点
- `waitForToast(page, text)` — 等待指定 Toast 消息出现

## CI 集成建议

```yaml
# GitHub Actions 示例
- name: Install browsers
  run: npx playwright install --with-deps chromium
- name: Run E2E tests
  run: npm run e2e
- name: Upload report
  uses: actions/upload-artifact@v4
  with:
    name: e2e-report
    path: e2e-report/
```

## 测试失败时的产出

配置了失败时自动保留:
- **截图** (`e2e-results/` 目录)
- **视频** (录屏回放)
- **Trace** (Playwright Trace Viewer 可分析)

使用 `npx playwright show-trace <trace.zip>` 分析 Trace 文件。
