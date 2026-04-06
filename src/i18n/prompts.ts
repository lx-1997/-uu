/** 工作台一键发送的长提示（中英） */

export const ONE_SHOT_DEV_WORKFLOW_PROMPT_ZH = [
  '我想一句话开发一个功能，请严格按以下通用流程执行，并在关键节点先给我确认：',
  '1) 需求澄清：先复述目标、输入输出和成功标准；',
  '2) 硬件可行性：检查当前板卡型号、已连接传感器/相机/麦克风、系统与依赖状态，判断是否满足；',
  '3) 能力匹配：以设备板卡探测、套件端 assess 与实时环境为准，判断技能与依赖是否真可用；',
  '4) 联网检索：搜索官网/文档/代码仓库，确认是否已有成熟方案与实现路径；',
  '5) 方案产出：给出最小可行实现（涉及 skill 时先给草案），列出风险与前置条件；',
  '6) 二次确认：明确问我"是否按该方案执行"；',
  '7) 我确认后再执行，不要直接动手。',
].join('\n');

export const ONE_SHOT_DEV_WORKFLOW_PROMPT_EN = [
  'I want to build a feature from one prompt. Follow this workflow and ask for my confirmation at key steps:',
  '1) Clarify requirements: restate goal, I/O, and success criteria;',
  '2) Hardware feasibility: board model, connected sensors/camera/mic, OS/deps;',
  '3) Capability fit: use live board probe and assess, not stale registries;',
  '4) Web research: official docs/repos for proven approaches;',
  '5) Propose MVP (skill draft if needed), risks and prerequisites;',
  '6) Ask explicitly: "Proceed with this plan?";',
  '7) Execute only after I confirm.',
].join('\n');

export const DASHBOARD_HEALTH_CHECK_PROMPT_ZH = '帮我做一次设备体检，并按风险从高到低给出处理建议。';
export const DASHBOARD_HEALTH_CHECK_PROMPT_EN = 'Run a full health check on this device';

export const DASHBOARD_CHAT_INTRO_PROMPT_ZH =
  '介绍一下 RDK Studio 与 RDKClaw：各自擅长什么、如何帮我快速解决套件端开发与排障问题，并给 3 条可立刻执行的上手建议。';
export const DASHBOARD_CHAT_INTRO_PROMPT_EN =
  'Introduce RDK Studio and RDKClaw: what each is best at, how you help solve real board bring-up and debugging, and give 3 actionable getting-started tips.';
