class ConnectionAdapter{
    constructor(oneTime=false, settingWlan=false){
        this.oneTime = oneTime;
        this.settingWlan = settingWlan;
        this.connectionList = [];
        this.connectionName = '';
        this.userName = '';
        this.userPassword = '';
        this.wifiName = '';
        this.wifiPassword = '';
        this.hardwareName = '';
        this.hardwareIP = '';
        this.hardwareDescription = '';
        this.deviceType = '';
        this.deviceID = '';
        this.connectionType = '';
    }

    getConnectionObject(){
        return {
            name: this.hardwareName,
            type: this.connectionName,
            ip: this.hardwareIP,
            userName: this.userName,
            wifiName: this.wifiName,
            deviceType: this.deviceType,
            deviceID: this.deviceID,
            description: this.hardwareDescription,
            connectionType: this.connectionType,
            oneTime: this.oneTime
        }
    }

    getConnectionList(){

    }

    resetConnectionName(name){
        this.connectionName = name;
    }

    resetConnectionIP(ip){
        this.hardwareIP = ip;
    }

    resetUserInfo(name, passwd){
        this.userName = name;
        this.userPassword = passwd;
    }

    resetWifiInfo(name, passwd){
        this.wifiName = name;
        this.wifiPassword = passwd;
    }

    skipWifiInfo(){
        
    }

    resetHardwareInfo(name, ip, desp, connectionType=''){
        this.hardwareName = name;
        this.hardwareIP = ip;
        this.hardwareDescription = desp;
        this.connectionType = connectionType;
    }

    resetAdditionalInfo(deviceType, deviceID){
        this.deviceType = deviceType;
        this.deviceID = deviceID;
    }

    checkValidation(name, ip, list, cb){
        const status = list.some((item) => {
            return (item.deviceID === this.deviceID && item.ip === ip && item.userName === this.userName && item.wifiName === this.wifiName) || item.name === name;
        })
        cb(status);
    }

    getAdditionalInfo(name, passwd, ip, cb){}
    
}

export {
    ConnectionAdapter
}