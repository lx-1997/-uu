/**
 * 用户服务协议 / 隐私政策（简体为主；英文为配套摘要）。
 * 体例参考国内常见互联网软件及开发者工具的用户协议与个人信息处理规则结构。
 * 对外发布前仍建议由法务结合适用法律法规审阅定稿。
 */

export type LegalSection = { heading: string; paragraphs: string[] };

export const TERMS_OF_SERVICE_ZH: { title: string; intro: string; sections: LegalSection[] } = {
  title: 'RDK Studio 用户服务协议',
  intro:
    '欢迎使用 RDK Studio（以下简称「本软件」或「本服务」）。请您在下载、安装、注册或使用本服务前认真阅读本协议全部条款，特别是免除或限制责任、争议解决及法律适用等条款。您通过网络页面点击确认、实际下载、安装、使用或以其他方式接受本服务，即视为您已充分阅读、理解并同意接受本协议的全部约束。若您不同意本协议任一内容，请立即停止使用本服务。',
  sections: [
    {
      heading: '一、协议的范围与效力',
      paragraphs: [
        '本协议由您与地瓜机器人及其关联公司（以下合称「我们」或「运营方」）就您使用 RDK Studio 客户端软件及相关技术服务所订立，适用于本软件及其更新版本、附属功能与相关文档。',
        '我们有权根据业务运营需要不时修订本协议；修订内容将在本软件内、官方网站或以其他合理方式公示。若您在本协议修订后继续使用本服务，即视为您已接受修订后的协议；若您不同意修订内容，应停止使用本服务。',
        '本协议未尽事宜，适用国家法律法规及监管规定；本软件特定功能所附单独规则或说明构成本协议补充，与本协议具有同等效力，冲突时以专门规则为准（专门规则未排除的，仍以本协议为准）。',
      ],
    },
    {
      heading: '二、服务内容与软件许可',
      paragraphs: [
        '本软件为面向开发者及相关专业人员提供的 RDK 系列开发者套件及相关开发环境的连接、配置、管理与辅助工具，可能包括但不限于远程连接、文件与命令操作、远程桌面、在线开发环境、ROS 相关能力、智能助手与设备侧 Agent 协同等功能；具体服务范围、界面与能力以实际提供的版本及说明为准，我们可能依技术、合规或商业安排对功能进行调整、升级、优化或下线。',
        '在遵守本协议及适用法律的前提下，我们授予您一项有限的、非独占的、不可转让且不可再许可的权利，在合法授权的设备上安装、运行本软件，并以本协议允许的方式使用本服务。',
        '本服务可能依赖第三方产品或服务（包括但不限于统一身份认证、云基础设施、通信通道、大模型或推理服务、开源组件及设备端程序等）。该等第三方服务由其各自运营主体独立提供，您应同时遵守其用户协议、服务规则及隐私政策；因第三方原因导致的服务不可用或纠纷，由您与该第三方依约处理，法律法规另有规定的除外。',
      ],
    },
    {
      heading: '三、账号、登录与安全',
      paragraphs: [
        '若本服务提供账号注册、组织统一登录（SSO）或其他身份验证方式，您应使用真实、准确、合法的信息，并妥善保管账号、密码、令牌及二次验证方式。因您保管不善或授权他人使用所导致的损失，由您自行承担。',
        '您的账号下的操作行为视为您本人或经您授权的行为，您应对该等行为负责。如发现未经授权使用，应立即通知我们或您的组织管理员并采取合理措施防止损失扩大。',
      ],
    },
    {
      heading: '四、使用规范与禁止行为',
      paragraphs: [
        '您承诺遵守中华人民共和国相关法律法规及公序良俗，不得利用本服务从事任何违法、侵权、干扰网络安全或损害他人合法权益的行为，包括但不限于：侵入或破坏他人系统、未经授权扫描或攻击网络、传播恶意程序、窃取或非法买卖数据、侵犯知识产权或商业秘密等。',
        '未经我们书面许可，您不得对本软件进行反向工程、反编译、反汇编或以其他方式试图获取源代码（法律强制性规定允许的除外），不得删除或篡改权利管理信息及技术措施，不得绕过或破坏安全验证。',
        '您理解开发者套件固件烧录、远程命令执行、系统配置变更等操作具有固有风险，可能导致数据丢失、设备不可用或安全事故；您应在具备相应能力与授权的前提下谨慎操作，并自行完成必要备份与确认。',
      ],
    },
    {
      heading: '五、用户内容与数据',
      paragraphs: [
        '您通过本服务上传、提交、存储或处理的指令、代码、文件、对话内容及业务数据（合称「用户内容」）的合法性、准确性及后果由您自行负责；您应确保已获得必要权利与授权，且用户内容不违反法律法规及本协议。',
        '为提供、维护与改进本服务所必需，您授予我们在全球范围内一项非独占的许可，使我们得以在实现本协议目的所必需的范围内存储、处理、传输用户内容；该等处理还应遵守《隐私政策》的约定。',
        '在法律法规允许的范围内，我们可基于产品安全、合规审计、权利保护等正当目的，对用户内容进行必要的技术处理与留存，留存期限以实现目的所必需为限或依法律法规要求。',
      ],
    },
    {
      heading: '六、知识产权',
      paragraphs: [
        '本软件所含的程序、界面设计、文档、商标、标识及相关内容的知识产权归运营方或相应权利人所有，受法律法规保护。除本协议明确授权外，未经书面许可，您不得复制、修改、传播、出租、出售或许可他人使用。',
        '开源软件或第三方组件受其各自许可协议约束，您应遵守相应许可条款。',
      ],
    },
    {
      heading: '七、免责声明与责任限制',
      paragraphs: [
        '本服务按「现状」和「现有」基础提供。在适用法律允许的最大范围内，我们对本服务的及时性、安全性、准确性、完整性、无中断或无错误不作明示或默示的保证。',
        '因不可抗力、网络状况、设备硬件与固件、第三方服务中断、您自身操作或环境配置不当、以及非可归责于运营方的原因所导致的任何直接或间接损失，我们不承担责任；法律法规另有强制性规定的，从其规定。',
        '在任何情况下，我们对您因使用本服务所产生的索赔所承担的赔偿责任总额，以您就该等索赔所涉付费服务已向我们实际支付的金额为上限；若您未就相关功能付费，则我们的赔偿责任以人民币零元为上限，除非适用法律另有强制性规定不得限制。',
      ],
    },
    {
      heading: '八、服务的变更、中止与终止',
      paragraphs: [
        '您可随时停止使用并卸载本软件。我们有权基于技术升级、安全、合规、业务调整等原因，在法律法规允许的范围内中止或终止向您提供全部或部分服务，并将尽可能通过合理方式予以提示。',
        '本协议终止后，您使用本服务的权利即行终止；我们在法律法规要求或合理期限内可删除或匿名化处理与您相关的数据，另有约定或法律另有规定的除外。',
      ],
    },
    {
      heading: '九、法律适用与争议解决',
      paragraphs: [
        '本协议的订立、效力、解释、履行及争议解决，适用中华人民共和国大陆地区法律（仅为冲突法规范之目的，不适用外国法律）。',
        '因本协议引起的或与本协议有关的争议，双方应首先友好协商解决；协商不成的，任何一方均可向被告住所地有管辖权的人民法院提起诉讼，法律法规对管辖另有强制性规定的除外。',
      ],
    },
    {
      heading: '十、其他',
      paragraphs: [
        '本协议中的标题仅为阅读方便，不影响条款解释。若本协议任一条款被有权机关认定为无效或不可执行，不影响其余条款的效力。',
        '我们未行使或延迟行使本协议项下权利，不构成对该权利的放弃。',
        '如您对本协议有任何疑问，可通过《隐私政策》载明的方式或我们届时公布的官方渠道与我们联系。',
      ],
    },
  ],
};

