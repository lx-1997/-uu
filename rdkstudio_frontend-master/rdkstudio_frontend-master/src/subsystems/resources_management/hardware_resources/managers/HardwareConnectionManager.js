import {
    CONNECTION_ETHERNET,
    CONNECTION_WLAN,
    CONNECTION_SERIALPORT,
    CONNECTION_TYPEC
} from '@hardware/constants/ConnectionConstants';

import {
    SimpleConnectionFactory
} from '@hardware/connections/ConnectionFactory';

import {
    GlobalConfig
} from '@/global_configuration/GlobalConfig.js'
const Config = GlobalConfig.getInstance();

class HardwareConnectionManager{
    constructor(){
        this.connectionAdapter = undefined;
    }

    get isTypeCAvailableGetter(){
        return true;
    }

    get isLongTermConnectionAvailableGetter(){
        return Config.isWinGetter;
    }

    async handleConnectionTypeConfirmed(type, finishedCallback, errorCallback){
        this.connectionAdapter = await SimpleConnectionFactory(type);
        const list = this.connectionAdapter.getConnectionList();
        if(Array.isArray(list) && list.length > 0){
            finishedCallback(list);
        }
        else{
            errorCallback('Failed to get net list!');
        }
    }

    handleRemovingConnectionType(){
        this.connectionAdapter = undefined;
    }

    handleConnectionIPConfirmed(ip, finishedCallback, errorCallback){
        this.connectionAdapter.resetConnectionIP(ip, finishedCallback, errorCallback);
    }

    handleRemovingConnectionIP(){
        this.connectionAdapter.resetConnectionIP('');
    }

    handleConnectionNameConfirmed(name, finishedCallback, errorCallback){
        this.connectionAdapter.resetConnectionName(name, finishedCallback, errorCallback);
    }
    
    handleRemovingConnectionName(){
        this.connectionAdapter.resetConnectionName('');
    }

    handleUserInfoConfirmed(user, passwd, finishedCallback, errorCallback){
        this.connectionAdapter.resetUserInfo(user, passwd, finishedCallback, errorCallback);
    }

    handleRemovingUserInfo(){
        this.connectionAdapter.resetUserInfo('', '');
    }

    handleWifiInfoConfirmed(wifi, wifiPasswd, finishedCallback, errorCallback){
        this.connectionAdapter.resetWifiInfo(wifi, wifiPasswd, finishedCallback, errorCallback);
    }

    handleRemovingWifiInfo(){
        this.connectionAdapter.resetWifiInfo('', '');
    }

    handleSkipWifiInfo(finishedCallback){
        this.connectionAdapter.skipWifiInfo(finishedCallback);
    }

    getConnectionList(){
        return this.connectionAdapter.getConnectionList();
    }

    getAdditionalInfo(user, passwd, ip, cb){
        this.connectionAdapter.getAdditionalInfo(user, passwd, ip, cb);
    }

    checkHardwareItemValidation(name, ip, list, cb){
        this.connectionAdapter.checkValidation(name, ip, list, cb);
    }

    handleHardwareItemConfirmed(name, ip, description, connectionType){
        console.log('description: ', description);
        this.connectionAdapter.resetHardwareInfo(name, ip, description, connectionType);
    }

    handleRemovingHardwareItem(){
        this.connectionAdapter.resetHardwareInfo('', '', '', '');
    }

    handleRemovingAll(){
        if(this.connectionAdapter){
            this.handleRemovingHardwareItem();
            this.handleRemovingWifiInfo();
            this.handleRemovingUserInfo();
            this.handleRemovingConnectionName();
            this.handleRemovingConnectionType();
        }
    }

    getConnectionObject(){
        return this.connectionAdapter.getConnectionObject();
    }

    checkWifiConnection(user, passwd, cb){
        this.connectionAdapter.checkWifiConnection(user, passwd, cb);
    }

    getConnectionIP(connectionType){
        if(connectionType.indexOf(CONNECTION_ETHERNET) >= 0){
            return Config.etherIPGetter;
        }
        else if(connectionType.indexOf(CONNECTION_TYPEC) >= 0){
            return Config.typecEtherIPGetter;
        }
    }
}

export {
    HardwareConnectionManager
}