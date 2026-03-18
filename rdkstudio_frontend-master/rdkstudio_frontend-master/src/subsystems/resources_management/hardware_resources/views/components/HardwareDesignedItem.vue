<template>
    <div class="hardware-item" :class="statusClass">
        <section class="image-section">
            <div class="device-image">
                <img v-if="info?.deviceType === 'x3'" src="@/assets/images/image-rdkx3.png">
                <img v-else-if="info?.deviceType === 'x5'" src="@/assets/images/image-rdkx5.png">
                <img v-else-if="info?.deviceType === 's100'" src="@/assets/images/image-s100.png">
                <img v-else-if="info?.deviceType === 'nvidia'" src="@/assets/images/image-jetsonnano.png">
                <img v-else-if="info?.deviceType === 'raspberrypi'" src="@/assets/images/image-raspberrypi.png">
                <img v-else src="@/assets/images/image-others.png">
            </div>
            <div class="device-status">
                <div class="status-item">
                    <span class="status-title">{{ $t('resources.hardwares.labels.itemNetworkStatus') }}:</span>
                    <template v-if="networkStatus">
                        <span style="color: green;">{{ $t('resources.hardwares.labels.statusNetworkAvailable') }}</span>
                        <span class="status-title">&nbsp;{{ netSpeed }}</span>
                    </template>
                    <span v-else style="color: red;">{{ $t('resources.hardwares.labels.statusNetworkNotAvailable') }}</span>
                </div>
                <div class="status-item">
                    <span class="status-title">{{ $t('resources.hardwares.labels.itemUsbCamStatus') }}:</span>
                    <span v-if="usbCamStatus === 0" style="color: yellow;">{{ $t('resources.hardwares.labels.statusUsbCamNotFound') }}</span>
                    <span v-else style="color: green;">{{ usbCamStatus }} {{ $t('resources.hardwares.labels.statusUsbCamFound') }}</span>
                </div>
            </div>
        </section>
        <section class="info-section">
            <h2>{{ info?.name }}</h2>
            <h6>{{ info?.description }}</h6>
            <div class="device-tags">
                <a-space :size="[0, 'small']">
                    <a-tag color="green">RDK {{ info?.deviceType.toUpperCase() }}</a-tag>
                    <a-tag color="blue">RDK OS 3.0</a-tag>
                    <a-tag color="yellow">ROS2 Humble</a-tag>
                </a-space>
            </div>
            <div class="info-item">
                <span class="info-title">{{ $t('resources.hardwares.labels.deviceType') }}: </span>
                <span class="info-content">RDK {{ info.deviceType.toUpperCase() }}</span>
            </div>
            <div class="info-item">
                <span class="info-title">{{ $t('resources.hardwares.labels.ipAddress') }}: </span>
                <span class="info-content">{{ info.ip }}</span>
                <div class="info-option">
                    <a-popover :title="$t('resources.hardwares.titles.staticIp')">
                        <template #content>
                            <a-button type="link" @click="handleStaticIpClicked('https://www.bilibili.com/video/BV1fcHyeiEku/?spm_id_from=333.788')" style="color: white;">{{ $t('resources.hardwares.titles.contentStaticIpNetworkOperator') }}</a-button><br>
                            <a-button type="link" @click="handleStaticIpClicked('https://www.bilibili.com/video/BV1SApMepEhB/?spm_id_from=333.788')" style="color: white;">{{ $t('resources.hardwares.titles.contentStaticIpGatewayNetworkOperator') }}</a-button><br>
                            <a-button type="link" @click="handleStaticIpClicked('https://www.bilibili.com/video/BV1VaHCe4ELp/?spm_id_from=333.788')" style="color: white;">{{ $t('resources.hardwares.titles.contentStaticIpXiaoMi') }}</a-button><br>
                        </template>
                        <InfoCircleOutlined />
                    </a-popover>
                </div>
            </div>
            <div class="info-item">
                <span class="info-title">{{ $t('resources.hardwares.labels.userName') }}: </span>
                <span class="info-content">{{ info.userName }}</span>
            </div>
            <div v-if="info?.connectionType" class="info-item">
                <span class="info-title">{{ $t('resources.hardwares.labels.connectionType') }}: </span>
                <span class="info-content">{{ $t(`resources.hardwares.labels.${info.connectionType}`) }}</span>
            </div>
            <div v-if="info?.wifiName" class="info-item">
                <span class="info-title">{{ $t('resources.hardwares.labels.wifiName') }}: </span>
                <span class="info-content">{{ info.wifiName }}</span>
            </div>
        </section>
        <div class="divider"></div>
        <section class="appspace-section" :key="`${info.name}-appspace-${appSpaceUpdate}`">
            <template v-if="itemStatus">
                <a-tooltip color="orangered">
                    <template #title>{{ $t('resources.hardwares.labels.appSpace') }}</template>
                    <a-button shape="circle" 
                          type="primary" 
                          style="background: orangered; width: 3rem; height: 3rem; font-size: 1.5rem;"
                          :class="{'blink-btn': appList.filter(app => app.operations.needsInstall).length === 0}"
                          :icon="h(AppstoreAddOutlined)" 
                          @click="handleAppSpaceClicked"></a-button>
                </a-tooltip>
                

                <template v-for="app of appList">
                    <AppLaunchButton v-if="app.isInstalled" 
                                    :key="`launcher-${app.name}`" 
                                    :app-name="app.name"
                                    :img-src="app.icon"
                                    :app-connection="app.connection"
                                    :app-url="app?.connectionUrl"
                                    :video-tutorial="app.operations?.videoTutorial"
                                    @clickLaunch="handleLaunchAppClicked(app)"
                                    @clickLearnMore="handleAppLearnMoreClicked(app)"
                                    @clickClose="handleCloseAppClicked(app)">
                    </AppLaunchButton>
                </template>

                <div class="inside-btn">
                    <a-tooltip>
                        <template #title>
                            <span style="text-transform: uppercase; color: orangered;">Open URL</span>
                        </template>
                        <img src="@/assets/icons/manualip.png"
                                  @click="handleInsideAppClicked">
                    </a-tooltip>
                </div>
                
            </template>
        </section>
        <div class="divider"></div>
        <section class="operation-section">
            <a-dropdown v-if="itemStatus" 
                        :trigger="['click']">
                <PoweroffOutlined/>
                <template #overlay>
                    <a-menu @click="handlePowerOptionClicked">
                        <a-menu-item key="reboot">{{ $t('resources.hardwares.labels.reboot') }}</a-menu-item>
                        <a-menu-item key="shutdown">{{ $t('resources.hardwares.labels.shutdown') }}</a-menu-item>
                    </a-menu>
                </template>
            </a-dropdown>
            <a-tooltip placement="left" v-if="itemStatus">
                <template #title>
                    <span>{{ $t('resources.hardwares.titles.upgradeRDK') }}</span>
                </template>
                <CloudDownloadOutlined :style="{color: updatingStatus ? 'green' : 'orangered'}" 
                                       @click="handleUpdateClicked"/>
            </a-tooltip>
            <a-tooltip placement="left">
                <template #title>
                    <span>{{ $t('resources.hardwares.titles.upgradeFirmware') }}</span>
                </template>
                <DownSquareOutlined :style="{color: updatingFirmwareStatus ? 'green' : 'orangered'}"
                                    @click="handleUpdateFirmwareClicked"></DownSquareOutlined>
            </a-tooltip>
             <a-tooltip placement="left">
                <template #title>
                    <span>{{ $t('resources.hardwares.titles.refreshCard') }}</span>
                </template>
                <ReloadOutlined @click="handleCheckConnectionClicked(true)"/>
            </a-tooltip>
            <a-tooltip placement="left">
                <template #title>
                    <span>{{ $t('resources.hardwares.titles.deleteCard') }}</span>
                </template>
                <DeleteOutlined @click="handleDeleteItemClicked"/>
            </a-tooltip>
            <a-tooltip v-if="!itemStatus" placement="left">
                <template #title>
                    <span>{{ $t('resources.hardwares.titles.fixConnection') }}</span>
                </template>
                <InfoCircleOutlined></InfoCircleOutlined>
            </a-tooltip>
        </section>

        <div v-if="appSpaceFlag" 
             class="app-space"
             @click="handleAppSpaceClosed">
            <h3>{{ $t('resources.hardwares.labels.appSpace') }}</h3>
            <h6>{{ $t('resources.hardwares.labels.appPreset') }}</h6>
            <div class="space-block">
                <AppSpaceButton v-for="app of appList.filter(item => !item.operations.needsInstall)" 
                                :key="`space-${app.name}`"
                                :img-src="app.icon"
                                :needs-operations="false"
                                :needs-install="app.operations.needsInstall"
                                :description="app.operations.description[$t('studio.lang')]"></AppSpaceButton>
            </div>
            <h6>{{ $t('resources.hardwares.labels.appInstalled') }}</h6>
            <div class="space-block">
                <AppSpaceButton v-for="app of appList.filter(item => item.operations.needsInstall && item.isInstalled)" 
                            :key="`space-${app.name}`"
                            :img-src="app.icon"
                            :needs-install="!app.isInstalled"
                            :is-installing="app.isInstalling"
                            :is-uninstalling="app.isUninstalling"
                            :description="app.operations.description[$t('studio.lang')]"
                            @uninstallApp="handleUninstallAppClicked(app)"
                            ></AppSpaceButton>
            </div>
            <h6>{{ $t('resources.hardwares.labels.appUninstalled') }}</h6>
            <div class="space-block">
                <AppSpaceButton v-for="app of appList.filter(item => item.operations.needsInstall && !item.isInstalled)" 
                            :key="`space-${app.name}`"
                            :img-src="app.icon"
                            :needs-install="!app.isInstalled"
                            :is-installing="app.isInstalling"
                            :install-steps="app.installSteps"
                            :install-percents="app.percents"
                            :description="app.operations.description[$t('studio.lang')]"
                            @installApp="handleInstallAppClicked(app)"
                            @learnMore="handleAppLearnMoreClicked(app)"></AppSpaceButton>
            </div>
        </div>

        <div v-if="insideOpenUrlAppFlag"
             class="inside-openurl-options">
            <h3>Open Url</h3>
            <div class="url-group">
                <a-select v-model:value="ipPrefix" 
                          size="small" 
                          style="width: 120px;">
                    <a-select-option value="http://">http://</a-select-option>
                    <a-select-option value="https://">https://</a-select-option>
                </a-select>
                <span style="padding: 0 1rem;">{{ props.info.ip }}:</span>
                <a-input v-model:value="ipPostfix" size="small" style="width: 120px;"></a-input>
            </div>
            <div class="btn-group">
                <a-button ghost
                          size="small"
                          @click="handleCancelInsideAppClicked">Cancel</a-button>
                <span style="padding: 0 .5rem;"></span>
                <a-button type="primary"
                          size="small"
                          @click="handleOpenFromInsideAppClicked">Open</a-button>
            </div>
        </div>

        <div v-if="waitingMaskFlag" 
             class="waiting-mask">
            <a-spin/>    
        </div>
    </div>
