<template>
    <div class="imager-main">
        <header class="imager-header">
            <h2>{{ $t('plugins.imager.labels.mainLabel') }}</h2>
        </header>
        <section class="imager-section">
            <Transition name="fade" mode="out-in">
                <a-spin v-if="!initFlagRef" size="large"></a-spin>
                <FlashSteps v-else
                            ref="flashStepsRef"
                            :download-path="imageDownloadPathRef"
                            :local-image-path="imagePath"
                            :storage-devices="storagesRef"
                            :flashing-progress="percentageRef"
                            :flashing-speed="flashingSpeed"
                            :flashing-type="flashingType"
                            :downloading-progress="downloadPercentageRef"
                            :downloading-size="downloadingSpeedRef"
                            :is-type-c-available="isTypeCAvailableRef"
                            :flash-manager="flashManager"
                            @chooseDownloadPath="handleChooseDownloadPathClicked"
                            @chooseImageFile="handleImageSelected"
                            @refreshStorageDevices="handleRefreshStorageDevicesClicked"
                            @startDownloading="handleDownloadClicked"
                            @startFlashing="handleFlashClicked"
                            @cancelDownloading="handleCancelDownloadingClicked"
                            @cancelFlashing="handleCancelFlashingClicked"></FlashSteps>
            </Transition>
        </section>
        <div v-if="compressingStatusRef" class="decompress-mask">
            <a-spin size="large"></a-spin>
            <span>Decompressing...</span>
        </div>
    </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import i18n from '@/locales';
import { onBeforeRouteLeave } from 'vue-router'
import { message, Modal } from 'ant-design-vue';
import FlashSteps from './components/FlashSteps.vue';
import {
    OPEN_DIALOG,
    DIALOG_RESULT,
    GET_DOWNLOAD_PATH,
    RETURN_DOWNLOAD_PATH
} from '@/constants/AppEventNames';
import { FlashManager } from '../managers/FlashManager';
import { DownloadManager } from '../managers/DownloadManager';
import { XZFileManager } from '../managers/XZFileManager';

const { t } = i18n.global;
const { ipcRenderer } = require('electron');
const SUPPORTED_EXTENSIONS = [
	// 'bin',
	// 'bz2',
	// 'dmg',
	// 'dsk',
	// 'etch',
	// 'gz',
	// 'hddimg',
	// 'iso',
	// 'raw',
	// 'rpi-sdimg',
	// 'sdcard',
	// 'vhd',
	// 'wic',
	// 'zip',
    'xz',
    'img'
];

const initFlagRef = ref(false);
const storagesRef = ref([]);
const imagePath = ref('');

const downloadPercentageRef = ref(0);
const downloadingSpeedRef = ref('');

const flashingState = ref(false);
const percentageRef = ref(0);
const flashingSpeed = ref('');
const flashingType = ref('');

const flashStepsRef = ref();
const imageDownloadPathRef = ref('');
const compressingStatusRef = ref(false);

const isTypeCAvailableRef = ref(true);


const flashManager = new FlashManager((list) => {
    storagesRef.value = list;
});
isTypeCAvailableRef.value = flashManager.isTypeCAvailableGetter;

const downloadManager = new DownloadManager((percentage, speedStr, skipFlag) => {
    if(skipFlag){
        message.info(t('plugins.imager.titles.imageExists'))
    }
    downloadPercentageRef.value = percentage;
    downloadingSpeedRef.value = speedStr;
}, (error) => {
    Modal.error({
        title: t('plugins.imager.titles.downloadingError'),
        content: error
    })
});

const xzFileManager = new XZFileManager();

const handleFlashingStatusUpdated = (err, progress, speedStr, finished) => {
    if(err){
        Modal.error({
            title: t('plugins.imager.errors.flashingErrorHint'),
            content: t('plugins.imager.errors.contentFlashingError'),
        })

        return;
    }
    percentageRef.value = progress;
    flashingSpeed.value = speedStr;

    if(finished){
        flashStepsRef.value.handleDoneFlashingTriggered();
        flashingState.value = false;
        downloadPercentageRef.value = 0;
        percentageRef.value = 0;
        downloadingSpeedRef.value = '';
        flashingSpeed.value = '';
    }
}

const handleImageSelected = () => {
    if(imagePath.value !== ''){
        imagePath.value = '';
        return;
    }

    ipcRenderer.once(DIALOG_RESULT, async (event, result) => {
        console.log(event, result)
        if(!result.canceled && result.filePaths.length > 0){

            const imgPathFromUser = result.filePaths[0];

            //decomporess first
            if(xzFileManager.isXZFile(imgPathFromUser)){
                Modal.confirm({
                    title: t('plugins.imager.titles.decompressHint'),
                    content: t('plugins.imager.titles.contentDecompress'),
                    okText: t('plugins.imager.titles.decompressOk'),
                    cancelText: t('plugins.imager.titles.decompressCancel'),
                    onOk: async () => {
                        compressingStatusRef.value = true;
                        const result = await xzFileManager.decompressXZFileFromMainProcess(imgPathFromUser);
                        compressingStatusRef.value = false;
                        if(result){
                            imagePath.value = result;
                        }
                        else{
                            message.error(t('plugins.imager.errors.decompressFailed'));
                        }
                        return;
                    },
                    onCancel: () => {

                    }
                })
            }
            else if(xzFileManager.isIMGFile(imgPathFromUser)){
                imagePath.value = imgPathFromUser;
            }
            else{
                message.error(t('plugins.imager.errors.unsupportFileType'))
            }
        }
    });

    //choose file
    const options = {
        defaultPath: process.env.OWD,
        properties: ['openFile', 'treatPackageAsDirectory'],
        filters: [
            {
                name: 'osImages',
                extensions: SUPPORTED_EXTENSIONS,
            },
            {
                name: 'allFiles',
                extensions: ['*'],
            },
        ],
    };

    ipcRenderer.send(OPEN_DIALOG, options);
}