export const PRIVACY_POLICY_ZH: { title: string; intro: string; sections: LegalSection[] } = {
  title: 'RDK Studio 隐私政策',
  intro:
    '地瓜机器人（D-Robotics，以下简称「我们」）重视用户个人信息与隐私保护。本政策适用于 RDK Studio 客户端软件及相关技术服务（以下统称「本服务」）。我们将按照适用法律法规的要求，说明我们如何收集、使用、存储、共享、转让、公开披露及保护您的个人信息，以及您享有的权利。请您在使用本服务前仔细阅读并充分理解本政策；您开始使用或继续使用本服务，即表示您已理解并同意我们按照本政策处理您的个人信息。如您不同意本政策内容，请停止使用本服务。',
  sections: [
    {
      heading: '一、我们收集与使用的个人信息',
      paragraphs: [
        '我们仅会为实现本政策所述目的，在合法、正当、必要的范围内处理个人信息；非必要不收集，且不会将个人信息用于与所述目的不符的用途。',
        '（一）账号与身份验证：当您使用注册、登录或组织统一身份认证等功能时，我们可能收集账号标识、昵称、电子邮箱、手机号码等由您主动提供或经身份提供方返回的信息，用于创建与管理账号、身份核验、权限控制、安全审计及客户服务。',
        '（二）设备连接与远程开发：为向您提供远程连接、文件传输、命令执行、远程桌面、在线开发、设备管理等功能，您可能需主动提供或在本机配置设备地址、端口、认证信息等；该等信息将用于建立连接、执行您发起的操作及保障连接安全，存储方式与期限取决于您的选择与部署环境。',
        '（三）对话与智能辅助：您在使用对话、指令或智能辅助类功能时输入或产生的信息，将用于完成当次服务响应及在符合您或您所在组织配置的前提下进行会话管理或归档；涉及由您自行选定的第三方大模型或推理服务的，相关处理同时受该第三方规则约束。',
        '（四）运营与改进：在符合法律法规及您或您所在组织同意的前提下，我们可能收集并使用去标识化、匿名化或经汇总统计后的信息（如应用版本、设备或浏览器标识、事件类型、时间戳、错误日志、访问记录等），用于保障服务安全稳定运行、分析产品使用情况、改进用户体验；该等处理原则上不涉及可单独识别您身份的内容，具体以实际功能与配置为准。',
        '（五）安全保障：为防范安全风险、识别异常行为及履行网络与数据安全义务，我们可能记录与访问相关的技术信息（如访问时间、网络地址、终端标识、操作日志等），在实现目的所必需的期限内保存，并依法采取安全保护措施。',
        '关于敏感个人信息：我们原则上不主动收集身份证件号码、金融账户、精准行踪轨迹、不满十四周岁未成年人个人信息等敏感个人信息。若您在使用服务过程中自行提供或输入可能构成敏感个人信息的内容，请您谨慎评估必要性；我们仅在实现您所请求的服务所必需的范围内处理，并建议您避免在非必要场景提交。',
      ],
    },
    {
      heading: '二、Cookie 与同类技术',
      paragraphs: [
        '为保障登录态、会话安全与基本功能实现，我们可能使用 Cookie、本地存储（如 localStorage、sessionStorage）或同类技术，用于存储会话标识、偏好设置、匿名标识符等信息。',
        '您可根据浏览器或系统提供的功能管理或清除 Cookie 及本地存储；若您限制该类技术，可能影响部分功能的正常使用。',
        '我们不会将前述技术用于本政策未说明的目的。',
      ],
    },
    {
      heading: '三、委托处理、共享、转让与公开披露',
      paragraphs: [
        '我们不会以出售个人信息的方式牟利。我们可能在以下情形下委托第三方处理或与其共享为实现本政策目的所必需的个人信息：（1）获得您的同意或您主动选择；（2）法律法规规定或有权机关依法提出要求；（3）与受托合作伙伴（如身份认证、云基础设施、消息通知、数据分析等）在严格的数据处理协议约束下，为实现本服务功能所必需，且限于实现目的的最小范围。',
        '我们不会将您的个人信息转让给任何公司、组织或个人，但涉及合并、分立、收购、资产转让或类似交易，且继受方承诺继续受本政策约束的，或法律法规另有规定的除外。',
        '原则上我们不会公开披露您的个人信息；确需公开披露时，我们将依法取得您的单独同意或依据法律法规进行。',
        '若因您或您所在组织的部署安排导致个人信息存储或处理涉及境外，我们将依法采取合同、安全评估、认证或其他适用法律要求的措施，具体以实际部署及合规安排为准。',
      ],
    },
    {
      heading: '四、信息的存储与保护',
      paragraphs: [
        '您的个人信息可能存储于您的终端设备、您或您所在组织管理的服务器，或您配置的第三方云服务中；存储地点与期限取决于部署方式、业务需要及法律法规要求。',
        '我们采用符合业界标准的安全防护措施，包括访问控制、加密传输与存储（在适用场景）、权限最小化、安全审计等，防止数据遭到未经授权的访问、披露、使用或损坏。请您理解，任何安全措施均无法保证绝对安全，您应妥善保管账号、密码及设备。',
        '在实现处理目的后或保存期限届满时，我们将依法删除、匿名化处理或停止除存储和采取必要安全措施之外的处理；法律法规要求留存或另有约定的除外。',
      ],
    },
    {
      heading: '五、您的权利',
      paragraphs: [
        '在适用法律规定的范围内，您对您的个人信息享有查阅、复制、更正、补充、删除、撤回同意、限制处理、解释说明、获取副本等权利。',
        '若您通过企业或组织使用本服务，部分权利行使可能需要由您所在组织的管理员协助或依内部流程办理。您也可通过清除本机配置、会话或浏览器数据等方式，减少本地留存。',
        '为保障安全，我们可能对您的请求进行身份核验；我们将在法律法规规定的期限内答复您的请求。',
      ],
    },
    {
      heading: '六、未成年人保护',
      paragraphs: [
        '本服务主要面向开发者及相关专业人员。若您为未满十四周岁的未成年人，应在监护人陪同下阅读本政策，并在监护人同意后使用本服务。若我们发现未获监护人同意而收集了未成年人的个人信息，将尽快采取删除或匿名化处理等措施。',
      ],
    },
    {
      heading: '七、本政策的更新',
      paragraphs: [
        '我们可能适时修订本政策。当本政策发生重大变更时，我们将通过本软件内提示、官方网站公告或其他合理方式通知您。若您在本政策更新后继续使用本服务，即视为您已阅读并同意更新后的政策；若您不同意更新内容，请停止使用本服务。',
      ],
    },
    {
      heading: '八、联系我们',
      paragraphs: [
        '如您对本政策或个人信息保护相关事宜有任何疑问、意见或投诉，或希望行使相关权利，请通过您所在组织提供的渠道或 D-Robotics 官方公布的联系方式与我们联系。我们将在验证您的身份后，于合理期限内予以答复。',
      ],
    },
  ],
};

