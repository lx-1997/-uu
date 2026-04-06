import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n/use-i18n';
import { fetchBots, fetchKnowledgeSpaces } from '../api';
import ProductLibrarySection from './bot-center/ProductLibrarySection';

export default function BotCenterPage() {
  const { t } = useI18n();

  const [spaceCount, setSpaceCount] = useState(0);
  const [totalSources, setTotalSources] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);
  const [activeBotName, setActiveBotName] = useState<string | undefined>();

  const refreshStats = useCallback(async () => {
    const [br, sr] = await Promise.all([fetchBots(), fetchKnowledgeSpaces()]);
    if (br.ok) {
      const active = br.bots.find((b) => b.id === br.activeBotId);
      setActiveBotName(active?.name);
    }
    if (sr.ok) {
      setSpaceCount(sr.spaces.length);
      setTotalSources(sr.spaces.reduce((sum, item) => sum + item.sourceCount, 0));
      setTotalChunks(sr.spaces.reduce((sum, item) => sum + item.totalChunks, 0));
    }
  }, []);

  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  return (
    <div className="tool-page bot-center-page">
      <header className="tool-bar bot-center-topbar">
        <div className="tool-bar-left">
          <span className="tool-bar-title">{t('botCenter.heroTitle', '机器人中心')}</span>
          <span className="tool-bar-count">
            {t(
              'botCenter.heroDescV3',
              '每个资料库对应一份对话配置与知识索引；激活后 RDKClaw 在服务端按注册表绑定检索。',
            )}
          </span>
        </div>
        <div className="tool-bar-right bot-center-topbar__stats">
          <span>
            {spaceCount} {t('botCenter.metricSpaces', '资料库')}
          </span>
          <span>
            {totalSources} {t('botCenter.metricSources', '素材')}
          </span>
          <span>
            {totalChunks} {t('botCenter.metricExcerptsShort', '段摘录')}
          </span>
          <span>{activeBotName ?? t('botCenter.metricActiveEmpty', '未激活资料库对话')}</span>
        </div>
      </header>

      <ProductLibrarySection onStatsRefresh={refreshStats} />
    </div>
  );
}
