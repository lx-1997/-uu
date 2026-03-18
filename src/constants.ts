import type { DashboardCard } from './app-types';

export const DASHBOARD_CARDS: DashboardCard[] = [
  {
    tab: 'openclaw',
    title: 'OpenClaw 网关',
    description: '统一接入模型与机器人能力，把 NodeHub + ModelZoo 组合成可运行应用',
    loading: '正在打开 OpenClaw 网关与编排面板...',
    statusLabel: '板端网关联动',
    statusOk: true,
    miniStats: [{ label: '可编排能力', value: '--' }, { label: '网关状态', value: '--' }],
    cta: '进入网关工作台',
    quickActions: [{ label: '状态联动', icon: '🔄' }, { label: '应用方案', icon: '✨' }],
  },
  {
    tab: 'examples',
    title: 'NodeHub 应用能力',
    description: '安装机器人节点能力（感知/导航/语音），作为应用流程的执行层',
    loading: '正在加载 NodeHub 应用与板端状态...',
    statusLabel: '板端同步可见',
    statusOk: true,
    miniStats: [{ label: '可安装能力', value: '--' }, { label: '已同步安装', value: '--' }],
    cta: '打开 NodeHub',
    quickActions: [{ label: '官方检查', icon: '🧪' }, { label: '能力同步', icon: '📡' }],
  },
  {
    tab: 'ros',
    title: 'ROS 运行诊断',
    description: '话题/节点/TF 全链路诊断，定位应用编排后的运行问题',
    loading: '正在扫描 ROS2 话题...',
    statusLabel: '实时可观测',
    statusOk: true,
    miniStats: [{ label: '活跃 Topic', value: '--' }, { label: '诊断方式', value: '实时命令' }],
    cta: '进入 ROS 诊断',
    quickActions: [{ label: '话题巡检', icon: '📡' }, { label: '节点健康', icon: '🧭' }],
  },
  {
    tab: 'models',
    title: 'ModelZoo 模型能力',
    description: '部署推理模型到板端，并同步到 OpenClaw 的可用能力上下文',
    loading: '正在连接 ModelZoo 与板端模型状态...',
    statusLabel: '板端实况同步',
    statusOk: true,
    miniStats: [{ label: '已部署模型', value: '--' }, { label: '官方来源', value: 'RDK ModelZoo' }],
    cta: '打开 ModelZoo',
    quickActions: [{ label: '官方检查', icon: '🧪' }, { label: '模型同步', icon: '🧠' }],
  },
];

export const FLASH_IMAGES = [
  { id: 'ubuntu-22.04', label: 'Ubuntu 22.04 LTS (官方推荐)', detail: '基础开发环境 + Docker runtime' },
  { id: 'ros2-humble', label: 'ROS2 Humble 预装版', detail: '预装 TogetherROS.b 与调试工具链' },
  { id: 'tros-ai', label: 'TROS AI 开发版', detail: '适合视觉算法与小龙虾示例快速验证' },
  { id: 'local', label: '浏览本地文件...', detail: '导入自定义镜像包并保留元数据校验' },
];

export const STORAGE_TARGETS = [
  { id: 'sd', label: 'SD Card', path: '/dev/mmcblk1', safe: '可热插拔适合开发调试' },
  { id: 'emmc', label: 'eMMC', path: '/dev/mmcblk0', safe: '适合稳定部署需二次确认' },
  { id: 'usb', label: 'USB 启动盘', path: '/dev/sda', safe: '适合离线交付与系统恢复' },
];

export const TERMINAL_PROFILES = [
  { id: 'shell', label: '系统 Shell', desc: '命令行操作日志查看与环境配置' },
  { id: 'openclaw', label: 'OpenClaw 对话', desc: 'AI 对话模式用自然语言操控设备' },
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
  'visual-follow': { deps: ['hobot_dnn ', 'mipi_cam ', 'cv_bridge '], cmd: 'ros2 launch visual_follow visual_follow.launch.py', source: '官方', difficulty: ' 入门', desc: '使用 BPU 加速的目标检测驱动小车跟随目标移动' },
  'gesture-ctrl': { deps: ['hand_detection ', 'gesture_lib ', 'serial_driver '], cmd: 'ros2 launch gesture_ctrl gesture.launch.py', source: '官方', difficulty: ' 进阶', desc: '手势识别控制机械臂/小车方向支持 5 种手势映射' },
  'stereo-depth': { deps: ['stereo_usb_cam ', 'depth_estimation ', 'rviz2 '], cmd: 'ros2 launch stereo_depth depth_display.launch.py', source: '社区', difficulty: ' 高级', desc: '双目摄像头深度估计与 RViz2 点云可视化' },
};

export const ROS_TOPIC_DETAILS: Record<string, { msgType: string; hz: string; publishers: number; vizType: string }> = {
  '/hobot_dnn/bbox': { msgType: 'ai_msgs/PerceptionTargets', hz: '30 Hz', publishers: 1, vizType: 'BBox 检测框' },
  '/camera/color/image_raw': { msgType: 'sensor_msgs/Image', hz: '30 Hz', publishers: 1, vizType: '图像' },
  '/tf': { msgType: 'tf2_msgs/TFMessage', hz: '100 Hz', publishers: 3, vizType: '坐标变换' },
  '/cmd_vel': { msgType: 'geometry_msgs/Twist', hz: '10 Hz', publishers: 2, vizType: '速度表盘' },
};

export const MODEL_REPO = [
  { id: 'yolov5', name: 'YOLOv5s (BPU)', format: 'bin', size: '14.2 MB', status: 'deployed', fps: '30', desc: '通用目标检测已优化为 BPU 推理格式' },
  { id: 'fcos', name: 'FCOS Efficient', format: 'bin', size: '22.8 MB', status: 'deployed', fps: '25', desc: '全卷积单阶段检测器适合密集目标' },
  { id: 'mobilenet', name: 'MobileNetV2', format: 'onnx', size: '8.6 MB', status: 'pending', fps: '', desc: '待转换为 BPU 格式需运行 hb_mapper' },
  { id: 'unet', name: 'U-Net Segmentation', format: 'caffe', size: '31.4 MB', status: 'pending', fps: '', desc: '语义分割模型需先通过工具链量化' },
];

export const CMD_SUGGESTIONS = [
  { icon: '', text: '基于当前设备状态，给我一份可执行应用计划', keyword: '计划' },
  { icon: '', text: '同步 NodeHub 和 ModelZoo 的板端状态并汇总能力', keyword: '同步' },
  { icon: '', text: '帮我烧录最新系统镜像并给出验证步骤', keyword: '烧录' },
  { icon: '', text: '打开 SSH 终端并检查 ROS2 与 BPU 环境', keyword: '终端' },
  { icon: '', text: '连接 VNC 并优化远程调试体验', keyword: 'vnc' },
  { icon: '', text: '查看 ROS 话题异常并给出修复命令', keyword: 'ros' },
  { icon: '', text: '部署一个可运行的视觉应用并回显结果', keyword: '示例' },
  { icon: '', text: '生成 OpenClaw 工作流模板并执行', keyword: 'openclaw' },
];

export const METRIC_CARDS = [
  { label: 'BPU 占用', value: '--', bar: 0, hint: '请在硬件页执行实时诊断命令获取数据' },
  { label: 'CPU 占用', value: '--', bar: 0, hint: '请在硬件页执行实时诊断命令获取数据' },
  { label: '内存使用', value: '--', bar: 0, hint: '请在硬件页执行实时诊断命令获取数据' },
  { label: '芯片温度', value: '--', bar: 0, hint: '请在硬件页执行实时诊断命令获取数据' },
];
