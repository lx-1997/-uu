<template>
    <div class="studio-main">
        <div v-if="isMainWindow" class="side-bar">
            <SideBar ref="sideBarRef"
                     @setWebviewOperations="handleSettingWebviewOperations"
                     @changeLanguage="handleLanguageChanged" />
        </div>
        <div class="content-area">
            <div class="content-center">
                <div v-if="webviewStatusRefs"
                     class="webview-operations">
                     <div></div>
                     <div class="right-operations">
                        <a-tooltip placement="left" color="orangered">
                            <template #title>
                                <span>{{ $t('studio.tooltips.openWithBrowser') }}</span>
                            </template>
                            <CompassOutlined @click="handleOpenWithBrowserClicked"/>
                        </a-tooltip>
                        <a-tooltip placement="left" color="orangered">
                            <template #title>
                                <span>{{ $t('studio.tooltips.copyLink') }}</span>
                            </template>
                            <LinkOutlined @click="handleCopyLinkClicked"/>
                        </a-tooltip>
                        <a-tooltip placement="left" color="orangered">
                            <template #title>
                                <span>{{ $t('studio.tooltips.closeTab') }}</span>
                            </template>
                            <CloseCircleOutlined @click="handleCloseTabClicked"/>
                        </a-tooltip>
                     </div>
                </div>
                <div v-if="webviewStatusRefs"
                     class="webview-contents">
                    <a-spin></a-spin>
                </div>
                <ContentArea />
            </div>
        </div>
    </div>
</template>

<script setup>
    import { ref } from 'vue';
    import { useI18n } from 'vue-i18n';
    import SideBar from '@/views/components/SideBar.vue';
    import ContentArea from '@/views/components/ContentArea.vue';
    import { RDKStudioManager } from '@/managers/RDKStudioManager';

    import {
        LinkOutlined,
        CompassOutlined,
        CloseCircleOutlined
    } from '@ant-design/icons-vue';

    const isMainWindow = ref(true);
    const i18n = useI18n();
    const sideBarRef = ref();
    const webviewStatusRefs = ref(false);
    const rdkStudioManager = new RDKStudioManager((isMain) => {
        isMainWindow.value = isMain;
    });

    const handleSettingWebviewOperations = (options) => {
        console.log('setting operations: ', options)
        webviewStatusRefs.value = options.needsOperations;
        rdkStudioManager.handleSettingWebviewOperations(options);
    }

    const handleOpenWithBrowserClicked = () => {
        rdkStudioManager.handleOpenLinkClicked();
    }

    const handleCopyLinkClicked = () => {
        rdkStudioManager.handleCopyLinkClicked();
    }

    const handleCloseTabClicked = () => {
        sideBarRef.value.handleCloseTabClicked(rdkStudioManager.webviewUrlGetter);
    }

    const handleLanguageChanged = (item) => {
        if(i18n.locale.value !== item.key){
            i18n.locale.value = item.key;
            rdkStudioManager.changeLanguage(item.key);
        }
    }
</script>

<style lang="less" scoped>
@import url('@/assets/styles/common.less');

.studio-main{
    height: 100vh;
    .center;
    justify-content: flex-start;
    .side-bar{
        width: 4.5rem;
        min-width: 4.5rem;
        flex-shrink: 0;
        height: 100%;
        // background: linear-gradient(to bottom, rgba(255,255,198,.28) 0%,rgba(237, 117, 5, 0.3) 100%);
        background: black;
    }
    .content-area{
        flex: 1;
        min-width: 0;
        height: 100%;
        padding: .3rem;
        box-sizing: border-box;
        background: black;
        .content-center{
            height: 100%;
            border-radius: .5rem;
            background: rgba(29,32,37,1);
            box-shadow: 0 0 .2rem rgba(0,0,0,.2);
            .center;
            justify-content: flex-start;
            overflow: hidden;
            position: relative;
            .webview-operations{
                position: absolute;
                width: 100%;
                height: 2rem;
                top: 0;
                left: 0;
                background: black;
                z-index: 100;
                .center;
                justify-content: space-between;
                .right-operations{
                    color: white;
                    padding: 0 .5rem;
                    span{
                        padding: 0 .3rem;
                    }
                }
            }
            .webview-contents{
                position: absolute;
                width: 100%;
                height: calc(100% - 2rem);
                top: 2rem;
                left: 0;
                background: black;
                z-index: 100;
                .center;
            }
        }
    }
}
</style>