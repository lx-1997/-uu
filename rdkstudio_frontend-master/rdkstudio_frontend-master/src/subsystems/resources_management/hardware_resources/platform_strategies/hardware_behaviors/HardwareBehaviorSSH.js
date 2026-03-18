import { isNumber } from 'lodash';

const Client = require('ssh2').Client;
const path = require('path');

class HardwareBehaviorSSH{
    constructor(){
        this.netSpeedRecords = {};
    }

    checkConnectionStatus(user, passwd, ip, cb){
        const assembledOptions = {
            host: ip,
            port: 22,
            username: user,
            password: passwd,
            readyTimeout: 5000
        };

        const testStr = 'testConnection';
        const command = `[ "$(nmcli networking connectivity)" != "full" ] && echo ${testStr} || (echo ${testStr} && echo "timestamp: ${ip}: $(date +%s)" && echo "netspeed: ${ip}: $(cat /sys/class/net/$(ip a | awk '/state UP/ && /wl/{gsub(":","",$2); print $2; exit}')/statistics/rx_bytes)")`;
        const commandNoWlan = `echo ${testStr}`;

        const connection = new Client();
        connection.on('ready', () => {
            connection.exec(command, (err, stream) => {
                if(err){
                    cb(false);
                    connection.end();
                    throw err;
                }

                stream.on('close', (code, signal) => {
                    if(code === 0){
                        if(this.netSpeedRecords[ip]?.speed && this.netSpeedRecords[ip].speed !== ''){
                            cb(true, this.netSpeedRecords[ip].speed);
                        }
                        else{
                            cb(true);
                        }
                        connection.end();
                    }
                }).on('data', (data) => {
                    if(data.toString().trim() === testStr){
                        if(!Object.hasOwnProperty.call(this.netSpeedRecords, ip)){
                            cb(true);
                            connection.end();
                        }
                    }
                    else{
                        this._calculateNetSpeed(data.toString())
                    }
                }).stderr.on('data', (data) => {
                    console.log('stderr: ', data.toString())
                    connection.end();
                    // cb(false);
                })
            })
        }).on('error', (err)=>{
            cb(false);
            connection.end();
        }).connect(assembledOptions);
    }

    _calculateNetSpeed(dataStr){
        const strList = dataStr.split(':');
        if(dataStr.indexOf('timestamp') >= 0){
            const timestamp = parseInt(strList[2].trim());
            const ip = strList[1].trim();
            if(!Object.hasOwnProperty.call(this.netSpeedRecords, ip)){
                this.netSpeedRecords[ip] = {
                    time: timestamp,
                    timeInterval: 0,
                    bytes: 0,
                    bytesInterval: 0,
                    speed: ''
                }
            }
            else{
                this.netSpeedRecords[ip].timeInterval = timestamp - this.netSpeedRecords[ip].time;
                this.netSpeedRecords[ip].time = timestamp;
            }
        }
        else if(dataStr.indexOf('netspeed') >= 0){
            const netBytes = parseInt(strList[2].trim());
            const ip = strList[1].trim();
            if(Object.hasOwnProperty.call(this.netSpeedRecords, ip)){
                const obj = this.netSpeedRecords[ip];
                obj.bytesInterval = netBytes - obj.bytes;
                obj.bytes = netBytes;

                if(isNumber(obj.timeInterval) && obj.timeInterval > 0 && isNumber(obj.bytesInterval) && obj.bytesInterval > 0){
                    obj.speed = (obj.bytesInterval/1048576/obj.timeInterval).toFixed(1) + 'MB/s';
                }
            }
        }
    }

    checkNetworkStatus(user, passwd, ip, cb){
        const command = 'ping -c 1 jd.com > /dev/null 2>&1 && echo connected || echo unconnected';
        const customCb = (err, data) => {
                if(err){
                    cb(err);
                    return;
                }
                if(data === 'connected'){
                    cb(undefined, true);
                }
                else{
                    cb(undefined, false);
                }
        }

        this._checkSpecificStatus(user, passwd, ip, command, customCb);
    }

    checkUsbCamStatus(user, passwd, ip, cb){
        const command = 'v4l2-ctl  --list-devices | grep media | wc -l';
        const customCb = (err, data) => {
            if(err){
                cb(err);
                return;
            }
            if(data === '0'){
                cb(undefined, 0);
            }
            else{
                console.log('camera status in ssh: ', data)
                if(Number.isInteger(Number(data))){
                    cb(undefined, Number(data));
                }
            }
        }

        this._checkSpecificStatus(user, passwd, ip, command, customCb);
    }

    _checkSpecificStatus(user, passwd, ip, command, customCb){
        const assembledOptions = {
            host: ip,
            port: 22,
            username: user,
            password: passwd,
            readyTimeout: 5000
        };

        let connection = new Client();
        connection.on('ready', () => {
            connection.exec(command, (err, stream) => {
                if(err){
                    customCb(err);
                    connection.end();
                    throw err;
                }

                stream.on('close', (code, signal) => {
                    if(code === 0){}
                    connection.end();
                    connection = undefined;
                }).on('data', (data) => {
                    customCb(undefined, data.toString().trim());
                    connection.end();
                })
                .stderr.on('data', (data) => {
                    customCb(data);
                    connection.end();
                })
            })
        }).on('error', (err)=>{
            customCb(err);
            connection.end();
        }).connect(assembledOptions);
    }

