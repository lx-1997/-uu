<template>
    <a-modal
        v-model:open="modalVisible"
        :title="$t('studio.titles.changelogTitle')"
        :width="560"
        :footer="null"
        @cancel="handleCancel">
        <div class="changelog-content">
            <!-- 详细文档链接 -->
            <div class="detail-link-container">
                <a class="detail-link" @click="handleDetailLinkClick">
                    {{ $t('studio.titles.changelogDetailLink') }}
                </a>
            </div>
            
            <!-- 版本更新列表 -->
            <div class="version-list">
                <div v-for="version in latestVersions" :key="version.version" class="version-item">
                    <div class="version-header">
                        <span class="version-number">{{ version.version }}</span>
                        <span class="version-date">({{ version.date }})</span>
                    </div>
                    <div v-for="(group, groupIndex) in getGroupedUpdates(version.updates)" :key="groupIndex" class="update-group">
                        <div class="update-group-title" :class="group.type">
                            {{ group.typeLabel }}
                        </div>
                        <ul class="update-list">
                            <li v-for="(item, index) in group.items" :key="index">
                                <span class="update-content">{{ item.content }}</span>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
            
            <!-- 确定按钮 -->
            <div class="footer-actions">
                <a-button type="primary" @click="handleCancel">{{ confirmButtonText }}</a-button>
            </div>
        </div>
    </a-modal>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import i18n from '@/locales';
import { shell } from 'electron';
import { GlobalConfig } from '@/global_configuration/GlobalConfig';

const fs = require('fs');
const path = require('path');
const { ipcRenderer } = require('electron');

const { t } = i18n.global;
const globalConfig = GlobalConfig.getInstance();

// 社区文档更新板块链接
const DETAIL_LINK_URL = 'https://developer.d-robotics.cc/forumList?id=155&title=RDK%20Studio';

// 当前语言相关的 computed
const currentLang = computed(() => i18n.global.locale.value || 'zh');
const langCode = computed(() => currentLang.value === 'zh' ? 'zh-CN' : 'en-US');
const isZh = computed(() => currentLang.value === 'zh');

// 判断更新类型
const getUpdateType = (content) => {
    const lowerContent = content.toLowerCase();
    
    // 判断是否为新增类型
    const isNew = isZh.value
        ? (content.includes('新增') || content.includes('添加'))
        : (lowerContent.includes('add') || lowerContent.includes('new') || lowerContent.includes('support'));
    
    if (isNew) {
        return {
            type: 'new',
            typeLabel: t('studio.changelog.new') || (isZh.value ? '新增' : 'New')
        };
    }
    
    // 默认为优化
    return {
        type: 'optimize',
        typeLabel: t('studio.changelog.optimize') || (isZh.value ? '优化' : 'Optimize')
    };
};

// 格式化日期为 YYYYMMDD
const formatDate = (dateStr) => {
    return dateStr.replace(/[.\-\s]/g, '').slice(0, 8);
};

// 解析 changelog 文件，提取版本信息
const parseChangelog = (text) => {
    if (!text) return [];
    
    const versions = [];
    const lines = text.split('\n');
    let currentVersion = null;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // 匹配版本标题：## v1.2.3 (日期)
        const versionMatch = line.match(/^##\s+(v[\d.]+)\s*\(([^)]+)\)/);
        if (versionMatch) {
            // 保存上一个版本
            if (currentVersion) {
                versions.push(currentVersion);
            }
            
            currentVersion = {
                version: versionMatch[1],
                date: formatDate(versionMatch[2]),
                updates: []
            };
            continue;
        }
        
        // 处理列表项：
        if (currentVersion && /^[\*\-\+]\s/.test(line)) {
            // 提取内容
            const content = line.replace(/^[\*\-\+]\s+/, '').trim();
            
            if (content) {
                const { type, typeLabel } = getUpdateType(content);
                currentVersion.updates.push({ type, typeLabel, content });
            }
        }
    }
    
    // 添加最后一个版本
    if (currentVersion) {
        versions.push(currentVersion);
    }
    
    return versions;
};

const props = defineProps({
    open: {
        type: Boolean,
        default: false
    }
});

const emits = defineEmits(['update:open']);

const modalVisible = computed({
    get: () => props.open,
    set: (value) => emits('update:open', value)
});

const latestVersions = ref([]);

// 确定按钮文本
const confirmButtonText = computed(() => 
    t('studio.changelog.confirm') || (isZh.value ? '确定' : 'OK')
);

// 将更新项按类型分组
const getGroupedUpdates = (updates) => {
    const typeOrder = { 'new': 1, 'optimize': 2 };
    
    const groups = updates.reduce((acc, item) => {
        if (!acc[item.type]) {
            acc[item.type] = {
                type: item.type,
                typeLabel: item.typeLabel,
                items: []
            };
        }
        acc[item.type].items.push(item);
        return acc;
    }, {});
    
    return Object.values(groups).sort((a, b) => 
        (typeOrder[a.type] || 99) - (typeOrder[b.type] || 99)
    );
};

