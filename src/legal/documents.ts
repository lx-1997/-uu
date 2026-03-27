/**
 * 服务条款 / 隐私政策（简体为主；英文为配套摘要）。
 * 结构参考常见云产品与开发者工具隐私政策（信息类型、目的、存储、共享、安全、权利等）。
 * 正式对外前建议由法务按适用法域审阅。
 */

export type LegalSection = { heading: string; paragraphs: string[] };

export const TERMS_OF_SERVICE_ZH: { title: string; intro: string; sections: LegalSection[] } = {
  title: 'RDK Studio 服务条款',
  intro:
    '欢迎使用 RDK Studio（以下简称「本软件」或「本服务」）。请您在下载、安装或使用前仔细阅读本条款。您点击同意、实际使用或继续使用本软件，即视为您已充分理解并同意接受本条款的全部内容。若您不同意，请立即停止使用。',
  sections: [
    {
      heading: '1. 协议范围与接受',
      paragraphs: [
        '本条款适用于 RDK Studio 客户端软件及其相关功能（含与 RDK 开发板、OpenClaw 等的连接与管理能力）。我们可能不时更新本条款；更新后的条款将在软件内或官网/发布说明中提示，您继续使用视为接受更新后的条款。',
        '若您代表组织使用本软件，您声明已获得该组织授权，且该组织受本条款约束。',
      ],
    },
    {
      heading: '2. 服务说明与许可',
      paragraphs: [
        '本软件由开发者向您提供，用于在本地或局域网环境下连接、配置与管理 RDK 系列开发板及相关开发工具（例如 SSH、文件、远程桌面、在线 IDE、ROS、OpenClaw 等）。具体功能以实际安装版本为准，可能随更新而调整、优化或下线部分能力。',
        '在遵守本条款及适用法律的前提下，我们授予您一项个人的、非独占的、不可转让的许可，以在您的设备上安装、运行本软件。',
        '部分能力依赖第三方服务或开源组件（如统一身份认证、云厂商 API、设备侧 Agent 等）。该等第三方服务受其各自条款与隐私政策约束，本条款不替代该等第三方规则。',
      ],
    },
    {
      heading: '3. 账号与使用规范',
      paragraphs: [
        '若您使用组织统一登录（SSO）等功能，您应妥善保管账号与凭据，并对您账号下发生的操作负责。您不得将账号用于违法、侵害他人权益或破坏网络安全与秩序的行为。',
        '您不得对本软件进行反向工程、反编译或试图获取源代码（如适用法律允许且强制性例外除外），不得绕过或破坏技术保护措施，不得利用本软件进行未经授权的扫描、攻击或干扰他人系统。',
        '您理解并同意：涉及设备固件烧录、远程命令执行、系统配置等操作具有固有风险，可能导致数据丢失或设备不可用；您应在操作前自行备份并确认步骤与权限。',
      ],
    },
    {
      heading: '4. 用户内容与数据',
      paragraphs: [
        '您在设备上执行的命令、生成的文件、与 AI 的对话内容及业务数据，由您或您的组织控制与负责。您应确保其合法合规，并自行完成必要的备份。',
        '除非法律法规或监管要求另有规定，或我们另行明确说明，我们不会将您的聊天正文用于训练可识别特定个人的模型；与产品改进相关的可选统计，请参见《隐私政策》。',
      ],
    },
    {
      heading: '5. 知识产权',
      paragraphs: [
        '本软件及其界面、文档、商标等知识产权归权利人所有。未经书面许可，您不得复制、传播或用于商业再分发（开源许可另有规定的除外）。',
      ],
    },
    {
      heading: '6. 免责声明与责任限制',
      paragraphs: [
        '本软件按「现状」和「可用性」提供。在适用法律允许的最大范围内，我们对因网络、设备硬件、固件、第三方服务中断、不可抗力、您操作不当或环境配置不当等导致的数据丢失、业务中断或间接损失，不承担责任。',
        '在任何情况下，我们对您因使用本软件所可能产生的赔偿责任总额，以您为引起索赔的特定功能所实际支付的费用为限（若您未付费使用，则以零为限），除非适用法律另有强制性规定。',
      ],
    },
    {
      heading: '7. 终止',
      paragraphs: [
        '您可随时停止使用并卸载本软件。我们可在遵守适用法律的前提下，因技术、安全或合规原因暂停或终止向您提供部分或全部功能。',
      ],
    },
    {
      heading: '8. 法律适用与争议',
      paragraphs: [
        '本条款的解释与执行，以中华人民共和国大陆地区法律为适用法律（仅为冲突法规范除外）。若发生争议，双方应首先友好协商；协商不成的，提交有管辖权的人民法院诉讼解决（除非强制性法律另有规定）。',
      ],
    },
  ],
};