</template>

<script setup>
import { h, ref, shallowRef, computed, createVNode, onBeforeUnmount, watch} from 'vue';
import i18n from '@/locales';
import { shell } from 'electron';
import {
    AppstoreAddOutlined,
    PoweroffOutlined,
    ReloadOutlined,
    DeleteOutlined,
    ExclamationCircleOutlined,
    InfoCircleOutlined,
    CloudDownloadOutlined,
    DownSquareOutlined,
} from '@ant-design/icons-vue';
import { Modal, message } from 'ant-design-vue';
import AppLaunchButton from './AppLaunchButton.vue';
import AppSpaceButton from './AppSpaceButton.vue';
import {
    HardwareItemManager
} from '@hardware/managers/HardwareItemManager';


const { t } = i18n.global;
const props = defineProps({
    info: {
        type: Object,
        required: true
    },
    id: {
        required: true
    }
})

const emits = defineEmits([
    'deleteItem',
    'statusChanged'
]);



const appSpaceUpdate = ref(0);
const appSpaceFlag = ref(false);
const insideOpenUrlAppFlag = ref(false);
const waitingMaskFlag = ref(false);
const itemStatus = ref(false);
const statusClass = computed(() => ({
    'inactivate-status': !itemStatus.value
}))
const networkStatus = ref(false);
const netSpeed = ref('');
const usbCamStatus = ref(0);
const updatingStatus = ref(false);
const updatingFirmwareStatus = ref(false);

