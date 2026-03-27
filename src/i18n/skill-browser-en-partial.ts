/** Skill browser / OpenClaw skill studio — merged into EN via en-extras */
export const SKILL_BROWSER_EN: Record<string, string> = {
  'skillBrowser.source.web': 'Web page',

  'skillBrowser.prompt.mustWrite':
    '[Important] You must use the board_openclaw_write_skill tool to write the generated SKILL.md to the board. Do not output text only.',
  'skillBrowser.prompt.noTool':
    'If that tool is unavailable, output the full SKILL.md and tell the user to deploy manually.',
  'skillBrowser.prompt.qualityTitle': 'Quality requirements:',
  'skillBrowser.prompt.q1': '1) Provide executable commands — no hand-wavy descriptions only.',
  'skillBrowser.prompt.q2':
    '2) If key info is missing, list clearly: missing items + risks + what to add.',
  'skillBrowser.prompt.q3':
    '3) Output a complete SKILL.md with all frontmatter fields (name/description/version/trigger/risk/permissions/delegate_preference/requires_board/approval_level/cooldown_seconds/scheduler_template/category).',
  'skillBrowser.prompt.q4': '4) Suggest a skill name (kebab-case) and explain why.',
  'skillBrowser.prompt.deviceLine': '5) Target device: {{hint}}',
  'skillBrowser.prompt.q6':
    '6) Final structure: A. Source summary B. Generated SKILL.md C. Deploy result D. Risks and rollback.',

  'skillBrowser.prompt.githubIntro':
    'Turn the following GitHub repo into an OpenClaw skill and deploy it to the board.',
  'skillBrowser.prompt.githubExtra':
    'GitHub focus: read README and dependency files, extract build/run commands, pin versions.',
  'skillBrowser.prompt.nodehubIntro':
    'Turn the following NodeHub app into an OpenClaw skill and deploy it to the board.',
  'skillBrowser.prompt.nodehubExtra':
    'NodeHub focus: app ID, install/run/stop commands, config, resource usage.',
  'skillBrowser.prompt.webIntro':
    'Turn the following web content into an OpenClaw skill and deploy it to the board.',
  'skillBrowser.prompt.webExtra': 'Web focus: extract main points and actionable steps.',
  'skillBrowser.prompt.linkLine': 'Link: {{url}}',
  'skillBrowser.prompt.goalLine': 'Goal: {{goal}}',

  'skillBrowser.template': `---
name: my-skill
description: "One-line description of what the skill does"
version: 1.0.0
trigger: keyword1,keyword2,keyword1,keyword2
risk: low
permissions: device_exec
delegate_preference: board
requires_board: true
approval_level: none
cooldown_seconds: 0
scheduler_template: none
category: Custom
---

# Skill title

## When to use
- Concrete scenarios

## Steps
1. Step one (commands or tools)
2. Step two
3. Step three

## Prerequisites
- Environment or dependencies

## How to verify
- How to confirm success
`,

  'skillBrowser.title': 'OpenClaw Skill Studio',
  'skillBrowser.count': '{{n}} on-device skills',
  'skillBrowser.gwOn': 'Gateway running',
  'skillBrowser.gwOff': 'Gateway stopped',
  'skillBrowser.refresh': 'Refresh',
  'skillBrowser.searchPh': 'Search skills…',
  'skillBrowser.empty.noSkills': 'No skills on this device',
  'skillBrowser.empty.noDevice': 'Connect a device first',
  'skillBrowser.newSkill': '+ New skill',
  'skillBrowser.tab.view': 'View / edit',
  'skillBrowser.tab.create': 'Create',
  'skillBrowser.tab.link': 'Link → skill',
  'skillBrowser.view.pick': 'Select a skill on the left to view its content.',
  'skillBrowser.edit': 'Edit',
  'skillBrowser.cancel': 'Cancel',
  'skillBrowser.saving': 'Saving…',
  'skillBrowser.saveToBoard': 'Save to board',
  'skillBrowser.editPlaceholder': 'Edit SKILL.md',
  'skillBrowser.loading': 'Loading SKILL.md from board…',
  'skillBrowser.noContent': 'No content loaded',
  'skillBrowser.createTitle': 'Create custom skill',
  'skillBrowser.createDesc': 'Write SKILL.md and deploy to the board OpenClaw skills directory.',
  'skillBrowser.idLabel': 'Skill ID (kebab-case)',
  'skillBrowser.idPh': 'e.g. my-custom-skill',
  'skillBrowser.idHint':
    'Leave empty to take name from SKILL.md. Path: ~/.openclaw/workspace/skills/{skillId}/SKILL.md',
  'skillBrowser.contentLabel': 'SKILL.md content',
  'skillBrowser.contentPh': 'Enter SKILL.md content',
  'skillBrowser.deploying': 'Deploying…',
  'skillBrowser.deploy': 'Deploy to board',
  'skillBrowser.resetTemplate': 'Reset template',
  'skillBrowser.connectFirst': 'Connect a device first',
  'skillBrowser.linkTitle': 'Link to skill (AI)',
  'skillBrowser.linkDesc':
    'Paste a GitHub / NodeHub / doc URL; AI will analyze and generate a deployable OpenClaw skill.',
  'skillBrowser.urlPh': 'Paste URL (GitHub / NodeHub / docs)',
  'skillBrowser.kindLabel': 'Detected type:',
  'skillBrowser.goalPh': 'Optional: extra goal (e.g. extract YOLO inference commands)',
  'skillBrowser.aiRun': 'Generate & deploy with AI',
  'skillBrowser.linkHint':
    'Opens AI chat: it will analyze the link, generate SKILL.md, and write to the board via tools. If you only get text, copy it to the Create tab and deploy manually.',

  'skillBrowser.confirm.cancel': 'Cancel',
  'skillBrowser.confirm.deploy': 'Deploy',
  'skillBrowser.confirm.save': 'Save',

  'skillBrowser.defaultGoal': 'Turn the link into a reusable OpenClaw skill',
  'skillBrowser.deviceHintLine': '{{name}} ({{id}})',
  'skillBrowser.deviceDisconnected': 'No device connected — generate definition only',

  'skillBrowser.toast.deployOk': 'Skill {{id}} deployed: {{path}}',
  'skillBrowser.toast.deployFail': 'Deploy failed: {{msg}}',
  'skillBrowser.toast.needDevice': 'Connect a device first',
  'skillBrowser.toast.needId': 'Enter a skill name (or set name in SKILL.md)',
  'skillBrowser.toast.badId': 'Skill ID may only contain letters, digits, underscore, hyphen',
  'skillBrowser.toast.emptyContent': 'SKILL.md content cannot be empty',
  'skillBrowser.confirm.deployTitle': 'Deploy skill “{{id}}” to board?',
  'skillBrowser.confirm.deployDetail':
    'Will write ~/.openclaw/workspace/skills/{{id}}/SKILL.md ({{lines}} lines)',
  'skillBrowser.toast.updated': 'Skill {{id}} updated',
  'skillBrowser.toast.saveFail': 'Save failed: {{msg}}',
  'skillBrowser.confirm.saveTitle': 'Overwrite skill “{{id}}” on board?',
  'skillBrowser.confirm.saveDetail': 'This overwrites the existing SKILL.md on the board.',
  'skillBrowser.toast.needUrl': 'Enter a URL first',
  'skillBrowser.toast.badUrl': 'Enter a valid http/https URL',
  'skillBrowser.err.readHttp': 'Could not read skill (HTTP {{status}})',
  'skillBrowser.err.emptyBody': '(empty)',
  'skillBrowser.err.readFail': 'Read failed: {{msg}}',
  'skillBrowser.writeDone': 'Write complete',
};
