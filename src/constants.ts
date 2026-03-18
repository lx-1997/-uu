import type { DashboardCard } from './app-types';

export const DASHBOARD_CARDS: DashboardCard[] = [
  {
    tab: 'openclaw',
    title: ' OpenClaws Gateway',
    description: '大模型网关与 AI Agent 编排直连 OpenAI / Qwen飞书一键接入',
    loading: '正在载入 OpenClaws 网关配置...',
    statusLabel: '状态实时检测',
    statusOk: true,
    miniStats: [{ label: '已接入渠道', value: '--' }, { label: '调用次数', value: '--' }],
    cta: '管理网关配置 ',
    quickActions: [{ label: '配置密钥', icon: '' }, { label: '查看日志', icon: '' }],
  },
  {
    tab: 'examples',
    title: ' 应用示例 · NodeHub',
    description: '来自地瓜机器人 NodeHub 的示例应用一键部署到开发板',
    loading: '正在加载 NodeHub 应用列表...',
    statusLabel: '按设备实时检测',
    statusOk: true,
    miniStats: [{ label: '可部署', value: '--' }, { label: '已安装', value: '--' }],
    cta: '浏览 NodeHub ',
    quickActions: [{ label: '人体检测', icon: '' }, { label: '视觉跟随', icon: '' }],
  },
  {
    tab: 'ros',
    title: ' ROS 话题分析',
    description: '话题监控节点图谱TF 坐标树AI 辅助诊断',
    loading: '正在扫描 ROS2 话题...',
    statusLabel: '实时扫描',
    statusOk: true,
    miniStats: [{ label: '活跃 Topic', value: '--' }, { label: '分析工具', value: '实时命令' }],
    cta: '打开分析面板 ',
    quickActions: [{ label: '话题监听', icon: '' }, { label: '分析工具', icon: '' }],
  },
  {
    tab: 'models',
    title: ' 模型仓库 · ModelZoo',
    description: '浏览地瓜机器人 ModelZoo 模型转换部署到开发板',
    loading: '正在连接 ModelZoo...',
    statusLabel: '按板端命令执行',
    statusOk: true,
    miniStats: [{ label: '已部署', value: '--' }, { label: 'ModelZoo', value: '官方仓库' }],
    cta: '浏览 ModelZoo ',
    quickActions: [{ label: '一键部署', icon: '' }, { label: 'Benchmark', icon: '' }],
  },
];

export const FLASH_IMAGES = [
  { id: 'ubuntu-22.04', label: 'Ubuntu 22.04 LTS (官方推荐)', detail: '基础开发环境 + Docker runtime' },
  { id: 'ros2-humble', label: 'ROS2 Humble 预装版', detail: '预装 TogetherROS.b 与调试工具链' },
  { id: 'tros-ai', label: 'TROS AI 开发版', detail: '适合视觉算法与小龙虾示例快速验证' },
  { id: 'local', label: '浏览本地文件...', detail: '导入自定义镜像包并保留元数据校验' },
];

export const STORAGE_TARGETS = [
  { id: 'sd', label: 'SD Card', path: '/dev/mmcblk0', safe: '可热插拔适合开发调试' },
  { id: 'emmc', label: 'eMMC', path: '/dev/mmcblk1', safe: '适合稳定部署需二次确认' },
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
  { icon: '', text: '帮我烧录最新系统镜像', keyword: '烧录' },
  { icon: '', text: '打开SSH终端连接设备', keyword: '终端' },
  { icon: '', text: '上传模型文件到设备', keyword: '文件' },
  { icon: '', text: '连接VNC远程桌面', keyword: 'vnc' },
  { icon: '', text: '查看ROS话题数据', keyword: 'ros' },
  { icon: '', text: '检查设备硬件温度', keyword: '温度' },
  { icon: '', text: '运行视觉跟随示例应用', keyword: '示例' },
  { icon: '', text: '配置OpenClaws AI网关', keyword: 'openclaw' },
];

export const METRIC_CARDS = [
  { label: 'BPU 占用', value: '--', bar: 0, hint: '请在硬件页执行实时诊断命令获取数据' },
  { label: 'CPU 占用', value: '--', bar: 0, hint: '请在硬件页执行实时诊断命令获取数据' },
  { label: '内存使用', value: '--', bar: 0, hint: '请在硬件页执行实时诊断命令获取数据' },
  { label: '芯片温度', value: '--', bar: 0, hint: '请在硬件页执行实时诊断命令获取数据' },
];
