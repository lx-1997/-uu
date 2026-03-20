/**
 * ModelZoo Provider — Ingests AI models from D-Robotics rdk_model_zoo.
 *
 * Current strategy: static seed data (from your existing BUILTIN_MODELS).
 * Future: parse https://github.com/D-Robotics/rdk_model_zoo README or API.
 */

import type {
  EcoProvider,
  EcoSkill,
  ModelZooSkill,
  RdkPlatform,
} from '../../../shared/ecosystem-types.js';

interface SeedModel {
  id: string;
  name: string;
  desc: string;
  category: string;
  platforms: RdkPlatform[];
  format: ModelZooSkill['format'];
  size: string;
  fps?: string;
  latency?: string;
  modelPath: string;
  samplePath: string;
  processKey: string;
  deployCmd: string;
  runCmd: string;
  removeCmd: string;
  repo: string;
  tags: string[];
}

const SEED_MODELS: SeedModel[] = [
  {
    id: 'modelzoo.detect.yolov5s',
    name: 'YOLOv5s',
    desc: '高效目标检测模型，支持 80 类物体识别，适合实时检测场景',
    category: '检测',
    platforms: ['rdk-x3', 'rdk-x5'],
    format: 'BIN',
    size: '14MB',
    fps: '30fps',
    latency: '33ms',
    modelPath: 'yolov5',
    samplePath: '/opt/rdk_model_zoo/demos/detect/yolov5',
    processKey: 'yolov5_detect.py',
    deployCmd: 'cd /opt/rdk_model_zoo && bash scripts/download_model.sh yolov5s',
    runCmd: 'cd /opt/rdk_model_zoo && python3 demos/detect/yolov5/yolov5_detect.py',
    removeCmd: 'rm -rf /opt/rdk_model_zoo/models/yolov5s*',
    repo: 'https://github.com/D-Robotics/rdk_model_zoo/tree/main/demos/detect/yolov5',
    tags: ['yolo', 'yolov5', '目标检测', 'detection', 'object', '80类'],
  },
  {
    id: 'modelzoo.detect.fcos',
    name: 'FCOS',
    desc: '无锚框目标检测，适合密集场景与小目标',
    category: '检测',
    platforms: ['rdk-x3', 'rdk-x5'],
    format: 'BIN',
    size: '22MB',
    fps: '25fps',
    latency: '40ms',
    modelPath: 'fcos',
    samplePath: '/opt/rdk_model_zoo/demos/detect/fcos',
    processKey: 'fcos_detect.py',
    deployCmd: 'cd /opt/rdk_model_zoo && bash scripts/download_model.sh fcos',
    runCmd: 'cd /opt/rdk_model_zoo && python3 demos/detect/fcos/fcos_detect.py',
    removeCmd: 'rm -rf /opt/rdk_model_zoo/models/fcos*',
    repo: 'https://github.com/D-Robotics/rdk_model_zoo/tree/main/demos/detect/fcos',
    tags: ['fcos', '无锚框', 'anchor-free', '检测', '密集'],
  },
  {
    id: 'modelzoo.classify.mobilenetv2',
    name: 'MobileNetV2',
    desc: '轻量级图像分类模型，千类 ImageNet 分类',
    category: '分类',
    platforms: ['rdk-x3', 'rdk-x5', 'rdk-ultra'],
    format: 'BIN',
    size: '8MB',
    fps: '60fps',
    latency: '16ms',
    modelPath: 'mobilenetv2',
    samplePath: '/opt/rdk_model_zoo/demos/classify/mobilenetv2',
    processKey: 'mobilenetv2_cls.py',
    deployCmd: 'cd /opt/rdk_model_zoo && bash scripts/download_model.sh mobilenetv2',
    runCmd: 'cd /opt/rdk_model_zoo && python3 demos/classify/mobilenetv2/mobilenetv2_cls.py',
    removeCmd: 'rm -rf /opt/rdk_model_zoo/models/mobilenetv2*',
    repo: 'https://github.com/D-Robotics/rdk_model_zoo/tree/main/demos/classify/mobilenetv2',
    tags: ['分类', 'classification', 'mobilenet', '轻量', 'imagenet'],
  },
  {
    id: 'modelzoo.segment.deeplabv3',
    name: 'DeepLabV3+',
    desc: '语义分割模型，像素级场景理解',
    category: '分割',
    platforms: ['rdk-x3', 'rdk-x5'],
    format: 'BIN',
    size: '18MB',
    fps: '15fps',
    latency: '66ms',
    modelPath: 'deeplab',
    samplePath: '/opt/rdk_model_zoo/demos/segment/deeplabv3',
    processKey: 'deeplabv3_seg.py',
    deployCmd: 'cd /opt/rdk_model_zoo && bash scripts/download_model.sh deeplabv3plus',
    runCmd: 'cd /opt/rdk_model_zoo && python3 demos/segment/deeplabv3/deeplabv3_seg.py',
    removeCmd: 'rm -rf /opt/rdk_model_zoo/models/deeplabv3*',
    repo: 'https://github.com/D-Robotics/rdk_model_zoo/tree/main/demos/segment/deeplabv3',
    tags: ['分割', 'segmentation', 'deeplab', '语义', 'pixel'],
  },
  {
    id: 'modelzoo.pose.yolov8pose',
    name: 'YOLOv8-Pose',
    desc: '人体姿态估计，17 关键点检测',
    category: '姿态',
    platforms: ['rdk-x5'],
    format: 'BIN',
    size: '12MB',
    fps: '20fps',
    latency: '50ms',
    modelPath: 'yolov8_pose',
    samplePath: '/opt/rdk_model_zoo/demos/pose/yolov8_pose',
    processKey: 'yolov8_pose.py',
    deployCmd: 'cd /opt/rdk_model_zoo && bash scripts/download_model.sh yolov8_pose',
    runCmd: 'cd /opt/rdk_model_zoo && python3 demos/pose/yolov8_pose/yolov8_pose.py',
    removeCmd: 'rm -rf /opt/rdk_model_zoo/models/yolov8_pose*',
    repo: 'https://github.com/D-Robotics/rdk_model_zoo/tree/main/demos/pose/yolov8_pose',
    tags: ['姿态', 'pose', 'yolov8', '关键点', 'keypoint', '人体'],
  },
  {
    id: 'modelzoo.audio.whisper',
    name: 'Whisper-tiny',
    desc: '语音识别模型，支持中英文语音转文字',
    category: '语音',
    platforms: ['rdk-x5', 'rdk-ultra'],
    format: 'ONNX',
    size: '39MB',
    latency: '200ms',
    modelPath: 'whisper',
    samplePath: '/opt/rdk_model_zoo/demos/audio/whisper',
    processKey: 'whisper_asr.py',
    deployCmd: 'cd /opt/rdk_model_zoo && bash scripts/download_model.sh whisper_tiny',
    runCmd: 'cd /opt/rdk_model_zoo && python3 demos/audio/whisper/whisper_asr.py',
    removeCmd: 'rm -rf /opt/rdk_model_zoo/models/whisper*',
    repo: 'https://github.com/D-Robotics/rdk_model_zoo',
    tags: ['语音', 'whisper', 'asr', '语音识别', 'speech'],
  },
];

