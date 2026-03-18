<template>
    <div class="launch-button">
        <a-tooltip v-if="appConnection" 
                   placement="top" 
                   color="green">
            <template #title>
                <span>{{ $t('resources.hardwares.titles.launchRunning') }}</span>
            </template>
            <div class="launch-status"
                 ></div>
        </a-tooltip>
        <a-popover v-if="appConnection" 
                   :title="$t('resources.hardwares.titles.closeAppHint')"
                   :open="hintStatus">
            <div class="close-btn">
                <CloseCircleOutlined  @click="emits('clickClose')"/>
            </div>
        </a-popover>
        <a-popover v-if="appUrl"
                   placement="left">
            <template #title>
                <span style="text-transform: uppercase;">{{ appName }}</span>
            </template>
            <template #content>
                <a-qrcode :value="appUrl" 
                          :size="80" 
                          color="white"></a-qrcode>
                <h6 style="color: white;">{{ $t('resources.hardwares.titles.scanQrCodeHint') }}</h6>
            </template>
            <img :src="`file://${imgSrc}`"
                 @click="emits('clickLaunch')">
        </a-popover>
        <a-popover v-else-if="videoTutorial">
            <template #title>
                <span style="text-transform: uppercase; color: orangered;">{{ appName }}</span>
            </template>
            <template #content>
                <a-button type="link" @click="emits('clickLearnMore')">{{ $t('resources.hardwares.titles.appLearnMore') }}</a-button>
            </template>
            <img :src="`file://${imgSrc}`"
                 @click="emits('clickLaunch')">
        </a-popover>
        <a-tooltip v-else>
            <template #title>
                <span style="text-transform: uppercase; color: orangered;">{{ appName }}</span>
            </template>
            <img :src="`file://${imgSrc}`"
                 @click="emits('clickLaunch')">
        </a-tooltip>
    </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import {
    CloseCircleOutlined
} from '@ant-design/icons-vue';

const props = defineProps({
    imgSrc: {
        type: String,
        required: true
    },
    appName: {
        type: String,
        required: true
    },
    appConnection: {
        type: Object,
        required: false
    },
    appUrl: {
        type: String,
        required: false
    },
    tutorial: {
        type: Object,
        required: false
    },
    videoTutorial: {
        type: Object,
        required: false
    }
})

const emits = defineEmits([
    'clickLaunch',
    'clickLearnMore',
    'clickClose'
]);

const hintStatus = ref(true);

watch(() => props.appConnection, (newValue) => {
    if(newValue){
        setTimeout(() => {
            hintStatus.value = false;
        }, 5000)
    }
    else{
        hintStatus.value = true;
    }
})
</script>

<style lang="less" scoped>

.launch-button{
    position: relative;
    width: 3rem;
    height: 3rem;
    border-radius: .25rem;
    // overflow: hidden;

    img{
        width: 100%;
        height: 100%;
        &:hover{
            box-shadow: 0 0 4px rgba(0,0,0,.5);
            cursor: pointer;
        }
        transition: box-shadow .2s ease;
    }
    

    .launch-status{
        position: absolute;
        top: -0.15rem;
        left: -0.15rem;
        width: .5rem;
        height: .5rem;
        border-radius: 0.25rem;
        background: rgba(10,200,10,.8);
        &:hover{
            box-shadow: 0 0 6px rgba(10,200,10,.8);
            cursor: pointer;
        }
        transition: box-shadow .2s ease;
    }
    .close-btn{
        position: absolute;
        font-size: .5rem;
        top: -0.15rem;
        right: -0.15rem;
        width: .5rem;
        height: .5rem;
        transition: box-shadow .2s ease;
        color: red;
        font-weight: bold;
        &:hover{
            text-shadow: 0 0 6px orangered;
            cursor: pointer;
        }
    }

    
}

</style>