/**
 * TROS Provider — Ingests TogetheROS.Bot packages as skills.
 *
 * TROS packages are the core ROS2 building blocks on RDK boards.
 * Unlike NodeHub apps (high-level), these are lower-level components:
 * camera drivers, codec, AI inference nodes, display outputs, etc.
 *
 * AI Dock uses these when composing pipelines or diagnosing ROS2 issues.
 */

import type {
  EcoProvider,
  EcoSkill,
  TrosSkill,
  RdkPlatform,
} from '../../../shared/ecosystem-types.js';

interface SeedTros {
  id: string;
  name: string;
  desc: string;
  category: string;
  pkgName: string;
  platforms: RdkPlatform[];
  rosNodes: string[];
  rosTopics: string[];
  runCmd: string;
  tags: string[];
}

const SEED_TROS: SeedTros[] = [
  // ─── Sensors ───
  { id: 'tros.sensor.mipi-cam', name: 'MIPI Camera', desc: 'MIPI CSI 摄像头驱动节点', category: '传感器',
    pkgName: 'tros-mipi-cam', platforms: ['rdk-x3', 'rdk-x5', 'rdk-ultra'],
    rosNodes: ['mipi_cam'], rosTopics: ['/image_raw', '/camera_info'],
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch mipi_cam mipi_cam.launch.py',
    tags: ['mipi', '摄像头', 'camera', 'sensor'] },
  { id: 'tros.sensor.usb-cam', name: 'USB Camera', desc: 'USB 摄像头驱动节点', category: '传感器',
    pkgName: 'tros-hobot-usb-cam', platforms: ['rdk-x3', 'rdk-x5', 'rdk-ultra'],
    rosNodes: ['usb_cam'], rosTopics: ['/image_raw'],
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch hobot_usb_cam hobot_usb_cam.launch.py',
    tags: ['usb', '摄像头', 'camera', 'sensor'] },
  { id: 'tros.sensor.audio', name: 'Audio Capture', desc: '音频采集节点（需要音频子板）', category: '传感器',
    pkgName: 'tros-hobot-audio', platforms: ['rdk-x5', 'rdk-ultra'],
    rosNodes: ['hobot_audio'], rosTopics: ['/audio_raw'],
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch hobot_audio hobot_audio.launch.py',
    tags: ['audio', '音频', '麦克风', 'microphone'] },

  // ─── Perception ───
  { id: 'tros.perception.dnn-node', name: 'DNN 通用推理', desc: 'BPU 加速 DNN 推理通用节点（YOLO/分类/分割）', category: '感知',
    pkgName: 'tros-dnn-node-example', platforms: ['rdk-x3', 'rdk-x5', 'rdk-ultra'],
    rosNodes: ['dnn_node_example'], rosTopics: ['/ai_msg'],
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch dnn_node_example dnn_node_example.launch.py',
    tags: ['dnn', 'bpu', '推理', 'inference', 'yolo'] },
  { id: 'tros.perception.face-landmarks', name: '人脸关键点', desc: '人脸检测与 106 关键点定位', category: '感知',
    pkgName: 'tros-face-landmarks-detection', platforms: ['rdk-x3', 'rdk-x5', 'rdk-ultra'],
    rosNodes: ['face_landmarks_detection'], rosTopics: ['/ai_msg'],
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch face_landmarks_detection body_det_face_landmarks_det.launch.py',
    tags: ['人脸', 'face', '关键点', 'landmark'] },
  { id: 'tros.perception.yolo-world', name: 'YOLO-World', desc: 'YOLO-World 开放词汇目标检测', category: '感知',
    pkgName: 'tros-hobot-yolo-world', platforms: ['rdk-x5', 'rdk-ultra'],
    rosNodes: ['hobot_yolo_world'], rosTopics: ['/ai_msg'],
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch hobot_yolo_world hobot_yolo_world.launch.py',
    tags: ['yolo-world', '开放词汇', 'open-vocabulary', '检测'] },
  { id: 'tros.perception.mobilesam', name: 'MobileSAM', desc: '轻量 SAM 分割模型', category: '感知',
    pkgName: 'tros-mono-mobilesam', platforms: ['rdk-x5', 'rdk-ultra'],
    rosNodes: ['mono_mobilesam'], rosTopics: ['/ai_msg'],
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch mono_mobilesam sam.launch.py',
    tags: ['sam', '分割', 'segment-anything', 'mobilesam'] },
  { id: 'tros.perception.stereonet', name: '双目深度估计', desc: '双目摄像头深度估计节点', category: '感知',
    pkgName: 'tros-hobot-stereonet', platforms: ['rdk-x5', 'rdk-ultra'],
    rosNodes: ['hobot_stereonet'], rosTopics: ['/depth'],
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch hobot_stereonet stereonet_model.launch.py',
    tags: ['双目', 'stereo', '深度', 'depth'] },

  // ─── Output ───
  { id: 'tros.output.websocket', name: 'Web 展示', desc: 'Web 端实时画面展示（端口 8000）', category: '输出',
    pkgName: 'tros-websocket', platforms: ['rdk-x3', 'rdk-x5', 'rdk-ultra'],
    rosNodes: ['websocket'], rosTopics: [],
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch websocket websocket.launch.py',
    tags: ['web', 'websocket', '展示', 'display', '可视化'] },
  { id: 'tros.output.hdmi', name: 'HDMI 输出', desc: 'HDMI 显示输出节点', category: '输出',
    pkgName: 'tros-hobot-hdmi', platforms: ['rdk-x5', 'rdk-ultra'],
    rosNodes: ['hobot_hdmi'], rosTopics: [],
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch hobot_hdmi hobot_hdmi.launch.py',
    tags: ['hdmi', '显示', 'display', '输出'] },
  { id: 'tros.output.codec', name: '图像编解码', desc: '硬件加速图像编解码节点', category: '输出',
    pkgName: 'tros-hobot-codec', platforms: ['rdk-x3', 'rdk-x5', 'rdk-ultra'],
    rosNodes: ['hobot_codec'], rosTopics: ['/image_mjpeg'],
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch hobot_codec hobot_codec.launch.py',
    tags: ['codec', '编码', '解码', 'mjpeg', 'h264'] },

  // ─── Application ───
  { id: 'tros.app.audio-control', name: '语音控制', desc: '语音指令控制机器人运动', category: '应用',
    pkgName: 'tros-audio-control', platforms: ['rdk-x5', 'rdk-ultra'],
    rosNodes: ['audio_control'], rosTopics: ['/cmd_vel'],
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch audio_control audio_control.launch.py',
    tags: ['语音', '控制', 'voice', 'control', '指令'] },
  { id: 'tros.app.parking-search', name: '智能车位搜索', desc: '自动识别空闲车位并引导', category: '应用',
    pkgName: 'tros-parking-search', platforms: ['rdk-x5', 'rdk-ultra'],
    rosNodes: ['parking_search'], rosTopics: ['/parking_result'],
    runCmd: 'source /opt/tros/humble/setup.bash && ros2 launch parking_search parking_search.launch.py',
    tags: ['停车', 'parking', '车位', '自动'] },
];

