/**
 * OpenClaw Skills Provider — Ingests skill definitions from SKILL.md files.
 *
 * These are the skills that OpenClaw (the on-board AI agent gateway) can use.
 * RDK Studio reads them, registers them in the ecosystem, and can also
 * provision NEW skills to the board (turning NodeHub/ModelZoo resources into
 * OpenClaw-callable skills).
 */

import type {
  EcoProvider,
  EcoSkill,
  OpenClawSkillDef,
  RdkPlatform,
} from '../../../shared/ecosystem-types.js';

interface SeedOCSkill {
  id: string;
  name: string;
  desc: string;
  platform: RdkPlatform;
  requiredBins: string[];
  runCmd: string;
  tags: string[];
  category: string;
}

const SEED_OC_SKILLS: SeedOCSkill[] = [
  {
    id: 'openclaw.rdk-x5-app',
    name: 'RDK X5 App 预装示例',
    desc: '运行 /app 目录下 12 个 Python AI demo、40pin GPIO 示例、C++ 多媒体示例',
    platform: 'rdk-x5',
    requiredBins: ['python3'],
    runCmd: 'cd /app/pydev_demo/07_yolov5_sample && /usr/bin/python3.10 test_yolov5.py',
    tags: ['app', 'demo', '示例', 'pydev', 'gpio', '多媒体'],
    category: '示例',
  },
  {
    id: 'openclaw.rdk-x5-tros',
    name: 'RDK X5 TROS 机器人开发',
    desc: '启动 43 个预装 ROS2 算法包、管理话题节点、构建 camera+AI+output pipeline',
    platform: 'rdk-x5',
    requiredBins: ['ros2'],
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch dnn_node_example dnn_node_example.launch.py',
    tags: ['tros', 'ros2', 'pipeline', '机器人', '话题', '节点'],
    category: '机器人',
  },
  {
    id: 'openclaw.rdk-x5-ai-detect',
    name: 'RDK X5 BPU AI 推理',
    desc: '在 10TOPS BPU 上运行 YOLO、分类、分割、人脸、手势、DOSOD、LLM 等单 AI 算法',
    platform: 'rdk-x5',
    requiredBins: ['ros2'],
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch dnn_node_example dnn_node_example.launch.py dnn_example_config_file:=config/yolov5sworkconfig.json',
    tags: ['ai', 'bpu', '推理', 'yolo', '检测', '分类', '分割', 'llm', 'dosod'],
    category: 'AI',
  },
  {
    id: 'openclaw.rdk-x5-camera',
    name: 'RDK X5 摄像头管理',
    desc: '配置 MIPI/USB/RTSP 摄像头，调整分辨率帧率，排查摄像头问题',
    platform: 'rdk-x5',
    requiredBins: ['python3'],
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch mipi_cam mipi_cam.launch.py',
    tags: ['camera', '摄像头', 'mipi', 'usb', 'rtsp', '视频'],
    category: '硬件',
  },
  {
    id: 'openclaw.rdk-x5-gpio',
    name: 'RDK X5 GPIO 控制',
    desc: '40pin GPIO 输入输出、I2C/SPI/UART/PWM 控制',
    platform: 'rdk-x5',
    requiredBins: ['python3'],
    runCmd: 'cd /app/40pin_samples && sudo python3 simple_out.py',
    tags: ['gpio', 'i2c', 'spi', 'uart', 'pwm', '引脚', '40pin'],
    category: '硬件',
  },
  {
    id: 'openclaw.rdk-x5-monitor',
    name: 'RDK X5 系统监控',
    desc: 'BPU/CPU/温度/内存/磁盘/网络实时监控与告警',
    platform: 'rdk-x5',
    requiredBins: ['hrut_smi'],
    runCmd: 'hrut_smi && free -h && df -h && cat /sys/class/thermal/thermal_zone0/temp',
    tags: ['monitor', '监控', 'bpu', 'cpu', '温度', '内存', '诊断'],
    category: '系统',
  },
];

function seedToSkill(seed: SeedOCSkill): OpenClawSkillDef {
  const skillMdContent = `---
name: ${seed.id.split('.').pop()}
description: "${seed.desc}"
license: MIT-0
metadata:
  openclaw:
    requires:
      bins: [${seed.requiredBins.join(', ')}]
    compatibility:
      platform: ${seed.platform}
---
# ${seed.name}
${seed.desc}

## 执行
\`\`\`bash
${seed.runCmd}
\`\`\`
`;

  return {
    id: seed.id,
    source: 'openclaw_skill',
    name: seed.name,
    description: seed.desc,
    category: seed.category,
    tags: seed.tags,
    platforms: [seed.platform],
    installCmd: `mkdir -p /opt/openclaw/skills/${seed.id.split('.').pop()}`,
    runCmd: seed.runCmd,
    uninstallCmd: `rm -rf /opt/openclaw/skills/${seed.id.split('.').pop()}`,
    preconditions: seed.requiredBins.map((bin) => ({
      type: 'binary' as const,
      check: `command -v ${bin}`,
      message: `${bin} 未安装`,
    })),
    routingKeywords: seed.tags,
    boardStatusByDevice: {},
    skillMdContent,
    requiredBins: seed.requiredBins,
  };
}

export class OpenClawSkillProvider implements EcoProvider {
  source: 'openclaw_skill' = 'openclaw_skill';

  async fetchAll(platforms?: RdkPlatform[]): Promise<EcoSkill[]> {
    let skills = SEED_OC_SKILLS.map(seedToSkill);
    if (platforms?.length) {
      skills = skills.filter((s) =>
        s.platforms.some((p) => platforms.includes(p)),
      );
    }
    return skills;
  }
}
