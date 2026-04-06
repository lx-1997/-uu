/**
 * 产品资料库 — 每个资料库对应一个 RDKClaw「机器人」配置（绑定知识空间）；
 * 激活后服务端读取 activeBotId；对话时会带上你录入的链接/文档作为参考（大块保留上下文，按需摘录）。
 */

import { useCallback, useEffect, useState } from 'react';
import {
  BookOpen,
  Bot,
  ChevronDown,
  ChevronUp,
  Layers,
  Link2,
  Loader2,
  Power,
  Search,
  Trash2,
} from 'lucide-react';
import { useAppState } from '../../hooks/useAppState';
import { useI18n } from '../../i18n/use-i18n';
import {
  activateBot,
  createBot,
  createKnowledgeSpace,
  deleteBot,
  deleteKnowledgeSpace,
  fetchBotDetail,
  fetchBots,
  fetchKnowledgeSpaces,
  indexKnowledgeText,
  indexKnowledgeUrl,
  indexKnowledgeUrlsBulk,
  searchKnowledgeSpace,
  updateBot,
  type KnowledgeSpaceDetail,
} from '../../api';
import type { DocPriority, RoboBotSummary } from '../../../shared/bot-types';

const DOC_INDEX_HINT_PATH = 'server/rdkclaw/rdk-doc-url-index.md';

function findBotForSpace(spaceId: string, bots: RoboBotSummary[]): RoboBotSummary | undefined {
  return bots.find((b) => (b.knowledgeSpaceIds ?? []).includes(spaceId));
}

