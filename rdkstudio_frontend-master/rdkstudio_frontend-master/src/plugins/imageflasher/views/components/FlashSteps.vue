<template>
    <div class="flash-steps">
        <a-steps :current="stepCurrent" 
                 :status="stepStatus"
                 :items="steps"></a-steps>
        <Transition name="fade" mode="out-in">
            <div v-if="stepCurrent === 1" class="steps-options">
                <div class="download-path-option">
                    <span class="option-title">{{ $t('plugins.imager.labels.downloadPath') }}: </span>
                    <a-select class="option-select" 
                              size="small"
                              :open="false"
                              :value="downloadPath"
                              @dropdownVisibleChange="emits('chooseDownloadPath')"></a-select>
                </div>
                <div class="delete-after-flash-option">
                    <span class="option-title">{{ $t('plugins.imager.labels.autoDelete') }}: </span>
                    <a-switch v-model:checked="optionAutoDeleteRef"></a-switch>
                </div>
            </div>
            <div v-else-if="stepCurrent === 2">
                <span style="color: yellow;">{{ $t('plugins.imager.titles.attentionChooseStorage') }}</span>
                <InfoCircleOutlined class="storage-icon storage-blink" @click="handleOpenExternalClicked('https://www.bilibili.com/video/BV1HPczeqEPU/?share_source=copy_web&vd_source=d7a3dcf73103b07f664eecd90dd4020e')"/>
                <ReloadOutlined class="storage-icon" @click="emits('refreshStorageDevices')"/>
            </div>
        </Transition>
        
        <div class="steps-content" :class="{'steps-content-less': stepCurrent === 1}">
            <Transition name="fade" mode="out-in">
                <div v-if="stepCurrent === 0">
                    <template v-for="item of dataDeviceList" :key="item.name">
                        <!-- 特殊设备：不可选择，使用独立组件 -->
                        <DisabledDeviceCard 
                            v-if="isDisabledDevice(item.key)"
                            :device="item"
                            :device-image="getDeviceImage(item.key)"
                            :notice-text="getDeviceNotice(item.key)"
                            :tool-section="getToolSection(item)"
                        />
                        <!-- 其他设备：可选择 -->
                        <div v-else class="list-item" @click="handleRdkDeviceChecked(item.key)">
                            <div class="left-part">
                                <a-checkbox :checked="valueOfDeviceRef === item.key"
                                            @change="handleRdkDeviceChecked(item.key)"
                                            @click.stop=""></a-checkbox>
                                <div class="image-position">
                                    <img v-if="item.key === 'x3'" src="@/assets/images/image-rdkx3.png">
                                    <img v-else-if="item.key === 'x3-module'" :src="RdkX3ModuleImage">
                                    <img v-else-if="item.key === 'x5'" ref="x5ref" src="@/assets/images/image-rdkx5.png">
                                    <img v-else-if="item.key === 'x5-module'" ref="x5ModuleRef" :src="RdkX5ModuleImage">
                                </div>
                                <h2>{{ item.name }}</h2>
                            </div>
                            <div class="right-part">
                                <a-button type="primary"
                                          danger
                                          size="small"
                                          @click.stop="handleLearnTFCardUsageClicked">
                                    {{ $t('plugins.imager.labels.useTFCard') }}
                                </a-button>
                                <span style="padding-left: .5rem;"></span>
                                <a-button v-if="item.key === 'x5' || item.key === 'x5-module'"
                                          type="primary"
                                          danger
                                          size="small"
                                          @click.stop="handleLearnTypeCUsageClicked">
                                    {{ $t('plugins.imager.labels.useTypec') }}
                                </a-button>
                                
                                <a-button type="link"
                                          size="small"
                                          @click.stop="handleOpenExternalClicked(item.infoUrl)">{{ $t('plugins.imager.labels.learnMore') }}</a-button>
                            </div>
                        </div>
                    </template>
                </div>
                <div v-else-if="stepCurrent === 1">
                    <div class="list-item" @click="handleLocalImageItemChecked">
                        <div class="left-part">
                            <a-checkbox :checked="localImagePath !== ''"
                                        @change="handleLocalImageItemChecked"
                                        @click.stop=""></a-checkbox>
                            
                            <h3>{{ $t('plugins.imager.labels.customImage') }}</h3>
                        </div>
                        <div class="right-part">
                            <span>{{ localImagePath }}</span>
                        </div>
                    </div>
                    <template v-for="item of dataImageList[getActualDeviceKey(valueOfDeviceRef)]" :key="item.name">
                        <div class="list-item" @click="handleImageItemChecked(item.name)">
                            <div class="left-part">
                                <a-checkbox :checked="valueOfImageRef === item.name"
                                            @change="handleImageItemChecked(item.name)"
                                            @click.stop=""></a-checkbox>
                                
                                <h3>{{ item.name }}</h3>
                                <a-tag v-for="tag of item.tags" 
                                       :key="`${item.name}-${tag}`"
                                       :color="(tag.indexOf('with') >= 0 || tag.indexOf('界面') >= 0) ? (tag === 'withUI' || tag === '图形界面' ? 'green' : 'red') : 'blue'"
                                       >{{ tag }}</a-tag>
                            </div>
                            <div class="right-part">
                                <a-button type="link" 
                                          size="small"
                                          @click.stop="handleOpenExternalClicked(item.infoUrl)">{{ $t('plugins.imager.labels.learnMore') }}</a-button>
                                <a-button type="link" 
                                          size="small"
                                          @click.stop="handleOpenExternalClicked(item.downloadUrl)">{{ $t('plugins.imager.labels.manualDownload') }}</a-button>
                            </div>
                        </div>
                    </template>
                </div>
                <div v-else-if="stepCurrent === 2">
                    <template v-for="item of storageDevices" :key="item.device">
                        <div class="list-item" 
                             @click="handleStorageDeviceChecked(item.device)">
                            <div class="left-part">
                                <a-checkbox :checked="item.device === valueOfStorageRef"
                                            @change="handleStorageDeviceChecked(item.device)"
                                            @click.stop=""></a-checkbox>
                                <h3>{{ item.name }}</h3>
                                <a-tag color="blue">{{ $t('plugins.imager.titles.tagExternal') }}</a-tag>
                            </div>
                            <div class="right-part"></div>
                        </div>
                    </template>
                </div>
                <div v-else-if="stepCurrent === 3" class="progress-area">
                    <a-progress v-show="needsDownloadingRef"
                                :percent="downloadingProgress"
                                style="width: 70%;"></a-progress>
                    <div v-show="needsDownloadingRef" style="color: white; width: 70%; float: left;">{{ $t('plugins.imager.labels.downloading') + downloadingSize }}</div>
                    <a-progress :percent="flashingProgress"
                                style="width: 70%;"></a-progress>
                    <div v-show="flashingSpeed" style="color: white; width: 70%; text-align: left;">{{ flashingSpeed }}</div>
                </div>
                <a-result v-else-if="stepCurrent === 4"
                    status="success"
                    :title="$t('plugins.imager.titles.flashSuccess')"
                    :sub-title="$t('plugins.imager.titles.flashRemove')">
                    <template #extra>
                        <a-space>
                            <a-button key="OK" 
                                      type="primary"
                                      @click="handleCancelClicked">{{ $t('plugins.imager.labels.flashOk') }}</a-button>
                            <a-button key="WiFi" 
                                      type="default"
                                      @click="handleSetWiFiClicked">{{ $t('plugins.imager.labels.setWiFi') }}</a-button>
                        </a-space>
                    </template>
                </a-result>
            </Transition>
        </div>
        <div class="steps-operations">
            <div>
                <a-popconfirm placement="topLeft"
                              :title="$t('plugins.imager.titles.cancelProcedure')"
                              :ok-text="$t('plugins.imager.titles.cancelYes')"
                              :cancel-text="$t('plugins.imager.titles.cancelNo')"
                              @confirm="handleCancelClicked">
                              
                    <a-button ghost 
                              v-show="stepCurrent > 0 && stepCurrent < 4">{{ $t('plugins.imager.labels.btnCancel') }}</a-button>
                </a-popconfirm>
                
            </div>
            
            <div class="move-operations">
                <a-button ghost
                          v-show="stepCurrent > 0 && stepCurrent < 3"
                          @click="handlePreviousClicked">{{ $t('plugins.imager.labels.btnPrev') }}</a-button>
                <span style="padding: 0 .5rem;"></span>
                <a-button v-if="stepCurrent < 2"
                          danger 
                          type="primary"
                          :disabled="(stepCurrent === 0 && valueOfDeviceRef === '')
                                    || (stepCurrent === 1 && valueOfImageRef === '' && localImagePath === '')" 
                          @click="handleNextClicked">{{ $t('plugins.imager.labels.btnNext') }}</a-button>
                <a-button v-else-if="stepCurrent === 2"
                          danger
                          type="primary"
                          :disabled="stepCurrent === 2 && valueOfStorageRef === ''"
                          @click="handleFlashClicked">{{ $t('plugins.imager.labels.btnFlash') }}</a-button>
            </div>
        </div>
        <a-tour :open="tfCardUsageTourRef"
                :mask="false"
                :steps="tfCardUsageSteps"
                @close="handleLearnTFCardUsageClicked"></a-tour>
        <a-tour :open="typecUsageTourRef"
                :mask="false" 
                :steps="typecUsageSteps" 
                @close="handleLearnTypeCUsageClicked"></a-tour>
        <a-tour :open="successTourRef"
                :mask="true"
                :steps="afterFlashingSteps"
                @close="handleAfterFlasingClicked"></a-tour>
        <NetworkConfigModal 
            v-model:open="networkConfigModalVisible"
            :target-device="valueOfStorageRef"
            :flash-manager="flashManager"
            @save="handleNetworkConfigSaved"></NetworkConfigModal>
    </div>
