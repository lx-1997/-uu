<template>
    <div class="examples-main">
        <header class="examples-header">
            <h2>{{ $t('examples.labels.mainLabel') }}</h2>
            <!-- <div class="example-filters">filters</div> -->
        </header>
        <section class="example-content">
            <div class="example-item" 
                 v-for="item of exampleListRef" 
                 :key="item.nameEn">
                <!-- 示例状态指示器 -->
                <div class="example-status-indicator">
                    <a-tooltip 
                        :key="`tooltip-${item.nameEn}-${item.currentDevice}-${item.currentDeviceType}`"
                        :title="getExampleStatusTooltip(item)" 
                        placement="top">
                        <div :class="['status-circle', getExampleStatusClass(item)]"></div>
                    </a-tooltip>
                </div>
                <!-- <iframe :src="`${item.videoUrl}&autoplay=false&danmaku=false&poster=true`"
                        scrolling="no"
                        frameborder="0"></iframe> -->
                <div class="example-images">
                    <a-carousel arrows>
                        <template #prevArrow>
                            <div class="custom-slick-arrow" style="left: 10px; z-index: 1">
                                <LeftCircleOutlined />
                            </div>
                        </template>
                        <template #nextArrow>
                            <div class="custom-slick-arrow" style="right: 10px">
                                <RightCircleOutlined />
                            </div>
                        </template>
                        <div v-for="imgUrl of item.images" 
                             :key="`${item.nameEn}-${imgUrl}`">
                             <img :src="`file://${imgUrl}`">
                        </div>
                    </a-carousel>
                </div>
                <div class="example-name">
                    <h3>{{ $t("studio.lang") === "zh" ? item.nameZh : item.nameEn }}</h3>
                </div>
                <div class="example-tags">
                    <a-tag v-for="tag of item.supports" 
                           :key="`${item.nameEn}-${tag}`"
                           :bordered="false"
                           color="blue">
                        RDK {{ tag.toUpperCase() }}
                    </a-tag>
                    <a-tag v-for="tag of item.tagsEn"
                           :key="`${item.nameEn}-${tag}`"
                           :bordered="false"
                           color="green">
                        {{ tag }}
                    </a-tag>
                </div>
                <div class="example-device">
                    <a-select class="device-select"
                              size="small"
                              :dropdownStyle="{
                                background: 'rgba(200,200,200,.9)',
                              }"
                              :value="item.currentDevice"
                              :options="item.availableDevices"
                              placeholder="No Available RDK Device"
                              @change="handleExampleDeviceChanged($event, item)"></a-select>
                    <div class="example-links">
                        <ReadOutlined @click="handleOpenExternalLinkClicked(item.docUrl)"/>
                        <GithubOutlined @click="handleOpenExternalLinkClicked(item.githubUrl)"/>
                        <DeleteOutlined v-if="false" @click="handleDeleteExampleDependencyClicked(item)"/>
                    </div>
                </div>
                <div class="example-launchers" v-if="item.currentDeviceType !== ''">
                    <template v-if="!item.isInstalled && !item.isInstalling && isExampleAvailable(item)">
                        <a-button type="primary"
                                  @click="handleInstallExampleClicked(item.currentDevice, item)">Install Example</a-button>
                    </template>
                    <template v-else-if="item.isInstalling">
                        <a-spin></a-spin>
                    </template>
                    <template v-else>
                        <AppLaunchButton v-if="item.projects[item.currentDeviceType] && item.projects[item.currentDeviceType]['node-red'] !== ''"
                                         app-name="NodeRED"
                                         :img-src="NodeREDImageUrl"
                                         :appConnection="item.apps['node-red'].connection"
                                         :app-url="item.apps['node-red']?.connectionUrl"
                                         @clickLaunch="handleLaunchExampleClicked(item.nameEn, item.currentDevice, 'node-red', item.apps, item.projects, item)"
                                         @clickClose="handleCloseExampleClicked(item.apps['node-red'])"></AppLaunchButton>
                        <AppLaunchButton v-if="item.projects[item.currentDeviceType] && item.projects[item.currentDeviceType]['jupyter'] !== ''"
                                         app-name="Jupyter"
                                         :img-src="JupyterImageUrl"
                                         :appConnection="item.apps['jupyter'].connection"
                                         :app-url="item.apps['jupyter']?.connectionUrl"
                                         @clickLaunch="handleLaunchExampleClicked(item.nameEn, item.currentDevice, 'jupyter', item.apps, item.projects, item)"
                                         @clickClose="handleCloseExampleClicked(item.apps['jupyter'])"></AppLaunchButton>
                        <AppLaunchButton v-if="item.projects[item.currentDeviceType] && item.projects[item.currentDeviceType]['code-server'] !== ''"
                                         app-name="VSCodeWeb"
                                         :img-src="VSCodeWebImageUrl"
                                         :appConnection="item.apps['code-server'].connection"
                                         :app-url="item.apps['code-server']?.connectionUrl"
                                         @clickLaunch="handleLaunchExampleClicked(item.nameEn, item.currentDevice, 'code-server', item.apps, item.projects, item)"
                                         @clickClose="handleCloseExampleClicked(item.apps['code-server'])"></AppLaunchButton>
                        <AppLaunchButton v-if="item.projects[item.currentDeviceType] && item.projects[item.currentDeviceType]['vscode'] !== ''"
                                         app-name="VSCode"
                                         :img-src="VSCodeImageUrl"
                                         @clickLaunch="handleLaunchExampleUsingLocalAppClicked(item.nameEn, item.currentDevice, 'vscode', item.apps, item.projects, item)"></AppLaunchButton>
                    </template>
                </div>
                <!-- <div class="example-mask">

                </div> -->
            </div>
        </section>
    </div>
