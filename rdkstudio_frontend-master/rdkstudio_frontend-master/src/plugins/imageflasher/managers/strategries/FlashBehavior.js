import {
    GlobalConfig
} from '@/global_configuration/GlobalConfig.js'
const Config = GlobalConfig.getInstance();

const path = require('path');
const fs = require('fs');
const sudo = require('sudo-prompt');
const exec = require('child_process').exec;
const execSync = require('child_process').execSync;
const spawn = require('child_process').spawn;

class FlashBase{
    constructor(){
        this.checkCommand = '';
    }

    checkDependencies(successCb, errorCb){
        exec(this.checkCommand, (err, stdout) => {
            if(err){
                errorCb();
                return;
            }

            const retStr = stdout.toString();
            if(retStr.indexOf('uninstall') >= 0){
                errorCb();
            }
            else{
                successCb();
            }
        })
    }
    checkUSBDevices(){}
    flashImage(){}
    cancelFlashing(){}
    saveNetworkConfig(device, networkConfig){
        return Promise.reject(new Error('Not implemented'));
    }
    saveNetworkConfigToMountPoint(mountPoint, networkConfig){
        return Promise.reject(new Error('Not implemented'));
    }
}

let behavior = FlashBase;


if(Config.isWinGetter){
    class FlashWindows extends FlashBase{
        constructor(){
            super();

            this.checkCommand = `if exist "${path.resolve(Config.pathResourcesGetter, './flash/win32/x64/dd.exe')}" (echo installed) else (echo uninstall)`;
            this.usbListCommand = `${path.resolve(Config.pathResourcesGetter, './flash/win32/x64/ls.exe')} /dev/sd*`
            this.usbNameCommand = `${path.resolve(Config.pathResourcesGetter, './flash/win32/x64/ls.exe')} /dev/disk/by-id`;
            this.usbCastCommand = `${path.resolve(Config.pathResourcesGetter, './flash/win32/x64/ls.exe')} -l /dev/disk/by-id`;
            this.usbDriveCommand = `${path.resolve(Config.pathResourcesGetter, './flash/win32/x64/ls.exe')} -l /dev/disk/by-drive`;
            this.cancelCommand = `wmic process where "name='dd.exe'" call terminate`;

            this.finishedStatus = false;
            this.cancelTriggeredStatus = false;
            this.cancelStatus = false;
            this.runningStatus = false;
            this.tempFolderPath = '';

            this.flashCommand = `${path.resolve(Config.pathResourcesGetter, './flash/win32/x64/dd.exe')} if=$image of=$device bs=4M status=progress`;
            // this.flashCommand = `powershell Start-Process -FilePath "${path.resolve(Config.pathResourcesGetter, './flash/win32/x64/dd.exe')}" -ArgumentList "if=$image", "of=$device", "bs=4M", "status=progress" -Verb runAs`;
            // this.flashCommand = 'powershell Start-Process -FilePath "D:\\sudotest\\ddscript.bat" -Verb runAs'
        }

        checkUSBDevices(){
            let ret = execSync(this.usbListCommand);
            let devices = ret.toString().trim().split('\n')

            ret = execSync(this.usbNameCommand);
            let names = ret.toString().split('\n');
            names = names.filter((name) => {
                return name.indexOf('usb') >= 0 && name.indexOf('part') < 0;
            })
            
            ret = execSync(this.usbCastCommand);
            let casts = ret.toString().split('\n');
            casts = casts.filter((cast) => {
                return cast.indexOf('usb') >= 0 && cast.indexOf('part') < 0;
            })

            ret =  execSync(this.usbDriveCommand);
            let drives = ret.toString().split('\n');


            let pairs = [];
            names.forEach((name) => {
                const castItemArray = casts.filter(cast => cast.indexOf(name) >= 0);
                if(castItemArray.length === 1){
                    let cacheArray = [];
                    devices.forEach((device) => {
                        const devStr = device.replace('/dev', '');
                        if(castItemArray[0].indexOf(devStr) >= 0){
                            cacheArray.push({
                                device: device,
                                name: name
                            })
                        }
                    })
                    if(cacheArray.length == 1){
                        pairs.push(...cacheArray);
                    }
                }
            });


            //when there is no any suitable name

            if(pairs.length === 0){
                ret = execSync(this.usbCastCommand);
                casts = ret.toString().split('\n');
                casts = casts.filter((cast) => {
                    return cast.indexOf('nvme') >= 0 && cast.indexOf('part') < 0;
                })

                const availableDevices = devices.filter((device) => {
                    if(device.indexOf('/sda') < 0){
                        const countArray = devices.filter(countDev => countDev.indexOf(device) >= 0);
                        if(countArray.length > 1){
                            const devStr = device.replace('/dev', '');
                            const countHasNvmeArray = casts.filter(countCast => countCast.indexOf(devStr) >= 0)
                            return (countHasNvmeArray.length === 0);
                        }
                    }
                    return false;
                })

                if(availableDevices.length > 0){
                    pairs = availableDevices.map((device) => {
                        return {
                            device: device,
                            name: device
                        }
                    })
                }
            }

            pairs.forEach((pair) => {
                const devStr = pair.device.replace('/dev', '');
                const drivesArray = drives.filter(drive => drive.indexOf(devStr) >= 0);
                let drivesStr = '(';
                drivesArray.forEach((drive) => {
                    const items = drive.split(' ');
                    drivesStr = drivesStr + items[items.length - 3].toUpperCase() + ': ';
                })
                drivesStr += ')';

                pair.name = drivesStr + pair.name;
            })

            return pairs;
        }

        flashImage(device, imagePath, deleteFlag, cb){
            this.finishedStatus = false;
            this.cancelTriggeredStatus = false;
            this.cancelStatus = false;
            this.runningStatus = false;
            
            //step 0: get basic info
            const imgInfo = fs.statSync(imagePath);
            const imgSize = imgInfo.size;

            //step 1: generate paths & mkdir
            this.tempFolderPath = path.resolve(Config.pathResourcesGetter, `tempFolder-${Date.now()}`);
            fs.mkdirSync(this.tempFolderPath);
            const pathStdout = path.resolve(this.tempFolderPath, './stdout.txt');
            const pathStderr = path.resolve(this.tempFolderPath, './stderr.txt');
            const pathStatus = path.resolve(this.tempFolderPath, './status.txt');
            const pathOuterScript = path.resolve(this.tempFolderPath, './outer.bat');
            const pathInnerScript = path.resolve(this.tempFolderPath, './inner.bat');

            //step 2: generate outter script
            const outterArray = [
                '@echo off',
                `call "${pathInnerScript}" > "${pathStdout}" 2> "${pathStderr}"`,
                `(echo %ERRORLEVEL) > "${pathStatus}"`
            ];
            fs.writeFileSync(pathOuterScript, outterArray.join('\r\n'), 'utf-8');

            //step 3: generate inner script
            let command = this.flashCommand.replace('$device', device).replace('$image', imagePath);
            const innerArray = [
                '@echo off',
                'chcp 65001>nul',
                command
            ];
            fs.writeFileSync(pathInnerScript, innerArray.join('\r\n'), 'utf-8');

            //step 4: generate powershell parameters
            const paramsArray = [
                'Start-Process',
                '-FilePath',
                `${pathOuterScript}`,
                '-WindowStyle hidden',
                '-Verb runAs'
            ];
            const child = spawn('powershell.exe', paramsArray);
            this.runningStatus = true;
            child.on('exit', (code) => {
                if(code !== 0 && !this.cancelTriggeredStatus){
                    cb('An error occurred while flashing');
                }
            })

            //step 5: check stderr file every second
            const readLoop = () => {
                if(this.finishedStatus || this.cancelStatus) return;
                setTimeout(() => {
                    try{
                        const result = fs.readFileSync(pathStderr, 'utf-8');
                        const lines = result.split('/s');
                        if(lines.length > 0) lines.pop();
                        if(lines.length > 0){
                            const line = lines.pop();
                            let progress = 0;
                            if(line.indexOf('bytes') > 0 && imgSize > 0){
                                const bytesStr = line.split('bytes')[0].trim();
                                if(Number.isInteger(parseInt(bytesStr)) && bytesStr.indexOf('out') < 0){
                                    progress = Math.floor(parseInt(bytesStr)*100/imgSize);
                                }
                                else{
                                    if(bytesStr.indexOf(imgSize.toString()) >= 0){
                                        this.finishedStatus = true;
                                        progress = 100;

                                        if(deleteFlag){
                                            fs.unlinkSync(imagePath);
                                            fs.unlinkSync(imagePath + '.xz')
                                        }

                                        setTimeout(() => {
                                            fs.rmSync(this.tempFolderPath, { recursive: true });
                                            this.tempFolderPath = '';
                                        }, 2000)
                                    }
                                }
                            }
                            if(!this.cancelStatus){
                                cb(undefined, progress, line + '/s', this.finishedStatus);
                            }
                        }
                        readLoop();
                    }
                    catch(e){
                        readLoop();
                    }
                    
                }, 1100)
            }
            readLoop();
        }

        cancelFlashing(cb){
            this.cancelTriggeredStatus = true;
            exec(this.cancelCommand, (err) => {
                if(err){
                    this.cancelTriggeredStatus = false;
                    cb(err);
                    return;
                }
                cb();
                if(this.tempFolderPath !== ''){
                    this.cancelStatus = true;
    
                    setTimeout(() => {
                        fs.rmSync(this.tempFolderPath, { recursive: true });
                        this.tempFolderPath = '';
                    }, 2000)
                }
            });
            
        }

        async saveNetworkConfig(device, networkConfig){
            const configFileName = 'rdk-system-config.txt';
            
            console.log('[FlashWindows] 开始保存网络配置');
            console.log('[FlashWindows] 设备路径:', device);
            console.log('[FlashWindows] 配置对象:', networkConfig);
            
            // 构建配置文件内容
            let configContent = '';
            Object.keys(networkConfig).forEach(key => {
                configContent += `${key}=${networkConfig[key]}\n`;
            });

            console.log('[FlashWindows] 配置文件内容:\n', configContent);

            // 先保存到临时目录（用于备份）
            const tempFolderPath = path.resolve(Config.pathResourcesGetter, `tempFolder-${Date.now()}`);
            fs.mkdirSync(tempFolderPath, { recursive: true });
            const tempConfigPath = path.resolve(tempFolderPath, configFileName);
            fs.writeFileSync(tempConfigPath, configContent, 'utf-8');
            console.log('[FlashWindows] 已备份到临时文件:', tempConfigPath);

            // 等待系统重新识别设备
            console.log('[FlashWindows] 等待3秒让系统重新识别设备...');
            await new Promise(resolve => setTimeout(resolve, 3000));

            // 调用平台特定的写入方法
            try {
                await this._writeConfigToTargetDevice(device, configFileName, configContent);
                console.log('[FlashWindows] 网络配置保存成功');
            } catch (error) {
                console.error('[FlashWindows] 保存失败:', error);
                throw error;
            }
        }

        async _writeConfigToTargetDevice(device, configFileName, configContent){
            const maxRetries = 3;
            let retryCount = 0;

            console.log('[FlashWindows] _writeConfigToTargetDevice 开始');
            console.log('[FlashWindows] 设备:', device);
            console.log('[FlashWindows] USB驱动命令:', this.usbDriveCommand);

            while (retryCount < maxRetries) {
                try {
                    console.log(`[FlashWindows] 尝试 ${retryCount + 1}/${maxRetries}`);
                    
                    // 查询USB设备盘符映射
                    const ret = execSync(this.usbDriveCommand);
                    const drives = ret.toString().trim().split('\n').filter(line => line.trim() !== '');
                    console.log('[FlashWindows] 查询到的驱动列表:', drives);

                    // 解析设备路径
                    const devStr = device.replace('/dev/', '');
                    console.log('[FlashWindows] 查找设备字符串:', devStr);
                    
                    const targetDrives = drives
                        .map(drive => {
                            const parts = drive.trim().split(/\s+/);
                            const driveLetter = parts[parts.length - 3];
                            const devPath = parts[parts.length - 1];
                            return { driveLetter, devPath };
                        })
                        .filter(drive => drive.devPath.indexOf(devStr) >= 0)
                        .sort((a, b) => {
                            // 优先选择 *1 分区（boot分区）
                            const aIsBoot = a.devPath.endsWith('1');
                            const bIsBoot = b.devPath.endsWith('1');
                            return (aIsBoot === bIsBoot) ? 0 : (aIsBoot ? -1 : 1);
                        });

                    console.log('[FlashWindows] 匹配到的目标驱动:', targetDrives);

                    if (targetDrives.length === 0) {
                        throw new Error(`未找到目标设备的盘符映射。设备: ${device}, 查找字符串: ${devStr}`);
                    }

                    // 选择第一个分区（通常是boot分区）
                    const targetDrive = targetDrives[0];
                    const targetPath = `${targetDrive.driveLetter}\\${configFileName}`;
                    console.log('[FlashWindows] 目标路径:', targetPath);

                    // 写入文件
                    const buffer = Buffer.from(configContent, 'utf-8');
                    const fd = fs.openSync(targetPath, 'w');
                    fs.writeSync(fd, buffer, 0, buffer.length, 0);
                    fs.fsyncSync(fd); // 强制刷新到磁盘
                    fs.closeSync(fd);
                    console.log('[FlashWindows] 文件写入完成');

                    // 校验文件
                    if (!fs.existsSync(targetPath)) {
                        throw new Error('文件写入后不存在');
                    }

                    const readBackContent = fs.readFileSync(targetPath, 'utf-8');
                    if (readBackContent !== configContent) {
                        console.error('[FlashWindows] 内容不匹配');
                        console.error('[FlashWindows] 期望:', configContent);
                        console.error('[FlashWindows] 实际:', readBackContent);
                        throw new Error('文件内容校验失败');
                    }

                    console.log('[FlashWindows] 文件校验成功');
                    return Promise.resolve();
                } catch (error) {
                    console.error(`[FlashWindows] 第 ${retryCount + 1} 次尝试失败:`, error.message);
                    retryCount++;
                    if (retryCount >= maxRetries) {
                        console.error('[FlashWindows] 所有重试都失败了');
                        return Promise.reject(error);
                    }
                    // 等待后重试
                    console.log('[FlashWindows] 等待2秒后重试...');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }

        async saveNetworkConfigToMountPoint(mountPoint, networkConfig){
            const configFileName = 'rdk-system-config.txt';
            
            console.log('[FlashWindows] 开始保存网络配置到挂载点');
            console.log('[FlashWindows] 挂载点:', mountPoint);
            console.log('[FlashWindows] 配置对象:', networkConfig);
            
            // 构建配置文件内容
            let configContent = '';
            Object.keys(networkConfig).forEach(key => {
                configContent += `${key}=${networkConfig[key]}\n`;
            });

            console.log('[FlashWindows] 配置文件内容:\n', configContent);

            // 先保存到临时目录（用于备份）
            const tempFolderPath = path.resolve(Config.pathResourcesGetter, `tempFolder-${Date.now()}`);
            fs.mkdirSync(tempFolderPath, { recursive: true });
            const tempConfigPath = path.resolve(tempFolderPath, configFileName);
            fs.writeFileSync(tempConfigPath, configContent, 'utf-8');
            console.log('[FlashWindows] 已备份到临时文件:', tempConfigPath);

            const targetPath = path.join(mountPoint, configFileName);
            console.log('[FlashWindows] 目标文件路径:', targetPath);

            // 检查挂载点是否存在
            if (!fs.existsSync(mountPoint)) {
                throw new Error(`挂载点不存在: ${mountPoint}`);
            }

            // 写入文件
            try {
                const buffer = Buffer.from(configContent, 'utf-8');
                const fd = fs.openSync(targetPath, 'w');
                fs.writeSync(fd, buffer, 0, buffer.length, 0);
                fs.fsyncSync(fd); // 强制刷新到磁盘
                fs.closeSync(fd);
                console.log('[FlashWindows] 文件写入完成');

                // 校验文件
                if (!fs.existsSync(targetPath)) {
                    throw new Error('文件写入后不存在');
                }

                const readBackContent = fs.readFileSync(targetPath, 'utf-8');
                if (readBackContent !== configContent) {
                    console.error('[FlashWindows] 内容不匹配');
                    console.error('[FlashWindows] 期望:', configContent);
                    console.error('[FlashWindows] 实际:', readBackContent);
                    throw new Error('文件内容校验失败');
                }

                console.log('[FlashWindows] 文件校验成功');
            } catch (error) {
                console.error('[FlashWindows] 写入文件失败:', error);
                throw error;
            }
        }

    }

    behavior = FlashWindows;
}
else if(Config.isMacGetter){
    class FlashMac extends FlashBase{
        constructor(){
            super();

            this.checkCommand = 'hash diskutil > /dev/null 2>&1 && hash dd > /dev/null 2>&1 && echo installed || echo uninstall';
            this.usbListCommand = 'diskutil list external | grep "/dev/" | awk \'{print $1}\'';

            this.getEnvCommand = '/usr/bin/env';
            this.unmountCommand = 'diskutil unmountdisk $device';
            this.flashCommand = '/bin/dd bs=4m of=$device if=$image status=progress 2> $output';
            this.cancelCommand = 'kill $pid';


            this.finishedStatus = false;
            this.cancelTriggeredStatus = false;
            this.cancelStatus = false;
            this.runningStatus = false;
            this.tempFolderPath = '';
            this.flashChild = undefined;
        }


        checkUSBDevices(){
            const ret = execSync(this.usbListCommand);
            return ret.toString().trim().split('\n')
                .filter((item) => item.trim() !== '') // 过滤掉空字符串
                .map((item) => {
                    return {
                        device: item,
                        name: item
                    }
                });
        }

        flashImage(device, imagePath, deleteFlag, cb){
            this.finishedStatus = false;
            this.cancelStatus = false;
            this.runningStatus = false;
            this.cancelTriggeredStatus = false;

            const options = {
                name: 'RDK Studio'
            };

            const imgInfo = fs.statSync(imagePath);
            const imgSize = imgInfo.size;

            this.tempFolderPath = path.resolve(Config.pathResourcesGetter, `tempFolder-${Date.now()}`);
            fs.mkdirSync(this.tempFolderPath);
            const pathStdout = path.resolve(this.tempFolderPath, './stdout.txt');
            const pathStderr = path.resolve(this.tempFolderPath, './stderr.txt');
            const pathStatus = path.resolve(this.tempFolderPath, './status.txt');

            const unmountCommand = this.unmountCommand.replace('$device', device);
            const rDevice = device.replace('/disk', '/rdisk')
            let command = this.flashCommand.replace('$device', rDevice).replace('$image', imagePath).replace('$output', pathStderr);

            exec(unmountCommand, (err, stdout) => {
                if(err){
                    console.log('unmount error: ', err);
                    return;
                }

                const ret = execSync(this.getEnvCommand);
                const pathList = ret.toString().split('\n').filter(env => env.indexOf('PATH=') === 0);
                if(pathList.length !== 1){
                    cb('An error occurred while flashing');
                    return;
                }
                const PATH = pathList[0].replace('PATH=', '');

                const askPath = this._getAskPassScriptPath();
                
                // 检查 askpass 文件是否存在
                if (!fs.existsSync(askPath)) {
                    console.error('[FlashMac] askpass 文件不存在:', askPath);
                    cb('An error occurred while flashing');
                    return;
                }
                
                console.log('before spawn: ', pathList[0])
                const child = spawn('sudo', ['--askpass', 'sh', '-c', command], {
                    env: {
                        SUDO_ASKPASS: askPath,
                        PATH: PATH
                    }
                });
                this.flashChild = child;
                this.runningStatus = true;
                child.stderr.on('data', (data) => {
                    console.log('spawn stderr: ', data.toString())
                })
                child.on('error', (err) => {
                    console.log('spawn error: ', err);
                })
                child.on('exit', (code) => {
                    this.runningStatus = false;
                    this.flashChild = undefined;
                    if(code !== 0 && !this.cancelTriggeredStatus){
                        cb('An error occurred while flashing');
                    }
                })
                
                const readLoop = () => {
                    if(this.finishedStatus || this.cancelStatus || !this.runningStatus) return;
                    
                    setTimeout(() => {
                        try{
                            const result = fs.readFileSync(pathStderr, 'utf-8');
                            const lines = result.split('/s');
                            if(lines.length > 0) lines.pop();
                            if(lines.length > 0){
                                const line = lines.pop();
                                let progress = 0;
                                if(line.indexOf('bytes') > 0 && imgSize > 0){
                                    const bytesStr = line.split('bytes')[0].trim();
                                    if(Number.isInteger(parseInt(bytesStr)) && bytesStr.indexOf('out') < 0){
                                        progress = Math.floor(parseInt(bytesStr)*100/imgSize);
                                    }
                                    else{
                                        if(bytesStr.indexOf(imgSize.toString()) >= 0){
                                            this.finishedStatus = true;
                                            progress = 100;
    
                                            if(deleteFlag){
                                                fs.unlinkSync(imagePath);
                                                fs.unlinkSync(imagePath + '.xz')
                                            }
    
                                            setTimeout(() => {
                                                fs.rmSync(this.tempFolderPath, { recursive: true });
                                                this.tempFolderPath = '';
                                            }, 2000)
                                        }
                                    }
                                }
                                if(!this.cancelStatus){
                                    cb(undefined, progress, line + '/s', this.finishedStatus);
                                }
                            }
                            readLoop();
                        }
                        catch(e){
                            readLoop();
                        }
                        
                    }, 1100)
                }
                readLoop();
            })
        }

        cancelFlashing(cb){
            this.cancelTriggeredStatus = true;
            if(this.flashChild && this.flashChild.pid){
                const options = {
                    name: 'RDK Studio'
                };
                const command = this.cancelCommand.replace('$pid', this.flashChild.pid.toString());
                sudo.exec(command, options, (err) => {
                    if(err) {
                        this.cancelTriggeredStatus = false;
                        cb(err);
                        return;
                    };
                    cb();
                    this.flashChild = undefined;
                    if(this.tempFolderPath !== ''){
                        this.cancelStatus = true;
        
                        setTimeout(() => {
                            fs.rmSync(this.tempFolderPath, { recursive: true });
                            this.tempFolderPath = '';
                        }, 2000)
                    }
                });
            }
            
        }

        async saveNetworkConfig(device, networkConfig){
            const configFileName = 'rdk-system-config.txt';
            
            console.log('[FlashMac] 开始保存网络配置');
            console.log('[FlashMac] 设备路径:', device);
            console.log('[FlashMac] 配置对象:', networkConfig);
            
            // 构建配置文件内容
            let configContent = '';
            Object.keys(networkConfig).forEach(key => {
                configContent += `${key}=${networkConfig[key]}\n`;
            });

            console.log('[FlashMac] 配置文件内容:\n', configContent);

            // 先保存到临时目录（用于备份）
            const tempFolderPath = path.resolve(Config.pathResourcesGetter, `tempFolder-${Date.now()}`);
            fs.mkdirSync(tempFolderPath, { recursive: true });
            const tempConfigPath = path.resolve(tempFolderPath, configFileName);
            fs.writeFileSync(tempConfigPath, configContent, 'utf-8');
            console.log('[FlashMac] 已备份到临时文件:', tempConfigPath);

            // 等待系统重新识别设备
            console.log('[FlashMac] 等待3秒让系统重新识别设备...');
            await new Promise(resolve => setTimeout(resolve, 3000));

            // 调用平台特定的写入方法
            try {
                await this._writeConfigToTargetDevice(device, configFileName, configContent);
                console.log('[FlashMac] 网络配置保存成功');
            } catch (error) {
                console.error('[FlashMac] 保存失败:', error);
                throw error;
            }
        }

        async _writeConfigToTargetDevice(device, configFileName, configContent){
            const maxRetries = 3;
            let retryCount = 0;

            console.log('[FlashMac] _writeConfigToTargetDevice 开始');
            console.log('[FlashMac] 设备:', device);

            while (retryCount < maxRetries) {
                try {
                    console.log(`[FlashMac] 尝试 ${retryCount + 1}/${maxRetries}`);
                    
                    // 从设备路径提取磁盘号（如 /dev/disk2 -> 2）
                    const diskMatch = device.match(/\/dev\/disk(\d+)/);
                    if (!diskMatch) {
                        throw new Error(`无法解析设备路径: ${device}`);
                    }
                    const diskNum = diskMatch[1];
                    console.log('[FlashMac] 磁盘号:', diskNum);

                    // 查询第一个分区的挂载点
                    console.log('[FlashMac] 查询分区信息...');
                    let mountOutput = execSync(`diskutil info disk${diskNum}s1`).toString();
                    console.log('[FlashMac] diskutil 输出:', mountOutput);
                    
                    // 优先通过 Volume Name 查找挂载点（更可靠）
                    let mountPoint = null;
                    const volumeMatch = mountOutput.match(/Volume Name:\s+(.+)/);
                    if (volumeMatch) {
                        const volumeName = volumeMatch[1].trim();
                        const potentialMountPoint = `/Volumes/${volumeName}`;
                        console.log('[FlashMac] 找到 Volume Name:', volumeName);
                        console.log('[FlashMac] 尝试挂载点:', potentialMountPoint);
                        
                        if (fs.existsSync(potentialMountPoint)) {
                            mountPoint = potentialMountPoint;
                            console.log('[FlashMac] 通过 Volume Name 找到挂载点:', mountPoint);
                        } else {
                            console.log('[FlashMac] Volume Name 对应的路径不存在，尝试挂载...');
                            // 尝试挂载
                            try {
                                execSync(`diskutil mount disk${diskNum}s1`);
                                // 挂载后再次检查
                                if (fs.existsSync(potentialMountPoint)) {
                                    mountPoint = potentialMountPoint;
                                    console.log('[FlashMac] 挂载后找到挂载点:', mountPoint);
                                }
                            } catch (mountError) {
                                console.error('[FlashMac] 挂载失败:', mountError.message);
                            }
                        }
                    }
                    
                    // 如果 Volume Name 方法失败，尝试从 Mount Point 解析（但要过滤系统路径）
                    if (!mountPoint) {
                        console.log('[FlashMac] Volume Name 方法失败，尝试解析 Mount Point...');
                        let mountMatch = mountOutput.match(/Mount Point:\s+(.+)/);
                        let parsedMountPoint = mountMatch ? mountMatch[1].trim() : null;
                        
                        // 过滤系统路径
                        if (parsedMountPoint && 
                            parsedMountPoint.startsWith('/Volumes/') && 
                            !parsedMountPoint.includes('iSCPreboot') && 
                            !parsedMountPoint.includes('System') &&
                            !parsedMountPoint.includes('Preboot')) {
                            mountPoint = parsedMountPoint;
                            console.log('[FlashMac] 从 Mount Point 解析到挂载点:', mountPoint);
                        } else {
                            console.log('[FlashMac] Mount Point 是系统路径，已过滤:', parsedMountPoint);
                        }
                    }
                    
                    // 如果还是找不到，尝试列出 /Volumes 下的所有挂载点
                    if (!mountPoint) {
                        console.log('[FlashMac] 尝试列出 /Volumes 下的所有挂载点...');
                        try {
                            const volumes = fs.readdirSync('/Volumes');
                            console.log('[FlashMac] /Volumes 下的目录:', volumes);
                            
                            // 查找最近修改的挂载点（可能是刚插入的设备）
                            let latestMount = null;
                            let latestTime = 0;
                            for (const vol of volumes) {
                                const volPath = `/Volumes/${vol}`;
                                try {
                                    const stats = fs.statSync(volPath);
                                    if (stats.isDirectory() && stats.mtimeMs > latestTime) {
                                        // 检查是否是系统卷（排除系统卷）
                                        if (!vol.startsWith('.') && 
                                            vol !== 'Macintosh HD' && 
                                            vol !== 'Macintosh HD - Data') {
                                            latestTime = stats.mtimeMs;
                                            latestMount = volPath;
                                        }
                                    }
                                } catch (e) {
                                    // 忽略无法访问的目录
                                }
                            }
                            
                            if (latestMount) {
                                mountPoint = latestMount;
                                console.log('[FlashMac] 通过最近修改时间找到挂载点:', mountPoint);
                            }
                        } catch (e) {
                            console.error('[FlashMac] 无法读取 /Volumes:', e);
                        }
                    }
                    
                    console.log('[FlashMac] 最终使用的挂载点:', mountPoint);

                    // 如果挂载点是系统路径，强制忽略并使用 Volume Name
                    if (mountPoint && (mountPoint.includes('iSCPreboot') || mountPoint.includes('System') || mountPoint.includes('Preboot'))) {
                        console.log('[FlashMac] 检测到系统路径，忽略:', mountPoint);
                        mountPoint = null;
                    }

                    // 如果未挂载或挂载点是系统路径，尝试挂载
                    if (!mountPoint || mountPoint === '' || !mountPoint.startsWith('/Volumes/')) {
                        console.log('[FlashMac] 分区未挂载或挂载点无效，尝试挂载...');
                        try {
                            execSync(`diskutil mount disk${diskNum}s1`);
                            // 挂载后重新查询 Volume Name
                            mountOutput = execSync(`diskutil info disk${diskNum}s1`).toString();
                            const volumeMatchAfterMount = mountOutput.match(/Volume Name:\s+(.+)/);
                            if (volumeMatchAfterMount) {
                                const volumeNameAfterMount = volumeMatchAfterMount[1].trim();
                                const potentialMountPointAfterMount = `/Volumes/${volumeNameAfterMount}`;
                                if (fs.existsSync(potentialMountPointAfterMount)) {
                                    mountPoint = potentialMountPointAfterMount;
                                    console.log('[FlashMac] 挂载后通过 Volume Name 找到挂载点:', mountPoint);
                                }
                            }
                        } catch (mountError) {
                            console.error('[FlashMac] 挂载失败:', mountError.message);
                        }
                    }

                    // 最终验证：挂载点必须是 /Volumes/ 下的有效路径
                    if (!mountPoint || !mountPoint.startsWith('/Volumes/')) {
                        throw new Error(`无法找到有效的设备挂载点。当前挂载点: ${mountPoint || 'null'}。请确保设备已正确挂载到 /Volumes/ 目录下。`);
                    }

                    let targetPath = path.join(mountPoint, configFileName);
                    console.log('[FlashMac] 目标文件路径:', targetPath);

                    // 检查挂载点是否存在
                    if (!fs.existsSync(mountPoint)) {
                        throw new Error(`挂载点不存在: ${mountPoint}`);
                    }

                    // 检查文件系统信息
                    console.log('[FlashMac] 检查文件系统状态...');
                    let fsInfo = execSync(`diskutil info disk${diskNum}s1`).toString();
                    const readOnlyMatch = fsInfo.match(/Read-Only Media:\s+(.+)/);
                    const isReadOnly = readOnlyMatch && readOnlyMatch[1].trim() === 'Yes';
                    const fileSystemMatch = fsInfo.match(/File System Personality:\s+(.+)/);
                    const fileSystem = fileSystemMatch ? fileSystemMatch[1].trim() : 'Unknown';
                    console.log('[FlashMac] 文件系统只读状态:', isReadOnly);
                    console.log('[FlashMac] 文件系统类型:', fileSystem);
                    
                    // 先写入到临时文件
                    const tmpdir = require('os').tmpdir;
                    const tempFile = path.join(tmpdir(), `rdk-config-${Date.now()}.txt`);
                    fs.writeFileSync(tempFile, configContent, 'utf-8');
                    console.log('[FlashMac] 已写入临时文件:', tempFile);
                    console.log('[FlashMac] 目标路径:', targetPath);

                    // 尝试多种方法写入文件
                    const options = {
                        name: 'RDK Studio'
                    };
                    
                    // 方法1: 尝试直接通过挂载点写入（如果文件系统支持）
                    let command = '';
                    let method = '';
                    
                    // 对于 FAT32 等文件系统，可能需要特殊处理
                    if (fileSystem.includes('FAT') || fileSystem.includes('MS-DOS')) {
                        console.log('[FlashMac] 检测到 FAT 文件系统，尝试特殊处理...');
                        // FAT32 文件系统在 macOS 上可能需要先卸载再写入
                        method = 'fat32';
                        command = `diskutil unmount disk${diskNum}s1 && sleep 1 && dd if="${tempFile}" of=/dev/rdisk${diskNum}s1 bs=512 seek=0 conv=notrunc && diskutil mount disk${diskNum}s1 && sleep 1`;
                    } else {
                        // 其他文件系统，尝试重新挂载为可写
                        method = 'normal';
                        if (isReadOnly) {
                            console.log('[FlashMac] 文件系统是只读的，将以可写方式重新挂载并写入文件...');
                            command = `diskutil unmount disk${diskNum}s1 && sleep 1 && diskutil mount -writable disk${diskNum}s1 && sleep 2 && cp "${tempFile}" "${targetPath}" && chmod 644 "${targetPath}" && sync`;
                        } else {
                            console.log('[FlashMac] 使用 sudo 权限写入文件...');
                            // 先尝试卸载再挂载为可写，然后使用 tee 写入
                            // tee 命令通常能更好地处理权限问题
                            // 注意：sudo-prompt 已经帮我们以 sudo 运行命令，这里的命令本身不能再带 sudo 前缀
                            command = `diskutil unmount disk${diskNum}s1 2>/dev/null; diskutil mount -writable disk${diskNum}s1 && sleep 1 && cat "${tempFile}" | tee "${targetPath}" > /dev/null && chmod 644 "${targetPath}" && sync`;
                        }
                    }
                    
                    console.log('[FlashMac] 使用方法:', method);
                    console.log('[FlashMac] 执行命令:', command);
                    
                    await new Promise((resolve, reject) => {
                        sudo.exec(command, options, (error, stdout, stderr) => {
                            // 清理临时文件
                            try {
                                if (fs.existsSync(tempFile)) {
                                    fs.unlinkSync(tempFile);
                                }
                            } catch (e) {
                                console.warn('[FlashMac] 清理临时文件失败:', e);
                            }
                            
                            if (error) {
                                console.error('[FlashMac] sudo 执行失败:', error);
                                console.error('[FlashMac] stdout:', stdout);
                                console.error('[FlashMac] stderr:', stderr);
                                
                                // 如果方法1失败，尝试备用方法
                                if (method === 'normal' && !isReadOnly) {
                                    console.log('[FlashMac] 方法1失败，尝试备用方法...');
                                    // 备用方法：使用 Python 脚本写入
                                    const fallbackCommand = `python3 -c "import shutil; shutil.copy('${tempFile}', '${targetPath}')"`;
                                    console.log('[FlashMac] 备用命令:', fallbackCommand);
                                    // 这里不继续尝试，直接返回错误
                                }
                                
                                reject(new Error(`使用 sudo 写入文件失败: ${error.message || error}`));
                                return;
                            }
                            
                            console.log('[FlashMac] sudo 执行成功');
                            if (stdout) console.log('[FlashMac] stdout:', stdout);
                            if (stderr) console.log('[FlashMac] stderr:', stderr);
                            
                            // 如果重新挂载了，需要更新挂载点
                            if (method === 'normal' && isReadOnly) {
                                try {
                                    mountOutput = execSync(`diskutil info disk${diskNum}s1`).toString();
                                    const volumeMatchAfterRemount = mountOutput.match(/Volume Name:\s+(.+)/);
                                    if (volumeMatchAfterRemount) {
                                        const volumeNameAfterRemount = volumeMatchAfterRemount[1].trim();
                                        const newMountPoint = `/Volumes/${volumeNameAfterRemount}`;
                                        if (fs.existsSync(newMountPoint)) {
                                            mountPoint = newMountPoint;
                                            targetPath = path.join(mountPoint, configFileName);
                                            console.log('[FlashMac] 重新挂载后的挂载点:', mountPoint);
                                        }
                                    }
                                } catch (e) {
                                    console.warn('[FlashMac] 更新挂载点失败:', e);
                                }
                            }
                            
                            resolve();
                        });
                    });
                    
                    // 验证文件
                    if (!fs.existsSync(targetPath)) {
                        throw new Error('文件写入后不存在');
                    }

                    const readBackContent = fs.readFileSync(targetPath, 'utf-8');
                    if (readBackContent !== configContent) {
                        console.error('[FlashMac] 内容不匹配');
                        console.error('[FlashMac] 期望:', configContent);
                        console.error('[FlashMac] 实际:', readBackContent);
                        throw new Error('文件内容校验失败');
                    }

                    console.log('[FlashMac] 文件校验成功');
                    return Promise.resolve();
                } catch (error) {
                    console.error(`[FlashMac] 第 ${retryCount + 1} 次尝试失败:`, error.message);
                    retryCount++;
                    if (retryCount >= maxRetries) {
                        console.error('[FlashMac] 所有重试都失败了');
                        return Promise.reject(error);
                    }
                    // 等待后重试
                    console.log('[FlashMac] 等待2秒后重试...');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }

        async saveNetworkConfigToMountPoint(mountPoint, networkConfig){
            const configFileName = 'rdk-system-config.txt';
            
            console.log('[FlashMac] 开始保存网络配置到挂载点');
            console.log('[FlashMac] 挂载点:', mountPoint);
            console.log('[FlashMac] 配置对象:', networkConfig);
            
            // 构建配置文件内容
            let configContent = '';
            Object.keys(networkConfig).forEach(key => {
                configContent += `${key}=${networkConfig[key]}\n`;
            });

            console.log('[FlashMac] 配置文件内容:\n', configContent);

            // 先保存到临时目录（用于备份）
            const tempFolderPath = path.resolve(Config.pathResourcesGetter, `tempFolder-${Date.now()}`);
            fs.mkdirSync(tempFolderPath, { recursive: true });
            const tempConfigPath = path.resolve(tempFolderPath, configFileName);
            fs.writeFileSync(tempConfigPath, configContent, 'utf-8');
            console.log('[FlashMac] 已备份到临时文件:', tempConfigPath);

            const targetPath = path.join(mountPoint, configFileName);
            console.log('[FlashMac] 目标文件路径:', targetPath);

            // 检查挂载点是否存在
            if (!fs.existsSync(mountPoint)) {
                throw new Error(`挂载点不存在: ${mountPoint}`);
            }

            // 直接使用 Node.js fs 模块写入挂载点（不再通过外部 cp 命令）
            try {
                const buffer = Buffer.from(configContent, 'utf-8');
                const fd = fs.openSync(targetPath, 'w');
                fs.writeSync(fd, buffer, 0, buffer.length, 0);
                fs.fsyncSync(fd);
                fs.closeSync(fd);
                console.log('[FlashMac] 文件写入完成');
            } catch (error) {
                console.error('[FlashMac] 使用 fs 写入文件失败:', error);
                throw error;
            }
            
            // 验证文件
            if (!fs.existsSync(targetPath)) {
                throw new Error('文件写入后不存在');
            }

            const readBackContent = fs.readFileSync(targetPath, 'utf-8');
            if (readBackContent !== configContent) {
                console.error('[FlashMac] 内容不匹配');
                console.error('[FlashMac] 期望:', configContent);
                console.error('[FlashMac] 实际:', readBackContent);
                throw new Error('文件内容校验失败');
            }

            console.log('[FlashMac] 文件校验成功');
        }

        _getAskPassScriptPath(){
            let lang = Intl.DateTimeFormat().resolvedOptions().locale;
		    lang = lang.substr(0, 2);

            return path.resolve(Config.pathResourcesGetter, `./flash/darwin/arm64/sudo-askpass.osascript-${lang}.js`);
        }
    }

    behavior = FlashMac;
}
else if(Config.isLinuxGetter){
    const accessSync = require('fs').accessSync;
    const constants = require('fs').constants;
    const tmpdir = require('os').tmpdir;

    class FlashLinux extends FlashBase{
        constructor(){
            super();

            this.checkCommand = 'hash lsblk > /dev/null 2>&1 && hash dd > /dev/null 2>&1 && echo installed || echo uninstall';
            this.usbListCommand = `lsblk -d -o name,rm,size | awk '$2 == 1 && $3 > "0B"'`;

            this.getEnvCommand = '/usr/bin/env';
            this.unmountCommand = 'umount $device';
            this.flashCommand = 'dd bs=4M of=$device if=$image conv=fsync oflag=direct status=progress 2> $output';
            this.cancelCommand = 'kill $pid';
        }

        checkUSBDevices(){
            const ret = execSync(this.usbListCommand);
            const deviceStrs = ret.toString().trim().split('\n');
            const names = deviceStrs.map((deviceStr) => {
                const name = '/dev/' + deviceStr.trim().split(/\s+/).shift();
                return {
                    device: name,
                    name: name
                }
            })
            return names;
        }

        flashImage(device, imagePath, deleteFlag, cb){
            this.finishedStatus = false;
            this.cancelStatus = false;
            this.runningStatus = false;
            this.cancelTriggeredStatus = false;

            const options = {
                name: 'RDK Studio'
            };

            const imgInfo = fs.statSync(imagePath);
            const imgSize = imgInfo.size;

            this.tempFolderPath = path.resolve(tmpdir(), `tempFolder-${Date.now()}`);
            fs.mkdirSync(this.tempFolderPath);
            const pathStdout = path.resolve(this.tempFolderPath, './stdout.txt');
            const pathStderr = path.resolve(this.tempFolderPath, './stderr.txt');
            const pathStatus = path.resolve(this.tempFolderPath, './status.txt');

            const unmountCommand = this.unmountCommand.replace('$device', device);
            let command = this.flashCommand.replace('$device', device).replace('$image', imagePath).replace('$output', pathStderr);

            exec(unmountCommand, (err, stdout) => {
                if(err){
                    console.log('unmount error: ', err);
                    //ignore umount error
                }

                const ret = execSync(this.getEnvCommand);
                const pathList = ret.toString().split('\n').filter(env => env.indexOf('PATH=') === 0);
                if(pathList.length !== 1){
                    cb('An error occurred while flashing');
                    return;
                }
                const PATH = pathList[0].replace('PATH=', '');

                const paths = ['/usr/bin/kdesudo', '/usr/bin/pkexec'];
                let sudoBin = '';
                for (const path of paths) {
                    try {
                        // check if the file exist and is executable
                        accessSync(path, constants.X_OK);
                        sudoBin = path;
                    } catch (error) {
                        continue;
                    }
                }

                if(sudoBin === ''){
                    cb('Sudo binary was not found!');
                    return;
                }


                const parameters = [];

                if (/kdesudo/i.test(sudoBin)) {
                    parameters.push(
                        '--comment',
                        "RDK Studio wants to make changes.Enter your password to allow this.",
                    );
                    parameters.push('-d'); // Do not show the command to be run in the dialog.
                    parameters.push('--');
                } else if (/pkexec/i.test(sudoBin)) {
                    parameters.push('--disable-internal-agent');
                }

                parameters.push('/bin/bash');
                parameters.push('-c');
                parameters.push(command)

                const child = spawn(sudoBin, parameters, {
                    env: {
                        PATH: PATH
                    }
                })

                this.flashChild = child;
                this.runningStatus = true;
                child.stderr.on('data', (data) => {
                    console.log('spawn stderr: ', data.toString())
                })
                child.on('error', (err) => {
                    console.log('spawn error: ', err);
                })
                child.on('exit', (code) => {
                    this.runningStatus = false;
                    this.flashChild = undefined;
                    if(code !== 0 && !this.cancelTriggeredStatus){
                        cb('An error occurred while flashing');
                    }
                })

                const readLoop = () => {
                    if(this.finishedStatus || this.cancelStatus || !this.runningStatus) return;
                    
                    setTimeout(() => {
                        try{
                            const result = fs.readFileSync(pathStderr, 'utf-8');
                            const lines = result.split('/s');
                            if(lines.length > 0) lines.pop();
                            if(lines.length > 0){
                                const line = lines.pop();
                                let progress = 0;
                                if(line.indexOf('bytes') > 0 && imgSize > 0){
                                    const bytesStr = line.split('bytes')[0].trim();
                                    if(Number.isInteger(parseInt(bytesStr)) && bytesStr.indexOf('out') < 0){
                                        progress = Math.floor(parseInt(bytesStr)*100/imgSize);
                                    }
                                    else{
                                        if(bytesStr.indexOf(imgSize.toString()) >= 0){
                                            this.finishedStatus = true;
                                            progress = 100;
    
                                            if(deleteFlag){
                                                fs.unlinkSync(imagePath);
                                                fs.unlinkSync(imagePath + '.xz')
                                            }
    
                                            setTimeout(() => {
                                                fs.rmSync(this.tempFolderPath, { recursive: true });
                                                this.tempFolderPath = '';
                                            }, 2000)
                                        }
                                    }
                                }
                                if(!this.cancelStatus){
                                    cb(undefined, progress, line + '/s', this.finishedStatus);
                                }
                            }
                            readLoop();
                        }
                        catch(e){
                            readLoop();
                        }
                        
                    }, 1100)
                }
                readLoop();
            })
        }

        cancelFlashing(cb){
            this.cancelTriggeredStatus = true;
            if(this.flashChild && this.flashChild.pid){
                const options = {
                    name: 'RDK Studio'
                };
                const command = this.cancelCommand.replace('$pid', this.flashChild.pid.toString());
                sudo.exec(command, options, (err) => {
                    if(err) {
                        this.cancelTriggeredStatus = false;
                        cb(err);
                        return;
                    };
                    cb();
                    this.flashChild = undefined;
                    if(this.tempFolderPath !== ''){
                        this.cancelStatus = true;
        
                        setTimeout(() => {
                            fs.rmSync(this.tempFolderPath, { recursive: true });
                            this.tempFolderPath = '';
                        }, 2000)
                    }
                });
            }
            
        }

        async saveNetworkConfig(device, networkConfig){
            const configFileName = 'rdk-system-config.txt';
            
            // 构建配置文件内容
            let configContent = '';
            Object.keys(networkConfig).forEach(key => {
                configContent += `${key}=${networkConfig[key]}\n`;
            });

            // 先保存到临时目录（用于备份）
            const tempFolderPath = path.resolve(Config.pathResourcesGetter, `tempFolder-${Date.now()}`);
            fs.mkdirSync(tempFolderPath, { recursive: true });
            const tempConfigPath = path.resolve(tempFolderPath, configFileName);
            fs.writeFileSync(tempConfigPath, configContent, 'utf-8');

            // 等待系统重新识别设备
            await new Promise(resolve => setTimeout(resolve, 3000));

            // 调用平台特定的写入方法
            return await this._writeConfigToTargetDevice(device, configFileName, configContent);
        }

        async _writeConfigToTargetDevice(device, configFileName, configContent){
            const maxRetries = 5;
            let retryCount = 0;
            const tmpdir = require('os').tmpdir;
            const accessSync = require('fs').accessSync;
            const constants = require('fs').constants;

            // 查找sudo二进制文件
            const paths = ['/usr/bin/kdesudo', '/usr/bin/pkexec'];
            let sudoBin = '';
            for (const sudoPath of paths) {
                try {
                    accessSync(sudoPath, constants.X_OK);
                    sudoBin = sudoPath;
                    break;
                } catch (error) {
                    continue;
                }
            }

            if (sudoBin === '') {
                return Promise.reject(new Error('未找到sudo二进制文件'));
            }

            while (retryCount < maxRetries) {
                try {
                    // 获取第一个分区路径
                    const partition1 = device.replace(/[^0-9]+$/, '') + '1';
                    
                    // 查询挂载点
                    let mountOutput = execSync(`lsblk -no MOUNTPOINT ${partition1}`).toString().trim();
                    let mountPoint = mountOutput || null;

                    // 如果未挂载，创建临时挂载点并挂载
                    if (!mountPoint) {
                        const tempMountPoint = path.join(tmpdir(), `rdk-flash-mount-${Date.now()}`);
                        fs.mkdirSync(tempMountPoint, { recursive: true });
                        execSync(`${sudoBin} mount ${partition1} ${tempMountPoint}`);
                        mountPoint = tempMountPoint;
                    }

                    const targetPath = path.join(mountPoint, configFileName);

                    // 使用sudo写入文件
                    const tempConfigPath = path.join(tmpdir(), configFileName);
                    fs.writeFileSync(tempConfigPath, configContent, 'utf-8');
                    execSync(`${sudoBin} cp ${tempConfigPath} ${targetPath}`);
                    execSync(`${sudoBin} sync`); // 确保数据写入磁盘
                    fs.unlinkSync(tempConfigPath);

                    // 校验文件
                    if (!fs.existsSync(targetPath)) {
                        throw new Error('文件写入后不存在');
                    }

                    const readBackContent = fs.readFileSync(targetPath, 'utf-8');
                    if (readBackContent !== configContent) {
                        throw new Error('文件内容校验失败');
                    }

                    return Promise.resolve();
                } catch (error) {
                    retryCount++;
                    if (retryCount >= maxRetries) {
                        return Promise.reject(error);
                    }
                    // 等待后重试
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }

        async saveNetworkConfigToMountPoint(mountPoint, networkConfig){
            const configFileName = 'rdk-system-config.txt';
            
            console.log('[FlashLinux] 开始保存网络配置到挂载点');
            console.log('[FlashLinux] 挂载点:', mountPoint);
            console.log('[FlashLinux] 配置对象:', networkConfig);
            
            // 构建配置文件内容
            let configContent = '';
            Object.keys(networkConfig).forEach(key => {
                configContent += `${key}=${networkConfig[key]}\n`;
            });

            console.log('[FlashLinux] 配置文件内容:\n', configContent);

            // 先保存到临时目录（用于备份）
            const tempFolderPath = path.resolve(Config.pathResourcesGetter, `tempFolder-${Date.now()}`);
            fs.mkdirSync(tempFolderPath, { recursive: true });
            const tempConfigPath = path.resolve(tempFolderPath, configFileName);
            fs.writeFileSync(tempConfigPath, configContent, 'utf-8');
            console.log('[FlashLinux] 已备份到临时文件:', tempConfigPath);

            const targetPath = path.join(mountPoint, configFileName);
            console.log('[FlashLinux] 目标文件路径:', targetPath);

            // 检查挂载点是否存在
            if (!fs.existsSync(mountPoint)) {
                throw new Error(`挂载点不存在: ${mountPoint}`);
            }

            // 查找sudo二进制文件
            const accessSync = require('fs').accessSync;
            const constants = require('fs').constants;
            const paths = ['/usr/bin/kdesudo', '/usr/bin/pkexec'];
            let sudoBin = '';
            for (const sudoPath of paths) {
                try {
                    accessSync(sudoPath, constants.X_OK);
                    sudoBin = sudoPath;
                    break;
                } catch (error) {
                    continue;
                }
            }

            if (sudoBin === '') {
                throw new Error('未找到sudo二进制文件');
            }

            // 使用sudo写入文件
            try {
                const tmpdir = require('os').tmpdir;
                const tempConfigPath = path.join(tmpdir(), `rdk-config-${Date.now()}.txt`);
                fs.writeFileSync(tempConfigPath, configContent, 'utf-8');
                
                // 使用sudo复制文件
                execSync(`${sudoBin} cp "${tempConfigPath}" "${targetPath}"`);
                execSync(`${sudoBin} sync`); // 确保数据写入磁盘
                
                // 清理临时文件
                fs.unlinkSync(tempConfigPath);
                
                console.log('[FlashLinux] 文件写入完成');

                // 校验文件
                if (!fs.existsSync(targetPath)) {
                    throw new Error('文件写入后不存在');
                }

                const readBackContent = fs.readFileSync(targetPath, 'utf-8');
                if (readBackContent !== configContent) {
                    console.error('[FlashLinux] 内容不匹配');
                    console.error('[FlashLinux] 期望:', configContent);
                    console.error('[FlashLinux] 实际:', readBackContent);
                    throw new Error('文件内容校验失败');
                }

                console.log('[FlashLinux] 文件校验成功');
            } catch (error) {
                console.error('[FlashLinux] 写入文件失败:', error);
                throw error;
            }
        }
    }

    behavior = FlashLinux;
}

export {
    behavior as FlashBehavior
}