</template>

<script setup>
import { ref, watch, createVNode } from 'vue';
import i18n from '@/locales';
import { shell } from 'electron';
import { message, Modal } from 'ant-design-vue';
import {
    InfoCircleOutlined,
    ReloadOutlined
} from '@ant-design/icons-vue';
import TFCardImagePath0 from '@/assets/images/tfCardUsageStep0.jpeg';
import TypecImagePathPre from '@/assets/images/typecUsagePre.png';
import TypecImagePath0 from '@/assets/images/typecUsageStep0.png';
import TypecImagePath1 from '@/assets/images/typecUsageStep1.png';
import TypecImagePath2 from '@/assets/images/typecUsageStep2.png';
import TypecImagePath3 from '@/assets/images/typecUsageStep3.png';
import TypecImagePath3Hold from '@/assets/images/typecUsageStep3Hold.png';
import TypecImagePath3NoHold from '@/assets/images/typecUsageStep3NoHold.png';
import RdkX5Image from '@/assets/images/image-rdkx5.png';
import RdkS100Image from '@/assets/images/image-s100.png';
import RdkX5ModuleImage from '@/assets/images/image-rdkx5module.png';
import RdkX3ModuleImage from '@/assets/images/image-rdkx3module.png';
import NetworkConfigModal from './NetworkConfigModal.vue';
import DisabledDeviceCard from './DisabledDeviceCard.vue';


