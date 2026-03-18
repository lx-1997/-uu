<template>
    <div class="connection-steps">
        <a-steps :current="stepCurrent" 
                 :status="stepStatus"
                 :items="steps"></a-steps>
        <div class="steps-content">
            <div class="title-group">
                <h3>{{ $t('resources.hardwares.labels.stepsLabel') }}</h3>
                <a-button size="small"
                          :icon="h(CloseOutlined)"
                          style="background: rgba(255, 81, 28, 1); color: white"
                          @click="handleCancelClicked"></a-button>
            </div>

            <Transition name="fade">

            <div v-if="stepCurrent === 0">
                <h3 style="display: inline-block; padding-right: 1rem;">{{ $t('resources.hardwares.labels.stepFirst') }}</h3>
                <QuestionCircleOutlined class="blink-text" @click="handleConnectionTypeHintClicked"/>
                <br>
                <a-radio-group v-model:value="connectionType" 
                               @change="handleNextFocused">
                    <a-radio v-if="connectionManager.isLongTermConnectionAvailableGetter" :style="radioStyle" :value="CONNECTION_ETHERNET">{{ $t('resources.hardwares.labels.typeNetworkCable') }}</a-radio>
                    <a-radio v-else :style="radioStyle" :value="CONNECTION_ETHERNET_ONE_TIME">{{ $t('resources.hardwares.labels.typeNetworkCableOneTime') }}</a-radio>
                    <a-radio :style="radioStyle" :value="CONNECTION_ETHERNET_SETTING_WLAN">{{ $t('resources.hardwares.labels.typeNetworkCableSettingWlan') }}</a-radio>
                    <!-- <a-radio :style="radioStyle" :value="CONNECTION_SERIALPORT">Serial Port Cable</a-radio> -->
                    <template v-if="connectionManager.isTypeCAvailableGetter">
                        <a-radio v-if="connectionManager.isLongTermConnectionAvailableGetter" :style="radioStyle" :value="CONNECTION_TYPEC">{{ $t('resources.hardwares.labels.typeTypeC') }}</a-radio>
                        <a-radio v-else :style="radioStyle" :value="CONNECTION_TYPEC_ONE_TIME">{{ $t('resources.hardwares.labels.typeTypeCOneTime') }}</a-radio>
                        <a-radio :style="radioStyle" :value="CONNECTION_TYPEC_SETTING_WLAN">{{ $t('resources.hardwares.labels.typeTypeCSettingWlan') }}</a-radio>
                    </template>
                    <a-radio :style="radioStyle" :value="CONNECTION_WLAN">{{ $t('resources.hardwares.labels.typeIpAddress') }}</a-radio>
                </a-radio-group>
            </div>
            <div v-else-if="stepCurrent === 1">
                <template v-if="connectionType !== CONNECTION_WLAN">
                    <h3>{{ $t('resources.hardwares.labels.stepSecondNetwork') }}</h3>
                    <a-select ref="select" 
                            v-model:value="connectionName" 
                            style="width: 200px" 
                            :dropdownStyle="dropdownStyleObject"
                            :options="connections" ></a-select>
                    <ReloadOutlined style="color: white; padding-left: 1rem;" @click="handleRefreshNetListClicked"/>
                    <br>
                    <br>
                    <span style="color: yellow; user-select: none;">{{ $t('resources.hardwares.titles.chooseNetworkHint') }}</span>
                    <InfoCircleOutlined class="blink-text" @click="handleNetworkHintClicked" />
                </template>
                <template v-else-if="connectionType === CONNECTION_WLAN">
                    <h3>{{ $t('resources.hardwares.labels.stepSecondIpAddress') }}</h3>
                    <a-input v-model:value="connectionIP" 
                             placeholder="xxx.xxx.xxx.xxx"
                             @pressEnter="handleNextFocused"></a-input>
                </template>
            </div>
            <div v-else-if="stepCurrent === 2">
                <h3>{{ $t('resources.hardwares.labels.stepThird') }}</h3>
                <a-radio-group v-model:value="userName">
                    <a-radio :style="radioStyle" value="sunrise">sunrise ({{ $t('resources.hardwares.titles.contentSunrise') }})</a-radio>
                    <a-radio :style="radioStyle" value="root">root ({{ $t('resources.hardwares.titles.contentRoot') }})</a-radio>
                    <!-- <a-radio :style="radioStyle" value="custom">custom</a-radio> -->
                </a-radio-group>
            </div>
            <div v-else-if="stepCurrent === 3">
                <h3>{{ $t('resources.hardwares.labels.stepForth') }}</h3>
                <a-space direction="vertical">
                    <a-select ref="select" 
                          v-model:value="wifiName" 
                          style="width: 200px" 
                          :options="wifis"></a-select>
                    <a-space style="width:200px">
                        <a-input-password
                            v-model:value="wifiPasswd"
                            v-model:visible="wifiPasswdVisbility"
                            :placeholder="$t('resources.hardwares.labels.passwordInput')"/>
                        <a-button style="background: rgba(255, 81, 28, 1); color: white;"
                                  @click="wifiPasswdVisbility = !wifiPasswdVisbility">
                            {{ wifiPasswdVisbility ? $t('resources.hardwares.labels.passwordHide') : $t('resources.hardwares.labels.passwordShow') }}
                        </a-button>
                    </a-space>
                    <div v-if="wifiNameConnected" style="color: green; user-select: none;">
                            <span>{{ $t('resources.hardwares.labels.wifiConnectionStatus') }}: </span>
                            <span>{{ wifiNameConnected }}</span>
                    </div>
                </a-space>
            </div>
            <div v-else-if="stepCurrent === 4">
                <h3>{{ $t('resources.hardwares.labels.stepFinal') }}</h3>
                <a-form :model="formState" :label-col="labelCol" :wrapper-col="wrapperCol">
                    <a-form-item :label="$t('resources.hardwares.labels.itemHardwareName')">
                        <a-input v-model:value="formState.name"
                                 @pressEnter="handleNextFocused" />
                    </a-form-item>
                    <a-form-item :label="$t('resources.hardwares.labels.itemUserName')">
                        <p>{{ userName }}</p>
                    </a-form-item>
                    <a-form-item :label="$t('resources.hardwares.labels.itemIpAddress')">
                        <p>{{ hardwareIP }}</p>
                    </a-form-item>
                    <a-form-item :label="$t('resources.hardwares.labels.itemDescription')">
                        <a-textarea v-model:value="formState.desc" />
                    </a-form-item>
                </a-form>
            </div>

            </Transition>

            <!-- <p class="error-info">{{ errorInfo }}</p> -->
            <div class="steps-button-group">
                <a-button v-if="stepCurrent > 0"
                          size="small"
                          ghost
                          @click="handlePreviousClicked">{{ $t('resources.hardwares.labels.btnPrev') }}</a-button>
                <a-button v-else
                          size="small"
                          ghost
                          @click="handleCancelClicked">{{ $t('resources.hardwares.labels.btnCancel') }}</a-button>
                <div class="right-steps-buttons">
                    <a-button v-if="stepCurrent === 3 && !(connectionType.indexOf('wlan') >= 0 && connectionList[0].ip === '')"
                              size="small" 
                              ghost
                              @click="handleSkipClicked">{{ $t('resources.hardwares.labels.btnSkip') }}</a-button>
                    <span style="padding: 0 .5rem"></span>
                    <a-button v-if="stepStatus === 'error'" 
                                size="small" 
                                type="primary"
                                danger
                                @click="handleCancelClicked">{{ $t('resources.hardwares.labels.btnCancel') }}</a-button>
                    <a-button v-else-if="stepCurrent < 4"
                                ref="nextBtn"
                                type="primary" 
                                size="small" 
                                @click="handleNextClicked">{{ $t('resources.hardwares.labels.btnNext') }}</a-button>
                    <a-button v-else
                                type="primary"
                                size="small"
                                @click="handleConfirmClicked">{{ $t('resources.hardwares.labels.btnConfirm') }}</a-button>
                </div>
            </div>
        </div>

        <a-tour :open="connectionTypeHintRef"
                :mask="false"
                :steps="connectionTypeSteps"
                @close="handleConnectionTypeHintClicked">

        </a-tour>
    </div>