const ipPrefix = ref('http://');
const ipPostfix = ref('8000')

const appList = ref([]);

const itemManager = new HardwareItemManager(props.info.userName, props.info.userName, props.info.ip, (flag, speed='') => {
    if(flag !== itemStatus.value){
        handleCheckConnectionClicked();
    }
    if(speed !== ''){
        netSpeed.value = speed;
    }
});

function handleAppSpaceClicked(){
    appSpaceFlag.value = true;
}

function handleAppSpaceClosed(){
    appSpaceFlag.value = false;
}

function handleInsideAppClicked(){
    insideOpenUrlAppFlag.value = true;
}

function handleCancelInsideAppClicked(){
    insideOpenUrlAppFlag.value = false;
}

function handleOpenFromInsideAppClicked(){
    insideOpenUrlAppFlag.value = false;

    const completeUrl = ipPrefix.value + props.info.ip + ':' + ipPostfix.value;
    handleStaticIpClicked(completeUrl);
}


function handleCheckConnectionClicked(needsCheck=false){
    if(needsCheck){
        if(updatingFirmwareStatus.value){
            message.warn(t('resources.hardwares.titles.firmwareOnUpdating'))
            return;
        }
        const status = appList.value.some(app => app?.connection);
        if(status){
            Modal.warning({
                title: t('resources.hardwares.titles.closeConnection'),
                content: t('resources.hardwares.titles.contentCloseConnection'),
                okText: t('resources.hardwares.labels.modalYes'),
                okType: 'danger',
                cancelText: t('resources.hardwares.labels.modalNo'),
                onOk(){
                    //close apps
                    appList.value.forEach((app) => {
                        handleCloseAppClicked(app);
                    })

                    setTimeout(() => {
                        handleCheckConnectionClicked(true);
                    }, 800)
                },
                onCancel(){

                }
            })
            
            return;
        }
    }


    waitingMaskFlag.value = true;
    itemManager.checkHardwareConnection(props.info.userName, props.info.userName, props.info.ip, (flag) => {
        if(flag !== itemStatus.value){
            emits('statusChanged', flag);
        }
        itemStatus.value = flag;

        if(flag === true){
            itemManager.getAppList((list) => {
                const newlist = list.map((item) => {
                    const newItem = Object.assign({}, item);
                    newItem.isInstalling = false;
                    newItem.isInstalled = false;
                    newItem.isUninstalling = false;
                    newItem.installSteps = newItem.operations.install.length;
                    newItem.percents = 0;
                    return newItem;
                })
                appList.value = newlist;
                newlist.forEach((app) => {
                    itemManager.checkAppInstallation(app, props.info, (value) => {
                        appSpaceUpdate.value += 1;
                        app.isInstalled = value;
                    }, (err) => {
                        // message.error('Check Installation Error');
                        console.log('Check Installation Error: ',err)
                    })
                })

                //set close app callback
                itemManager.setCloseAppCallback((url) => {
                    const idx = appList.value.findIndex(item => item?.connectionUrl === url);
                    if(idx >= 0){
                        handleCloseAppClicked(appList.value[idx]);
                    }
                })

                setTimeout(() => {
                    waitingMaskFlag.value = false;
                }, 4000);
            })

            //check network status
            itemManager.checkNetworkStatus(props.info.userName, props.info.userName, props.info.ip, (err, status) => {
                if(err){
                    console.log('error in checking network status')
                    return;
                }
                networkStatus.value = status;
            })

            //check camera status
            itemManager.checkUsbCamStatus(props.info.userName, props.info.userName, props.info.ip, (err, count) => {
                if(err){
                    console.log('error in checking USB cameras');
                    return;
                }
                console.log('usbcam status: ', count);
                usbCamStatus.value = count;
            })
        }
        else{
            // set class status first
            waitingMaskFlag.value = false;
        }
    })

    

}