const { t } = i18n.global;

// 临时调试功能：跳过烧写之前的步骤，直接到达成功界面
// 设置为 true 时，会直接显示烧写成功界面（stepCurrent = 4）
// 使用完毕后，请将此标志设置为 false 以恢复正常流程
const TEMP_SKIP_TO_SUCCESS = false; // 临时跳过标志：true = 跳过，false = 正常流程

const stepStatus = ref('process');
// 如果启用跳过模式，直接设置为成功界面（步骤4）
const stepCurrent = ref(TEMP_SKIP_TO_SUCCESS ? 4 : 0);
const steps = ref([
    {
        title: t('plugins.imager.titles.contentChooseDevice'),
        description: '',
        // 跳过模式下，所有步骤都标记为完成
        status: TEMP_SKIP_TO_SUCCESS ? 'finish' : 'process',
    },
    {
        title: t('plugins.imager.titles.contentChooseImage'),
        description: '',
        status: TEMP_SKIP_TO_SUCCESS ? 'finish' : 'wait',
    },
    {
        title: t('plugins.imager.titles.contentChooseStorage'),
        description: '',
        status: TEMP_SKIP_TO_SUCCESS ? 'finish' : 'wait',
    },
]);
const optionAutoDeleteRef = ref(false);
const valueOfDeviceRef = ref('');
const valueOfImageRef = ref('');
const valueOfStorageRef = ref('');
const isS100SelectedRef = ref(false);

const needsDownloadingRef = ref(false);
const isDownloadingStatusRef = ref(false);
const isDownloadingFinishedRef = ref(false);
const isFlashingStatusRef = ref(false);
const isFlashingFinishedRef = ref(false);
const typecUsageTourRef = ref(false);
const tfCardUsageTourRef = ref(false);
const successTourRef = ref(false);
const networkConfigModalVisible = ref(false);
const x5ref = ref();
const x5ModuleRef = ref();

const tfCardUsageSteps = [
    {
        title: t('plugins.imager.labels.tourTFCardStep1'),
        description: t('plugins.imager.labels.tourTFCardStep1Description'),
        cover: createVNode('img', {
            alt: 'tfCardUsageStep0.jpeg',
            src: TFCardImagePath0
        }),
        target: () => (x5ref.value && x5ref.value.$el) || (x5ModuleRef.value && x5ModuleRef.value.$el),
    }
]