</template>

<script setup>
import { shell } from 'electron';
import { ref, reactive, nextTick, h, onMounted, createVNode } from 'vue';
import i18n from '@/locales';
import { message } from 'ant-design-vue';
import { 
    CloseOutlined,
    InfoCircleOutlined,
    ReloadOutlined,
    QuestionCircleOutlined
 } from '@ant-design/icons-vue';
import {
    CONNECTION_ETHERNET,
    CONNECTION_ETHERNET_ONE_TIME,
    CONNECTION_ETHERNET_SETTING_WLAN,
    CONNECTION_WLAN,
    CONNECTION_SERIALPORT,
    CONNECTION_TYPEC,
    CONNECTION_TYPEC_ONE_TIME,
    CONNECTION_TYPEC_SETTING_WLAN
} from '@hardware/constants/ConnectionConstants';
import {
    HardwareConnectionManager
} from '@hardware/managers/HardwareConnectionManager';

import {
    GlobalConfig
} from '@/global_configuration/GlobalConfig.js';
const Config = GlobalConfig.getInstance();

import ConnectionTypecToWlan from '@/assets/images/connectionTypecToWlan.png';
import ConnectionTypecToTypec from '@/assets/images/connectionTypecToTypec.png';
import ConnectionCableToWlan from '@/assets/images/connectionCableToWlan.png';
import ConnectionCableToCable from '@/assets/images/connectionCableToCable.png';



