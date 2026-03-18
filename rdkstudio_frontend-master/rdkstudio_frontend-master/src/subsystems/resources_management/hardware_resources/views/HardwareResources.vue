<template>
    <div class="hardware-main">
        <header class="hardware-header">
            <h3>{{ $t('resources.hardwares.labels.mainLabel') }}</h3>
            <a-tooltip :title="$t('resources.hardwares.titles.addHardware')"
                       placement="left">
                <a-button ref="addHardwareRef"
                      type="primary"
                      size="small"
                      :icon="h(PlusOutlined)"
                      style="background: rgba(255, 81, 28, 1);"
                      @click="handleAddHardwareClicked">
                      {{ $t('resources.hardwares.labels.addHardware') }}
                </a-button>
            </a-tooltip> 
        </header>
        <section class="hardware-section">
            <!-- <BackgroundStars/> -->
            <div class="bg-wrapper">
                <HardwareDesignedContainer :item-list="itemList"
                                           @deleteItem="handleDeleteItemClicked"
                                           @statusChanged="handleItemStatusChanged">
                </HardwareDesignedContainer>
            </div>
        </section>

        <a-tour class="custom-tour"
                placement="bottomLeft"
                :open="stepsStatus"
                :mask="true"
                :steps="steps"
                @close="handleCancelAddHardwareSteps"></a-tour>

        <Transition name="fade">
            <div v-if="addHardwareFlag" 
                 class="add-hardware-mask">
                <ConnectionSteps :connection-manager="hardwareResourcesManager.connectionManager"
                                 :hardware-list="itemList"
                                 @cancelSteps="handleCancelStepsClicked"
                                 @confirmSteps="handleConfirmStepsClicked"
                                 @startWaiting="handleStartWaiting"
                                 @stopWaiting="handleStopWaiting" />
            </div>
        </Transition>
        
        <Transition name="fade">
            <div v-if="waitingFlag"
                 class="waiting-mask">
                <LoadingAnimation />
            </div>
        </Transition>
    </div>
</template>

<script setup>
import { h, ref, createVNode, shallowRef, nextTick } from 'vue';
import i18n from '@/locales';
import {
    PlusOutlined,
} from '@ant-design/icons-vue';
import {
    HardwareResourcesManager
} from '../managers/HardwareResourcesManager';
// import BackgroundStars from '@/views/backgrounds/BackgroundStars.vue';
import LoadingAnimation from '@/views/components/LoadingAnimation.vue';
import ConnectionSteps from './components/ConnectionSteps.vue';
import HardwareDesignedContainer from './components/HardwareDesignedContainer.vue';

import WelcomStep0Image from '@/assets/images/welcomStep0.png';
import WelcomStep1Image from '@/assets/images/welcomStep1.png';
import WelcomStep2Image from '@/assets/images/welcomStep2.png';
import WelcomCautions0Image from '@/assets/images/welcomCautions0.png';
import WelcomCautions1Image from '@/assets/images/welcomCautions1.png';
import WelcomCautions2Image from '@/assets/images/welcomCautions2.png';


const { t } = i18n.global;
const itemList = ref([]);
const stepsStatus = ref(false);

const hardwareResourcesManager = new HardwareResourcesManager((list) => {
    itemList.value = [...list];
    itemList.value.forEach(item => item.connectionStatus = false)

    if(list.length === 0){
        stepsStatus.value = true;
    }
});