export const PRIVACY_POLICY_ZH: { title: string; intro: string; sections: LegalSection[] } = {
  title: 'RDK Studio 隐私政策',
  intro:
    '地瓜机器人（D-Robotics，以下简称「我们」）深知个人信息对您的重要性。本政策说明在您下载、安装或使用「RDK Studio」客户端软件（以下简称「本软件」）及相关服务时，我们如何收集、使用、存储、共享与保护您的个人信息，以及您享有的权利。本政策结构参考业界通行的云产品与开发者工具隐私说明方式（包括信息分类说明、Cookie/本地存储、共享与跨境、安全与权利等）。若本政策与具体功能页面的说明不一致，以更新日期较新者为准。正式对外提供前，您亦可请法务结合适用法域审阅。',
  sections: [
    {
      heading: '1. 我们如何收集和使用您的个人信息',
      paragraphs: [
        '我们会出于本政策所述的合法、正当、必要目的处理个人信息；非必要不收集，且不会将信息用于与目的不符的用途。',
        '（1）账号与身份验证：若您使用统一身份认证（SSO）登录，我们会从身份提供方接收账号标识、展示名、邮箱等（以实际返回为准），用于建立会话、权限控制、安全审计与问题排查。',
        '（2）设备连接与远程开发：为使用 SSH、文件、远程桌面、在线 IDE、ROS、OpenClaw 等功能，您需主动提供或在本机保存设备地址、端口、用户名、密码或密钥；该等信息主要用于建立连接与执行您发起的操作，存储位置与方式取决于您的选择与部署环境。',
        '（3）对话与 AI 功能：您在对话或指令中输入的内容，将用于响应当次请求与在您选择开启时的会话归档（若您或管理员配置了云端归档）。**我们不会将您的聊天正文用于定向广告或出售给第三方。** 与模型推理相关的处理还可能涉及您配置的第三方大模型服务商；请您同时关注该服务商的条款与隐私政策。',
        '（4）产品改进与统计：在**您或管理员开启**的前提下，我们可能处理匿名或去标识化信息（例如本地随机标识符、应用版本、UTC 日期、事件类型与时间戳、脱敏后的网络地址等），用于估算活跃情况、稳定性与功能改进；**默认不包含聊天全文**。若启用「每日使用人数」类统计且您通过 SSO 登录，服务端可能将**与对话归档一致的登录展示名**（优先姓名，其次邮箱前缀等）作为当日去重键写入统计库，**不用于广告画像**。无 SSO 的本地部署场景可使用浏览器匿名标识。您可通过关闭服务端统计或相关环境变量限制此类处理。',
        '（5）安全保障与运维：为防范攻击与故障排查，服务器可能记录访问时间、经匿名化或截断处理的 IP、User-Agent、错误码等技术日志，保留期限遵循最小必要原则并可配置。',
        '**关于敏感个人信息**：我们**不主动要求**您提供身份证件号码、银行账户、精准行踪、不满十四周岁未成年人信息等敏感个人信息。若您在对话、设备命令或表单中**自行输入**了可能构成敏感个人信息的内容，请您自行评估必要性；我们仅在实现您请求所必需的范围内处理，并建议您避免在非必要场景提交高度敏感信息。',
      ],
    },
    {
      heading: '2. 我们如何使用 Cookie 和同类技术',
      paragraphs: [
        '为保障登录态与安全，我们可能使用 **HttpOnly Cookie** 存储会话标识（若您使用需登录的部署方式）。',
        '我们可能使用 **浏览器本地存储（如 localStorage / sessionStorage）** 保存界面偏好、匿名统计标识、草稿等非敏感数据；您可通过浏览器设置清除。',
        '「同类技术」还包括与上述目的类似的小型数据文件或标识符；我们不会将 Cookie/本地存储用于本政策未说明的目的。',
      ],
    },
    {
      heading: '3. 我们如何共享、转让、公开披露您的个人信息',
      paragraphs: [
        '**共享与委托处理**：我们不会向无关第三方出售个人信息。我们可能在以下情形共享或委托处理：（1）经您同意或主动选择；（2）法律法规规定或有权机关依法提出要求；（3）与身份提供方、云基础设施、消息通道（如飞书/企业微信）等**受托方**为实现功能所必需，且通过协议约束其处理目的、方式与期限。',
        '**转让**：原则上不转让；如因合并、分立、资产转让等确需转让，我们将要求继受方继续受本政策约束或重新征得同意（法律另有规定除外）。',
        '**公开披露**：原则上不公开披露；除非获得您的单独同意或基于法律法规的强制性要求。',
        '**跨境传输**：若您或组织使用的服务部署涉及境外数据中心，我们可能根据适用法律采取合同、认证或安全评估等措施；具体以您组织的合规安排为准。',
      ],
    },
    {
      heading: '4. 我们如何存储和保护您的个人信息',
      paragraphs: [
        '数据可能存储于您的终端、您组织的服务器，或您配置的第三方云服务（如数据库、对象存储）；存储地点与期限取决于部署方式与策略。',
        '我们采取合理可行的措施，包括传输与存储加密（在适用场景）、访问控制、最小权限、脱敏展示、审计与备份策略等。**请您理解，互联网环境不存在绝对安全**，您应妥善保管账号、令牌与设备。',
        '在实现处理目的后，我们将依法删除、匿名化或按策略缩短保存期限；技术日志与统计数据通常按滚动窗口或合理周期清理。',
      ],
    },
    {
      heading: '5. 您的权利',
      paragraphs: [
        '在适用法律允许的范围内，您可对您的个人信息行使**查阅、复制、更正、补充、删除、撤回同意、限制处理、解释说明、获取副本（可携带）**等权利。',
        '若您通过企业或组织使用本软件，部分请求可能需要由**管理员**代为或协助处理。您也可通过清除本机设备列表、会话与浏览器存储，减少本地留存。',
        '为保障安全，我们可能对请求进行身份核验；我们将在法律法规规定的期限内答复您的请求。',
      ],
    },
    {
      heading: '6. 未成年人保护',
      paragraphs: [
        '本软件主要面向开发者与专业人员。若您为未满十四周岁的未成年人，请在监护人陪同下阅读本政策，并在监护人同意后使用。若我们发现未获监护人同意而收集了未成年人的个人信息，将尽快删除或进行匿名化处理。',
      ],
    },
    {
      heading: '7. 本政策如何更新',
      paragraphs: [
        '我们可能适时修订本政策。重大变更时，我们将通过软件内提示、发布说明或其他合理方式告知；**若您继续使用本软件，即视为您已阅读并同意更新后的政策。**',
      ],
    },
    {
      heading: '8. 如何联系我们',
      paragraphs: [
        '如您对本政策或个人信息保护有任何疑问、意见或投诉，请通过您所在组织或 D-Robotics 官方支持渠道与我们联系。我们将在验证身份后，于合理期限内答复。',
      ],
    },
  ],
};