</template>

<script setup>
import { ref, onBeforeUnmount, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { shell } from 'electron';
import { ExampleManager } from '../managers/ExampleManager';
import { 
    LeftCircleOutlined,
    RightCircleOutlined,
    GithubOutlined,
    ReadOutlined,
    DeleteOutlined
} from '@ant-design/icons-vue';
import { message, Modal } from 'ant-design-vue';
import i18n from '@/locales';
import AppLaunchButton from './components/AppLaunchButton.vue';

import NodeREDImageUrl from '@/assets/images/icon-nodered.png';
import JupyterImageUrl from '@/assets/images/icon-jupyter.png';
import VSCodeWebImageUrl from '@/assets/images/icon-vscode-local.png';
import VSCodeImageUrl from '@/assets/images/icon-vscode.png';

const { t } = i18n.global;
const route = useRoute();
const exampleListRef = ref([]);
const connectedDevicesRef = ref([]);

const exampleManager = new ExampleManager((list) => {
    console.log('examples in vue: ', list)
    list.forEach((example) => {
        example.availableDevices = [];
        example.currentDevice = '';
        example.currentDeviceType = '';
        example.isInstalled = true;
        example.isInstalling = false;
        if(example?.needsInstall){
            example.isInstalled = false;
        }
        example.apps = {
            'node-red': {
                name: 'node-red',
                port: 1880
            },
            'jupyter': {
                name: 'jupyter',
                port: 8888
            },
            'code-server': {
                name: 'vscodeweb',
                port: 9888
            },
            'vscode': {
                name: 'vscode',
                "needsCheck": true,
                "check": {
                    "win": {
                        "cmd": "powershell Get-Command code",
                        "keyword": "uninstall"
                    },
                    "mac": {
                        "cmd": "hash code > /dev/null 2>&1 && echo installed || echo uninstall",
                        "keyword": "uninstall"
                    },
                    "linux": {
                        "cmd": "hash code > /dev/null 2>&1 && echo installed || echo uninstall",
                        "keyword": "uninstall"
                    }
                },
                "install": [],
                "uninstall": "",
                "launch": {
                    "win": "code --remote ssh-remote+$user@$ip ",
                    "mac": "code --remote ssh-remote+$user@$ip ",
                    "linux": "code --remote ssh-remote+$user@$ip "
                },
                "quit": {

                },
                "description": {
                    "zh": "本地VS Code：使用VS Code的SSH Remote插件打开RDK设备中的实例工程。",
                    "en": "Local VS Code: Use SSH Remote plugin to open project on RDK device."
                },
                "downloadUrl": "https://code.visualstudio.com/Download"
            }
        }
    })
    exampleListRef.value = list;
}, (device) => {
    // 添加到已连接设备列表
    if(!connectedDevicesRef.value.find(d => d.name === device.name)){
        connectedDevicesRef.value.push(device);
    }
    
    exampleListRef.value.forEach((example) => {
        if(example.currentDevice === ''){
            example.currentDevice = device.name;
            example.currentDeviceType = device.deviceType;
            //check example installation
            if(!example.isInstalled){
                example.isInstalling = true;
                handleCheckExampleInstallation(device.name, example, (err, flag) => {
                    example.isInstalling = false;
                    if(err){
                        message.error(t('examples.errors.checkInstallationError'));
                        return;
                    }
                    if(flag){
                        example.isInstalled = flag;
                    }
                });
            }
        }
        // 检查设备是否已经存在于列表中，避免重复添加
        const deviceExists = example.availableDevices.some(d => d.value === device.name);
        if(!deviceExists){
            example.availableDevices.push({
                value: device.name,
                label: device.name,
                deviceType: device.deviceType
            });
        }
    })

    //set close callback
    exampleManager.setCloseAppCallback((url) => {
        const idx = exampleListRef.value.findIndex((example) => {
            for(const app in example.apps){
                if(example.apps[app]?.connectionUrl === url){
                    return true;
                }
            }
            return false;
        })

        if(idx >= 0){
            const apps = exampleListRef.value[idx].apps;
            for(const app in apps){
                if(apps[app]?.connectionUrl === url){
                    handleCloseExampleClicked(apps[app]);
                }
            }
        }
    });
});

const handleOpenExternalLinkClicked = (url) => {
    if(url){
        shell.openExternal(url);
    }
}

const handleDeleteExampleDependencyClicked = (item) => {
    const example = item;
    const deviceName = item.currentDevice;
    Modal.confirm({
        title: t('examples.titles.removeDependencyHint'),
        content: t('examples.titles.contentRemoveDependency'),
        okText: t('examples.titles.removeOk'),
        cancelText: t('examples.titles.removeCancel'),
        onOk: () => {
            if(item?.dependency){
                exampleManager.removeDependency(item.currentDevice, item.dependency);
                example.isInstalling = true;
                setTimeout(() => {
                    handleCheckExampleInstallation(deviceName, example, (err, subflag) => {
                        example.isInstalling = false;
                        if(err){
                            message.error(t('examples.errors.checkExampleInstallationError'));
                            example.isInstalling = false;
                            return;
                        }
                        example.isInstalling = false;
                        example.isInstalled = subflag;
                    })
                }, 1000)
            }
        },
        onCancel: () => {}
    });
    
}

const handleCheckExampleInstallation = (deviceName, example, cb) => {
    exampleManager.checkExampleInstallation(deviceName, example, cb);
}

const handleInstallExampleClicked = (deviceName, example) => {
    if(deviceName === ''){
        message.error(t('examples.errors.noDeviceFoundError'));
        return;
    }
    example.isInstalling = true;
    exampleManager.installExample(deviceName, example, (err, flag) => {
        if(err){
            message.error(t('examples.errors.installExampleError'));
            return;
        }
        console.log('install app: ', flag);
        
        if(flag){
            handleCheckExampleInstallation(deviceName, example, (err, subflag) => {
                example.isInstalling = false;
                if(err){
                    message.error(t('examples.errors.checkExampleInstallationError'));
                    example.isInstalling = false;
                    return;
                }
                example.isInstalling = false;
                example.isInstalled = subflag;
            })
        }
        else{
            example.isInstalling = false;
            example.isInstalled = flag;
        }
    })
}

const handleExampleDeviceChanged = (key, example) => {
    let status = false;
    for(const app in example.apps){
        if(example.apps[app]?.connection){
            status = true;
            break;
        }
    }
    if(status){
        message.info(t('examples.titles.appIsRunningHint'));
    }
    else{
        example.currentDevice = key;
        const idx = example.availableDevices.findIndex(device => device.value === key);
        if(idx >= 0){
            example.currentDeviceType = example.availableDevices[idx].deviceType;
        }
        //check example installation
        if(!example?.needsInstall) return;
        example.isInstalling = true;
        handleCheckExampleInstallation(key, example, (err, flag) => {
            example.isInstalling = false;
            if(err){
                message.error(t('examples.errors.checkExampleInstallationError'));
                return;
            }
            example.isInstalled = flag;
        });
    }
}

const handleLaunchExampleClicked = (exampleNameEn, device, appName, apps, projects, example) => {
    if(device === ''){
        message.warning(t('examples.errors.deviceNotFoundWarning'), 5);
        return;
    }

    if(example.supports.findIndex(type => type === example.currentDeviceType) < 0){
        message.warning(t('examples.errors.deviceNotSupportWarning'));
        return;
    }

    exampleListRef.value.forEach((example) => {
        let status = false;
        for(const app in example.apps){
            if(example.apps[app]?.connection && example.currentDevice === device){
                status = true;
                break;
            }
        }
        if(status && example.nameEn !== exampleNameEn){
            message.warning(t('examples.errors.otherExampleIsRunningWarning'));
            return;
        }
    })

    if(!apps[appName]?.connection){
        message.info(t('examples.titles.appIsLaunchingHint').replace('$app', appName));
    }
    exampleManager.launchExampleApp(example, device, appName, apps, projects, (err) => {
        console.log('error', err);
        if(err.indexOf('not installed') >= 0){
            message.warning(t('examples.errors.appNotInstalledWarning').replace('$app', appName));
        }
    })
}

const handleLaunchExampleUsingLocalAppClicked = (exampleNameEn, device, appName, apps, projects, example) => {
    if(device === ''){
        message.warning(t('examples.errors.deviceNotFoundWarning'), 5);
        return;
    }
    
    if(example.supports.findIndex(type => type === example.currentDeviceType) < 0){
        message.warning(t('examples.errors.deviceNotSupportWarning'));
        return;
    }

    exampleManager.launchExampleUsingLocalApp(device, appName, apps, projects, (name, url) => {
        message.warning(t('examples.errors.vscodeNotFoundWarning'));
    },
    (err) => {
        console.log(err);
    })
}

const handleCloseExampleClicked = (appObject) => {
    exampleManager.closeApp(appObject);
}

// 检查示例是否可用
const isExampleAvailable = (example) => {
    // 检查 currentDeviceType 是否存在
    if(example.currentDeviceType && example.currentDeviceType !== ''){
        // 检查设备类型是否在supports数组中
        return example.supports && example.supports.includes(example.currentDeviceType);
    }
    // 无设备连接，返回不可用
    return false;
};

// 获取示例状态样式类
const getExampleStatusClass = (example) => {
    return isExampleAvailable(example) ? 'status-available' : 'status-unavailable';
};

// 获取示例状态提示文本
const getExampleStatusTooltip = (example) => {
    const connectedCount = connectedDevicesRef.value.length;
    
    // 无设备连接
    if(connectedCount === 0){
        return t('examples.labels.noDeviceDetected');
    }
    
    // 有设备连接，检查当前设备
    if(example.currentDeviceType && example.currentDeviceType !== ''){
        const isCompatible = example.supports && example.supports.includes(example.currentDeviceType);
        if(isCompatible){
            // 设备支持该示例
            return t('examples.labels.deviceSupportExample');
        } else {
            // 设备不支持该示例
            return t('examples.labels.deviceNotSupportExample');
        }
    }
    
    // 未选择设备，返回不支持
    return t('examples.labels.deviceNotSupportExample');
};

const checkReadyStateOfExamples = () => {
    if(exampleListRef.value.length > 0){
        exampleManager.registerCloseAppFunction();
    }
    else{
        setTimeout(() => {
            checkReadyStateOfExamples();
        }, 1000)
    }
}

onBeforeUnmount(() => {
    exampleListRef.value.forEach((example) => {
        for(const app in example.apps){
            if(example.apps[app]?.connection){
                handleCloseExampleClicked(example.apps[app]);
            }
        }
        console.log('close all apps in example page');
    })

    exampleManager.removeCloseAppFunction();
})

checkReadyStateOfExamples();

// 刷新示例安装状态的函数
const refreshExampleInstallationStatus = () => {
    exampleListRef.value.forEach((example) => {
        if(example.currentDevice && example.needsInstall && !example.isInstalling){
            example.isInstalling = true;
            handleCheckExampleInstallation(example.currentDevice, example, (err, flag) => {
                example.isInstalling = false;
                if(err){
                    console.error('check example installation error:', err);
                    return;
                }
                example.isInstalled = flag;
            });
        }
    });
};

// 监听路由变化，刷新示例状态
watch(() => route.path, (newPath, oldPath) => {
    // 当切换到示例模块时，刷新所有示例的安装状态
    if(newPath === '/examples'){
        // 延迟确保组件已经渲染完成
        setTimeout(() => {
            refreshExampleInstallationStatus();
        }, 100);
    }
}, { immediate: false });

onMounted(() => {
    // 组件挂载时如果已经在示例页面，也刷新一次状态
    if(route.path === '/examples'){
        refreshExampleInstallationStatus();
    }
});
</script>

<style lang="less" scoped>
@import url('@/assets/styles/common.less');

.examples-main{
    width: 100%;
    height: 100%;
    .examples-header{
        height: 4rem;
        padding: 0 1rem;
        background: black;
        .center;
        flex-direction: column;
        align-items: flex-start;
        h2{
            color: white;
        }
        .example-filters{
            color: lightgray;
        }
    }
    .example-content{
        height: calc(100% - 4rem);
        background: radial-gradient(ellipse at bottom, #1a1311 0%, #06060a 100%);
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
        grid-template-rows: repeat(auto-fill, 21rem);
        grid-gap: 2rem;
        overflow-y: auto;
        padding: 1rem;
        .example-inactive{
            opacity: .3 !important;
        }
        .example-item{
            position: relative;
            height: 21rem;
            border-radius: .5rem;
            background: hsla(0, 0%, 100%, .1);
            // background: gray;
            overflow: hidden;
            
            .example-status-indicator{
                position: absolute;
                top: 8px;
                left: 8px;
                z-index: 10;
                
                .status-circle{
                    width: 14px;
                    height: 14px;
                    border-radius: 50%;
                    border: 2px solid white;
                    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
                    
                    &.status-available{
                        background-color: #52c41a;
                        box-shadow: 0 0 8px rgba(82, 196, 26, 0.6), 0 2px 6px rgba(0, 0, 0, 0.3);
                    }
                    
                    &.status-unavailable{
                        background-color: #ff4d4f;
                        box-shadow: 0 0 8px rgba(255, 77, 79, 0.6), 0 2px 6px rgba(0, 0, 0, 0.3);
                        animation: pulse-red 2s infinite;
                    }
                }
            }
            
            iframe{
                width: 100%;
                height: 60%;
            }
            .example-name{
                height: 2rem;
                .center;
                justify-content: flex-start;
                color: white;
                padding: 0 .5rem;
                h3{
                    margin: 0;
                }
            }
            .example-images{
                height: 12rem;
                img{
                    width: 100%;
                    height: 12rem;
                }
                :deep(.slick-slide) {
                    height: 12rem;
                    text-align: center;
                    background: #364d79;
                    overflow: hidden;
                }
                :deep(.slick-arrow.custom-slick-arrow) {
                    width: 25px;
                    height: 25px;
                    font-size: 25px;
                    color: #fff;
                    background-color: rgba(31, 45, 61, 0.11);
                    transition: ease all 0.3s;
                    opacity: 0.3;
                    z-index: 1;
                }
                :deep(.slick-arrow.custom-slick-arrow:before) {
                    display: none;
                }
                :deep(.slick-arrow.custom-slick-arrow:hover) {
                    color: #fff;
                    opacity: 0.5;
                }
            }
            .example-tags{
                height: 2rem;
                padding: .5rem;
                .center;
                justify-content: flex-start;
                opacity: .4;
                overflow-y: hidden;
                overflow-x: auto;
                transition: opacity .5s ease;
                &:hover{
                    opacity: .9;
                }
            }
            .example-device{
                height: 2rem;
                padding: 0 .5rem;
                .center;
                justify-content: space-between;
                .device-select{
                    overflow: hidden;
                    flex-grow: 1;
                    width: 10rem;
                    margin-right: 1rem;
                }
                .example-links{
                    color: @theme-color;
                    .center;
                    gap: .5rem;
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
            .example-launchers{
                height: 3rem;
                padding: .5rem;
                .center;
                justify-content: flex-start;
                gap: .5rem;
                img{
                    width: 2rem;
                    height: 2rem;
                }
            }
            .example-mask{
                position: absolute;
                z-index: 10;
                width: 100%;
                height: 100%;
                top: 0;
                left: 0;
                background: transparent;
            }
        }
    }
}

// 红色闪烁动画
@keyframes pulse-red {
    0% {
        transform: scale(1);
        opacity: 1;
    }
    50% {
        transform: scale(1.1);
        opacity: 0.7;
    }
    100% {
        transform: scale(1);
        opacity: 1;
    }
}
</style>