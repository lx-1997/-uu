import { useMemo } from 'react';
import { useAppState } from '../hooks/useAppState';
import { useI18n } from '../i18n/use-i18n';
import { isDesktopMac } from '../utils/env';
import { BadgeCheck } from 'lucide-react';

type Step = 'board' | 'flash' | 'connect' | 'rdkclaw' | 'done';

const BOARDS = [
  {
    key: 'x3',
    name: 'RDK X3',
    chip: '旭日3',
    tops: '5 TOPS',
    cpu: '4x A53 @1.5GHz',
    mem: '2/4GB',
    desc: '入门级机器人开发套件，200+ 开源算法',
    url: 'https://developer.d-robotics.cc/rdkx3',
  },
  {
    key: 'x5',
    name: 'RDK X5',
    chip: '旭日5',
    tops: '10 TOPS',
    cpu: '8x A55 @1.5GHz',
    mem: '4/8GB',
    desc: 'Type-C 闪连开发，Wi-Fi 6 + BT 5.4',
    url: 'https://developer.d-robotics.cc/rdkx5',
  },
  {
    key: 's100',
    name: 'RDK S100',
    chip: 'Journey 6',
    tops: '128 TOPS',
    cpu: '6x A78AE + 4x R52',
    mem: '12/24GB',
    desc: '具身智能平台，大小脑架构，全场景算力',
    url: 'https://developer.d-robotics.cc/rdks100',
  },
];

