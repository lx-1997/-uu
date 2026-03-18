import {
    ConnectionAdapter
} from './ConnectionAdapter';

import {
    ConnectionBehaviorEtherList
} from '@hardware/platform_strategies/connection_behaviors/ConnectionBehaviorEtherList';

import {
    ConnectionBehaviorConfigEther
} from '@hardware/platform_strategies/connection_behaviors/ConnectionBehaviorConfigEther';

import {
    ConnectionBehaviorSSH
} from '@hardware/platform_strategies/connection_behaviors/ConnectionBehaviorSSH';

import {
    ConnectionBehaviorCheckIP
} from '@hardware/platform_strategies/connection_behaviors/ConnectionBehaviorCheckIP';

import {
    GlobalConfig
} from '@/global_configuration/GlobalConfig.js'
const Config = GlobalConfig.getInstance();

class ConnectionAdapterEtherNet extends ConnectionAdapter{
    constructor(oneTime=false, settingWlan=false){
        super(oneTime, settingWlan);
        this.listConnectionBehavior = new ConnectionBehaviorEtherList();
        this.configEtherBehavior = new ConnectionBehaviorConfigEther(Config.pcEtherIPGetter, Config.pcNetMaskGetter, Config.etherIPGetter);
        this.sshBehavior = new ConnectionBehaviorSSH(Config.etherIPGetter);
    }

    getConnectionList(){
        this.connectionList = this.listConnectionBehavior.getList();
        return this.connectionList;
    }

    resetConnectionName(name, finishedCallback, errorCallback){
        super.resetConnectionName(name);
        if(name !== ''){
            this.configEtherBehavior.configEtherNet(name, finishedCallback, errorCallback);
        }
    }

    resetUserInfo(userName, userPassword, finishedCallback, errorCallback){
        super.resetUserInfo(userName, userPassword);
        if(userName !== ''){
            this.sshBehavior.establishConnection(userName, userPassword, finishedCallback, errorCallback);
        }
    }

    resetWifiInfo(wifiName, wifiPassword, finishedCallback, errorCallback){
        super.resetWifiInfo(wifiName, wifiPassword);
        super.resetConnectionName(wifiName);
        if(wifiPassword !== ''){
            this.sshBehavior.setWifiConnection(this.userName, this.userPassword, wifiName, wifiPassword, finishedCallback, errorCallback);
        }
    }
    
    checkWifiConnection(user, passwd, cb){
        this.sshBehavior.checkWifiConnection(user, passwd, cb);
    }

    skipWifiInfo(finishedCallback){
        finishedCallback(this.configEtherBehavior.staticIPGetter);
    }

    getAdditionalInfo(user, passwd, ip, cb){
        this.sshBehavior.getAdditionalInfo(user, passwd, ip, (err, type, id) => {
            if(err){
                cb(err);
                return;
            }
            else{
                super.resetAdditionalInfo(type, id);
                cb(err, type, id);
            }
        });
    }
}

export {
    ConnectionAdapterEtherNet
}