export const TERMS_OF_SERVICE_EN: { title: string; intro: string; sections: LegalSection[] } = {
  title: 'RDK Studio Terms of Service',
  intro:
    'Welcome to RDK Studio (“the Software”). Please read these Terms carefully before you install or use the Software. By clicking Accept, installing, or continuing to use the Software, you agree to these Terms. If you do not agree, do not use the Software.',
  sections: [
    {
      heading: '1. Scope and acceptance',
      paragraphs: [
        'These Terms govern the RDK Studio client and related features (including connectivity to RDK boards and OpenClaw). We may update these Terms; continued use after notice means you accept the updates.',
        'If you use the Software on behalf of an organization, you represent that you are authorized to bind that organization.',
      ],
    },
    {
      heading: '2. Service and license',
      paragraphs: [
        'The Software helps you connect to and manage RDK boards and related development tools (SSH, files, remote desktop, web IDE, ROS, OpenClaw, etc.). Features may change across releases.',
        'Subject to these Terms, we grant you a personal, non-exclusive, non-transferable license to install and run the Software on your devices.',
        'Some features rely on third-party services or components (SSO, cloud APIs, on-device agents). Their terms and privacy policies apply separately.',
      ],
    },
    {
      heading: '3. Account and acceptable use',
      paragraphs: [
        'If you use SSO or similar, keep credentials secure and you are responsible for actions under your account. Do not use the Software for unlawful activity or to harm others’ systems.',
        'You understand that flashing firmware, running remote commands, or changing system configuration can cause data loss or device failure; back up and verify steps before operating.',
      ],
    },
    {
      heading: '4. Your content and data',
      paragraphs: [
        'Commands, files, chat content, and business data on devices remain under your or your organization’s control. You are responsible for lawful use and backup.',
        'Unless required by law or expressly stated otherwise, we do not use your chat content to train personally identifiable models; optional analytics are described in the Privacy Policy.',
      ],
    },
    {
      heading: '5. Intellectual property',
      paragraphs: [
        'The Software, UI, documentation, and marks are owned by their respective rights holders. Do not copy or redistribute for commercial purposes without permission (except as allowed by applicable open-source licenses).',
      ],
    },
    {
      heading: '6. Disclaimer and limitation of liability',
      paragraphs: [
        'The Software is provided “as is” and “as available.” To the maximum extent permitted by law, we are not liable for indirect losses, data loss, or business interruption from networks, hardware, firmware, third-party outages, or misuse.',
        'Our liability for any claim is limited to fees you paid for the specific feature giving rise to the claim (or zero if you use the Software free of charge), unless mandatory law provides otherwise.',
      ],
    },
    {
      heading: '7. Termination',
      paragraphs: [
        'You may stop using and uninstall the Software at any time. We may suspend or discontinue features for technical, security, or compliance reasons where permitted by law.',
      ],
    },
    {
      heading: '8. Governing law',
      paragraphs: [
        'These Terms are governed by the laws of mainland China (excluding conflict-of-law rules only where applicable). Disputes shall be submitted to competent courts unless mandatory law requires otherwise.',
      ],
    },
  ],
};

