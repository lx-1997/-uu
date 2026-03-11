import type { DashboardCard, Device } from './app-types';

export const MOCK_DEVICES: Device[] = [
  { id: '1', name: 'RDK X3 - Local', status: 'online', ip: '192.168.1.100' },
  { id: '2', name: 'RDK Ultra - Lab', status: 'offline', ip: '192.168.1.105' },
];

export const DASHBOARD_CARDS: DashboardCard[] = [
  {
    tab: 'openclaw',
    title: '⚙️ OpenClaws Gateway',
    description: '大模型网关与 AI Agent 编排，直连 OpenAI / Qwen，飞书一键接入。',
    loading: '正在载入 OpenClaws 网关配置...',
    statusLabel: 'Gateway Running',
    statusOk: true,
    miniStats: [{ label: '已接入渠道', value: '2' }, { label: '今日调用', value: '1,247' }],
    cta: '管理网关配置 →',
    quickActions: [{ label: '配置密钥', icon: '🔑' }, { label: '查看日志', icon: '📋' }],
  },
  {
    tab: 'examples',
    title: '📦 示例应用中心',
    description: '视觉跟随、手势控制、双摄测距等深度学习 Demo，含依赖检查。',
    loading: '正在准备示例应用目录与运行前检查...',
    statusLabel: '3 个示例可用',
    statusOk: true,
    miniStats: [{ label: '可运行', value: '3' }, { label: '需配置', value: '1' }],
    cta: '浏览示例目录 →',
    quickActions: [{ label: '视觉跟随', icon: '👁️' }, { label: '手势控制', icon: '🖐️' }],
  },
  {
    tab: 'ros',
    title: '🕸️ ROS 话题可视化',
    description: '订阅 ROS2 话题，实时渲染点云、图像与 AI 推理框。',
    loading: '正在建立 ROS2 可视化工作区...',
    statusLabel: '4 个话题活跃',
    statusOk: true,
    miniStats: [{ label: '活跃 Topic', value: '4' }, { label: '录包', value: 'OFF' }],
    cta: '打开可视化面板 →',
    quickActions: [{ label: '开始录包', icon: '⏺️' }, { label: '话题列表', icon: '📡' }],
  },
  {
    tab: 'models',
    title: '🤖 模型仓库与部署',
    description: '管理 AI 推理模型，支持格式转换与 BPU 部署。',
    loading: '正在扫描模型仓库与部署状态...',
    statusLabel: '2 个模型已部署',
    statusOk: true,
    miniStats: [{ label: '已部署', value: '2' }, { label: '推理 FPS', value: '30' }],
    cta: '管理模型 →',
    quickActions: [{ label: '上传模型', icon: '⬆️' }, { label: '性能基准', icon: '📊' }],
  },
];

export const FLASH_IMAGES = [
  { id: 'ubuntu-22.04', label: 'Ubuntu 22.04 LTS (官方推荐)', detail: '基础开发环境 + Docker runtime' },
  { id: 'ros2-humble', label: 'ROS2 Humble 预装版', detail: '预装 TogetherROS.b 与调试工具链' },
  { id: 'tros-ai', label: 'TROS AI 开发版', detail: '适合视觉算法与小龙虾示例快速验证' },
  { id: 'local', label: '浏览本地文件...', detail: '导入自定义镜像包并保留元数据校验' },
];

export const STORAGE_TARGETS = [
  { id: 'sd', label: 'SD Card', path: '/dev/mmcblk0', safe: '可热插拔，适合开发调试' },
  { id: 'emmc', label: 'eMMC', path: '/dev/mmcblk1', safe: '适合稳定部署，需二次确认' },
  { id: 'usb', label: 'USB 启动盘', path: '/dev/sda', safe: '适合离线交付与系统恢复' },
];

export const TERMINAL_PROFILES = [
  { id: 'shell', label: '系统 Shell', desc: '命令行操作、日志查看与环境配置' },
  { id: 'openclaw', label: 'OpenClaw 对话', desc: 'AI 对话模式，用自然语言操控设备' },
];

export const COMMAND_SUGGESTIONS = ['ros2 topic list', 'hrut_smi', 'tail -f /var/log/syslog', 'ls /userdata', 'top'];

export const LOCAL_FILES = ['models/', 'records/', 'configs/', 'launch.py', 'README.md'];
export const REMOTE_FILES = ['app/', 'userdata/', 'logs/', 'claw_pipeline.yaml', 'start_ros.sh'];

export const FLOW_TEMPLATES = [
  { id: 'vision', name: '视觉感知流水线', desc: '摄像头输入 -> AI 推理 -> 结果发布' },
  { id: 'ops', name: '设备运维自动化', desc: 'SSH 指令 -> 结果判断 -> 报警与回滚' },
  { id: 'demo', name: '社区示例编排', desc: '算法启动 -> 资源检测 -> 可视化页面联动' },
];