function seedToSkill(seed: SeedModel): ModelZooSkill {
  return {
    id: seed.id,
    source: 'modelzoo',
    name: seed.name,
    description: seed.desc,
    category: seed.category,
    tags: seed.tags,
    platforms: seed.platforms,
    repo: seed.repo,
    externalUrl: seed.repo,
    installCmd: `test -d /opt/rdk_model_zoo || (cd /opt && git clone https://github.com/D-Robotics/rdk_model_zoo.git); ${seed.deployCmd}`,
    runCmd: seed.runCmd,
    stopCmd: `pkill -f "${seed.processKey}" || true`,
    uninstallCmd: seed.removeCmd,
    preconditions: [
      {
        type: 'binary',
        check: 'python3 --version',
        message: 'Python3 未安装',
      },
      {
        type: 'package',
        check: 'python3 -c "import hobot_dnn" 2>/dev/null || python3 -c "import bpu_infer_lib" 2>/dev/null',
        fix: 'pip3 install bpu_infer_lib_x5 || pip3 install bpu_infer_lib_x3',
        message: 'BPU 推理库未安装',
      },
    ],
    routingKeywords: seed.tags,
    scenario: `${seed.category}场景 · ${seed.fps || ''} ${seed.latency || ''}`.trim(),
    boardStatusByDevice: {},
    format: seed.format,
    size: seed.size,
    fps: seed.fps,
    latency: seed.latency,
    modelPath: seed.modelPath,
    samplePath: seed.samplePath,
    processKey: seed.processKey,
  };
}

export class ModelZooProvider implements EcoProvider {
  source: 'modelzoo' = 'modelzoo';

  async fetchAll(platforms?: RdkPlatform[]): Promise<EcoSkill[]> {
    // TODO: Parse GitHub rdk_model_zoo repo for dynamic model discovery
    let skills = SEED_MODELS.map(seedToSkill);

    if (platforms?.length) {
      skills = skills.filter((s) =>
        s.platforms.some((p) => platforms.includes(p)),
      );
    }

    return skills;
  }
}