const { t } = i18n.global;
const props = defineProps({
    connectionManager: {
        type: HardwareConnectionManager,
        required: true
    },
    hardwareList: {
        type: Array,
        required: true
    }
});

const emits = defineEmits([
    'cancelSteps',
    'confirmSteps',
    'startWaiting',
    'stopWaiting'
])

const steps = ref([
    {
        title: t('resources.hardwares.titles.stepFirst'),
        description: '',
        status: 'process',
    },
    {
        title: t('resources.hardwares.titles.stepSecond'),
        description: '',
        status: 'wait',
    },
    {
        title: t('resources.hardwares.titles.stepThird'),
        description: '',
        status: 'wait',
    },
    {
        title: t('resources.hardwares.titles.stepForth'),
        description: '',
        status: 'wait',
    },
    {
        title: t('resources.hardwares.titles.stepFinal'),
        description: '',
        status: 'wait',
    },
]);

// Mac 和 Linux 上默认选择一次性网线连接，Windows 默认选择网线连接
const connectionType = ref(Config.isWinGetter ? CONNECTION_ETHERNET : CONNECTION_ETHERNET_ONE_TIME);
const targetConnectionType = ref(Config.isWinGetter ? CONNECTION_ETHERNET : CONNECTION_ETHERNET_ONE_TIME);

const stepStatus = ref('process');
const stepCurrent = ref(0);
const errorInfo = ref('');

const radioStyle = reactive({
    display: 'flex',
    height: '30px',
    lineHeight: '30px',
});
const nextBtn = ref();
const connectionName = ref('');
const connections = ref([]);
const connectionIP = ref('');

const userName = ref('sunrise');

const wifiName = ref('');
const wifiPasswd = ref('');
const wifiPasswdVisbility = ref(false);
const wifis = ref([]);
const wifiNameConnected = ref('');
const wifiConnectedStatus = ref(false);
const newWifiStatus = ref(false);

const hardwareIP = ref('');
const labelCol = { style: { width: '120px' } };
const wrapperCol = { span: 18 };
const formState = reactive({
  name: '',
  type: [],
  resource: '',
  desc: '',
});

const connectionList = ref([
    {
        type: CONNECTION_WLAN,
        name: '',
        ip: '',
        value: CONNECTION_WLAN,
        label: t(`resources.hardwares.labels.${CONNECTION_WLAN}`)

    },
    {
        type: '',
        name: '',
        ip: '',
        value: '',
        label: ''
    }
]);

const dropdownStyleObject = {
    background: 'hsla(0, 0%, 100%, .2)'
}

const connectionTypeHintRef = ref(false);
let connectionTypeSteps = [];

