/**
 * NodeHub Provider — Ingests RDK applications from D-Robotics NodeHub.
 *
 * Current strategy: static seed data (from your existing BUILTIN_APPS).
 * Future: fetch from https://developer.d-robotics.cc/nodehub API when available.
 *
 * Each NodeHub app becomes a NodeHubSkill that AI Dock can install/run/stop.
 */

import type {
  EcoProvider,
  EcoSkill,
  NodeHubSkill,
  RdkPlatform,
} from '../../../shared/ecosystem-types.js';

interface SeedApp {
  id: string;
  name: string;
  desc: string;
  category: string;
  platforms: RdkPlatform[];
  pkgName: string;
  processKey: string;
  installCmd: string;
  runCmd: string;
  stopCmd: string;
  uninstallCmd: string;
  repo: string;
  scenario: string;
  launchFile?: string;
  dependencies: string[];
  tags: string[];
}

const SEED_APPS: SeedApp[] = [
  {
    id: 'nodehub.vision.yolo-detect',
    name: 'YOLO 目标检测',
    desc: '基于 hobot_dnn 的实时 YOLO 目标检测，支持 80 类物体识别',
    category: '视觉',
    platforms: ['rdk-x3', 'rdk-x5', 'rdk-ultra'],
    pkgName: 'tros-dnn-node-example',
    processKey: 'dnn_node_example',
    installCmd: 'sudo apt install -y tros-hobot-dnn tros-dnn-node-example',
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch dnn_node_example dnn_node_example.launch.py',
    stopCmd: 'pkill -f dnn_node_example || true',
    uninstallCmd: 'sudo apt remove -y tros-dnn-node-example',
    repo: 'https://developer.d-robotics.cc/nodehub/detail/168',
    scenario: '适合巡检、安防、视觉触发控制场景',
    dependencies: ['tros-hobot-dnn'],
    tags: ['yolo', '目标检测', 'detection', 'object', '视觉', 'dnn'],
  },
  {
    id: 'nodehub.vision.body-detection',
    name: '人体骨骼点检测',
    desc: '人体关键点检测与姿态估计，17 个骨骼关键点',
    category: '视觉',
    platforms: ['rdk-x3', 'rdk-x5', 'rdk-ultra'],
    pkgName: 'tros-hobot-body-det',
    processKey: 'hobot_body_det',
    installCmd: 'sudo apt install -y tros-hobot-body-det',
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch hobot_body_det hobot_body_det.launch.py',
    stopCmd: 'pkill -f hobot_body_det || true',
    uninstallCmd: 'sudo apt remove -y tros-hobot-body-det',
    repo: 'https://developer.d-robotics.cc/nodehub/detail/169',
    scenario: '适合人体跟随、互动识别与姿态分析',
    dependencies: [],
    tags: ['人体', '骨骼', 'body', 'skeleton', 'pose', '姿态'],
  },
  {
    id: 'nodehub.nav.orb-slam3',
    name: 'ORB-SLAM3',
    desc: '视觉 SLAM 建图与定位，支持单目/双目/RGB-D',
    category: '导航',
    platforms: ['rdk-x3', 'rdk-x5', 'rdk-ultra'],
    pkgName: 'tros-orb-slam3',
    processKey: 'orb_slam3',
    installCmd: 'sudo apt install -y tros-orb-slam3',
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch orb_slam3 orb_slam3.launch.py',
    stopCmd: 'pkill -f orb_slam3 || true',
    uninstallCmd: 'sudo apt remove -y tros-orb-slam3',
    repo: 'https://developer.d-robotics.cc/nodehub/detail/170',
    scenario: '适合建图定位、路径规划前置能力',
    dependencies: [],
    tags: ['slam', '建图', '定位', '导航', 'mapping', 'localization'],
  },
  {
    id: 'nodehub.nav.nav2',
    name: 'Nav2 导航',
    desc: 'ROS2 自主导航框架，包含路径规划与障碍物避让',
    category: '导航',
    platforms: ['rdk-x3', 'rdk-x5', 'rdk-ultra'],
    pkgName: 'tros-nav2-bringup',
    processKey: 'nav2_bringup|navigation_launch',
    installCmd: 'sudo apt install -y tros-nav2-bringup',
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch nav2_bringup navigation_launch.py',
    stopCmd: 'pkill -f nav2 || true',
    uninstallCmd: 'sudo apt remove -y tros-nav2-bringup',
    repo: 'https://developer.d-robotics.cc/nodehub/detail/171',
    scenario: '适合室内导航、巡线与自动回充场景',
    dependencies: [],
    tags: ['导航', 'navigation', 'nav2', '路径规划', 'planner'],
  },
  {
    id: 'nodehub.audio.tts',
    name: '语音合成 TTS',
    desc: '文本转语音输出，支持中英文',
    category: '语音',
    platforms: ['rdk-x3', 'rdk-x5', 'rdk-ultra'],
    pkgName: 'tros-hobot-tts',
    processKey: 'hobot_tts',
    installCmd: 'sudo apt install -y tros-hobot-tts',
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch hobot_tts hobot_tts.launch.py',
    stopCmd: 'pkill -f hobot_tts || true',
    uninstallCmd: 'sudo apt remove -y tros-hobot-tts',
    repo: 'https://developer.d-robotics.cc/nodehub/detail/172',
    scenario: '适合语音播报、对话反馈与提示音场景',
    dependencies: [],
    tags: ['语音', 'tts', '语音合成', 'speech', '播报'],
  },
  {
    id: 'nodehub.vision.hand-gesture',
    name: '手势识别',
    desc: '实时手势检测与分类，支持多种手势指令',
    category: '视觉',
    platforms: ['rdk-x3', 'rdk-x5', 'rdk-ultra'],
    pkgName: 'tros-hand-gesture-det',
    processKey: 'hand_gesture_det',
    installCmd: 'sudo apt install -y tros-hand-gesture-det',
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch hand_gesture_det hand_gesture_det.launch.py',
    stopCmd: 'pkill -f hand_gesture_det || true',
    uninstallCmd: 'sudo apt remove -y tros-hand-gesture-det',
    repo: 'https://developer.d-robotics.cc/nodehub/detail/173',
    scenario: '适合非接触式交互与手势控制场景',
    dependencies: [],
    tags: ['手势', 'gesture', '识别', '交互', 'hand'],
  },
  {
    id: 'nodehub.vision.dosod',
    name: 'DOSOD 开放词汇检测',
    desc: '地瓜自研开放词汇目标检测，支持语音指令指定检测目标',
    category: '视觉',
    platforms: ['rdk-x5', 'rdk-ultra'],
    pkgName: 'tros-hobot-dosod',
    processKey: 'dosod',
    installCmd: 'sudo apt install -y tros-hobot-dosod',
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch hobot_dosod dosod.launch.py',
    stopCmd: 'pkill -f dosod || true',
    uninstallCmd: 'sudo apt remove -y tros-hobot-dosod',
    repo: 'https://developer.d-robotics.cc/nodehub',
    scenario: '适合开放词汇检测、语音驱动视觉理解场景',
    dependencies: [],
    tags: ['dosod', '开放词汇', 'open-vocabulary', '检测'],
  },
  {
    id: 'nodehub.app.body-tracking',
    name: '人体跟随',
    desc: '基于人体检测的自主跟随，输出速度控制指令',
    category: '视觉',
    platforms: ['rdk-x3', 'rdk-x5', 'rdk-ultra'],
    pkgName: 'tros-body-tracking',
    processKey: 'body_tracking',
    installCmd: 'sudo apt install -y tros-body-tracking tros-mono2d-body-detection',
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch body_tracking body_tracking.launch.py',
    stopCmd: 'pkill -f body_tracking || true',
    uninstallCmd: 'sudo apt remove -y tros-body-tracking',
    repo: 'https://developer.d-robotics.cc/nodehub',
    scenario: '适合机器人跟随、快递配送、服务引导',
    dependencies: ['tros-mono2d-body-detection'],
    tags: ['跟随', 'tracking', '人体', 'body', '跟踪'],
  },
  {
    id: 'nodehub.app.gesture-control',
    name: '手势控制',
    desc: '通过手势控制机器人移动和动作',
    category: '视觉',
    platforms: ['rdk-x3', 'rdk-x5', 'rdk-ultra'],
    pkgName: 'tros-gesture-control',
    processKey: 'gesture_control',
    installCmd: 'sudo apt install -y tros-gesture-control',
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch gesture_control gesture_control.launch.py',
    stopCmd: 'pkill -f gesture_control || true',
    uninstallCmd: 'sudo apt remove -y tros-gesture-control',
    repo: 'https://developer.d-robotics.cc/nodehub',
    scenario: '适合无接触式机器人操控演示',
    dependencies: [],
    tags: ['手势', '控制', 'gesture', 'control', '操控'],
  },
  {
    id: 'nodehub.app.llm',
    name: '端侧大模型 LLM',
    desc: '在 RDK 上运行轻量 LLM（≤2B 参数量化模型）',
    category: '大模型',
    platforms: ['rdk-x5', 'rdk-ultra'],
    pkgName: 'tros-hobot-llamacpp',
    processKey: 'hobot_llamacpp',
    installCmd: 'sudo apt install -y tros-hobot-llamacpp',
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch hobot_llamacpp hobot_llamacpp.launch.py',
    stopCmd: 'pkill -f hobot_llamacpp || true',
    uninstallCmd: 'sudo apt remove -y tros-hobot-llamacpp',
    repo: 'https://developer.d-robotics.cc/nodehub',
    scenario: '适合端侧对话、离线问答、语音助手场景',
    dependencies: [],
    tags: ['llm', '大模型', 'llamacpp', '对话', '语言模型'],
  },
];

