import {
    ConnectionAdapter
} from './ConnectionAdapter';

import {
    ConnectionBehaviorSSH
} from '@hardware/platform_strategies/connection_behaviors/ConnectionBehaviorSSH';

import {
    GlobalConfig
} from '@/global_configuration/GlobalConfig.js'
const Config = GlobalConfig.getInstance();

class ConnectionAdapterWlan extends ConnectionAdapter{
    constructor(){
        super();

        this.sshBehavior = new ConnectionBehaviorSSH(Config.etherIPGetter);
    }

    getConnectionList(){
        return [''];
    }

    resetConnectionIP(ip, finishedCallback, errorCallback){
        super.resetConnectionIP(ip);
        if(ip !== ''){
            finishedCallback();
        }
    }

    resetUserInfo(userName, userPassword, finishedCallback, errorCallback){
        super.resetUserInfo(userName, userPassword);
        if(userName !== ''){
            this.sshBehavior.ipSetter = this.hardwareIP;
            this.sshBehavior.establishConnection(userName, userPassword, finishedCallback, errorCallback);
        }
    }

    skipWifiInfo(finishedCallback){
        finishedCallback(this.hardwareIP);
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
    
    checkWifiConnection(){

    }
}

export {
    ConnectionAdapterWlan
}