const handleFlashClicked = async (storage, deleteFlag=false) => {
    flashManager.flashImage(storage, imagePath.value, deleteFlag, handleFlashingStatusUpdated);
}

const handleRefreshStorageDevicesClicked = () => {
    storagesRef.value = [];
    flashManager.checkUSBDevices();
}

const handleDownloadClicked = (url, deleteFlag, storage) => {
    downloadManager.downloadFile(url, imageDownloadPathRef.value, async (filePath) => {

        //decompress first
        if(xzFileManager.isXZFile(filePath)){
            compressingStatusRef.value = true;
            const result = await xzFileManager.decompressXZFileFromMainProcess(filePath);
            compressingStatusRef.value = false;
            if(result){
                imagePath.value = result;

                flashStepsRef.value.handleFinishDownloadingTriggered();
                flashStepsRef.value.handleStartFlashingTreggered();
                await handleFlashClicked(storage, deleteFlag);
            }
            else{
                message.error(t('plugins.imager.errors.decompressFailed'));
            }
        }
        else{
            message.error(t('plugins.imager.errors.notXZFile'));
        }
    })
}

const handleCancelFlashingClicked = () => {
    flashManager.cancelFlashing((err) => {
        if(err){
            message.warning(t('plugins.imager.errors.stillFlashing'));
            return;
        }
        percentageRef.value = 0;
        flashingSpeed.value = '';
        flashStepsRef.value.handleCancelFlashingTriggered();
        flashingState.value = false;
    });

    
}

const handleCancelDownloadingClicked = () => {
    downloadManager.cancelDownload();
    flashStepsRef.value.handleCancelDownloadingTriggered();
}

const handleChooseDownloadPathClicked = () => {
    ipcRenderer.once(DIALOG_RESULT, (event, result) => {
        console.log(event, result)
        if(!result.canceled && result.filePaths.length > 0){
            imageDownloadPathRef.value = result.filePaths[0]
        }
    })

    ipcRenderer.send(OPEN_DIALOG, {
        properties: ["openDirectory"]
    })
}

ipcRenderer.once(RETURN_DOWNLOAD_PATH, (event, result) => {
    if(result?.path){
        imageDownloadPathRef.value = result.path;
    }
})

ipcRenderer.send(GET_DOWNLOAD_PATH);





onMounted(() => {
    flashManager.checkDependencies(() => {
        initFlagRef.value = true;
        message.success(t('plugins.imager.titles.initSuccess'), 7);
        flashManager.checkUSBDevices();
    }, () => {
        Modal.error({
            title: t('plugins.imager.titles.imagerError'),
            content: t('plugins.imager.titles.initFailed')
        })
    })

    Modal.warn({
        title: t('plugins.imager.titles.hintAdminTitle'),
        content: t('plugins.imager.titles.hintAdminOpenStudio')
    })

})

onBeforeUnmount(() => {

})

onBeforeRouteLeave((from, to, next) => {
    if(flashingSpeed.value){
        alert('flasing in progress')
        next(false);
    }
    else{
        next();
    }
})
</script>

<style lang="less" scoped>
@import url('@/assets/styles/common.less');

.imager-main{
    width: 100%;
    height: 100%;
    padding: 2rem;
    background: rgba(20, 20, 20, 1);
    position: relative;

    .imager-header{
        height: 3rem;
        text-align: left;
        color: rgba(236, 240, 244, 1);
    }
    .imager-section{
        // width: 100%;
        height: calc(100% - 3rem);
        .center;

        .fade-enter-active{
        // .fade-leave-active {
            transition: opacity .5s ease;
        }

        .fade-enter-from,
        .fade-leave-to {
            opacity: 0;
        }
    }
    .imager-operations{
        background: orange;
        height: 70%;
        .center;
        flex-direction: column;
        justify-content: space-around;
        .imager-options{
            width: 100%;
            .center;
            justify-content: space-around;
        }
        .imager-actions{
            width: 100%;
            .center;
            justify-content: space-around;
            .imager-progress{
                width: 50%;
            }
        }
    }

    .decompress-mask{
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,.8);
        z-index: 10;
        .center;
        flex-direction: column;
        span{
            user-select: none;
            color: white;
        }
    }
}
</style>