export const TERMS_OF_SERVICE_EN: { title: string; intro: string; sections: LegalSection[] } = {
  title: 'RDK Studio Terms of Service',
  intro:
    'Welcome to RDK Studio (“the Software” or “the Service”). Please read this Agreement carefully before you download, install, register, or use the Service, including provisions on limitation of liability, dispute resolution, and governing law. By clicking to accept, installing, using, or otherwise accessing the Service, you acknowledge that you have read, understood, and agree to be bound by this Agreement in full. If you do not agree, do not use the Service.',
  sections: [
    {
      heading: '1. Scope and effect',
      paragraphs: [
        'This Agreement is between you and D-Robotics and its affiliates (“we”, “us”, or “Operator”) regarding your use of the RDK Studio client and related technical services. It applies to the Software, updates, ancillary features, and related documentation.',
        'We may revise this Agreement from time to time. Updates will be posted in the Software, on our website, or by other reasonable means. Continued use after updates constitutes acceptance. If you disagree, stop using the Service.',
        'Matters not covered here are subject to applicable laws and regulations. Separate rules for specific features supplement this Agreement and have equal effect where not inconsistent; where they conflict, the specific rules prevail except as otherwise stated.',
      ],
    },
    {
      heading: '2. Service and license',
      paragraphs: [
        'The Software provides tools to connect to, configure, and manage RDK boards and related development environments, which may include remote access, file and command operations, remote desktop, online IDE, ROS-related capabilities, assistants, and coordination with on-device agents. The actual scope of features is as provided in each release; we may adjust, upgrade, optimize, or discontinue features as permitted by law.',
        'Subject to this Agreement and applicable law, we grant you a limited, non-exclusive, non-transferable, non-sublicensable right to install and run the Software on authorized devices and use the Service as permitted herein.',
        'The Service may rely on third-party products or services (including SSO, cloud infrastructure, messaging, model/inference services, open-source components, and device-side programs). Those are provided by their respective operators; you must comply with their terms and privacy policies. Issues arising from third parties are primarily between you and the third party except where mandatory law provides otherwise.',
      ],
    },
    {
      heading: '3. Account and security',
      paragraphs: [
        'If the Service offers registration, SSO, or other authentication, you must provide accurate and lawful information and keep credentials, tokens, and second factors secure. You bear losses due to inadequate safeguarding or authorized third-party use.',
        'Activity under your account is deemed yours or duly authorized. Notify us or your org admin promptly of unauthorized use and take reasonable steps to limit harm.',
      ],
    },
    {
      heading: '4. Acceptable use',
      paragraphs: [
        'You will comply with applicable laws and public order. You must not use the Service for unlawful, infringing, or harmful activity, including unauthorized access, attacks, malware distribution, data theft or illegal trading, or infringement of IP or trade secrets.',
        'Without our written consent, you may not reverse engineer, decompile, or disassemble the Software or attempt to obtain source code (except where mandatory law allows), remove or circumvent technical protections, or bypass security measures.',
        'You understand that firmware flashing, remote commands, and system changes involve inherent risk of data loss, device failure, or safety issues; operate only with appropriate skill and authorization, and maintain backups.',
      ],
    },
    {
      heading: '5. Your content and data',
      paragraphs: [
        'You are responsible for the legality and accuracy of commands, code, files, chat content, and other data you submit (“User Content”) and for obtaining necessary rights and consents.',
        'To provide and improve the Service, you grant us a worldwide, non-exclusive license to store, process, and transmit User Content as needed for the purposes of this Agreement, subject to our Privacy Policy.',
        'Where permitted by law, we may process User Content for security, compliance, audits, and rights protection, retaining it only as long as necessary for those purposes or as required by law.',
      ],
    },
    {
      heading: '6. Intellectual property',
      paragraphs: [
        'The Software, UI, documentation, trademarks, and related materials are owned by us or licensors and protected by law. Except as expressly licensed, you may not copy, modify, distribute, rent, sell, or sublicense.',
        'Open-source or third-party components are governed by their respective licenses.',
      ],
    },
    {
      heading: '7. Disclaimer and limitation of liability',
      paragraphs: [
        'The Service is provided “as is” and “as available.” To the fullest extent permitted by law, we disclaim warranties of timeliness, security, accuracy, completeness, uninterrupted operation, or error-free operation.',
        'We are not liable for direct or indirect losses caused by force majeure, network conditions, hardware/firmware, third-party outages, your own actions or configuration, or other causes not attributable to us, except where mandatory law provides otherwise.',
        'Our total liability for any claim relating to the Service is limited to fees you actually paid to us for the specific paid feature giving rise to the claim; if no fees were paid, liability is capped at zero, unless mandatory law prohibits such a cap.',
      ],
    },
    {
      heading: '8. Change, suspension, and termination',
      paragraphs: [
        'You may stop using and uninstall the Software at any time. We may suspend or terminate all or part of the Service for technical, security, compliance, or business reasons as permitted by law, with reasonable notice where practicable.',
        'Upon termination, your right to use the Service ends. We may delete or anonymize related data within periods required or permitted by law, unless otherwise agreed.',
      ],
    },
    {
      heading: '9. Governing law and disputes',
      paragraphs: [
        'This Agreement is governed by the laws of mainland China (excluding conflict-of-law rules only where applicable).',
        'Disputes shall first be resolved through good-faith negotiation; failing that, either party may submit the dispute to a competent people’s court at the defendant’s domicile, unless mandatory law requires otherwise.',
      ],
    },
    {
      heading: '10. Miscellaneous',
      paragraphs: [
        'Section titles are for convenience only. If any provision is held invalid, the remainder remains in effect.',
        'Failure to exercise a right is not a waiver.',
        'For questions, contact us through the channels described in the Privacy Policy or as we may publish from time to time.',
      ],
    },
  ],
};

