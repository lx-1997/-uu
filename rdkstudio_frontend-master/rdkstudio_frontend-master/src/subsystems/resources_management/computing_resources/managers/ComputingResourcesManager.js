import { LocalDockerBehavior } from '@computing/behaviors/LocalDockerBehavior';
import { FileTransferBehavior } from '@computing/behaviors/FileTransferBehavior';

import {
    GlobalConfig
} from '@/global_configuration/GlobalConfig';
const Config = GlobalConfig.getInstance();

import {
    StoreManager
} from '@computing/store/StoreManager';
const Store = StoreManager.getInstance();

class ComputingResourcesManager{
    constructor(){
        this.localDockerBehavior = new LocalDockerBehavior();
        this.fileTransferBehavior = new FileTransferBehavior();
    }

    getLocalSpecifications(cb){
        cb(Config.localCpuGetter, Config.localMemoryGetter, Config.localGpuGetter);
    }

    getLocalDockerStatus(cb){
        this.localDockerBehavior.checkDockerStatus(cb);
    }

    installDocker(){
        this.localDockerBehavior.installDocker();
    }

    launchDocker(){
        this.localDockerBehavior.launchDocker();
    }

    getComputingList(cb){
        Store.getComputingList(cb);
    }

    checkImageStatus(imageName, cb){
        this.localDockerBehavior.checkImageStatus(imageName, cb);
    }

    downloadComputingItem(item, dir, cb, err){
        this.fileTransferBehavior.downloadFile(item.host, item.target, dir, item.fileName, cb, err);
    }

    loadComputingItem(item, dir, cb, err){
        this.localDockerBehavior.loadImage(dir, item.fileName, cb);
    }

    launchComputingItem(item, cb){
        this.localDockerBehavior.launchImage(item.launchCommand, cb);
    }

    clostComputingItem(item, cb){
        this.localDockerBehavior.stopContainer(item.imageProcess, item.imageName, cb);
    }
}

export {
    ComputingResourcesManager
}