function handleDeleteItemClicked(){
    Modal.confirm({
        title: t('resources.hardwares.titles.deleteItem'),
        icon: createVNode(ExclamationCircleOutlined),
        content: '',
        okText: t('resources.hardwares.labels.modalYes'),
        okType: 'danger',
        cancelText: t('resources.hardwares.labels.modalNo'),
        onOk() {
            appList.value.forEach((app) => {
                handleCloseAppClicked(app);
            });

            emits('deleteItem');
        },
        onCancel() {
        },
    });
}

function handleLaunchAppClicked(app){
    if(app.type === 'server/web' && !app?.connection){
        message.info(t('resources.hardwares.titles.appFirstLaunch'), 6);
    }

    itemManager.launchApp(app, props.info, (name, url) => {
        console.log('hint: ', name, url)
        Modal.info({
            title: t('resources.hardwares.titles.appNotDetected').replace('$name', name),
            content: t('resources.hardwares.titles.contentNotDetected').replace('$name', name).replace('$url', url),
            okText: t('resources.hardwares.labels.modalGotIt'),
            onOk(){

            }
        })
    }, (err) => {
        message.error(t('resources.hardwares.errors.launchError') + err, 5);
    })
}

function handleCloseAppClicked(app){
    itemManager.closeApp(app);
}


