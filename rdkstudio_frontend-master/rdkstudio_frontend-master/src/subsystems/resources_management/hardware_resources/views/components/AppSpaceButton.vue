<template>
    <div class="space-button" @click.stop="">
        <div class="app-icon">
            <img :src="`file://${imgSrc}`">
        </div>
        <div class="app-info">
            <a-tooltip color="orangered">
                <template #title>{{  description }}</template>
                <div class="app-description">{{ description }}</div>
            </a-tooltip>
            <div v-if="needsOperations" class="app-operates">
                <!-- <a-progress :percent="50" style="width: 100%;">

                </a-progress> -->
                <a-progress v-if="needsInstall && isInstalling"
                        :percent="installPercents" 
                        stroke-color="#52c41a"
                        style="width: 100%; margin-top: .2rem;"></a-progress>
                <template v-else-if="needsInstall">
                    <span class="app-btn"
                          @click="emits('installApp')"><DownloadOutlined/>{{ $t('resources.hardwares.labels.installApp') }}</span>
                    <span class="app-btn"
                          @click="emits('learnMore')">&nbsp;&nbsp;<InfoCircleOutlined/>{{ $t('resources.hardwares.labels.learnMoreApp') }}</span>
                </template>
                <span v-else
                      class="app-btn"
                      @click="emits('uninstallApp')"><DeleteOutlined/>{{ $t('resources.hardwares.labels.uninstallApp') }}</span>
            </div>
        </div>

        <div v-if="isUninstalling" class="btn-mask">
            <a-spin></a-spin>
        </div>
    </div>
</template>

<script setup>
import {
    DownloadOutlined,
    DeleteOutlined,
    InfoCircleOutlined
} from '@ant-design/icons-vue';

const props = defineProps({
    imgSrc: {
        type: String,
        required: true
    },
    needsInstall: {
        type: Boolean,
        required: true
    },
    needsOperations: {
        type: Boolean,
        required: false,
        default: true
    },
    isInstalling: {
        type: Boolean,
        required: false
    },
    isUninstalling: {
        type: Boolean,
        required: false,
        default: false
    },
    installSteps: {
        type: Number,
        required: false
    },
    installPercents: {
        type: Number,
        required: false
    },
    description: {
        type: String,
        required: true
    }
})

const emits = defineEmits([
    'installApp',
    'uninstallApp',
    'learnMore'
])

</script>

<style lang="less" scoped>
@import url('@/assets/styles/common.less');
@button-length: 3rem;

.space-button{
    position: relative;
    .center;
    justify-content: flex-start;
    padding: .5rem;
    border-radius: .2rem;
    transition: background .5s ease;
    &:hover{
        background: hsla(0, 0%, 100%, .15);
        .app-info{
            .app-description{
                opacity: .9;
            }
        }
    }

    .app-icon{
        width: @button-length;
        height: @button-length;
        border-radius: .2rem;        
        img{
            width: 100%;
            height: 100%;
        }
    }

    .app-info{
        width: calc(100% - @button-length);
        font-size: .8rem;
        padding-left: .5rem;
        .app-description{
            height: 2rem;
            display: -webkit-box;
            -webkit-box-orient: vertical;
            -webkit-line-clamp: 2;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: normal;
            word-break: break-all;
            user-select: none;
            opacity: .6;
            transition: opacity .5s ease;
        }
        .app-operates{
            height: 1rem;
            width: 100%;
            .app-btn{
                color: orangered;
                transition: text-shadow .3s ease;
                &:hover{
                    cursor: pointer;
                    user-select: none;
                    text-shadow: 0 0 .1rem orange;
                }
            }
            :deep(.ant-progress){
                .ant-progress-inner{
                    background: hsla(0, 0%, 100%, .3);
                }
                .ant-progress-text{
                    color: white;
                }
            }
        }
    }

    .app-operations{
        .center;
        font-size: .6rem;
        width: @button-length;
        user-select: none;
        .app-operation{
            width: 100%;
            border: solid 1px rgba(200,200,200,.8);
            border-radius: .2rem;
            margin: .1rem;
            padding: .1rem;
            font-weight: bold;
            color: rgba(222,222,222,1);
            text-align: center;
            &:hover{
                cursor: pointer;
                text-shadow: 0 0 8px rgba(255,255,255,.6);
            }
            transition: text-shadow .2s ease;
        }
    }

    .btn-mask{
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 2;
        background: rgba(0,0,0,.8);
        .center;
    }
}
</style>