function seedToSkill(seed: SeedTros): TrosSkill {
  return {
    id: seed.id,
    source: 'tros',
    name: seed.name,
    description: seed.desc,
    category: seed.category,
    tags: seed.tags,
    platforms: seed.platforms,
    installCmd: `sudo apt install -y ${seed.pkgName}`,
    runCmd: seed.runCmd,
    stopCmd: `pkill -f "${seed.rosNodes[0]}" || true`,
    uninstallCmd: `sudo apt remove -y ${seed.pkgName}`,
    preconditions: [
      {
        type: 'file',
        check: 'test -f /opt/tros/humble/setup.bash',
        fix: 'sudo apt update && sudo apt install -y tros-humble-ros-base',
        message: 'TROS Humble 环境未安装',
      },
    ],
    routingKeywords: seed.tags,
    boardStatusByDevice: {},
    pkgName: seed.pkgName,
    rosNodes: seed.rosNodes,
    rosTopics: seed.rosTopics,
  };
}

export class TrosProvider implements EcoProvider {
  source: 'tros' = 'tros';

  async fetchAll(platforms?: RdkPlatform[]): Promise<EcoSkill[]> {
    let skills = SEED_TROS.map(seedToSkill);
    if (platforms?.length) {
      skills = skills.filter((s) =>
        s.platforms.some((p) => platforms.includes(p)),
      );
    }
    return skills;
  }
}