function seedToSkill(seed: SeedApp): NodeHubSkill {
  return {
    id: seed.id,
    source: 'nodehub',
    name: seed.name,
    description: seed.desc,
    category: seed.category,
    tags: seed.tags,
    platforms: seed.platforms,
    repo: seed.repo,
    externalUrl: seed.repo,
    installCmd: seed.installCmd,
    runCmd: seed.runCmd,
    stopCmd: seed.stopCmd,
    uninstallCmd: seed.uninstallCmd,
    preconditions: [
      {
        type: 'binary',
        check: 'command -v ros2',
        fix: 'sudo apt update && sudo apt install -y ros-humble-ros-base',
        message: 'ROS2 Humble 未安装',
      },
      {
        type: 'file',
        check: 'test -f /opt/tros/humble/setup.bash',
        fix: 'sudo apt install -y tros-humble-ros-base',
        message: 'TROS Humble 环境未安装',
      },
    ],
    routingKeywords: seed.tags,
    scenario: seed.scenario,
    boardStatusByDevice: {},
    pkgName: seed.pkgName,
    processKey: seed.processKey,
    launchFile: seed.launchFile,
    dependencies: seed.dependencies,
  };
}

export class NodeHubProvider implements EcoProvider {
  source: 'nodehub' = 'nodehub';

  async fetchAll(platforms?: RdkPlatform[]): Promise<EcoSkill[]> {
    // TODO: When NodeHub API becomes available, fetch live data here.
    // For now, return seed data filtered by requested platforms.
    let skills = SEED_APPS.map(seedToSkill);

    if (platforms?.length) {
      skills = skills.filter((s) =>
        s.platforms.some((p) => platforms.includes(p)),
      );
    }

    return skills;
  }
}