const typecUsageSteps = [
{
    title: t('plugins.imager.labels.tourPre'),
    description: t('plugins.imager.labels.tourPreDescription'),
    cover: createVNode('img', {
      alt: 'typecUsagePre.png',
      src: TypecImagePathPre,
    }),
    target: () => (x5ref.value && x5ref.value.$el) || (x5ModuleRef.value && x5ModuleRef.value.$el),
  },
  {
    title: t('plugins.imager.labels.tourStep1'),
    description: t('plugins.imager.labels.tourStep1Description'),
    cover: createVNode('img', {
      alt: 'typecUsageStep0.png',
      src: TypecImagePath0,
    }),
    target: () => (x5ref.value && x5ref.value.$el) || (x5ModuleRef.value && x5ModuleRef.value.$el),
  },
  {
    title: t('plugins.imager.labels.tourStep2'),
    description: t('plugins.imager.labels.tourStep2Description'),
    cover: createVNode('img', {
      alt: 'typecUsageStep1.png',
      src: TypecImagePath1,
    }),
    target: () => (x5ref.value && x5ref.value.$el) || (x5ModuleRef.value && x5ModuleRef.value.$el),
  },
  {
    title: t('plugins.imager.labels.tourStep3'),
    description: t('plugins.imager.labels.tourStep3Description'),
    cover: createVNode('img', {
      alt: 'typecUsageStep2.png',
      src: TypecImagePath2,
    }),
    target: () => (x5ref.value && x5ref.value.$el) || (x5ModuleRef.value && x5ModuleRef.value.$el),
  },
  {
    title: t('plugins.imager.labels.tourStep4'),
    description: t('plugins.imager.labels.tourStep4Description'),
    cover: createVNode('img', {
      alt: '',
      src: TypecImagePath3Hold,
    }),
    target: () => (x5ref.value && x5ref.value.$el) || (x5ModuleRef.value && x5ModuleRef.value.$el),
  },
];

const afterFlashingSteps = [
    {
        title: t('plugins.imager.labels.tourAfterFlashingStep1'),
        description: t('plugins.imager.labels.tourAfterFlashingStep1Description'),
        cover: createVNode('img', {
            alt: 'typecUsageStep0.png',
            src: TypecImagePath0,
        }),
    },
    {
        title: t('plugins.imager.labels.tourAfterFlashingStep2'),
        description: t('plugins.imager.labels.tourAfterFlashingStep2Description'),
        cover: createVNode('img', {
            alt: 'typecUsageStep3NoHold.png',
            src: TypecImagePath3NoHold,
        }),
    }
]

const emits = defineEmits([
    'chooseDownloadPath',
    'chooseImageFile',
    'startDownloading',
    'startFlashing',
    'cancelDownloading',
    'cancelFlashing',
    'refreshStorageDevices'
])

const props = defineProps({
    'downloadPath': {
        type: String,
        required: true
    },
    'localImagePath': {
        type: String,
        required: true
    },
    'storageDevices': {
        type: Array,
        required: true
    },
    'flashingType': {
        type: String,
        required: true
    },
    'flashingProgress': {
        type: Number,
        required: true
    },
    'flashingSpeed': {
        type: String,
        required: true
    },
    'downloadingProgress': {
        type: Number,
        required: true
    },
    'downloadingSize': {
        type: String,
        required: true
    },
    'isTypeCAvailable': {
        type: Boolean,
        required: false,
        default: true
    },
    'flashManager': {
        type: Object,
        required: true
    }
})

const handleNextClicked = () => {
    steps.value[stepCurrent.value].status = 'finish';
    stepCurrent.value += 1;
    steps.value[stepCurrent.value].status = 'process';

    console.log('next: ', stepCurrent.value)
}

const handlePreviousClicked = () => {
    steps.value[stepCurrent.value].status = 'wait';
    stepCurrent.value -= 1;
    steps.value[stepCurrent.value].status = 'process';
}

const handleCancelClicked = () => {
    console.log('cancel: ', isDownloadingStatusRef.value, isFlashingStatusRef.value)
    if(isDownloadingStatusRef.value){
        emits('cancelDownloading');
        return;
    }

    if(isFlashingStatusRef.value){
        emits('cancelFlashing');
        return;
    }

    stepCurrent.value = 0;
    steps.value[0].status = 'process';
    steps.value[1].status = 'wait';
    steps.value[2].status = 'wait';

    valueOfDeviceRef.value = '';
    valueOfImageRef.value = '';
    valueOfStorageRef.value = '';
    optionAutoDeleteRef.value = false;

    needsDownloadingRef.value = false;
    isDownloadingStatusRef.value = false;
    isDownloadingFinishedRef.value = false;
    isFlashingStatusRef.value = false;
    isFlashingFinishedRef.value = false;
}