const refreshItemList = (itemList, itemName, names) => {
    if(!Array.isArray(names)){
        itemList.value = [];
        itemName.value = '';
        return;
    }
    itemList.value = names.map((name) => {
        return {
            label: name,
            value: name
        }
    });
    itemName.value = names[0];
}

// handle next and previous
const stepFinishedCallback = (systemData) => {
    emits('stopWaiting');

    steps.value[stepCurrent.value].status = 'finish';

    if(stepCurrent.value === 0){
        refreshItemList(connections, connectionName, systemData);

        connectionList.value[1].type = connectionType.value;
        connectionList.value[1].value = connectionType.value;

        let tempConnectionType = '';
        if(connectionType.value.indexOf(CONNECTION_ETHERNET) >= 0){
            tempConnectionType = CONNECTION_ETHERNET;
        }
        else if(connectionType.value.indexOf(CONNECTION_TYPEC) >= 0){
            tempConnectionType = CONNECTION_TYPEC;
        }
        else{
            tempConnectionType = connectionType.value;
        }
        connectionList.value[1].label = t(`resources.hardwares.labels.${tempConnectionType}`);
        connectionList.value[1].ip = props.connectionManager.getConnectionIP(tempConnectionType);
        targetConnectionType.value = connectionType.value;

    }
    else if(stepCurrent.value === 2){
        refreshItemList(wifis, wifiName, systemData);
    }
    else if(stepCurrent.value === 3){
        console.log('system data for ip: ', systemData);
        hardwareIP.value = systemData;
        if(connectionType.value === CONNECTION_WLAN){
            connectionList.value[0].ip = hardwareIP.value;
        }

        if(newWifiStatus.value){
            connectionList.value[0].ip = systemData;
        }
        else if(connectionType.value.indexOf('wlan') >= 0){
            hardwareIP.value = connectionList.value[0].ip;
        }

        if(connectionType.value.indexOf('wlan') < 0){
            hardwareIP.value = props.connectionManager.getConnectionIP(connectionType.value);
        }

        //get addtional info here
        props.connectionManager.getAdditionalInfo(userName.value, userName.value, hardwareIP.value, (err, deviceType, macAddress) => {
            console.log(deviceType, macAddress)
        });
    }

    stepCurrent.value++;
    stepStatus.value = 'process';
    steps.value[stepCurrent.value].status = 'process';

    if(connectionType.value === CONNECTION_WLAN && stepCurrent.value === 3){
        handleSkipClicked()
        // props.connectionManager.handleSkipWifiInfo(stepFinishedCallback);
    }
}

const stepErrorCallback = (error) => {
    emits('stopWaiting');

    errorInfo.value = error;
    stepStatus.value = 'error';
    steps.value[stepCurrent.value].status = 'error';

    console.log(error)
    message.error(t('resources.hardwares.errors.stepsError'), 6);
}

const handleNextFocused = () => {
    nextBtn.value.focus();
}

const handleNextClicked = async () => {
    emits('startWaiting');
    await nextTick();

    stepStatus.value = 'wait';
    if(stepCurrent.value === 0){
        props.connectionManager.handleConnectionTypeConfirmed(connectionType.value, stepFinishedCallback, stepErrorCallback);
    }
    else if(stepCurrent.value === 1){
        if(connectionType.value.indexOf(CONNECTION_ETHERNET) >= 0 || connectionType.value.indexOf(CONNECTION_TYPEC) >= 0){
            setTimeout(() => {
                props.connectionManager.handleConnectionNameConfirmed(connectionName.value, stepFinishedCallback, stepErrorCallback);
            }, 500)
        }
        else if(connectionType.value === CONNECTION_WLAN){
            //validate
            if(connectionIP.value === ''){
                message.error(t('resources.hardwares.errors.stepsEmptyIP'));
                emits('stopWaiting');
                return;
            }
            props.connectionManager.handleConnectionIPConfirmed(connectionIP.value, stepFinishedCallback, stepErrorCallback);
        }
    }
    else if(stepCurrent.value === 2){
        props.connectionManager.checkWifiConnection(userName.value, userName.value, (err, status, name) => {
            if(err){
                wifiNameConnected.value = '';
                return;
            }
            if(status){

                const list = name.split(':');
                console.log('wifi name: ', name, list)

                if(list.length < 2) return;

                wifiNameConnected.value = list[0];
                wifiConnectedStatus.value = true;
                const idx = connectionList.value.findIndex(item => item.type === CONNECTION_WLAN);
                if(idx >= 0){
                    const connectionItem = connectionList.value[idx];
                    connectionItem.name = name;
                    connectionItem.ip = list[1];
                }
            }
            else{
                wifiNameConnected.value = '';
            }
        })
        props.connectionManager.handleUserInfoConfirmed(userName.value, userName.value, stepFinishedCallback, stepErrorCallback);
    }
    else if(stepCurrent.value === 3){
        if(wifiPasswd.value !== ''){
            wifiConnectedStatus.value = true;
            newWifiStatus.value = true;
            connectionList.value[0].name = wifiName.value;
            props.connectionManager.handleWifiInfoConfirmed(wifiName.value, wifiPasswd.value, stepFinishedCallback, stepErrorCallback);
        }
        else{
            handleSkipClicked();
        }
    }

    nextBtn.value.focus();
}

