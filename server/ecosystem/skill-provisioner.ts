/**
 * Skill Provisioner — Converts ecosystem resources into OpenClaw skills
 * and pushes them to the board.
 *
 * This is the key mechanism for "RDK Studio gives skills to the board":
 *   1. User installs a NodeHub app / ModelZoo model via AI Dock
 *   2. RDK Studio auto-generates a SKILL.md for OpenClaw
 *   3. SKILL.md is uploaded to the board via SFTP
 *   4. OpenClaw reloads and can now invoke this skill autonomously
 *
 * The provisioner also supports de-provisioning (removing skills from board).
 */

import type { EcoSkill, ProvisionResult } from '../../shared/ecosystem-types.js';

/**
 * Generate OpenClaw SKILL.md content from an EcoSkill definition.
 */
export function generateSkillMd(skill: EcoSkill): string {
  const safeName = skill.id.replace(/\./g, '-');
  const platform = skill.platforms[0] || 'rdk-x5';

  const requiredBins: string[] = skill.preconditions
    .filter((p) => p.type === 'binary')
    .map((p) => {
      const match = p.check.match(/command -v (\S+)/);
      return match ? match[1] : '';
    })
    .filter(Boolean);

  const routingDesc = [
    skill.description,
    skill.scenario ? `Scenario: ${skill.scenario}.` : '',
    `Tags: ${skill.tags.join(', ')}.`,
    `Source: ${skill.source}.`,
    `Provisioned by RDK Studio.`,
  ]
    .filter(Boolean)
    .join(' ');

  const lines = [
    '---',
    `name: ${safeName}`,
    `description: "${routingDesc}"`,
    'license: MIT-0',
    'metadata:',
    '  openclaw:',
  ];

  if (requiredBins.length > 0) {
    lines.push('    requires:');
    lines.push('      bins:');
    for (const bin of requiredBins) {
      lines.push(`        - ${bin}`);
    }
  }

  lines.push('    compatibility:');
  lines.push(`      platform: ${platform}`);
  lines.push('  provisioned_by: rdk-studio');
  lines.push(`  source: ${skill.source}`);
  lines.push(`  original_id: ${skill.id}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${skill.name}`);
  lines.push('');
  lines.push(skill.description);
  lines.push('');

  if (skill.installCmd) {
    lines.push('## 安装');
    lines.push('```bash');
    lines.push(skill.installCmd);
    lines.push('```');
    lines.push('');
  }

  lines.push('## 执行');
  lines.push('```bash');
  lines.push(skill.runCmd);
  lines.push('```');
  lines.push('');

  if (skill.stopCmd) {
    lines.push('## 停止');
    lines.push('```bash');
    lines.push(skill.stopCmd);
    lines.push('```');
    lines.push('');
  }

  if (skill.preconditions.length > 0) {
    lines.push('## 前置条件');
    for (const pre of skill.preconditions) {
      lines.push(`- ${pre.message}: \`${pre.check}\``);
      if (pre.fix) {
        lines.push(`  修复: \`${pre.fix}\``);
      }
    }
    lines.push('');
  }

  if (skill.scenario) {
    lines.push('## 适用场景');
    lines.push(skill.scenario);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Build the SSH commands to provision a skill to the board.
 * Returns an array of commands to execute sequentially.
 */
export function buildProvisionCommands(
  skill: EcoSkill,
  targetPath?: string,
): string[] {
  const safeName = skill.id.replace(/\./g, '-');
  const skillDir = targetPath || `/opt/openclaw/skills/${safeName}`;
  const skillMd = generateSkillMd(skill);

  const escapedContent = skillMd
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "'\\''");

  return [
    `mkdir -p '${skillDir}'`,
    `cat > '${skillDir}/SKILL.md' << 'SKILL_EOF'\n${skillMd}\nSKILL_EOF`,
    // Notify OpenClaw to reload skills (best-effort)
    `(openclaw skill reload 2>/dev/null || clawctl skill reload 2>/dev/null || true)`,
  ];
}

/**
 * Build SSH commands to de-provision (remove) a skill from the board.
 */
export function buildDeprovisionCommands(
  skillId: string,
  targetPath?: string,
): string[] {
  const safeName = skillId.replace(/\./g, '-');
  const skillDir = targetPath || `/opt/openclaw/skills/${safeName}`;
  return [
    `rm -rf '${skillDir}'`,
    `(openclaw skill reload 2>/dev/null || clawctl skill reload 2>/dev/null || true)`,
  ];
}

/**
 * Validate that a skill can be provisioned to a specific platform.
 */
export function validateProvision(
  skill: EcoSkill,
  targetPlatform: string,
): { valid: boolean; reason?: string } {
  if (!skill.platforms.includes(targetPlatform as any)) {
    return {
      valid: false,
      reason: `${skill.name} 不支持 ${targetPlatform}，仅支持: ${skill.platforms.join(', ')}`,
    };
  }

  if (!skill.runCmd?.trim()) {
    return {
      valid: false,
      reason: `${skill.name} 缺少运行命令，无法注册为 skill`,
    };
  }

  return { valid: true };
}