export default function ProductLibrarySection({ onStatsRefresh }: { onStatsRefresh: () => void }) {
  const { addToast } = useAppState();
  const { t } = useI18n();

  const [spaces, setSpaces] = useState<KnowledgeSpaceDetail[]>([]);
  const [bots, setBots] = useState<RoboBotSummary[]>([]);
  const [activeBotId, setActiveBotId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | undefined>();

  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [autoActivateOnCreate, setAutoActivateOnCreate] = useState(true);

  const [bulkTextBySpace, setBulkTextBySpace] = useState<Record<string, string>>({});
  const [bulkBusyId, setBulkBusyId] = useState<string | undefined>();

  const [singleUrlBySpace, setSingleUrlBySpace] = useState<Record<string, string>>({});
  const [singleTitleBySpace, setSingleTitleBySpace] = useState<Record<string, string>>({});
  const [singleBusyId, setSingleBusyId] = useState<string | undefined>();

  const [pasteTitleBySpace, setPasteTitleBySpace] = useState<Record<string, string>>({});
  const [pasteBodyBySpace, setPasteBodyBySpace] = useState<Record<string, string>>({});
  const [pasteBusyId, setPasteBusyId] = useState<string | undefined>();

  const [searchQueryBySpace, setSearchQueryBySpace] = useState<Record<string, string>>({});
  const [searchResultsBySpace, setSearchResultsBySpace] = useState<
    Record<string, Array<{ content: string; score: number }>>
  >({});
  const [searchBusyId, setSearchBusyId] = useState<string | undefined>();

  const [ensureBusyId, setEnsureBusyId] = useState<string | undefined>();
  const [settingsBusyId, setSettingsBusyId] = useState<string | undefined>();
  const [settingsDraft, setSettingsDraft] = useState<
    Record<string, { includeRdk: boolean; docPriority: DocPriority; extra: string }>
  >({});

  const loadSpaces = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchKnowledgeSpaces();
      if (res.ok) setSpaces(res.spaces);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  const loadBots = useCallback(async () => {
    const res = await fetchBots();
    if (!res.ok) return;
    setBots(res.bots);
    setActiveBotId(res.activeBotId);
  }, []);

  const loadAll = useCallback(async () => {
    await Promise.all([loadSpaces(), loadBots()]);
    onStatsRefresh();
  }, [loadSpaces, loadBots, onStatsRefresh]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const ensureBotForSpace = async (space: KnowledgeSpaceDetail) => {
    setEnsureBusyId(space.id);
    try {
      const fresh = await fetchBots();
      if (!fresh.ok) return;
      if (findBotForSpace(space.id, fresh.bots)) {
        addToast(t('botCenter.botAlready', '该资料库已有对话配置'), 'info');
        await loadAll();
        return;
      }
      const res = await createBot({
        name: space.name,
        description: space.description || space.name,
        knowledgeSpaceIds: [space.id],
        includeRdkOfficialDocs: true,
        docPriority: 'merged',
      });
      if (!res.ok) return;
      addToast(t('botCenter.botLinkedOk', '已为本资料库创建对话配置'), 'success');
      await loadAll();
    } catch (e) {
      addToast(e instanceof Error ? e.message : t('botCenter.errGeneric', '操作失败'), 'error');
    } finally {
      setEnsureBusyId(undefined);
    }
  };

  const handleCreateSpace = async () => {
    if (!newName.trim()) {
      addToast(t('botCenter.libraryErrName', '请填写资料库名称'), 'warning');
      return;
    }
    const name = newName.trim();
    const desc = newDesc.trim();
    const spaceRes = await createKnowledgeSpace({ name, description: desc });
    if (!spaceRes.ok) return;

    const botRes = await createBot({
      name,
      description: desc || name,
      knowledgeSpaceIds: [spaceRes.space.id],
      includeRdkOfficialDocs: true,
      docPriority: 'merged',
    });
    if (!botRes.ok) {
      addToast(t('botCenter.spaceOnlyNoBot', '资料库已创建，但对话配置创建失败，请稍后在本卡片补建'), 'warning');
      setNewName('');
      setNewDesc('');
      await loadAll();
      return;
    }

    if (autoActivateOnCreate) {
      const act = await activateBot(botRes.bot.id);
      if (act.ok) setActiveBotId(act.activeBotId);
    }

    setNewName('');
    setNewDesc('');
    addToast(
      autoActivateOnCreate
        ? t('botCenter.libraryCreatedActive', '资料库与对话配置已创建，并已用于当前对话')
        : t('botCenter.libraryCreatedWithBot', '资料库与对话配置已创建，可在卡片上「用于对话」'),
      'success',
    );
    await loadAll();
  };

  const handleDeleteSpace = async (id: string) => {
    const bot = findBotForSpace(id, bots);
    if (bot) {
      const dr = await deleteBot(bot.id);
      if (!dr.ok) return;
    }
    const res = await deleteKnowledgeSpace(id);
    if (!res.ok) return;
    addToast(t('botCenter.libraryDeleted', '已删除资料库及关联对话配置'), 'success');
    if (expandedId === id) setExpandedId(undefined);
    await loadAll();
  };

  const handleActivateForSpace = async (botId: string) => {
    const res = await activateBot(botId);
    if (!res.ok) return;
    setActiveBotId(res.activeBotId);
      addToast(t('botCenter.activated', '已切换：后续对话会参考该资料库'), 'success');
    await loadBots();
    onStatsRefresh();
  };

  const handleDeactivate = async () => {
    const res = await activateBot(undefined);
    if (!res.ok) return;
    setActiveBotId(undefined);
    addToast(t('botCenter.deactivated', '已恢复默认助手（仍可使用内置 RDK 文档）'), 'success');
    await loadBots();
    onStatsRefresh();
  };

  const loadSettingsDraft = async (botId: string) => {
    if (settingsDraft[botId]) return;
    const res = await fetchBotDetail(botId);
    const fallback = {
      includeRdk: true as const,
      docPriority: 'merged' as DocPriority,
      extra: '',
    };
    if (!res.ok) {
      setSettingsDraft((prev) => ({ ...prev, [botId]: fallback }));
      return;
    }
    const b = res.bot;
    setSettingsDraft((prev) => ({
      ...prev,
      [botId]: {
        includeRdk: b.includeRdkOfficialDocs,
        docPriority: b.docPriority,
        extra: b.persona?.extraInstructions ?? '',
      },
    }));
  };

  const handleExpand = (spaceId: string, botId: string | undefined) => {
    setExpandedId((prev) => (prev === spaceId ? undefined : spaceId));
    if (botId) void loadSettingsDraft(botId);
  };

  const saveBotSettings = async (botId: string) => {
    const d = settingsDraft[botId];
    if (!d) return;
    setSettingsBusyId(botId);
    try {
      const prev = await fetchBotDetail(botId);
      if (!prev.ok) return;
      const res = await updateBot(botId, {
        includeRdkOfficialDocs: d.includeRdk,
        docPriority: d.docPriority,
        persona: {
          ...prev.bot.persona,
          extraInstructions: d.extra,
        },
      });
      if (!res.ok) return;
      addToast(t('botCenter.settingsSaved', '对话策略已保存'), 'success');
      await loadAll();
    } catch (e) {
      addToast(e instanceof Error ? e.message : t('botCenter.errGeneric', '操作失败'), 'error');
    } finally {
      setSettingsBusyId(undefined);
    }
  };

  const handleBulkIndex = async (spaceId: string) => {
    const text = (bulkTextBySpace[spaceId] ?? '').trim();
    if (!text) {
      addToast(t('botCenter.libraryErrBulk', '请粘贴含 https 链接的文本，或每行一个 URL'), 'warning');
      return;
    }
    setBulkBusyId(spaceId);
    try {
      const res = await indexKnowledgeUrlsBulk(spaceId, { urlsText: text });
      if (!res.ok) return;
      const failed = res.results.filter((r) => !r.ok);
      const u0 = String(failed[0]?.url ?? '');
      const firstErr =
        failed[0]?.error != null
          ? `${u0.length > 52 ? `${u0.slice(0, 52)}…` : u0} — ${failed[0].error}`
          : '';
      let toastMsg: string;
      if (res.indexedUrls === 0 && failed.length > 0) {
        toastMsg = t(
          'botCenter.libraryBulkAllFail',
          `本次 ${failed.length} 个链接均未抓取成功（资料库内原有 ${res.totalChunks} 段摘录未变）。${firstErr ? ` 示例：${firstErr}` : ''}`,
        );
      } else if (failed.length > 0) {
        toastMsg = t(
          'botCenter.libraryBulkPartial',
          `本次成功 ${res.indexedUrls} 个链接，新增 ${res.addedChunksThisRun} 段摘录；资料库累计 ${res.totalChunks} 段。另有 ${failed.length} 个失败。${firstErr ? ` 示例：${firstErr}` : ''}`,
        );
      } else {
        toastMsg = t(
          'botCenter.libraryBulkOk',
          `本次成功 ${res.indexedUrls} 个链接，新增 ${res.addedChunksThisRun} 段摘录；资料库累计 ${res.totalChunks} 段。`,
        );
      }
      addToast(toastMsg, failed.length ? 'warning' : 'success');
      setBulkTextBySpace((prev) => ({ ...prev, [spaceId]: '' }));
      await loadSpaces();
      onStatsRefresh();
    } catch (e) {
      addToast(e instanceof Error ? e.message : t('botCenter.errGeneric', '操作失败'), 'error');
    } finally {
      setBulkBusyId(undefined);
    }
  };

  const handleSingleUrl = async (spaceId: string) => {
    const url = (singleUrlBySpace[spaceId] ?? '').trim();
    if (!url) {
      addToast(t('botCenter.errImportUrl', '请填写网站链接'), 'warning');
      return;
    }
    setSingleBusyId(spaceId);
    try {
      const res = await indexKnowledgeUrl(spaceId, {
        url,
        title: (singleTitleBySpace[spaceId] ?? '').trim() || undefined,
      });
      if (!res.ok) return;
      addToast(t('botCenter.librarySingleOk', '页面已抓取并加入索引'), 'success');
      setSingleUrlBySpace((prev) => ({ ...prev, [spaceId]: '' }));
      setSingleTitleBySpace((prev) => ({ ...prev, [spaceId]: '' }));
      await loadSpaces();
      onStatsRefresh();
    } catch (e) {
      addToast(e instanceof Error ? e.message : t('botCenter.errGeneric', '操作失败'), 'error');
    } finally {
      setSingleBusyId(undefined);
    }
  };

  const handlePasteIndex = async (spaceId: string) => {
    const content = (pasteBodyBySpace[spaceId] ?? '').trim();
    if (!content) {
      addToast(t('botCenter.errImportText', '请填写文本内容'), 'warning');
      return;
    }
    setPasteBusyId(spaceId);
    try {
      const res = await indexKnowledgeText(spaceId, {
        title: (pasteTitleBySpace[spaceId] ?? '').trim() || t('botCenter.manualNote', '手动输入说明'),
        content,
      });
      if (!res.ok) return;
      addToast(t('botCenter.libraryPasteOk', '文本已保存，可作为对话参考'), 'success');
      setPasteBodyBySpace((prev) => ({ ...prev, [spaceId]: '' }));
      await loadSpaces();
      onStatsRefresh();
    } catch (e) {
      addToast(e instanceof Error ? e.message : t('botCenter.errGeneric', '操作失败'), 'error');
    } finally {
      setPasteBusyId(undefined);
    }
  };

  const handleSearch = async (spaceId: string) => {
    const q = (searchQueryBySpace[spaceId] ?? '').trim();
    if (!q) return;
    setSearchBusyId(spaceId);
    try {
      const res = await searchKnowledgeSpace(spaceId, q);
      if (res.ok) {
        setSearchResultsBySpace((prev) => ({ ...prev, [spaceId]: res.results }));
      }
    } catch {
      /* ignore */
    } finally {
      setSearchBusyId(undefined);
    }
  };

  return (
    <div className="bot-center-library">
      <div className="bot-center-library-intro">
        <Layers size={18} aria-hidden />
        <div>
          <strong>{t('botCenter.libraryIntroTitle', '你的产品 / 功能文档索引')}</strong>
          <p>
            {t(
              'botCenter.libraryIntroBodyV2',
              `内置 RDK 文档目录来自仓库（如 ${DOC_INDEX_HINT_PATH}）。此处你只需维护链接或文档：每个资料库对应一份对话配置；启用后，遇到问题时 RDKClaw 会结合你录入的资料思考（无需关心底层如何分段）。`,
            )}
          </p>
        </div>
      </div>

      <div className="bot-center-panel bot-center-library-create">
        <div className="bot-center-panel__head">
          <h2>{t('botCenter.libraryNewTitle', '新建资料库')}</h2>
          {loading ? <Loader2 size={16} className="bot-center-spin" aria-label="loading" /> : null}
        </div>
        <div className="bot-center-form-grid bot-center-form-grid--compact">
          <label className="bot-center-field">
            <span>{t('botCenter.libraryName', '资料库名称')}</span>
            <input
              className="input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('botCenter.libraryNamePh', '例如：X5 整机说明 · 激光雷达集成')}
            />
          </label>
          <label className="bot-center-field">
            <span>{t('botCenter.libraryDesc', '说明（可选）')}</span>
            <input
              className="input"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder={t('botCenter.libraryDescPh', '一句话描述覆盖范围，便于以后区分多个资料库')}
            />
          </label>
          <label className="bot-center-switch-row">
            <span>{t('botCenter.autoActivateOnCreate', '创建后用于当前对话（写入服务端激活状态）')}</span>
            <input
              type="checkbox"
              checked={autoActivateOnCreate}
              onChange={(e) => setAutoActivateOnCreate(e.target.checked)}
            />
          </label>
          <div className="bot-center-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void handleCreateSpace()}>
              <BookOpen size={14} /> {t('botCenter.libraryCreate', '创建资料库')}
            </button>
          </div>
        </div>
      </div>

      <div className="bot-center-library-list">
        {spaces.length === 0 ? (
          <div className="bot-center-empty-state">
            <BookOpen size={18} />
            <strong>{t('botCenter.libraryEmptyTitle', '还没有资料库')}</strong>
            <p>{t('botCenter.libraryEmptyDescV2', '创建后导入链接或文档并启用，后续对话即可参考这些资料。')}</p>
          </div>
        ) : (
          spaces.map((space) => {
            const bot = findBotForSpace(space.id, bots);
            const isActiveBot = Boolean(bot && activeBotId === bot.id);
            const open = expandedId === space.id;

            return (
              <article key={space.id} className="bot-center-space-card">
                <div className="bot-center-space-card__row">
                  <div className="bot-center-space-card__main">
                    <div className="bot-center-space-title-row">
                      <strong>{space.name}</strong>
                      {bot ? (
                        <span className={`bot-center-pill ${isActiveBot ? 'is-on' : ''}`}>
                          <Bot size={12} aria-hidden />
                          {isActiveBot
                            ? t('botCenter.statusActive', '当前对话使用')
                            : t('botCenter.statusIdle', '未激活')}
                        </span>
                      ) : (
                        <span className="bot-center-pill is-warn">
                          {t('botCenter.statusNoBot', '未绑定对话配置')}
                        </span>
                      )}
                    </div>
                    <span className="bot-center-space-meta">
                      {space.sourceCount} {t('botCenter.metricSources', '素材')} · {space.totalChunks}{' '}
                      {t('botCenter.metricExcerpts', '段摘录')} ·{' '}
                      {space.indexStatus}
                    </span>
                    {space.description ? <p className="bot-center-space-desc">{space.description}</p> : null}
                  </div>
                  <div className="bot-center-space-card__actions">
                    {bot ? (
                      <>
                        {isActiveBot ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => void handleDeactivate()}
                          >
                            <Power size={14} /> {t('botCenter.backToDefault', '恢复默认')}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => void handleActivateForSpace(bot.id)}
                          >
                            <Power size={14} /> {t('botCenter.activate', '用于对话')}
                          </button>
                        )}
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={ensureBusyId === space.id}
                        onClick={() => void ensureBotForSpace(space)}
                      >
                        {ensureBusyId === space.id ? <Loader2 size={14} className="bot-center-spin" /> : null}
                        {t('botCenter.ensureBot', '补建对话配置')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleExpand(space.id, bot?.id)}
                      aria-expanded={open}
                    >
                      {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      {open ? t('botCenter.libraryCollapse', '收起') : t('botCenter.libraryExpand', '导入 / 策略')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm bot-center-danger"
                      onClick={() => void handleDeleteSpace(space.id)}
                    >
                      <Trash2 size={14} /> {t('botCenter.delete', '删除')}
                    </button>
                  </div>
                </div>

                {open ? (
                  <div className="bot-center-space-tools">
                    {bot ? (
                      <div className="bot-center-tool-block">
                        <h4>{t('botCenter.convPolicyTitle', '对话策略（保存后由 RDKClaw 使用）')}</h4>
                        <p className="bot-center-hint bot-center-hint--tight">
                          {t(
                            'botCenter.convPolicyHint',
                            '与内置 RDK 文档并行时的优先级、以及额外指令；修改后请点击保存。',
                          )}
                        </p>
                        {settingsDraft[bot.id] ? (
                          <>
                            <label className="bot-center-switch-row">
                              <span>{t('botCenter.includeRdk', '同时保留 RDK 官方知识')}</span>
                              <input
                                type="checkbox"
                                checked={settingsDraft[bot.id].includeRdk}
                                onChange={(e) =>
                                  setSettingsDraft((prev) => ({
                                    ...prev,
                                    [bot.id]: { ...prev[bot.id]!, includeRdk: e.target.checked },
                                  }))
                                }
                              />
                            </label>
                            <label className="bot-center-field">
                              <span>{t('botCenter.priority', '知识优先策略')}</span>
                              <select
                                className="select"
                                value={settingsDraft[bot.id].docPriority}
                                onChange={(e) =>
                                  setSettingsDraft((prev) => ({
                                    ...prev,
                                    [bot.id]: {
                                      ...prev[bot.id]!,
                                      docPriority: e.target.value as DocPriority,
                                    },
                                  }))
                                }
                              >
                                <option value="merged">{t('botCenter.priorityMerged', '混合回答')}</option>
                                <option value="bot-first">{t('botCenter.priorityBot', '优先使用你的资料')}</option>
                                <option value="rdk-first">{t('botCenter.priorityRdk', '优先使用 RDK 官方资料')}</option>
                              </select>
                            </label>
                            <label className="bot-center-field">
                              <span>{t('botCenter.instructions', '补充指引（可选）')}</span>
                              <textarea
                                className="input bot-center-textarea bot-center-textarea--short"
                                rows={3}
                                value={settingsDraft[bot.id].extra}
                                onChange={(e) =>
                                  setSettingsDraft((prev) => ({
                                    ...prev,
                                    [bot.id]: { ...prev[bot.id]!, extra: e.target.value },
                                  }))
                                }
                              />
                            </label>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              disabled={settingsBusyId === bot.id}
                              onClick={() => void saveBotSettings(bot.id)}
                            >
                              {settingsBusyId === bot.id ? <Loader2 size={14} className="bot-center-spin" /> : null}
                              {t('botCenter.saveSettings', '保存策略')}
                            </button>
                          </>
                        ) : (
                          <Loader2 size={16} className="bot-center-spin" aria-label="loading" />
                        )}
                      </div>
                    ) : null}

                    <div className="bot-center-tool-block">
                      <h4>
                        <Link2 size={14} /> {t('botCenter.libraryBulkTitle', '批量链接（推荐）')}
                      </h4>
                      <p className="bot-center-hint bot-center-hint--tight">
                        {t(
                          'botCenter.libraryBulkHint',
                          '每行一个 URL，或粘贴整段 Markdown（会自动抽取其中所有 https 链接）。',
                        )}
                      </p>
                      <p className="bot-center-hint bot-center-hint--tight">
                        {t(
                          'botCenter.libraryBulkHintFail',
                          '若抓取失败：页面需登录、反爬、仅内网或返回空正文时，Studio 无法拉取；可改用「粘贴 Markdown」或本机可访问的链接。',
                        )}
                      </p>
                      <textarea
                        className="input bot-center-textarea bot-center-textarea--short"
                        rows={5}
                        value={bulkTextBySpace[space.id] ?? ''}
                        onChange={(e) =>
                          setBulkTextBySpace((prev) => ({ ...prev, [space.id]: e.target.value }))
                        }
                        placeholder="https://example.com/doc/a&#10;https://example.com/doc/b"
                      />
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={bulkBusyId === space.id}
                        onClick={() => void handleBulkIndex(space.id)}
                      >
                        {bulkBusyId === space.id ? <Loader2 size={14} className="bot-center-spin" /> : null}
                        {t('botCenter.libraryBulkRun', '抓取并索引')}
                      </button>
                    </div>

                    <div className="bot-center-tool-block">
                      <h4>{t('botCenter.librarySingleTitle', '单个网页')}</h4>
                      <div className="bot-center-form-grid bot-center-form-grid--compact">
                        <label className="bot-center-field">
                          <span>URL</span>
                          <input
                            className="input"
                            value={singleUrlBySpace[space.id] ?? ''}
                            onChange={(e) =>
                              setSingleUrlBySpace((prev) => ({ ...prev, [space.id]: e.target.value }))
                            }
                          />
                        </label>
                        <label className="bot-center-field">
                          <span>{t('botCenter.urlTitle', '标题（可选）')}</span>
                          <input
                            className="input"
                            value={singleTitleBySpace[space.id] ?? ''}
                            onChange={(e) =>
                              setSingleTitleBySpace((prev) => ({ ...prev, [space.id]: e.target.value }))
                            }
                          />
                        </label>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={singleBusyId === space.id}
                          onClick={() => void handleSingleUrl(space.id)}
                        >
                          {singleBusyId === space.id ? <Loader2 size={14} className="bot-center-spin" /> : null}
                          {t('botCenter.librarySingleRun', '添加该页')}
                        </button>
                      </div>
                    </div>

                    <div className="bot-center-tool-block">
                      <h4>{t('botCenter.libraryPasteTitle', '粘贴 Markdown / 纯文本')}</h4>
                      <label className="bot-center-field">
                        <span>{t('botCenter.textTitle', '标题（可选）')}</span>
                        <input
                          className="input"
                          value={pasteTitleBySpace[space.id] ?? ''}
                          onChange={(e) =>
                            setPasteTitleBySpace((prev) => ({ ...prev, [space.id]: e.target.value }))
                          }
                        />
                      </label>
                      <textarea
                        className="input bot-center-textarea"
                        rows={6}
                        value={pasteBodyBySpace[space.id] ?? ''}
                        onChange={(e) =>
                          setPasteBodyBySpace((prev) => ({ ...prev, [space.id]: e.target.value }))
                        }
                      />
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={pasteBusyId === space.id}
                        onClick={() => void handlePasteIndex(space.id)}
                      >
                        {pasteBusyId === space.id ? <Loader2 size={14} className="bot-center-spin" /> : null}
                        {t('botCenter.libraryPasteRun', '保存为资料')}
                      </button>
                    </div>

                    <div className="bot-center-tool-block">
                      <h4>
                        <Search size={14} /> {t('botCenter.librarySearchTitle', '试搜关键词（可选）')}
                      </h4>
                      <div className="bot-center-search-row">
                        <input
                          className="input"
                          value={searchQueryBySpace[space.id] ?? ''}
                          onChange={(e) =>
                            setSearchQueryBySpace((prev) => ({ ...prev, [space.id]: e.target.value }))
                          }
                          placeholder={t('botCenter.librarySearchPh', '输入关键词，看看能否找到相关段落')}
                        />
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={searchBusyId === space.id}
                          onClick={() => void handleSearch(space.id)}
                        >
                          {searchBusyId === space.id ? <Loader2 size={14} className="bot-center-spin" /> : null}
                          {t('botCenter.librarySearchRun', '搜索')}
                        </button>
                      </div>
                      {(searchResultsBySpace[space.id] ?? []).length > 0 ? (
                        <ul className="bot-center-search-results">
                          {(searchResultsBySpace[space.id] ?? []).map((r, i) => (
                            <li key={i}>
                              <span className="bot-center-search-score">{r.score.toFixed(2)}</span>
                              <span className="bot-center-search-snippet">{r.content}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