//handlers for contents
const handleRdkDeviceChecked = (key) => {
    valueOfDeviceRef.value = valueOfDeviceRef.value === key ? '' : key;
}

const handleLocalImageItemChecked = () => {
    emits('chooseImageFile');
}

const handleImageItemChecked = (name) => {
    if(valueOfImageRef.value === '' && props.localImagePath !== ''){
        emits('chooseImageFile');
    }

    if(valueOfImageRef.value === name){
        valueOfImageRef.value = '';
    }
    else{
        valueOfImageRef.value = name;

        needsDownloadingRef.value = true;
    }
}

const handleOpenExternalClicked = (link) => {
    if(link && link !== ''){
        shell.openExternal(link);
    }
    else{
        message.error(t('plugins.imager.titles.invalidUrl'))
    }
}

// 判断是否是特殊设备（不可选择的设备）
const isDisabledDevice = (key) => {
    return ['s100', 'x3-module-emmc', 'x5-module-emmc'].includes(key); // 可以扩展
}

// 获取设备图片
const getDeviceImage = (key) => {
    const imageMap = {
        's100': RdkS100Image,
        'x3-module-emmc': RdkX3ModuleImage,
        'x5-module-emmc': RdkX5ModuleImage,
    };
    return imageMap[key] || RdkX5Image;
}

// 获取设备提示文字
const getDeviceNotice = (key) => {
    const noticeMap = {
        's100': '提示:该设备需要使用第三方工具烧写系统',
        'x3-module-emmc': '提示:该设备需要使用第三方工具烧写系统',
        'x5-module-emmc': '提示:该设备需要使用第三方工具烧写系统',
    };
    return noticeMap[key] || '';
}

// 获取工具部分配置
const getToolSection = (item) => {
    if (item.toolDownloadUrl) {
        return {
            description: '',
            toolUrl: item.toolDownloadUrl
        };
    }
    return null;
}

const handleStorageDeviceChecked = (device) => {
    Modal.confirm({
        title: t('plugins.imager.titles.chooseStorageModalTitle'),
        content: t('plugins.imager.titles.chooseStorageModalContent'),
        okText: t('plugins.imager.titles.chooseStorageYes'),
        cancelButtonProps: { style: { display: 'none' } },
        onOk: () => {
            if(device === valueOfStorageRef.value){
                valueOfStorageRef.value = '';
            }
            else{
                valueOfStorageRef.value = device;
            }
        }
    });

    
}

const getActualDeviceKey = (deviceKey) => {
    if(deviceKey === 'x5-module') return 'x5';
    if(deviceKey === 'x3-module') return 'x3';
    return deviceKey;
};

const handleFlashClicked = () => {
    steps.value[stepCurrent.value].status = 'finish';
    stepCurrent.value += 1;
    if(needsDownloadingRef.value){
        const actualKey = getActualDeviceKey(valueOfDeviceRef.value);
        const imageList = dataImageList[actualKey] || [];
        const idx = imageList.findIndex(item => item.name === valueOfImageRef.value);
        if(idx >= 0){
            const item = imageList[idx];
            emits('startDownloading', item.downloadUrl, optionAutoDeleteRef.value, valueOfStorageRef.value);
            isDownloadingStatusRef.value = true;
        }
        
    }
    else{
        emits('startFlashing', valueOfStorageRef.value);
        isFlashingStatusRef.value = true;
    }
}

const handleCancelFlashingTriggered = () => {
    message.info(t('plugins.imager.titles.cancelFlashing'));
    setTimeout(() => {
        isFlashingStatusRef.value = false;
        isFlashingFinishedRef.value = false;
        handleCancelClicked();
    }, 2000)
    
}

const handleCancelDownloadingTriggered = () => {
    isDownloadingStatusRef.value = false;
    isDownloadingFinishedRef.value = false;
    handleCancelClicked();
}

const handleStartFlashingTreggered = () => {
    isFlashingStatusRef.value = true;
}

const handleFinishDownloadingTriggered = () => {
    console.log('finish downloading', isDownloadingStatusRef.value)
    isDownloadingStatusRef.value = false;
    isDownloadingFinishedRef.value = true;
}

const handleDoneFlashingTriggered = () => {
    stepCurrent.value += 1;

    handleAfterFlasingClicked();

    setTimeout(() => {
        isFlashingStatusRef.value = false;
        isFlashingFinishedRef.value = false;
    }, 3000);
    
}

