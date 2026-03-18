import {
    HardwareBehaviorSSH
} from '@hardware/platform_strategies/hardware_behaviors/HardwareBehaviorSSH';

import {
    ManageLocalApp,
} from '@hardware/platform_strategies/app_behaviors/ManageLocalApp';
import {
    ManageRemoteApp,
} from '@hardware/platform_strategies/app_behaviors/ManageRemoteApp';

import {
    StoreManager
} from '@hardware/store/StoreManager';

import {
    MESSAGE_CLOSE_APP,
} from '@/constants/AppMessageNames';

import {
    GlobalConfig
} from '@/global_configuration/GlobalConfig';
const Config = GlobalConfig.getInstance();


const CheckInterval = 20;

const Store = StoreManager.getInstance();
class HardwareItemManager{
    constructor(user, passwd, ip, statusCb){
        this.basicInfo = {
            user,
            passwd,
            ip
        };
        this.statusCb = statusCb;
        this.closeAppCb = undefined;
        this.lastStatus = false;
        this.appListPath = '';
        this.appList = [];
        this.updatedAppList = [];

        this.sshBehavior = new HardwareBehaviorSSH();
        this.localAppBehavior = new ManageLocalApp();
        this.remoteAppBehavior = new ManageRemoteApp();

        this._checkingStatus();

        this.registeredFunction = (msg) => {
            if(this.closeAppCb){
                this.closeAppCb(msg);
            }
        }
    }

    _checkingStatus(){
        this.checkHardwareConnection(this.basicInfo.user, this.basicInfo.passwd, this.basicInfo.ip, (flag, speed='') => {
            if(this.lastStatus && !flag){
                //double check
                this.checkHardwareConnection(this.basicInfo.user, this.basicInfo.passwd, this.basicInfo.ip, (subFlag, speed='') => {
                    this.lastStatus = subFlag;
                    this.statusCb(subFlag, speed);
                });
            }
            else{
                this.lastStatus = flag;
                this.statusCb(flag, speed);
            }
        });
        setTimeout(() => {
            this._checkingStatus();
        }, CheckInterval*1000);
    }

    checkHardwareConnection(user, passwd, ip, cb){
        this.sshBehavior.checkConnectionStatus(user, passwd, ip, cb);
    }

    operatePower(user, passwd, ip, type){
        if(type === 'reboot'){
            this.sshBehavior.powerReboot(user, passwd, ip);
        }
        else if(type === 'shutdown'){
            this.sshBehavior.powerShutdown(user, passwd, ip);
        }
    }

    operateUpdate(user, passwd, ip, cb){
        this.sshBehavior.updateOS(user, passwd, ip, cb);
    }

    operateFirmwareUpdate(user, passwd, ip, cb){
        this.sshBehavior.updateFirmware(user, passwd, ip, cb);
    }

    getAppList(cb){
        Store.getAppSpaceList((list) => {
            cb(list);
        })
    }

    launchApp(app, item, hintcb, errcb){
        if(app.type === 'local'){
            this.localAppBehavior.launchApp(app, item, hintcb, errcb);
        }
        else if(app.type === 'server/web'){
            this.remoteAppBehavior.launchApp(app, item, errcb);
        }
        else if(app.type === 'server/web/withoutlaunch'){
            this.remoteAppBehavior.launchAppWithoutConnection(app, item);
        }
        else if(app.type === 'server/client'){
            this.remoteAppBehavior.launchService(app, item, errcb);
            setTimeout(() => {
                this.localAppBehavior.launchApp(app, item, hintcb, errcb);
            }, 800)
        }
    }

    closeApp(app){
        if(app?.connection){
            this.remoteAppBehavior.closeApp(app);
        }
    }

    installApp(app, item, updatecb, finishedcb, errcb){
        this.remoteAppBehavior.installApp(app, item, updatecb, finishedcb, errcb, Config.langGetter);
    }

    uninstallApp(app, item, finishedcb, errcb){
        this.remoteAppBehavior.uninstallApp(app, item, finishedcb, errcb);
    }

    checkAppInstallation(app, item, resultcb, errcb){
        if(app.operations.needsInstall){
            this.remoteAppBehavior.checkAppInstallation(app, item, resultcb, errcb);
        }
        else{
            resultcb(true);
        }
    }

    checkNetworkStatus(user, passwd, ip, cb){
        this.sshBehavior.checkNetworkStatus(user, passwd, ip, cb);
    }

    checkUsbCamStatus(user, passwd, ip, cb){
        this.sshBehavior.checkUsbCamStatus(user, passwd, ip, cb);
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
    HardwareItemManager
}