const Client = require('ssh2').Client;

import {
    GlobalConfig
} from '@/global_configuration/GlobalConfig.js'
const Config = GlobalConfig.getInstance();

class BehaviorSSH{
    constructor(ip){
        this.command = 'sudo nmcli device wifi rescan && sleep 3 && nmcli -f "SSID" device wifi list'
        this.ip = ip ? ip : Config.etherIPGetter;
        this.connection = undefined;
    }

    set ipSetter(ip){
        this.ip = ip;
    }

    testConnection(userName, userPassword, finishedCallback, errorCallback){
        const testStr = 'testConnection';
        const testCommand = `echo ${testStr}`;
        const customCallback = (data) => {
            const str = data.toString().trim();

            if(str === testStr){
                // this.connection = undefined;
                finishedCallback();
            }
        }

        this._executeGeneralCommand(userName, userPassword, testCommand, () => {}, errorCallback, customCallback);
        
    }

    establishConnection(userName, userPassword, finishedCallback, errorCallback){
        const assembledOptions = {
            host: this.ip,
            port: 22,
            username: userName,
            password: userPassword,
            readyTimeout: 15000
        };

        console.log('establish connection: ', assembledOptions)

        let connection = new Client();
        connection.on('ready', () => {
            connection.exec(this.command, (err, stream) => {
                if(err){
                    errorCallback('connection error');
                    throw err;
                }

                let wifiNames = [];
                stream.on('close', (code, signal) => {
                    if(code === 0){
                        wifiNames = [...new Set(wifiNames)];
                        finishedCallback(wifiNames);
                    }
                    connection = undefined;
                }).on('data', (data) => {
                    let tempList =  data.toString()
                                        .split('\n')
                                        .map(name => name.trim())
                                        .filter(name => name !== 'SSID' && name !== '');
                    wifiNames = wifiNames.concat(tempList);
                }).stderr.on('data', (data) => {
                    errorCallback(data);
                })
            })
        }).on('error', (err)=>{
            errorCallback(err);
        }).connect(assembledOptions);
    }

    checkWifiConnection(user, passwd, cb){
        const assembledOptions = {
            host: this.ip,
            port: 22,
            username: user,
            password: passwd,
            readyTimeout: 5000
        };
        const command = "nmcli -t -f active,ssid dev wifi | grep '^yes' | cut -d':' -f2 && ifconfig | grep -A 1 '^wl' | grep 'inet ' | awk '{print $2}' | cut -d ':' -f2 | head -n 1";

        let connection = new Client();
        connection.on('ready', () => {
            let str = '';
            connection.exec(command, (err, stream) => {
                if(err){
                    throw err;
                }
                stream.on('close', (code, signal) => {
                    if(code === 0){
                        // finishedCallback();
                        cb(undefined, true, str);
                    }
                    connection = undefined;
                }).on('data', (data) => {
                    if(str === ''){
                        str = data.toString().trim();
                    }
                    else{
                        str = str + ':' + data.toString().trim();
                    }
                }).stderr.on('data', (data) => {
                    cb('error');
                })
            })
        }).on('error', (err)=>{
            cb('error');
        }).connect(assembledOptions);
    }

    setWifiConnection(userName, userPassword, wifiName, wifiPassword, finishedCallback, errorCallback){
        const assembledCommand = `sudo wifi_connect "${wifiName}" "${wifiPassword}" | awk -F \\' '{print $2}' | xargs ifconfig | grep 'inet ' | awk '{print $2}' | cut -d ':' -f2 | head -n 1`;
        const customCallback = (data) => {
            const str = data.toString().trim();
            console.log(str);
            finishedCallback(str);
        }
        this._executeGeneralCommand(userName, userPassword, assembledCommand, ()=>{}, errorCallback, customCallback);
    }

    getAdditionalInfo(user, passwd, ip, cb){
        const assembledCommand = `cat /proc/device-tree/compatible &&  export PATH=/usr/hobot/bin/:$PATH  && hash hrut_socuid > /dev/null 2>&1  && hrut_socuid || echo "soc_uid:$(cat /proc/device-tree/compatible)"`;
        let deviceType = '';
        let id = '';
        const customCallback = (data) => {
            const str = data.toString().trim();
            if(str.indexOf('soc_uid') >= 0){
                id = str.substring(8)
                cb(undefined, deviceType, id);
            }
            else if(deviceType === 's100'){
                cb(undefined, deviceType, str);
            }
            else {
                if(str.indexOf('x3') >= 0){
                    deviceType = 'x3';
                }
                else if(str.indexOf('x5') >= 0){
                    deviceType = 'x5';
                }
                else if(str.indexOf('s100') >= 0){
                    deviceType = 's100';
                }
                else if(str.indexOf('nvidia') >= 0){
                    deviceType = 'nvidia';
                }
                else if(str.indexOf('raspberrypi') >= 0){
                    deviceType = 'raspberrypi';
                }
                else{
                    deviceType = 'others';
                }
            }
        }
        console.log('before additional: ', user, passwd, this.ip)
        this._executeGeneralCommand(user, passwd, assembledCommand, () => {}, (e) => { console.log('additional error: ', e.toString()) }, customCallback);
    }

    _executeGeneralCommand(userName, userPassword, command, finishedCallback, errorCallback, customCb){
        const assembledOptions = {
            host: this.ip,
            port: 22,
            username: userName,
            password: userPassword,
            readyTimeout: 5000
        };

        let connection = new Client();
        connection.on('ready', () => {
            connection.exec(command, (err, stream) => {
                if(err){
                    throw err;
                }

                stream.on('close', (code, signal) => {
                    if(code === 0){
                        // finishedCallback();
                    }
                    connection = undefined;
                }).on('data', customCb ? customCb : (data) => {
                    console.log(data.toString())
                }).stderr.on('data', (data) => {
                    errorCallback(data);
                })
            })
        }).on('error', (err)=>{
            errorCallback(err);
        }).connect(assembledOptions);
    }
}

let behavior = BehaviorSSH;

if(Config.isWinGetter){
    
}
else if(Config.isMacGetter){
    
}
else if(Config.isLinuxGetter){

}

export {
    behavior as ConnectionBehaviorSSH
}