function handleAppLearnMoreClicked(app){
    const lang = t('studio.lang');
    const link = app.operations.videoTutorial[lang];
    handleStaticIpClicked(link);
}

function handlePowerOptionClicked({key}){
    if(updatingFirmwareStatus.value){
        message.warn(t('resources.hardwares.titles.firmwareOnUpdating'))
        return;
    }
    Modal.confirm({
        title: t('resources.hardwares.titles.operateItem').replace('$key', key),
        icon: createVNode(ExclamationCircleOutlined),
        content: '',
        okText: t('resources.hardwares.labels.modalYes'),
        okType: 'danger',
        cancelText: t('resources.hardwares.labels.modalNo'),
        onOk(){
            waitingMaskFlag.value = true;
            itemManager.operatePower(props.info.userName, props.info.userName, props.info.ip, key);
            setTimeout(() => {
                handleCheckConnectionClicked();
            }, 12*1000)
        },
        onCancel(){

        }
    })
}

function handleUpdateClicked(){
    if(updatingStatus.value){
        message.info(t('resources.hardwares.titles.upgradeInProgressing'))
        return;
    }
    updatingStatus.value = true;
    message.info(t('resources.hardwares.titles.upgradeTakesTime'))
    itemManager.operateUpdate(props.info.userName, props.info.userName, props.info.ip, (flag) => {
        updatingStatus.value = false;
        if(flag){
            message.success(t('resources.hardwares.titles.upgradeSuccessfully'));
        }
        else{
            message.error(t('resources.hardwares.errors.upgradeFailed'));
        }
    })
}

function handleUpdateFirmwareClicked(){
    if(updatingFirmwareStatus.value){
        message.info('on updating')
        return;
    }
    updatingFirmwareStatus.value = true;
    itemManager.operateFirmwareUpdate(props.info.userName, props.info.userName, props.info.ip, (flag, alreadyLatest=false) => {
        updatingFirmwareStatus.value = false;
        if(alreadyLatest){
            message.info(t('resources.hardwares.titles.firmwareAlreadyLatest'));
        }
        else if(flag){
            Modal.confirm({
                title: t('resources.hardwares.titles.firmwareRebootItem'),
                icon: createVNode(ExclamationCircleOutlined),
                content: '',
                okText: t('resources.hardwares.titles.firmwareConfirm'),
                okType: 'primary',
                cancelText: t('resources.hardwares.titles.firmwareCancel'),
                onOk() {
                    console.log('reboot now')
                },
                onCancel() {
                },
            });
        }
        else{
            message.error(t('resources.hardwares.titles.firmwareUpdateFailed'))
        }
    })

}

function handleInstallAppClicked(app){
    if(!networkStatus.value){
        Modal.warn({
            title: t('resources.hardwares.titles.networkNotAvailable'),
            content: t('resources.hardwares.titles.contentCheckNetwork'),
            okText: 'OK',
            onOk(){

            }
        })
        return;
    }

    let stepCount = 0;
    if(!app.isInstalled){
        app.isInstalling = true;
        itemManager.installApp(app, props.info, () => {
            stepCount++;
            if(app.installSteps > 0){
                app.percents = Math.round(100/app.installSteps)*stepCount;
            }
        }, () => {
            itemManager.checkAppInstallation(app, props.info, (value) => {
                if(value){
                    app.isInstalling = false;
                    app.isInstalled = true;
                    message.success(t('resources.hardwares.titles.appInstalled').replace('$name', app.name));
                    appSpaceUpdate.value += 1;
                }
                else{
                    app.isInstalling = false;
                    app.isInstalled = false;
                    message.error(t('resources.hardwares.errors.installAppFailed'));
                }
            }, (err) => {
                message.error(t('resources.hardwares.errors.installAppError'));

            })
            
            //double check to be continued...
        }, (err) => {
            app.isInstalling = false;
            message.error(t('resources.hardwares.titles.appInstallingFailed').replace('$name', app.name));
        })
    }
}

function handleUninstallAppClicked(app){
    app.isUninstalling = true;
    itemManager.uninstallApp(app, props.info, () => {
        app.isUninstalling = false;
        app.isInstalled = false;
        appSpaceUpdate.value += 1;
        message.success(t('resources.hardwares.titles.appUninstalled').replace('$name', app.name));
    }, () => {
        app.isUninstalling = false;
        message.error(t('resources.hardwares.titles.appUninstallingFailed').replace('$name', app.name));
    })
}

