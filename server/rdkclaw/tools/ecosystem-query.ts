import type { Tool } from '../../agent/tools/types.js';
import type { EcosystemRegistry } from '../../ecosystem/registry.js';
import type { RdkPlatform } from '../../../shared/ecosystem-types.js';
import { getDeviceProfile } from '../../ecosystem/device-profiles.js';

export function createEcosystemQueryTool(
  registry: EcosystemRegistry,
  platform?: RdkPlatform,
): Tool<{ query: string; intent?: 'capabilities' | 'recommendation' | 'howto' }> {
  return {
    name: 'ecosystem_query',
    description:
      '查询当前设备的生态能力。输入关键词或任务描述，返回该平台可用的技能、推荐方案和官方文档链接。用于了解板端能做什么、该怎么做。',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: "查询内容，如'目标检测'、'摄像头'、'GPIO控制'、'大模型'",
        },
        intent: {
          type: 'string',
          enum: ['capabilities', 'recommendation', 'howto'],
          description: '查询意图：capabilities=平台能力总览, recommendation=推荐方案, howto=操作指引',
        },
      },
      required: ['query'],
    },
    async execute(input, _ctx) {
      const profile = platform ? getDeviceProfile(platform) : null;
      const skills = registry.findRelevantSkills(input.query, platform, 8);

      const lines: string[] = [];

      if (profile) {
        lines.push(`## 平台: ${profile.displayName} (${profile.bpuTops}TOPS ${profile.cpu})`);
        if (profile.capabilityNotes?.length) {
          lines.push('能力概要:');
          for (const note of profile.capabilityNotes) {
            lines.push(`  - ${note}`);
          }
        }
        if (profile.limitations.length) {
          lines.push('限制:');
          for (const lim of profile.limitations) {
            lines.push(`  - ${lim}`);
          }
        }
        lines.push('');
      }

      if (skills.length > 0) {
        lines.push('## 相关技能');
        for (const skill of skills) {
          const noteForPlatform = platform && skill.platformNotes?.[platform];
          const docLink = skill.docUrl ? ` | 文档: ${skill.docUrl}` : '';
          const note = noteForPlatform ? ` | ${noteForPlatform}` : '';
          lines.push(`- **${skill.name}** (${skill.id}): ${skill.description}${note}${docLink}`);
          lines.push(`  来源: ${skill.source} | 平台: ${skill.platforms.join(', ')}`);
          if (skill.installCmd) lines.push(`  安装命令: \`${skill.installCmd}\``);
          if (skill.runCmd) lines.push(`  运行命令: \`${skill.runCmd}\``);
          if (skill.stopCmd) lines.push(`  停止命令: \`${skill.stopCmd}\``);
          if (skill.preconditions?.length) {
            lines.push(`  前置条件: ${skill.preconditions.map((p) => p.message).join('; ')}`);
          }
        }
        lines.push('');
      } else {
        lines.push('未找到与查询匹配的技能。可尝试更宽泛的关键词。');
      }

      if (profile?.docBaseUrl) {
        lines.push(`## 文档入口: ${profile.docBaseUrl}`);
      }

      return lines.join('\n');
    },
  };
}
