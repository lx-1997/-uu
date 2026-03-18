import { FlashBehavior } from "./strategries/FlashBehavior"

import {
    GlobalConfig
} from '@/global_configuration/GlobalConfig.js'
const Config = GlobalConfig.getInstance();

class FlashManager{
    constructor(usbListCb){
        this.usbListCb = usbListCb;
        this.flashBehavior = new FlashBehavior();
        this.usbDeviceList = [];
    }

    get isTypeCAvailableGetter(){
        return true;
    }

    checkDependencies(successCb, errorCb){
        this.flashBehavior.checkDependencies(successCb, errorCb);
    }

    initializeUSBDetection(){

    }

    checkUSBDevices(){
        const list = this.flashBehavior.checkUSBDevices();
        if(Array.isArray(list) && list.length > 0){
            this.usbDeviceList = list;
            this.usbListCb(this.usbDeviceList);
        }
    }

    flashImage(storage, imagePath, deleteFlag, cb){
        this.flashBehavior.flashImage(storage, imagePath, deleteFlag, cb);
    }

    cancelFlashing(cb){
        this.flashBehavior.cancelFlashing(cb);
    }

    async saveNetworkConfig(device, networkConfig){
        return await this.flashBehavior.saveNetworkConfig(device, networkConfig);
    }

    async saveNetworkConfigToMountPoint(mountPoint, networkConfig){
        return await this.flashBehavior.saveNetworkConfigToMountPoint(mountPoint, networkConfig);
    }
}

export {
    FlashManager
}