<template>
    <div class="list-item list-item-disabled">
        <div class="left-part">
            <div class="checkbox-placeholder"></div>
            <div class="image-position">
                <img :src="deviceImage" :alt="device.name">
            </div>
            <h2>{{ device.name }}</h2>
        </div>
        <div class="middle-part"></div>
        <div class="right-part">
            <div class="right-top">
                <div class="right-placeholder" v-if="device.key === 's100' || device.key === 'x3-module-emmc' || device.key === 'x5-module-emmc'"></div>
                <span class="device-notice" v-if="noticeText">{{ noticeText }}</span>
            </div>
            <div class="right-bottom">
                <div class="tool-section" v-if="toolSection">
                    <span class="device-description" v-if="toolSection.description">{{ toolSection.description }}：</span>
                    <a-button type="link"
                              size="small"
                              class="download-tool-btn"
                              @click.stop="handleOpenExternal(toolSection.toolUrl)">
                        {{ $t('plugins.imager.labels.downloadTool') }}
                    </a-button>
                </div>
                <div class="other-buttons">
                    <a-button v-if="device.imageDownloadUrl"
                              type="link"
                              size="small"
                              @click.stop="handleOpenExternal(device.imageDownloadUrl)">
                        {{ $t('plugins.imager.labels.downloadImage') }}
                    </a-button>
                    <a-button type="link"
                              size="small"
                              @click.stop="handleOpenExternal(device.infoUrl)">
                        {{ $t('plugins.imager.labels.learnMore') }}
                    </a-button>
                </div>
                <div class="right-bottom-placeholder" v-if="device.key === 's100' || device.key === 'x3-module-emmc' || device.key === 'x5-module-emmc'"></div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { shell } from 'electron';
import { message } from 'ant-design-vue';
import i18n from '@/locales';

const { t } = i18n.global;

const props = defineProps({
    device: {
        type: Object,
        required: true
    },
    deviceImage: {
        type: String,
        required: true
    },
    noticeText: {
        type: String,
        default: ''
    },
    toolSection: {
        type: Object,
        default: null
    }
});

const handleOpenExternal = (link) => {
    if (link && link !== '') {
        shell.openExternal(link);
    } else {
        message.error(t('plugins.imager.titles.invalidUrl'));
    }
};
</script>

<style lang="less" scoped>
@import url('@/assets/styles/common.less');

.list-item {
    height: 6rem;
    border-bottom: solid 1px rgba(255,255,255,.2);
    .center;
    justify-content: space-between;
    user-select: none;
    padding: 0 1rem;
    transition: background .3s ease;
    
    .left-part {
        .center;
        gap: 1rem;
        
        .checkbox-placeholder {
            width: 16px;
            flex-shrink: 0;
        }
        
        .image-position {
            width: 7.5rem;
            height: 5rem;
            img {
                width: 100%;
                height: 100%;
            }
        }
        
        h2 {
            color: white;
            word-break: break-all;
            margin: 0;
        }
    }
    
    .middle-part {
        flex: 1;
    }
    
        .right-part {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        justify-content: center;
        gap: 0.3rem;
        
        .right-top {
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 0.5rem;
            margin-top: -1rem;
            
            .right-placeholder {
                width: 120px;
                flex-shrink: 0;
            }
            
            .device-notice {
                color: #ff4d4f;
                font-size: 0.875rem;
                white-space: nowrap;
                margin-top: -0.5rem;
            }
        }
        
        .right-bottom {
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 0.5rem;
            margin-top: 0.3rem;
            
            .right-bottom-placeholder {
                width: 4.5em;
                min-width: 4.5em;
                flex-shrink: 0;
            }
        }
        
        .tool-section {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            
            .device-description {
                color: rgba(255, 255, 255, 0.8);
                font-size: 0.875rem;
                margin: 0;
                white-space: nowrap;
            }
            
            .download-tool-btn {
                :deep(.ant-btn-link) {
                    color: #1890ff;
                    padding: 0;
                    height: auto;
                    &:hover {
                        color: #40a9ff;
                    }
                }
            }
        }
        
        .other-buttons {
            display: flex;
            gap: 0.25rem;
        }
    }
    
    &.list-item-disabled {
        opacity: 0.85;
        cursor: default;
        background: rgba(255, 255, 255, 0.02);
        border-left: 3px solid rgba(255, 255, 255, 0.3);
        
        .left-part {
            h2 {
                color: rgba(255, 255, 255, 0.7);
            }
        }
        
        &:hover {
            background: rgba(255,255,255,.05);
        }
        
        &:active {
            background: rgba(255,255,255,.05);
        }
    }
}
</style>