const handleLearnTypeCUsageClicked = () => {
    typecUsageTourRef.value = !typecUsageTourRef.value;
}

const handleLearnTFCardUsageClicked = () => {
    tfCardUsageTourRef.value = !tfCardUsageTourRef.value;
}

const handleAfterFlasingClicked = () => {
    successTourRef.value = !successTourRef.value;
}

const handleSetWiFiClicked = () => {
    networkConfigModalVisible.value = true;
}

const handleNetworkConfigSaved = () => {
    // 只负责关闭弹窗，成功提示由 NetworkConfigModal 自己弹出，避免重复提示
    networkConfigModalVisible.value = false;
}

defineExpose({
    handleCancelDownloadingTriggered,
    handleCancelFlashingTriggered,
    handleDoneFlashingTriggered,
    handleFinishDownloadingTriggered,
    handleStartFlashingTreggered
})

watch(() => props.localImagePath, (newPath) => {
    if(newPath !== '' && valueOfImageRef.value !== ''){
        valueOfImageRef.value = '';
        needsDownloadingRef.value = false;
    }
})

watch(() => props.storageDevices, (newDevices) => {
    if(!isFlashingFinishedRef.value && !isFlashingStatusRef.value && valueOfStorageRef.value !== ''){
        const idx = newDevices.findIndex(item => item.device === valueOfStorageRef.value);
        if(idx < 0){
            console.log('Lost target storage device!');
            valueOfStorageRef.value = '';
            Modal.error({
                title: t('plugins.imager.titles.imagerError'),
                content: t('plugins.imager.titles.contentImagerError')
            })
        }
    }
})

const dataDeviceList = [
    {
        name: 'RDK X3',
        key: 'x3',
        infoUrl: 'https://developer.d-robotics.cc/rdkx3',
    },
    {
        name: 'RDK X5',
        key: 'x5',
        infoUrl: 'https://developer.d-robotics.cc/rdkx5',
    },
    {
        name: 'RDK S100(P)',
        key: 's100',
        infoUrl: 'https://developer.d-robotics.cc/rdks100',
        imageDownloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_s100/',
        toolDownloadUrl: 'https://archive.d-robotics.cc/downloads/software_tools/download_tools/xburn-gui_1.1.8/',
    },
    {
        name: 'RDK X3 Module(TF Card)',
        key: 'x3-module',
        infoUrl: 'https://developer.d-robotics.cc/rdkx3',
    },
    {
        name: 'RDK X3 Module(Emmc)',
        key: 'x3-module-emmc',
        infoUrl: 'https://developer.d-robotics.cc/rdkx3',
        imageDownloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x3/',
    },
    {
        name: 'RDK X5 Module(TF Card)',
        key: 'x5-module',
        infoUrl: 'https://developer.d-robotics.cc/rdkx5',
    },
    {
        name: 'RDK X5 Module(Emmc)',
        key: 'x5-module-emmc',
        infoUrl: 'https://developer.d-robotics.cc/rdkx5',
        imageDownloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x5/',
        toolDownloadUrl: 'https://archive.d-robotics.cc/downloads/software_tools/download_tools/xburn-gui_1.1.8/',
    }
];