function handleStaticIpClicked(url){
    if(url){
        shell.openExternal(url);
    }
}

onBeforeUnmount(() => {
    console.log('before unmount');

    appList.value.forEach((app) => {
        itemManager.closeApp(app);
    });

    itemManager.removeCloseAppFunction();
})

itemManager.registerCloseAppFunction();

// handleCheckConnectionClicked();
</script>

<style lang="less" scoped>
@import url('@/assets/styles/common.less');

.inactivate-status{
    opacity: 0.2;
    &:hover{
        opacity: 0.5;
    }
}

.hardware-item{
    height: 14rem;
    border-radius: .4rem;
    background: rgba(100, 100, 100, .25);
    backdrop-filter: blur(.05rem);
    box-shadow: .1rem .1rem .2rem hsla(0,0%,100%,.15);
    position: relative;
    overflow: hidden;
    color: white;
    display: grid;
    grid-template-columns: 14rem minmax(16rem, 0.6fr) 1px 1fr 1px 3rem;
    grid-column-gap: .5rem;
    transition: opacity .5s ease;

    .divider{
        height: 80%;
        border-left: solid 1px hsla(0,0%,100%,.3);
        justify-self: center;
        align-self: center;
    }

    .image-section{
        padding: 1rem;
        .device-image{
            height: 70%;
            // max-height: 55%;
            border: dashed 1px hsla(0,0%,100%,.3);
            border-radius: .2rem;
            img{
                width: 100%;
                height: 100%;
                opacity: 0.8;
            }
        }
        .device-status{
            padding: .5rem 0;
            .status-item{
                text-align: left;
                padding: .1rem 0;
                user-select: none;
                .status-title{
                    font-size: .8rem;
                    padding-right: .2rem;
                    color: lightgray;
                }
            }
        }
    }

    .info-section{
        padding: 1rem 0;
        text-align: left;
        overflow-x: auto;
        .ellipsis {
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
        }
        h2, h6{
            .ellipsis;
            user-select: none;
        }
        h2{
            background: -webkit-linear-gradient(white, @theme-color);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: .3rem;
        }
        h6{
            color: rgba(199,199,199,.9);
            margin-bottom: 0;
        }
        .device-tags{
            height: 2.5rem;
            padding: .5rem 0;
            opacity: .4;
            transition: opacity .5s ease;
            &:hover{
                opacity: .9;
            }
            overflow-x: auto;
            overflow-y: hidden;
        }
        .info-item{
            position: relative;
            .ellipsis;
            padding-bottom: .25rem;
            .info-title{
                font-size: .8rem;
                color: darkgray;
                user-select: none;
            }
            .info-content{
                color: lightgray;
            }
            .info-option{
                position: absolute;
                right: 0;
                top: 0;
                transition: color .5s ease;
                &:hover{
                    color: @theme-color;
                }
                &:active{
                    color: orange;
                }
            }
        }
    }

    .appspace-section{
        display: grid;
        grid-template-columns: repeat(auto-fill, 3rem);
        grid-template-rows: repeat(auto-fill, 3rem);
        gap: .5rem;
        padding: .5rem;
        overflow-x: scroll;
        .blink-btn{
            animation: blink 1.5s infinite;
        }
        .inside-btn{
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
        }
    }

    .operation-section{
        // background: yellow;
        padding: 1rem 0;
        .center;
        flex-direction: column;
        justify-content: flex-start;
        gap: 1rem;
        color: orangered;
        opacity: 1 !important;
        
    }

    .waiting-mask{
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 3;
        background: rgba(0,0,0,.8);
        color: white;
        backdrop-filter: blur(10px);
        .center;
    }

    .app-space{
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        padding: 1rem;
        background: rgba(0,0,0,.9);
        backdrop-filter: blur(10px);
        z-index: 2;
        text-align: left;
        overflow-y: auto;
        .space-block{
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
            grid-gap: 1rem;
        }
    }

    .inside-openurl-options{
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        .center;
        flex-direction: column;
        background: rgba(0,0,0,.9);
        backdrop-filter: blur(10px);
        z-index: 2;
        color: orangered;

        .url-group{
            .center;
            padding: 1rem 0 3rem 0;
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
            
        }

        .btn-group{
            position: absolute;
            bottom: 0;
            right: 0;
            padding: 0 1rem 1rem 0;
            :deep(.ant-btn-primary){
                background-color: @theme-color;
            }
        }
    }

}
</style>