const handlePreviousClicked = () => {
    if(connectionType.value === CONNECTION_WLAN && stepCurrent.value === 4){
        stepCurrent.value--;
    }
    else if(stepCurrent.value === 3){
        props.connectionManager.handleRemovingWifiInfo();
        wifiConnectedStatus.value = false;
        newWifiStatus.value = false;
    }
    else if(stepCurrent.value === 2){
        props.connectionManager.handleRemovingUserInfo();
    }
    else if(stepCurrent.value === 1){
        if(connectionType.value === CONNECTION_ETHERNET || connectionType === CONNECTION_TYPEC){
            props.connectionManager.handleRemovingConnectionName();
        }
        else{
            props.connectionManager.handleRemovingConnectionIP();
        }
    }

    errorInfo.value = '';
    steps.value[stepCurrent.value].status = 'wait';
    stepCurrent.value--;
    stepStatus.value = 'process';
    steps.value[stepCurrent.value].status = 'process';
}

const handleRefreshNetListClicked = () => {
    const list = props.connectionManager.getConnectionList();
    refreshItemList(connections, connectionName, list);
}

const handleSkipClicked = () => {
    props.connectionManager.handleSkipWifiInfo(stepFinishedCallback);
}

const handleCancelClicked = () => {
    props.connectionManager.handleRemovingAll();
    emits('cancelSteps');
}

const handleConfirmClicked = () => {
    if(formState.name === ''){
        message.error(t('resources.hardwares.errors.stepsIncompleteInfo'));
        return;
    };
    props.connectionManager.checkHardwareItemValidation(formState.name, hardwareIP.value, props.hardwareList, (flag) => {
        if(flag){
            message.warning(t('resources.hardwares.errors.stepsDuplicateDevice'));
        }
        else{
            if(connectionType.value === CONNECTION_ETHERNET_SETTING_WLAN || connectionType.value === CONNECTION_TYPEC_SETTING_WLAN || connectionType.value === CONNECTION_WLAN){
                targetConnectionType.value = CONNECTION_WLAN;
            }
            else if(connectionType.value === CONNECTION_ETHERNET || connectionType.value === CONNECTION_ETHERNET_ONE_TIME){
                targetConnectionType.value = CONNECTION_ETHERNET;
            }
            else if(connectionType.value === CONNECTION_TYPEC || connectionType.value === CONNECTION_TYPEC_ONE_TIME){
                targetConnectionType.value = CONNECTION_TYPEC;
            }
            props.connectionManager.handleHardwareItemConfirmed(formState.name, hardwareIP.value ,formState.desc, targetConnectionType.value);
            emits('confirmSteps');
        }
    })
    
}


const handleTargetConnectionTypeChanged = (value) => {
    console.log(value)
    targetConnectionType.value = value;
    const idx = connectionList.value.findIndex(item => item.value === value);
    if(idx >= 0){
        hardwareIP.value = connectionList.value[idx].ip;
    }
}

const handleNetworkHintClicked = () => {
    const link = "https://www.bilibili.com/video/BV14tCUYcEUa/?share_source=copy_web&vd_source=d9f78fbe028ffcaea5b918790e6a0bb2";
    shell.openExternal(link);
}