const dataImageList = {
    'x3': [
        {
            name: 'RDKOS 3.0.3 Desktop',
            type: 'desktop',
            infoUrl: 'https://developer.d-robotics.cc/rdk_doc/Quick_start/download',
            downloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x3/rdk_os_3.0.3-2025-09-08/rdk-x3-ubuntu22-preinstalled-desktop-3.0.3-arm64.img.xz',
            tags: [ t('plugins.imager.titles.tagWithUI'), 'ubuntu22.04']
        },
        {
            name: 'RDKOS 3.0.3 Server',
            type: 'server',
            infoUrl: 'https://developer.d-robotics.cc/rdk_doc/Quick_start/download',
            downloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x3/rdk_os_3.0.3-2025-09-08/rdk-x3-ubuntu22-preinstalled-server-3.0.3-arm64.img.xz',
            tags: [ t('plugins.imager.titles.tagWithoutUI'), 'ubuntu22.04']
        },
        {
            name: 'RDKOS 3.0.1 Desktop',
            type: 'desktop',
            infoUrl: 'https://developer.d-robotics.cc/rdk_doc/Quick_start/download',
            downloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x3/rdk_os_3.0.1-2025-07-04/release/ubuntu-preinstalled-desktop-arm64.img.xz',
            tags: [ t('plugins.imager.titles.tagWithUI'), 'ubuntu22.04']
        },
        {
            name: 'RDKOS 3.0.1 Server',
            type: 'server',
            infoUrl: 'https://developer.d-robotics.cc/rdk_doc/Quick_start/download',
            downloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x3/rdk_os_3.0.1-2025-07-04/release/ubuntu-preinstalled-server-arm64.img.xz',
            tags: [ t('plugins.imager.titles.tagWithoutUI'), 'ubuntu22.04']
        },
        {
            name: 'RDKOS 3.0.0 Desktop',
            type: 'desktop',
            infoUrl: 'https://developer.d-robotics.cc/rdk_doc/Quick_start/download',
            downloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x3/rdk_os_3.0.0-2024-08-31/release/ubuntu-preinstalled-desktop-arm64.img.xz',
            tags: [ t('plugins.imager.titles.tagWithUI'), 'ubuntu22.04']
        },
        {
            name: 'RDKOS 3.0.0 Server',
            type: 'server',
            infoUrl: 'https://developer.d-robotics.cc/rdk_doc/Quick_start/download',
            downloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x3/rdk_os_3.0.0-2024-08-31/release/ubuntu-preinstalled-server-arm64.img.xz',
            tags: [ t('plugins.imager.titles.tagWithoutUI'), 'ubuntu22.04']
        }
    ],
    'x5': [
        {
            name: 'RDKOS 3.4.1 Desktop',
            type: 'desktop',
            infoUrl: 'https://developer.d-robotics.cc/rdk_doc/Quick_start/download',
            downloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x5/rdk_os_3.4.1-2025-12-9/rdk-x5-ubuntu22-preinstalled-desktop-3.4.1-arm64.img.xz',
            tags: [ t('plugins.imager.titles.tagWithUI'), 'ubuntu22.04']
        },
        {
            name: 'RDKOS 3.4.1 Server',
            type: 'server',
            infoUrl: 'https://developer.d-robotics.cc/rdk_doc/Quick_start/download',
            downloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x5/rdk_os_3.4.1-2025-12-9/rdk-x5-ubuntu22-preinstalled-server-3.4.1-arm64.img.xz',
            tags: [ t('plugins.imager.titles.tagWithoutUI'), 'ubuntu22.04']
        },
        {
            name: 'RDKOS 3.3.3 Desktop',
            type: 'desktop',
            infoUrl: 'https://developer.d-robotics.cc/rdk_doc/Quick_start/download',
            downloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x5/rdk_os_3.3.3-2025-9-28/rdk-x5-ubuntu22-preinstalled-desktop-3.3.3-arm64.img.xz',
            tags: [ t('plugins.imager.titles.tagWithUI'), 'ubuntu22.04']
        },
        {
            name: 'RDKOS 3.3.3 Server',
            type: 'server',
            infoUrl: 'https://developer.d-robotics.cc/rdk_doc/Quick_start/download',
            downloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x5/rdk_os_3.3.3-2025-9-28/rdk-x5-ubuntu22-preinstalled-server-3.3.3-arm64.img.xz',
            tags: [ t('plugins.imager.titles.tagWithoutUI'), 'ubuntu22.04']
        },
        {
            name: 'RDKOS 3.2.3 Desktop',
            type: 'desktop',
            infoUrl: 'https://developer.d-robotics.cc/rdk_doc/Quick_start/download',
            downloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x5/rdk_os_3.2.3-2025-7-9/rdk-x5-ubuntu22-preinstalled-desktop-3.2.3-arm64.img.xz',
            tags: [ t('plugins.imager.titles.tagWithUI'), 'ubuntu22.04']
        },
        {
            name: 'RDKOS 3.2.3 Server',
            type: 'server',
            infoUrl: 'https://developer.d-robotics.cc/rdk_doc/Quick_start/download',
            downloadUrl: 'https://archive.d-robotics.cc/downloads/os_images/rdk_x5/rdk_os_3.2.3-2025-7-9/rdk-x5-ubuntu22-preinstalled-server-3.2.3-arm64.img.xz',
            tags: [ t('plugins.imager.titles.tagWithoutUI'), 'ubuntu22.04']
        }
    ],
};

</script>

<style lang="less" scoped>
@import url('@/assets/styles/common.less');