export const PRIVACY_POLICY_EN: { title: string; intro: string; sections: LegalSection[] } = {
  title: 'RDK Studio Privacy Policy',
  intro:
    'D-Robotics (“we”) explains in this Policy how we collect, use, store, share, and protect personal information when you use the RDK Studio client and related services. The structure follows common practices for cloud and developer tools (categories of data, cookies/local storage, sharing/cross-border, security, and your rights). If this Policy conflicts with a feature notice, the newer document prevails. Have legal counsel review before external publication where required.',
  sections: [
    {
      heading: '1. How we collect and use personal information',
      paragraphs: [
        'We process personal information for lawful, legitimate, and necessary purposes described here; we do not use it for unrelated purposes.',
        '(1) Account / SSO: identifiers, display name, email, etc., from your identity provider for session, authorization, audit, and troubleshooting.',
        '(2) Device connectivity: addresses, ports, credentials you provide for SSH, remote desktop, IDE, ROS, OpenClaw, etc.; used to fulfill your requests; storage depends on your choices.',
        '(3) Chat / AI: content you enter may be used to respond and, if you or your admin enables archiving, stored per configuration. We do not sell chat content or use it for targeted ads. Third-party model providers you configure have their own terms and policies.',
        '(4) Product improvement / stats (if enabled): anonymous or de-identified data such as local random ID, app version, UTC date, event types, coarse network info — not chat content by default. For optional daily-active metrics with SSO, we may use the same display name as conversation archives (name, email prefix, etc.) as a per-day dedupe key — not for ads. Non-SSO deployments may use a browser anonymous ID. Disable via server config or environment as applicable.',
        '(5) Security / ops: technical logs such as time, truncated IP, User-Agent for protection and debugging, kept for a limited period.',
        'Sensitive personal information: we do not actively request ID numbers, bank accounts, precise location of individuals, or children’s data. If you voluntarily enter sensitive content in chat or commands, assess necessity; we process only as needed to fulfill your request.',
      ],
    },
    {
      heading: '2. Cookies and similar technologies',
      paragraphs: [
        'We may use HttpOnly cookies for session security where login is used.',
        'We may use localStorage/sessionStorage for preferences, anonymous IDs, drafts, etc.; you can clear via browser settings.',
        'Similar technologies are not used for purposes beyond those stated in this Policy.',
      ],
    },
    {
      heading: '3. Sharing, transfer, and disclosure',
      paragraphs: [
        'We do not sell personal data. We may share or entrust processing to providers (identity, cloud, messaging channels) under contract for specific purposes, or when required by law or competent authorities.',
        'We generally do not transfer ownership of personal data; if business changes require it, we will require successors to comply or seek consent as required by law.',
        'We generally do not publicly disclose personal data unless with your separate consent or as required by law.',
        'Cross-border transfers may apply depending on deployment; we follow applicable law and your organization’s compliance setup.',
      ],
    },
    {
      heading: '4. Storage and protection',
      paragraphs: [
        'Data may be stored on your device, your organization’s servers, or configured cloud services; retention follows deployment policy.',
        'We use reasonable measures including encryption where appropriate, access control, least privilege, and minimization in UI. No system is perfectly secure — protect accounts and devices.',
        'We delete, anonymize, or shorten retention after purposes are fulfilled, subject to law.',
      ],
    },
    {
      heading: '5. Your rights',
      paragraphs: [
        'Where applicable law grants rights (access, copy, rectification, deletion, restriction, portability, withdrawal of consent, explanation), you may exercise them via your organization or our channels. Some requests may require admin assistance in enterprise use.',
        'We may verify identity before responding and will reply within statutory or reasonable timeframes.',
      ],
    },
    {
      heading: '6. Minors',
      paragraphs: [
        'The Software is intended for developers and professionals. Children under 14 should use it only with guardian consent. If we learn we collected a child’s data without consent, we will delete or anonymize it promptly.',
      ],
    },
    {
      heading: '7. Changes to this Policy',
      paragraphs: [
        'We may update this Policy. Material changes will be notified via in-app notice or release notes. Continued use means you accept the updated Policy.',
      ],
    },
    {
      heading: '8. Contact us',
      paragraphs: [
        'For questions or complaints about this Policy or personal data processing, contact us through your organization or D-Robotics official support. We will respond after verifying your identity where appropriate.',
      ],
    },
  ],
};
