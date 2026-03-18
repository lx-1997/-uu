import { StoreManager } from "../store/StorageManager"

import {
    HardwareBehaviorSSH
} from '@hardware/platform_strategies/hardware_behaviors/HardwareBehaviorSSH';

import {
    ManageRemoteApp
} from '../strategies/ManageRemoteApp';

import {
    ManageLocalApp
} from '../strategies/ManageLocalApp';

import {
    MESSAGE_CLOSE_APP,
} from '@/constants/AppMessageNames';

import {
    GlobalConfig
} from '@/global_configuration/GlobalConfig';
const Config = GlobalConfig.getInstance();

class ExampleManager{
    constructor(listCb, deviceCb){
        this.sshBehavior = new HardwareBehaviorSSH();
        this.manageRemoteApp = new ManageRemoteApp();
        this.manageLocalApp = new ManageLocalApp();
        this.availableDevices = [];
        this.storeManager = StoreManager.getInstance();
        this.storeManager.getExampleList(listCb);
        this.storeManager.getDeviceList((devices) => {
            console.log('devices: ', devices);
            if(Array.isArray(devices)){
                for(const device of devices){
                    this.sshBehavior.checkConnectionStatus(device.userName, device.userName, device.ip, (flag) => {
                        if(flag){
                            // 检查设备是否已经存在于列表中，避免重复添加
                            const deviceExists = this.availableDevices.some(d => d.name === device.name);
                            if(!deviceExists){
                                this.availableDevices.push(device);
                                deviceCb(device);
                            }
                        }
                    })
                }
            }
        });

        this.closeAppCb = undefined;
        this.registeredFunction = (msg) => {
            if(this.closeAppCb){
                this.closeAppCb(msg);
            }
        }
    }

    launchExampleApp(example, deviceName, appName, apps, projects, errcb){
        const idx = this.availableDevices.findIndex(device => device.name === deviceName);
        if(idx >= 0){
            const device = this.availableDevices[idx];
            this.manageRemoteApp.checkAppInstallation(appName, device, (err, flag) => {
                if(err){
                    errcb('check app installation failed')
                    return;
                }
                if(!flag){
                    errcb('app not installed')
                    return;
                }
                else{
                    //launch remote app
                    this.manageRemoteApp.launchApp(appName, device, apps[appName], projects[device.deviceType][appName], (err, flag) => {
                        console.log('launch app error: ', err);
                    }, example?.needsHttps, example?.settingsPath);
                }
            })
        }
    }

    launchExampleUsingLocalApp(deviceName, appName, apps, projects, hintcb, errcb){
        const idx = this.availableDevices.findIndex(device => device.name === deviceName);
        if(idx >= 0){
            const device = this.availableDevices[idx];
            this.manageLocalApp.launchApp(apps[appName], device, projects[device.deviceType][appName], hintcb, errcb);
            
        }
    }

    checkExampleInstallation(deviceName, example, cb){
        const idx = this.availableDevices.findIndex(device => device.name === deviceName);
        if(idx >= 0){
            const device = this.availableDevices[idx];
            this.manageRemoteApp.checkExampleInstallation(device, example, cb);
        }
    }

    installExample(deviceName, example, cb){
        const idx = this.availableDevices.findIndex(device => device.name === deviceName);
        if(idx >= 0){
            const device = this.availableDevices[idx];
            this.manageRemoteApp.installExample(device, example, cb);
        }
    }

    removeDependency(deviceName, folders){
        console.log(deviceName, folders)
        const idx = this.availableDevices.findIndex(device => device.name === deviceName);
        if(idx >= 0){
            const device = this.availableDevices[idx];
            this.sshBehavior.removeFolders(device.userName, device.userName, device.ip, folders)
        }
    }

    closeApp(appObject){
        this.manageRemoteApp.closeApp(appObject);
    }

    setCloseAppCallback(cb){
        this.closeAppCb = cb;
    }

    registerCloseAppFunction(){
        Config.registerMessageHandler(MESSAGE_CLOSE_APP, this.registeredFunction);
    }

    removeCloseAppFunction(){
        Config.removeMessageHandler(MESSAGE_CLOSE_APP, this.registeredFunction);
    }
}

export {
    ExampleManager
}