export const PRIVACY_POLICY_EN: { title: string; intro: string; sections: LegalSection[] } = {
  title: 'RDK Studio Privacy Policy',
  intro:
    'D-Robotics (“we”) respects your privacy. This Policy applies to the RDK Studio client and related services (collectively, the “Service”). We explain how we collect, use, store, share, transfer, disclose, and protect personal information, and what rights you have, in accordance with applicable laws. Please read this Policy carefully before using the Service. By starting or continuing to use the Service, you acknowledge that we may process your personal information as described here. If you disagree, please do not use the Service.',
  sections: [
    {
      heading: '1. Personal information we collect and use',
      paragraphs: [
        'We process personal information only for lawful, legitimate, and necessary purposes described in this Policy.',
        '(1) Account and authentication: when you register, log in, or use SSO, we may collect identifiers, display names, email, phone numbers, or similar information you provide or that is returned by your identity provider, for account management, verification, authorization, security audit, and support.',
        '(2) Device connectivity and development: to provide remote access, file transfer, command execution, remote desktop, online IDE, and device management, you may provide or configure addresses, ports, credentials, etc., used to establish connections, fulfill your requests, and protect security; storage depends on your deployment.',
        '(3) Conversations and assistants: content you enter may be used to respond and, where configured by you or your organization, for session management or archiving; third-party model services you select are governed by their rules as well.',
        '(4) Operations and improvement: where permitted by law and consent, we may use de-identified, anonymized, or aggregated information (such as app version, device or browser identifiers, event types, timestamps, error logs, access records) for security, stability, analytics, and product improvement; specifics depend on features and configuration.',
        '(5) Security: we may record technical information related to access for risk prevention and compliance, retained as long as necessary for those purposes.',
        'Sensitive personal information: we do not actively collect ID numbers, financial accounts, precise location, or children’s data in principle. If you voluntarily submit sensitive information, we process it only as needed to fulfill your request; avoid submitting it when unnecessary.',
      ],
    },
    {
      heading: '2. Cookies and similar technologies',
      paragraphs: [
        'We may use cookies, local storage, or similar technologies for session security, preferences, and anonymous identifiers.',
        'You may manage or clear these via browser or system settings; restricting them may affect some features.',
        'We do not use these technologies for purposes beyond those stated in this Policy.',
      ],
    },
    {
      heading: '3. Entrusted processing, sharing, transfer, and disclosure',
      paragraphs: [
        'We do not sell personal information. We may entrust processing or share data with partners (e.g., identity, cloud, messaging, analytics) under strict agreements and only as necessary, or when required by law or competent authorities.',
        'We do not transfer personal information except in mergers, acquisitions, or similar transactions where successors commit to this Policy, or as required by law.',
        'We do not publicly disclose personal information except with your separate consent or as required by law.',
        'Cross-border processing may apply depending on deployment; we take measures required by applicable law and your organization’s compliance arrangements.',
      ],
    },
    {
      heading: '4. Storage and protection',
      paragraphs: [
        'Data may be stored on your device, servers managed by you or your organization, or cloud services you configure; location and retention depend on deployment and legal requirements.',
        'We use industry-standard safeguards including access control, encryption where appropriate, least privilege, and auditing. No system is perfectly secure; protect your credentials and devices.',
        'After purposes are fulfilled or retention periods end, we delete, anonymize, or cease processing except storage and necessary security measures, unless law requires otherwise.',
      ],
    },
    {
      heading: '5. Your rights',
      paragraphs: [
        'Where applicable law grants rights (access, copy, rectification, deletion, restriction, portability, withdrawal of consent, explanation), you may exercise them. Enterprise users may need admin assistance.',
        'We may verify identity before responding and will reply within statutory or reasonable periods.',
      ],
    },
    {
      heading: '6. Minors',
      paragraphs: [
        'The Service is intended for developers and professionals. Users under 14 should use it only with guardian consent. If we learn we collected a child’s data without consent, we will delete or anonymize it promptly.',
      ],
    },
    {
      heading: '7. Changes to this Policy',
      paragraphs: [
        'We may update this Policy. Material changes will be notified via in-app notice, website, or other reasonable means. Continued use after updates means you accept the revised Policy; if you disagree, stop using the Service.',
      ],
    },
    {
      heading: '8. Contact us',
      paragraphs: [
        'For questions, complaints, or to exercise rights, contact us through your organization or D-Robotics official channels. We will respond after verifying your identity where appropriate.',
      ],
    },
  ],
};
