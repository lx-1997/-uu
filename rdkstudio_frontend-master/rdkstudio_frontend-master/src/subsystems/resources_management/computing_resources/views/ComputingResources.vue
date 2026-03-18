<template>
    <div class="computing-main">
        <header class="computing-header">
            <h3>Computing </h3>
            <a-tooltip title="Add Computing Resource"
                       placement="left">
                <a-button type="primary"
                      shape="circle"
                      size="small"
                      :icon="h(PlusOutlined)">
                </a-button>
            </a-tooltip>
        </header>
        <section class="computing-section">
            <ComputingMachineItem machine-name="This Computer"
                                  :machine-cpu="localCpu"
                                  :machine-memory="localMemory"
                                  :machine-gpu="localGpu"
                                  :docker-installed="isLocalDockerInstalled"
                                  :docker-running="isLocalDockerRunning" 
                                  @installDocker="handleInstallLocalDockerClicked"
                                  @launchDocker="handleLaunchLocalDockerClicked"
                                  @refreshStatus="handleRefreshLocalDockerStatusClicked"></ComputingMachineItem>
            <template v-if="isLocalDockerRunning">
                <ComputingItem v-for="item of localComputingList" 
                               :key="`local-${item.name}`"
                               :computing-item="item"
                               @checkStatus="handleCheckStatusTriggered(item)"
                               @downloadItem="handleDownloadItemClicked(item)"
                               @launchItem="handleLaunchItemClicked(item)"
                               @closeItem="handleCloseItemClicked(item)"></ComputingItem>
            </template>
        </section>
    </div>
</template>

<script setup>
import { h, ref, shallowRef, nextTick } from 'vue';
import {
    PlusOutlined,
} from '@ant-design/icons-vue';
import ComputingMachineItem from './components/ComputingMachineItem.vue';
import ComputingItem from './components/ComputingItem.vue';
import {
    ComputingResourcesManager
} from '@computing/managers/ComputingResourcesManager';
import {
    OPEN_DIALOG,
    DIALOG_RESULT
} from '@/constants/AppEventNames';

const { ipcRenderer } = require('electron');

const computingResourcesManager = new ComputingResourcesManager();
const isLocalDockerInstalled = ref(false);
const isLocalDockerRunning = ref(false);
const localCpu = ref('');
const localMemory = ref('');
const localGpu = ref('');
const localComputingList = ref([]);
let currentItem = undefined;

const getLocalSpecifications = () => {
    computingResourcesManager.getLocalSpecifications((cpu, mem, gpu) => {
        localCpu.value = cpu;
        localMemory.value = mem;
        localGpu.value = gpu;
    });
}

const getLocalDockerStatus = () => {
    computingResourcesManager.getLocalDockerStatus((isInstalled, isRunning) => {
        isLocalDockerInstalled.value = isInstalled;
        isLocalDockerRunning.value = isRunning;
    });
}

const handleInstallLocalDockerClicked = () => {
    computingResourcesManager.installDocker();
}

const handleLaunchLocalDockerClicked = () => {
    computingResourcesManager.launchDocker();
    setTimeout(handleRefreshLocalDockerStatusClicked, 20*1000);
}

const handleRefreshLocalDockerStatusClicked = () => {
    getLocalSpecifications();
    getLocalDockerStatus();
}

const handleCheckStatusTriggered = (item) => {
    computingResourcesManager.checkImageStatus(item.imageName, (loaded, running) => {
        item.isLoaded = loaded;
        item.isRunning = running;
    })
}

const handleDownloadItemClicked = (item) => {
    ipcRenderer.once(DIALOG_RESULT, (event, result) => {
        console.log(event, result)
        if(!result.canceled && result.filePaths.length > 0 && currentItem){
            processDownloadItem(currentItem, result.filePaths[0]);
            currentItem = undefined;
        }
    })

    currentItem = item;
    ipcRenderer.send(OPEN_DIALOG, {
        properties: ["openDirectory"]
    })
}

const handleLaunchItemClicked = (item) => {
    computingResourcesManager.launchComputingItem(item, (process) => {
        console.log('ui process: ', process)
        item.imageProcess = process;
        setTimeout(()=>{
            handleCheckStatusTriggered(item);
        }, 2000);
    })
}

const handleCloseItemClicked = (item) => {
    computingResourcesManager.clostComputingItem(item, () => {
        item.imageProcess = undefined;
        setTimeout(() => {
            handleCheckStatusTriggered(item);
        }, 2000);
    })
}

const processDownloadItem = (item, localPath) => {
    item.isDownloading = true;
    computingResourcesManager.downloadComputingItem(item, localPath, (progress, speed, finished) => {
        item.downloadProgress = progress;
        item.downloadSpeed = speed;
        if(finished){
            item.isDownloading = false;

            item.isLoading = true;
            computingResourcesManager.loadComputingItem(item, localPath, () => {
                item.isLoading = false;
                item.isLoaded = true;

                //remove file

                handleCheckStatusTriggered(item);
            }, (err) => {
                console.log(err);
            })

        }
    }, () => {
        item.isDownloading = false;
    })
}



computingResourcesManager.getComputingList((list) => {
    const newlist = list.map((item) => {
        const newitem = Object.assign({}, item);
        newitem.isLoaded = false;
        newitem.isRunning = false;
        newitem.isDownloading = false;
        newitem.isLoading = false;
        newitem.downloadProgress = 0;
        newitem.downloadSpeed = '';
        newitem.imageProcess = undefined;
        return newitem;
    })

    localComputingList.value = newlist;
})
handleRefreshLocalDockerStatusClicked();
</script>

<style lang="less" scoped>
@import url('@/assets/styles/common.less');

.computing-main{
    height: 100%;
    position: relative;
    .computing-header{
        height: 3rem;
        text-align: left;
        padding: .5rem;
        background: linear-gradient(to right, rgba(255,255,198,.28) 0%,rgba(237, 117, 5, 0.3) 100%);
        .center;
        justify-content: space-between;
    }
    .computing-section{
        height: calc(100% - 3rem);
    }
}
</style>