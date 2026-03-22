#!/usr/bin/env python3
"""
RDK Hello LED - 最小可运行应用
功能：控制 GPIO LED 每秒闪烁一次
"""

import time
import sys

# 尝试导入 RDK GPIO 库
try:
    from horizon_gpio import GPIO
    HAS_GPIO = True
except ImportError:
    HAS_GPIO = False
    print("警告：未找到 horizon_gpio 库，使用模拟模式")

class HelloLED:
    def __init__(self, pin=18):
        self.pin = pin
        self.running = True
        
        if HAS_GPIO:
            GPIO.setmode(GPIO.BCM)
            GPIO.setup(self.pin, GPIO.OUT)
            print(f"已初始化 GPIO 引脚 {pin}")
        else:
            print("模拟模式：将打印 LED 状态而非实际控制")
    
    def blink(self, times=10, interval=1.0):
        """LED 闪烁指定次数"""
        print(f"开始闪烁 {times} 次，间隔 {interval} 秒")
        
        for i in range(times):
            if not self.running:
                break
                
            # 点亮 LED
            if HAS_GPIO:
                GPIO.output(self.pin, GPIO.HIGH)
            print(f"[{i+1}/{times}] LED ON")
            time.sleep(interval)
            
            # 熄灭 LED
            if HAS_GPIO:
                GPIO.output(self.pin, GPIO.LOW)
            print(f"[{i+1}/{times}] LED OFF")
            time.sleep(interval)
        
        print("闪烁完成")
    
    def cleanup(self):
        """清理资源"""
        if HAS_GPIO:
            GPIO.cleanup()
        print("已清理资源")

def main():
    print("=" * 40)
    print("RDK Hello LED 应用启动")
    print("=" * 40)
    
    led = HelloLED(pin=18)
    
    try:
        # 闪烁 10 次后停止
        led.blink(times=10, interval=1.0)
    except KeyboardInterrupt:
        print("\n用户中断")
    finally:
        led.cleanup()
    
    print("应用退出")

if __name__ == "__main__":
    main()