const addHardwareRef = ref();
const steps = ref([
    {
        title: t('resources.hardwares.titles.tourWelcomStep0Title'),
        description: t('resources.hardwares.titles.tourWelcomStep0Description'),
        cover: createVNode('img', {
            alt: 'welcomStep0.png',
            src: WelcomStep0Image,
        })
    },
    {
        title: t('resources.hardwares.titles.tourWelcomStep1Title'),
        description: t('resources.hardwares.titles.tourWelcomStep1Description'),
        cover: createVNode('img', {
            alt: 'welcomStep1.png',
            src: WelcomStep1Image,
        })
    },
    {
        title: t('resources.hardwares.titles.tourTitle'),
        description: t('resources.hardwares.titles.tourDescription'),
        cover: createVNode('img', {
            alt: 'welcomStep2.png',
            src: WelcomStep2Image,
        })
        // target: () => addHardwareRef.value && addHardwareRef.value.$el
    },
    {
        title: t('resources.hardwares.titles.tourWelcomCaution0Title'),
        description: t('resources.hardwares.titles.tourWelcomCaution0Description'),
        cover: createVNode('img', {
            alt: 'welcomCautions0.png',
            src: WelcomCautions0Image,
        })
    },
    {
        title: t('resources.hardwares.titles.tourWelcomCaution1Title'),
        description: t('resources.hardwares.titles.tourWelcomCaution1Description'),
        cover: createVNode('img', {
            alt: 'welcomCautions1.png',
            src: WelcomCautions1Image,
        })
    },
    {
        title: t('resources.hardwares.titles.tourWelcomCaution2Title'),
        description: t('resources.hardwares.titles.tourWelcomCaution2Description'),
        cover: createVNode('img', {
            alt: 'welcomCautions2.png',
            src: WelcomCautions2Image,
        })
    },
])
const addHardwareFlag = ref(false);
const waitingFlag = ref(false);
let waitingConfirmFlag = false;

let hardwareItemObject = {
}

function handleAddHardwareClicked(){
    stepsStatus.value = false;
    addHardwareFlag.value = true;
}

function handleCancelStepsClicked(){
    //clear
    addHardwareFlag.value = false;
}

function handleConfirmStepsClicked(){
    //get object
    hardwareItemObject = hardwareResourcesManager.getConnectionObject();
    console.log(hardwareItemObject)
    hardwareResourcesManager.addHardwareItem(hardwareItemObject, () => {
        itemList.value.push(hardwareItemObject);
    });
    //clear
    addHardwareFlag.value = false;
}

function handleStartWaiting(){
    waitingConfirmFlag = true;
    setTimeout(() => {
        if(waitingConfirmFlag){
            waitingFlag.value = true;
            waitingConfirmFlag = false;
        }
    }, 100)
    
}

function handleStopWaiting(){
    waitingConfirmFlag = false;
    waitingFlag.value = false;
}

function handleDeleteItemClicked(index){
    const obj = itemList.value[index];
    hardwareResourcesManager.deleteHardwareItem(obj, () => {
        itemList.value.splice(index, 1);
    })
}

function handleItemStatusChanged(index, flag){
    console.log('receive params: ', index, flag);
    itemList.value[index].connectionStatus = flag;
    itemList.value.sort((a, b) => {
        if(a.connectionStatus !== b.connectionStatus){
            if(a.connectionStatus) return -1;
            else return 1;
        }
        else{
            if(a.name > b.name) return -1;
            else return 1;
        }
    })
}

function handleCancelAddHardwareSteps(){
    stepsStatus.value = !stepsStatus.value;
}
</script>

<style lang="less" scoped>
@import url('@/assets/styles/common.less');

.hardware-main{
    height: 100%;
    position: relative;
    .hardware-header{
        height: 3rem;
        text-align: left;
        padding: .5rem;
        background: linear-gradient(to top, #06060a 0%,rgba(0,0,0,.95) 100%);
        .center;
        justify-content: space-between;
        color: white;
    }
    .hardware-section{
        height: calc(100% - 3rem);
        // overflow-x: scroll;
        overflow: hidden;
        background: radial-gradient(ellipse at bottom, #1a1311 0%, #06060a 100%);
        .bg-wrapper{
            height: 100%;
            padding: 1rem;
            overflow-x: scroll;
        }

        // background: black;
        animation: bg 30 infinite;
        @keyframes bg {
            50% { background-color: orangered;}
        }
    }
    .add-hardware-mask{
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 10;
        background: rgba(0, 0, 0, .9);
        backdrop-filter: .1rem;
    }

    .waiting-mask{
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 101;
        background: rgba(0,0,0,.5);
        .center;
    }

    .fade-enter-active,
    .fade-leave-active {
        transition: opacity 0.6s ease;
    }

    .fade-enter-from,
    .fade-leave-to {
        opacity: 0;
    }

}
</style>