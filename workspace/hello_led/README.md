# RDK Hello LED

最小可运行的 RDK 应用示例。

## 功能
控制 GPIO LED 每秒闪烁一次，共闪烁 10 次。

## 依赖
- Python 3.6+
- RDK 设备上的 `horizon_gpio` 库（可选，没有则运行模拟模式）

## 运行方式

### 在 RDK 设备上运行
```bash
# 上传到设备
# 方式 1: 通过 SCP
scp hello_led.py root@<device-ip>:/userdata/apps/hello_led/

# 方式 2: 通过 RDK Studio 文件上传功能

# 在设备上执行
python3 /userdata/apps/hello_led/hello_led.py
```

### 本地模拟运行（无设备时）
```bash
python3 hello_led.py
```

## 预期输出
```
========================================
RDK Hello LED 应用启动
========================================
已初始化 GPIO 引脚 18（或：模拟模式）
开始闪烁 10 次，间隔 1.0 秒
[1/10] LED ON
[1/10] LED OFF
[2/10] LED ON
[2/10] LED OFF
...
闪烁完成
已清理资源
应用退出
```

## 自定义参数

修改代码中的参数：
- `pin=18`: GPIO 引脚号
- `times=10`: 闪烁次数
- `interval=1.0`: 闪烁间隔（秒）

## 下一步扩展

1. 添加按钮控制启停
2. 添加 ROS2 节点发布 LED 状态
3. 添加 Web 界面远程控制
4. 添加多种闪烁模式（SOS、呼吸灯等）