const generateConnectionTypeHintSteps = () => {
    connectionTypeSteps = [];

    connectionTypeSteps.push({
        title: t('resources.hardwares.labels.typeNetworkCable'),
        description: '',
        cover: createVNode('img', {
            alt: 'connectionCableToCable.png',
            src: ConnectionCableToCable,
        })
    });
    connectionTypeSteps.push({
        title: t('resources.hardwares.labels.typeNetworkCableSettingWlan'),
        description: '',
        cover: createVNode('img', {
            alt: 'connectionCableToWlan.png',
            src: ConnectionCableToWlan,
        })
    });
    connectionTypeSteps.push({
        title: t('resources.hardwares.labels.typeTypeC'),
        description: '',
        cover: createVNode('img', {
            alt: 'connectionTypecToTypec.png',
            src: ConnectionTypecToTypec,
        })
    });
    connectionTypeSteps.push({
        title: t('resources.hardwares.labels.typeTypeCSettingWlan'),
        description: '',
        cover: createVNode('img', {
            alt: 'connectionTypecToWlan.png',
            src: ConnectionTypecToWlan,
        })
    });
}

const handleConnectionTypeHintClicked = () => {
    if(!connectionTypeHintRef.value){
        generateConnectionTypeHintSteps();
    }

    connectionTypeHintRef.value = !connectionTypeHintRef.value;
}

onMounted(() => {
    nextBtn.value.focus();
})
</script>

<style lang="less" scoped>
@import url('@/assets/styles/common.less');

.connection-steps {
    height: 100%;
    padding: 3rem;

    .steps-content {
        position: relative;
        height: 90%;
        margin: 1rem;
        // padding: 1rem;
        padding-top: 15%;
        border: 1px dashed rgba(200, 200, 200, .5);
        border-radius: .5rem;
        background: rgba(255,255,255,.1);
        // min-height: 200px;
        // text-align: center;
        .center;
        flex-direction: column;
        justify-content: space-between;

        :deep(.ant-radio-group){
            .ant-radio-wrapper{
                color: white;
            }
            .ant-radio-checked > .ant-radio-inner{
                background-color: @theme-color;
                border-color: @theme-color;
            }
        }

        :deep(.ant-select-selector){
            background: hsla(0, 0%, 100%, .1);
            color: white;
            .ant-select-selection-item{
                color: white;
            }
        }

        :deep(.ant-select-arrow){
            color: lightgrey !important;
        }

        :deep(.ant-input){
            background: hsla(0, 0%, 100%, .2);
            color: white;
            &::placeholder{
                color: lightgray;
            }
        }

        :deep(.ant-space-item){
            .ant-input-password{
                background: hsla(0, 0%, 100%, .2);
                color: white;
                input{
                    background: transparent;
                    &::placeholder{
                        color: rgba(200, 200, 200, .5);
                    }
                }
                .span{
                    color: white;
                }
                svg{
                    color: white;
                }
            }
        }

        :deep(.ant-form){
            .ant-form-item-control-input-content{
                color: lightgray;
            }
            label{
                color: white;
            }
        }

        .blink-text{
            color: orangered;
            animation: blink 1.5s ease-in-out infinite;
        }

        .error-info{
            color: red;
        }

        h3{
            color: @theme-color;
        }

        .title-group{
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            padding: 1rem;
            .center;
            justify-content: space-between;
        }

        .steps-button-group {
            position: absolute;
            bottom: 0;
            left: 0;
            width: 100%;
            padding: 1rem;
            .center;
            justify-content: space-between;
            .right-steps-buttons{
                :deep(.ant-btn-background-ghost){
                    color: rgba(255, 81, 38, 1) !important;
                    border-color: rgba(255, 81, 38, 1) !important;
                }
                :deep(.ant-btn-primary){
                    background-color: @theme-color;
                }
            }
        }

        .fade-enter-active{
            transition: opacity 0.5s ease .5s;
        }
        .fade-leave-active {
            transition: opacity 0.5s ease;
        }

        .fade-enter-from,
        .fade-leave-to {
            opacity: 0;
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
}
</style>