    powerReboot(user, passwd, ip){
        const command = 'sudo reboot now';
        this._powerOperation(user, passwd, ip, command);
    }

    powerShutdown(user, passwd, ip){
        const command = 'sudo shutdown now';
        this._powerOperation(user, passwd, ip, command);
    }

    _powerOperation(user, passwd, ip, command){
        const assembledOptions = {
            host: ip,
            port: 22,
            username: user,
            password: passwd,
            readyTimeout: 5000
        };

        const connection = new Client();
        connection.on('ready', () => {
            connection.exec(command, (err, stream) => {
                if(err){
                    connection.end();
                    return;
                }
                // 重启/关机命令执行后设备会立即断开，延迟确保命令已发送
                setTimeout(() => {
                    connection.end();
                }, 1000);
            });
        }).connect(assembledOptions);
    }

    updateOS(user, passwd, ip, customCb){
        const command = 'sudo apt-get update && sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y';
        const assembledOptions = {
            host: ip,
            port: 22,
            username: user,
            password: passwd,
            readyTimeout: 5000
        };

        let connection = new Client();
        connection.on('ready', () => {
            connection.exec(command, (err, stream) => {
                if(err){
                    customCb(false);
                    connection.end();
                    throw err;
                }

                stream.on('close', (code, signal) => {
                    if(code === 0){
                        customCb(true);
                        connection.end();
                    }
                    else{
                        customCb(false);
                        connection.end();
                    }
                    connection = undefined;
                }).on('data', (data) => {
                    
                })
                .stderr.on('data', (data) => {
                    // 只记录 stderr 日志，不关闭连接（apt-get 的警告信息不应该中断升级过程）
                    console.log('hardware stderr: ', data.toString())
                })
            });
        }).connect(assembledOptions);
    }


    updateFirmware(user, passwd, ip, customCb){
        const currentCommand = 'sudo rdkos_info | grep U-Boot';
        const cloudCommand = 'rdk-miniboot-update -l';
        const updateCommand = 'sudo rdk-miniboot-update';

        let currentUboot = '';
        let cloudImg = '';

        const assembledOptions = {
            host: ip,
            port: 22,
            username: user,
            password: passwd,
            readyTimeout: 5000
        };

        let connection = new Client();
        connection.on('ready', () => {
            connection.exec(currentCommand, (err, stream) => {
                if(err){
                    customCb(false);
                    connection.end();
                    throw err;
                }

                stream.on('close', (code, signal) => {
                    if(code === 0){
                        // customCb(true);
                        connection.exec(cloudCommand, (err, stream) => {
                            if(err){
                                customCb(false);
                                connection.end();
                                throw err;
                            }

                            stream.on('close', (code, signal) => {
                                if(code === 0){
                                    const list = cloudImg.split('_');
                                    const dateStr = list[list.length - 1];
                                    const year = parseInt(dateStr.slice(0, 4));
                                    const month = parseInt(dateStr.slice(4, 6)) - 1;
                                    const day = parseInt(dateStr.slice(6, 8));
                                    const date = new Date(year, month, day);
                                    const monthNames = [
                                    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
                                    ];

                                    const formattedDate = `${monthNames[date.getMonth()]} ${date.getDate()} ${date.getFullYear()}`;


                                    if(currentUboot.indexOf(formattedDate) >= 0){
                                        customCb(false, true);
                                        connection.end();
                                    }
                                    else{
                                        connection.exec(updateCommand, (err, stream) => {
                                            if(err){
                                                customCb(false);
                                                throw err;
                                            }

                                            stream.on('close', (code, signal) => {
                                                if(code === 0){
                                                    customCb(true)
                                                }
                                                else{
                                                    customCb(false)
                                                }
                                            })
                                        })
                                    }
                                }
                                else{
                                    customCb(false);
                                    connection.end();
                                }
                            }).on('data', (data) => {
                                cloudImg = path.parse(data.toString().trim()).name;
                            })
                        })
                    }
                    else{
                        customCb(false);
                        connection.end();
                    }
                }).on('data', (data) => {
                    try{
                        let line = data.toString().trim();
                        currentUboot = line;
                    }
                    catch(e){}
                })
                .stderr.on('data', (data) => {
                    // customCb(false);
                    console.log(data.toString())
                })
            });
        }).connect(assembledOptions);
    }

    removeFolders(user, passwd, ip, folders){
        const commands = folders.map((folder) => {
            return `[ -d ${folder} ] && sudo rm -rf ${folder}`
        });
        const assembledOptions = {
            host: ip,
            port: 22,
            username: user,
            password: passwd,
            readyTimeout: 5000
        };

        const connection = new Client();
        connection.on('ready', () => {
            commands.forEach((command) => {
                connection.exec(command, (err, stream) => {});
            })
        }).connect(assembledOptions);
    }
}

export {
    HardwareBehaviorSSH
}