const IMAGE_RECOMMENDATIONS: Record<string, { name: string; tag: string; url: string }> = {
  x3: { name: 'RDKOS 3.0.3 Desktop', tag: 'ubuntu22.04 / 图形界面', url: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x3/' },
  x5: { name: 'RDKOS 3.4.1 Desktop', tag: 'ubuntu22.04 / 图形界面', url: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x5/' },
  s100: { name: 'RDKS100-V4.0.4-Beta Desktop', tag: 'ubuntu22.04', url: 'https://archive.d-robotics.cc/downloads/os_images/rdk_s100/' },
};

function StepIndicator({ current, steps }: { current: Step; steps: { key: Step; label: string }[] }) {
  const idx = steps.findIndex(s => s.key === current);
  return (
    <div className="ob-steps">
      {steps.map((s, i) => (
        <div key={s.key} className={`ob-step ${i < idx ? 'done' : i === idx ? 'active' : ''}`}>
          <span className="ob-step-num">
            {i < idx ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
            ) : i + 1}
          </span>
          {i < steps.length - 1 && <span className="ob-step-line" />}
        </div>
      ))}
    </div>
  );
}

export default function OnboardingWizard() {
  const {
    obStep, setObStep, selectedBoard, setSelectedBoard,
    setActiveTab, setShowAddDevice, setAddDeviceInitialMethod, currentDevice,
    addToast,
    setObReturnStep,
    setPendingOnboardingChatSend,
    setChatExpanded,
  } = useAppState();

  const { t, language } = useI18n();

  const obSteps = useMemo(
    () => [
      { key: 'board' as const, label: t('onboard.step.board', '选择硬件') },
      { key: 'flash' as const, label: t('onboard.step.flash', '烧录系统') },
      { key: 'connect' as const, label: t('onboard.step.connect', '连接设备') },
      { key: 'rdkclaw' as const, label: t('onboard.step.rdkclaw', '试用 RDKClaw') },
    ],
    [t, language],
  );

  const goFlasher = () => {
    setObReturnStep('flash');
    setActiveTab('flasher');
  };

  const goOpenClaw = () => {
    setObReturnStep('rdkclaw');
    setActiveTab('openclaw');
  };

  const handleTryRDKClaw = () => {
    /** 与 onboard.rdk.tryQuote 示例一致，去掉引号作为实际发送正文 */
    const body = t('onboard.rdk.trySendBody', '你好，RDKClaw！');
    setPendingOnboardingChatSend(body);
    setObStep('done');
    setActiveTab('dashboard');
    setChatExpanded(true);
    addToast(
      t('onboard.toast.trySending', '正在打开工作台并发送问候…'),
      'success',
    );
  };

  const finish = () => {
    setObStep('done');
    addToast(t('onboard.toast.done', '新手引导已完成，尽情使用 RDK Studio 吧！'), 'success');
    setActiveTab('dashboard');
  };

  const stepIdx = obSteps.findIndex((s) => s.key === obStep);

  /** 仅 RDK X5 / S100 支持 Type-C 闪连（与添加设备里 typec 一致） */
  const supportsFlashLink = selectedBoard === 'x5' || selectedBoard === 's100';

  const boardsI18n = useMemo(
    () =>
      BOARDS.map((b) => ({
        ...b,
        chip: t(`onboard.board.${b.key}.chip`, b.chip),
        desc: t(`onboard.board.${b.key}.desc`, b.desc),
      })),
    [t, language],
  );

  return (
    <div className="ob-wizard">
      <div className="ob-header">
        <div className="ob-brand">RDK Studio</div>
        <p className="ob-subtitle">{t('onboard.subtitle', '按步骤完成环境与设备配置')}</p>
      </div>

      <StepIndicator current={obStep} steps={obSteps} />

      <div className="ob-title">{obSteps[stepIdx]?.label}</div>

      {/* ── Step 1: 选择硬件 ── */}
      {obStep === 'board' && (
        <div className="ob-content">
          <p className="ob-desc">{t('onboard.board.pick', '选择你手上的 RDK 开发者套件型号：')}</p>
          <div className="ob-board-grid">
            {boardsI18n.map((b) => (
              <button
                key={b.key}
                type="button"
                className={`ob-board-card ${selectedBoard === b.key ? 'selected' : ''}`}
                onClick={() => setSelectedBoard(b.key)}
              >
                <div className="ob-board-head">
                  <strong className="ob-board-name">{b.name}</strong>
                  <span className="ob-board-tops">{b.tops}</span>
                </div>
                <div className="ob-board-specs">
                  <span>{b.chip}</span>
                  <span>{b.cpu}</span>
                  <span>{b.mem}</span>
                </div>
                <p className="ob-board-desc">{b.desc}</p>
                <a className="ob-board-link" href={b.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                  {t('onboard.board.learnMore', '了解更多')}
                </a>
              </button>
            ))}
          </div>
          <div className="ob-actions ob-actions--end">
            <button type="button" className="btn btn-primary" disabled={!selectedBoard} onClick={() => setObStep('flash')}>
              {t('onboard.btn.next', '下一步')}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: 烧录系统 ── */}
      {obStep === 'flash' && (
        <div className="ob-content">
          {selectedBoard && IMAGE_RECOMMENDATIONS[selectedBoard] ? (
            <>
              <p className="ob-desc">
                {t('onboard.flash.recoBefore', '为你的')}{' '}
                <strong>{BOARDS.find((b) => b.key === selectedBoard)?.name}</strong>
                {' '}{t('onboard.flash.recoAfter', '推荐以下系统镜像：')}
              </p>
              <div className="ob-flash-card">
                <div className="ob-flash-info">
                  <strong>{t(`onboard.image.${selectedBoard}.name`, IMAGE_RECOMMENDATIONS[selectedBoard].name)}</strong>
                  <span className="badge badge-muted">
                    {t(`onboard.image.${selectedBoard}.tag`, IMAGE_RECOMMENDATIONS[selectedBoard].tag)}
                  </span>
                </div>
                <p className="ob-desc">{t('onboard.flash.desktopHint', '推荐 Desktop 版本，含图形界面和完整开发工具链。需要将镜像写入 TF 卡（或 eMMC），请使用烧录工具。')}</p>
                <div className="ob-flash-actions">
                  <a className="btn btn-ghost btn-sm" href={IMAGE_RECOMMENDATIONS[selectedBoard].url} target="_blank" rel="noreferrer">
                    {t('onboard.flash.download', '下载镜像')}
                  </a>
                  <button type="button" className="btn btn-primary btn-sm" onClick={goFlasher}>
                    {t('onboard.flash.openTool', '打开烧录工具')}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <p className="ob-desc">{t('onboard.flash.pickFirst', '请先在烧录工具中选择板卡和镜像完成烧录。')}</p>
          )}
          <div className="ob-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setObStep('board')}>{t('onboard.btn.back', '上一步')}</button>
            <button type="button" className="btn btn-primary" onClick={() => setObStep('connect')}>
              {t('onboard.flash.doneNext', '已烧录完成，下一步')}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: 连接设备 ── */}
      {obStep === 'connect' && (
        <div className="ob-content">
          <p className="ob-desc">{t(
            'onboard.connect.desc',
            '请先为开发者套件通电，用网线或 Wi-Fi 接入与本机相同的局域网，再在下方选择一种方式添加设备。',
          )}</p>
          {supportsFlashLink ? (
            <p className="ob-desc">{t(
              'onboard.connect.flashLinkIntro',
              '若开发者套件暂时无法接入局域网，可使用「闪连」通过 USB Type-C 线连接电脑与开发者套件。',
            )}</p>
          ) : null}
          <div className="ob-connect-methods">
            <button
              type="button"
              className="ob-connect-card"
              onClick={() => {
                setAddDeviceInitialMethod('manual');
                setShowAddDevice(true);
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5"><path d="M5 12.55a11 11 0 0114 0"/><path d="M8.53 16.11a6 6 0 016.95 0"/><circle cx="12" cy="20" r="1"/></svg>
              <div>
                <strong>{t('onboard.connect.sshTitle', 'SSH 网络')}</strong>
                <span>{t('onboard.connect.sshSub', '填写设备 IP 与账号，建立 SSH 连接')}</span>
              </div>
            </button>
            {supportsFlashLink ? (
              <button
                type="button"
                className="ob-connect-card"
                onClick={() => {
                  setAddDeviceInitialMethod('typec');
                  setShowAddDevice(true);
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2v6" />
                  <path d="M9 8h6" />
                  <rect x="7" y="8" width="10" height="4" rx="2" />
                  <path d="M12 12v2" />
                  <path d="M8 14h8v4a2 2 0 01-2 2h-4a2 2 0 01-2-2v-4z" />
                  <circle cx="10" cy="17" r="0.5" fill="var(--accent)" />
                  <circle cx="14" cy="17" r="0.5" fill="var(--accent)" />
                </svg>
                <div>
                  <strong>{t('onboard.connect.flashLinkTitle', '闪连')}</strong>
                  <span>{t('onboard.connect.flashLinkSub', 'Type-C 连接电脑，经 SSH 访问套件端')}</span>
                </div>
              </button>
            ) : null}
            <button
              type="button"
              className={`ob-connect-card${isDesktopMac() ? ' ob-connect-card--disabled' : ''}`}
              disabled={isDesktopMac()}
              title={isDesktopMac() ? t('onboard.connect.serialMacTitle', 'macOS 桌面版暂不支持 USB 串口') : undefined}
              onClick={() => {
                if (isDesktopMac()) return;
                setAddDeviceInitialMethod('usb');
                setShowAddDevice(true);
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5"><path d="M12 18v-6"/><path d="M8 18v-2"/><path d="M16 18v-4"/><rect x="6" y="18" width="4" height="4" rx="1"/><rect x="14" y="18" width="4" height="4" rx="1"/><circle cx="12" cy="8" r="2"/><path d="M12 2v4"/></svg>
              <div>
                <div className="ob-connect-serial-title-row">
                  <strong>{t('onboard.connect.serialTitle', 'USB 串口')}</strong>
                  {isDesktopMac() && (
                    <span className="badge badge-muted">{t('onboard.connect.serialMacBadge', 'Mac 暂不支持')}</span>
                  )}
                </div>
                <span>{t('onboard.connect.serialSub', '浏览器串口调试，仅本机，与网络 SSH 无关')}</span>
              </div>
            </button>
          </div>
          <div className="ob-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setObStep(selectedBoard ? 'flash' : 'board')}>{t('onboard.btn.back', '上一步')}</button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                if (currentDevice) {
                  setObStep('rdkclaw');
                  addToast(
                    t(
                      'onboard.toast.connectHasDevice',
                      '已连接设备。模型与 OpenClaw 在左侧「OpenClaw」中配置，可在后台继续安装与部署。',
                    ),
                    'info',
                  );
                  return;
                }
                setObStep('rdkclaw');
                addToast(t('onboard.toast.skipConnect', '已跳过设备连接，可先体验 AI，稍后再补连设备'), 'info');
              }}
            >
              {t('onboard.connect.next', '下一步')}
            </button>
          </div>
          <p className="ob-desc ob-connect-sidebar-hint">
            {t('onboard.connect.sidebarHint', '也可稍后在左侧导航栏「设备」中连接。')}
          </p>
        </div>
      )}

      {/* ── Step 4: 试用 RDKClaw ── */}
      {obStep === 'rdkclaw' && (
        <div className="ob-content">
          <p className="ob-desc">
            {t(
              'onboard.rdk.intro',
              'RDKClaw 是 Studio 的编排主线：贯穿对话、设备与 OpenClaw 协同；懂你的开发者套件、能查文档、能下命令，把「想法」落成可执行的排障与开发步骤。下一步',
            )}
          </p>
          <div className="ob-try-card">
            <div className="ob-try-icon">
              <BadgeCheck size={24} strokeWidth={1.75} style={{ color: 'var(--accent)' }} aria-hidden />
            </div>
            <div className="ob-try-body">
              <strong>{t('onboard.rdk.tryTitle', '打个招呼')}</strong>
              <span>{t('onboard.rdk.tryQuote', '“你好，RDKClaw！”')}</span>
            </div>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleTryRDKClaw}>
              {t('onboard.rdk.send', '发送')}
            </button>
          </div>
          <div className="ob-flash-card" style={{ marginTop: 12 }}>
            <div className="ob-flash-info">
              <strong>{t('onboard.rdk.ocCardTitle', 'OpenClaw 与模型（推荐）')}</strong>
              <span className="badge badge-muted">{t('onboard.rdk.ocCardBadge', '配好模型更聪明')}</span>
            </div>
            <p className="ob-desc">
              {t(
                'onboard.rdk.ocCardDesc',
                '在「OpenClaw」页面配置模型并一键部署；安装与日志在后台进行，无需卡在新手引导里等待。',
              )}
            </p>
            <div className="ob-flash-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={goOpenClaw}>
                {t('onboard.rdk.goOc', '打开 OpenClaw 页面')}
              </button>
            </div>
          </div>
          <p className="ob-desc ob-try-hint">
            {t(
              'onboard.rdk.hint',
              '完成引导后，在工作台底部对话框描述问题或目标即可，RDKClaw 会拆解步骤并在需要时调用工具与套件端能力，帮你把事办完。',
            )}
          </p>
          <div className="ob-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setObStep('connect')}>{t('onboard.btn.back', '上一步')}</button>
            <button type="button" className="btn btn-primary" onClick={finish}>
              {t('onboard.rdk.finish', '完成引导')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
