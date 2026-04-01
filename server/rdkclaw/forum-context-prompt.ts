import { ForumAuthStore } from "./forum-auth-store.js";

/** 与设置页「社区论坛」同源；明确用户问「用户名/密码」时的应答方式 */
export function buildForumAuthContextPrompt(): string {
  const v = new ForumAuthStore().getView();
  const lines: string[] = [
    "## D-Robotics 社区论坛（Studio 本机配置快照，与「设置 → 社区论坛」一致）",
  ];
  if (v.hasApiKey) lines.push("- 已配置论坛 API Key 模式。");
  if (v.linkedFromAppSso) lines.push("- 已与主账号同步：本地存在论坛会话（Cookie/桥接）。");
  else if (v.hasCookie) lines.push("- 本地已保存论坛 Cookie。");
  if (v.hasAppSsoAccessTokenSaved) lines.push("- 已保存主应用 access_token，服务端可用其换取论坛会话。");
  if (v.hasPassword) lines.push("- 已保存论坛用户名与密码（由服务端工具使用，模型上下文**看不到**明文密码）。");
  const anyForum = v.hasApiKey || v.hasCookie || v.hasPassword || v.hasAppSsoAccessTokenSaved;
  if (!anyForum) {
    lines.push("- 当前未检测到论坛凭据；需要发帖时请引导用户在设置中配置或在对话中提供账号密码。");
  } else {
    lines.push(
      "- 涉及发帖/读帖时，必须先调用 forum_drobotics_auth_status。若返回 read_access: granted / auth_status ok，则不要要求用户再提供论坛密码。",
      "- 仅当 auth_status 明确失败或未配置时，再请用户在设置「保存并验证」、重新登录主账号，或在对话中提供凭据。",
    );
  }
  lines.push(
    "### 用户问「我的社区/论坛用户名、密码是多少」时（必须遵守）",
    "- **禁止**用「这是你的隐私我查不到」一句话打发；本机已配置的信息可以通过工具返回。",
    "- **必须先调用** forum_drobotics_auth_status；用返回里的 `studio_forum_username_masked` 告知用户当前在 Studio 中登记的**脱敏用户名**（与设置页「论坛用户」一致）。",
    "- **密码**：说明助手**不会也绝不能**在对话里复述明文密码（模型拿不到）；若已主账号同步或本机已保存凭据，说明「发帖/登录由服务端工具自动完成，无需把密码发到聊天里」。",
    "- 仅当工具显示完全未配置时，再引导去设置页或论坛找回密码。",
  );
  return lines.join("\n");
}