export const EXAMPLE_PRESETS = [
  { id: 'visual-follow', name: '视觉跟随', tag: 'TogetherROS.b', readiness: '需摄像头 + 电机控制链路' },
  { id: 'gesture-ctrl', name: '手势控制', tag: 'BPU Demo', readiness: '需 RGB 输入与动作映射' },
  { id: 'stereo-depth', name: '双摄测距', tag: 'Depth', readiness: '需双目标定与时间同步' },
];

export const ROS_TOPICS = ['/hobot_dnn/bbox', '/camera/color/image_raw', '/tf', '/cmd_vel'];

export const EXAMPLE_DETAILS: Record<string, { deps: string[]; cmd: string; source: string; difficulty: string; desc: string }> = {
  'visual-follow': { deps: ['hobot_dnn ✅', 'mipi_cam ✅', 'cv_bridge ✅'], cmd: 'ros2 launch visual_follow visual_follow.launch.py', source: '官方', difficulty: '⭐ 入门', desc: '使用 BPU 加速的目标检测驱动小车跟随目标移动。' },
  'gesture-ctrl': { deps: ['hand_detection ✅', 'gesture_lib ✅', 'serial_driver ⚠️'], cmd: 'ros2 launch gesture_ctrl gesture.launch.py', source: '官方', difficulty: '⭐⭐ 进阶', desc: '手势识别控制机械臂/小车方向，支持 5 种手势映射。' },
  'stereo-depth': { deps: ['stereo_usb_cam ✅', 'depth_estimation ✅', 'rviz2 ✅'], cmd: 'ros2 launch stereo_depth depth_display.launch.py', source: '社区', difficulty: '⭐⭐⭐ 高级', desc: '双目摄像头深度估计与 RViz2 点云可视化。' },
};

export const ROS_TOPIC_DETAILS: Record<string, { msgType: string; hz: string; publishers: number; vizType: string }> = {
  '/hobot_dnn/bbox': { msgType: 'ai_msgs/PerceptionTargets', hz: '30 Hz', publishers: 1, vizType: 'BBox 检测框' },
  '/camera/color/image_raw': { msgType: 'sensor_msgs/Image', hz: '30 Hz', publishers: 1, vizType: '图像' },
  '/tf': { msgType: 'tf2_msgs/TFMessage', hz: '100 Hz', publishers: 3, vizType: '坐标变换' },
  '/cmd_vel': { msgType: 'geometry_msgs/Twist', hz: '10 Hz', publishers: 2, vizType: '速度表盘' },
};

export const MODEL_REPO = [
  { id: 'yolov5', name: 'YOLOv5s (BPU)', format: 'bin', size: '14.2 MB', status: 'deployed', fps: '30', desc: '通用目标检测，已优化为 BPU 推理格式' },
  { id: 'fcos', name: 'FCOS Efficient', format: 'bin', size: '22.8 MB', status: 'deployed', fps: '25', desc: '全卷积单阶段检测器，适合密集目标' },
  { id: 'mobilenet', name: 'MobileNetV2', format: 'onnx', size: '8.6 MB', status: 'pending', fps: '—', desc: '待转换为 BPU 格式，需运行 hb_mapper' },
  { id: 'unet', name: 'U-Net Segmentation', format: 'caffe', size: '31.4 MB', status: 'pending', fps: '—', desc: '语义分割模型，需先通过工具链量化' },
];

export const CMD_SUGGESTIONS = [
  { icon: '💽', text: '帮我烧录最新系统镜像', keyword: '烧录' },
  { icon: '💻', text: '打开SSH终端连接设备', keyword: '终端' },
  { icon: '📁', text: '上传模型文件到设备', keyword: '文件' },
  { icon: '🖥️', text: '连接VNC远程桌面', keyword: 'vnc' },
  { icon: '🕸️', text: '查看ROS话题数据', keyword: 'ros' },
  { icon: '🏥', text: '检查设备硬件温度', keyword: '温度' },
  { icon: '📦', text: '运行视觉跟随示例应用', keyword: '示例' },
  { icon: '⚙️', text: '配置OpenClaws AI网关', keyword: 'openclaw' },
];

export const METRIC_CARDS = [
  { label: 'BPU 占用', value: '68%', bar: 68, hint: '推理负载较高，建议保留 20% 峰值余量' },
  { label: 'CPU 占用', value: '34%', bar: 34, hint: '适合继续运行视觉与终端诊断任务' },
  { label: '内存使用', value: '5.2 / 8 GB', bar: 65, hint: '建议清理历史录包后再跑双摄应用' },
  { label: '芯片温度', value: '61.8°C', bar: 58, hint: '温度正常，可开启持续监控窗口' },
];