.flash-steps{
    width: 100%;
    height: 100%;
    padding: 1rem 0;
    .center;
    flex-direction: column;
    justify-content: space-around;
    .storage-icon{
        color: orangered;
        padding: 0 .5rem;
        &:hover{
            cursor: pointer;
            opacity: .8;
        }
        &:active{
            opacity: .5;
        }
    }
    .storage-blink{
        animation: blink 1.5s ease-in-out infinite;
    }
    .steps-options{
        width: 100%;
        .center;
        justify-content: space-between;
        .option-title{
            color: lightgrey;
            padding-right: .3rem;
            user-select: none;
        }
        .download-path-option{
            .center;
            flex-grow: 1;
            padding-right: 2rem;
            .option-select{
                overflow: hidden;
                flex-grow: 1;
                width: 10rem;
            }
            :deep(.ant-select-selector){
                background: transparent;
                color: white;
                border-color: @theme-color;
                text-align: left;
                .ant-select-selection-placeholder{
                    color: gray;
                }
            }
            :deep(.ant-select-arrow){
                color: @theme-color !important;
            }
        }
        .delete-after-flash-option{
            :deep(.ant-switch-checked){
                background: rgba(255, 81, 38, 1) !important;
            }
            :deep(.ant-switch){
                background: gray;
            }
        }
    }
    .steps-content{
        width: 100%;
        height: 70%;
        border: dashed 1px white;
        border-radius: .5rem;
        background: rgba(255,255,255,.05);
        backdrop-filter: blur(.15rem);
        overflow-y: auto;
        .list-item{
            height: 6rem;
            border-bottom: solid 1px rgba(255,255,255,.2);
            .center;
            justify-content: space-between;
            user-select: none;
            padding: 0 1rem;
            transition: background .3s ease;
            .left-part{
                .center;
                gap: 1rem;
                .checkbox-placeholder{
                    width: 16px;
                    flex-shrink: 0;
                }
                .image-position{
                    width: 7.5rem;
                    height: 5rem;
                    // background: rgba(255,255,255,.15);
                    img{
                        width: 100%;
                        height: 100%;
                    }
                }
                .device-info{
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    gap: 0.25rem;
                }
                .device-description{
                    color: rgba(255, 255, 255, 0.6);
                    font-size: 0.875rem;
                    margin: 0;
                    font-style: italic;
                }
                h2, h3, h4{
                    color: white;
                    word-break: break-all;
                    margin: 0;
                }
            }
            .right-part{
                span{
                    color: white;
                    word-break: break-all;
                }
            }
            &:hover{
                background: rgba(255,255,255,.1);
            }
            &:active{
                background: rgba(255,255,255,.3);
            }
        }
        .progress-area{
            width: 100%;
            height: 100%;
            .center;
            flex-direction: column;
            :deep(.ant-progress){
                .ant-progress-inner{
                    background: rgba(200,200,200,.3);
                }
                .ant-progress-text{
                    color: white;
                }
            }
        }
        :deep(.ant-result){
            .ant-result-title, .ant-result-subtitle{
                color: white;
            }
        }
    }
    .steps-content-less{
        height: 60% !important;
    }
    .steps-operations{
        width: 100%;
        .center;
        justify-content: space-between;
        .move-operations{
            :deep(.ant-btn){
                transition: opacity .3s ease;
                &:hover{
                    opacity: .8;
                }
            }
            :deep(.ant-btn-background-ghost){
                color: rgba(255, 81, 38, 1) !important;
                border-color: rgba(255, 81, 38, 1) !important;
            }
            :deep(.ant-btn-dangerous){
                background-color: rgba(255, 81, 38, 1) !important;
            }
        }
    }
    :deep(.ant-steps){
        .ant-steps-item-title::after{
            background: white !important;
        }
        .ant-steps-item-wait{
            .ant-steps-item-icon{
                background-color: rgba(70, 74, 78, 1) !important;
                span{
                    color: lightgray;
                }
            }
            .ant-steps-item-title{
                color: gray;
            }
            .ant-steps-item-description{
                color: gray;
            }
        }
        .ant-steps-item-process{
            .ant-steps-item-icon{
                background-color: rgba(255, 81, 38, 1) !important;
                border-color: orangered;
            }
            .ant-steps-item-title{
                color: white;
            }
            .ant-steps-item-description{
                color: white;
            }
        }
        .ant-steps-item-finish{
            .ant-steps-item-icon{
                background-color: rgba(255, 81, 38, 1) !important;
                border-color: transparent;
                span{
                    color: white;
                }
            }
            .ant-steps-item-title, .ant-steps-item-description{
                color: gray;
            }
        }
    }

//animations
    .fade-enter-active{
    // .fade-leave-active {
        transition: opacity .5s ease;
    }

    .fade-enter-from,
    .fade-leave-to {
        opacity: 0;
    }
}
</style>