const loadChangelog = async () => {
    try {
        // 使用 GlobalConfig 获取正确的资源路径
        const resourcesPath = globalConfig.pathResourcesGetter;
        // 根据当前语言加载对应的 changelog 文件
        const changelogFileName = `changelog.${langCode.value}.md`;
        const changelogPath = path.resolve(resourcesPath, 'changelog', changelogFileName);
        
        if (fs.existsSync(changelogPath)) {
            const content = fs.readFileSync(changelogPath, 'utf-8');
            latestVersions.value = parseChangelog(content);
        } else {
            console.warn(`未找到 changelog 文件，路径: ${changelogPath}`);
            latestVersions.value = [];
        }
    } catch (error) {
        console.error('加载 changelog 失败:', error);
        latestVersions.value = [];
    }
};

const handleDetailLinkClick = () => {
    shell.openExternal(DETAIL_LINK_URL);
};

const handleCancel = () => {
    modalVisible.value = false;
};

// 监听弹窗打开和语言变化，加载 changelog
watch([() => props.open, currentLang], ([isOpen]) => {
    if (isOpen) {
        loadChangelog();
    }
});

onMounted(() => {
    // 预加载 changelog
    loadChangelog();
});
</script>

<style lang="less" scoped>
.changelog-content {
    padding: 0;
    color: #333;
    line-height: 1.6;
    
    .detail-link-container {
        margin-bottom: 1.5rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid rgba(0, 0, 0, 0.08);
    }
    
    .detail-link {
        color: #1890ff;
        text-decoration: none;
        font-size: 14px;
        cursor: pointer;
        transition: color 0.2s;
        
        &:hover {
            text-decoration: underline;
            color: #40a9ff;
        }
        
        &:active {
            color: #096dd9;
        }
    }
    
    .version-list {
        max-height: 50vh;
        overflow-y: auto;
        margin-bottom: 1.5rem;
        padding-right: 4px;
        
        &::-webkit-scrollbar {
            width: 6px;
        }
        
        &::-webkit-scrollbar-track {
            background: rgba(0, 0, 0, 0.05);
            border-radius: 3px;
        }
        
        &::-webkit-scrollbar-thumb {
            background: rgba(0, 0, 0, 0.2);
            border-radius: 3px;
            
            &:hover {
                background: rgba(0, 0, 0, 0.3);
            }
        }
    }
    
    .version-item {
        margin-bottom: 1.8rem;
        
        &:last-child {
            margin-bottom: 0;
        }
    }
    
    .version-header {
        display: flex;
        align-items: baseline;
        gap: 0.5rem;
        margin-bottom: 0.8rem;
        
        .version-number {
            font-size: 16px;
            font-weight: 600;
            color: #333;
        }
        
        .version-date {
            font-size: 14px;
            color: #666;
            font-weight: normal;
        }
    }
    
    .update-group {
        margin-bottom: 1rem;
        
        &:last-child {
            margin-bottom: 0;
        }
    }
    
    .update-group-title {
        font-size: 14px;
        font-weight: 600;
        margin-bottom: 0.5rem;
        
        &.new {
            color: #52c41a;
        }
        
        &.optimize {
            color: #1890ff;
        }
    }
    
    .update-list {
        list-style: none;
        padding-left: 0;
        margin: 0 0 0 1rem;
        
        li {
            display: flex;
            align-items: flex-start;
            margin-bottom: 0.5rem;
            padding-left: 1.2rem;
            position: relative;
            line-height: 1.6;
            
            &::before {
                content: '•';
                position: absolute;
                left: 0;
                color: #999;
                font-size: 14px;
                line-height: 1.6;
            }
            
            .update-content {
                flex: 1;
                font-size: 14px;
                color: #333;
                word-break: break-word;
            }
        }
    }
    
    .footer-actions {
        display: flex;
        justify-content: center;
        padding-top: 1rem;
        margin-top: 0.5rem;
        border-top: 1px solid rgba(0, 0, 0, 0.08);
        
        :deep(.ant-btn-primary) {
            min-width: 80px;
        }
    }
}

:deep(.ant-modal-content) {
    background: #ffffff;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

:deep(.ant-modal-header) {
    background: #ffffff;
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
    padding: 16px 24px;
    border-radius: 8px 8px 0 0;
}

:deep(.ant-modal-title) {
    color: #333 !important;
    font-size: 16px;
    font-weight: 600;
}

:deep(.ant-modal-body) {
    background: #ffffff;
    color: #333;
    padding: 24px;
}

:deep(.ant-modal-close) {
    color: #666 !important;
    top: 16px;
    right: 16px;
    
    &:hover {
        color: #333 !important;
    }
}
</style>
