import {
    MESSAGE_OPEN_URL
} from '@/constants/AppMessageNames';

import {
    GlobalConfig
} from '@/global_configuration/GlobalConfig.js'
const Config = GlobalConfig.getInstance();

const Client = require('ssh2').Client;

const CheckCommand = {
    'node-red': "export NVM_DIR=\"$HOME/.nvm\" && [ -s \"$NVM_DIR/nvm.sh\" ] && \\. \"$NVM_DIR/nvm.sh\" && hash node-red > /dev/null 2>&1 && echo installed || echo uninstall",
    'jupyter': "export PATH=\"$HOME/.local/bin:$PATH\" && hash jupyter > /dev/null 2>&1 && echo installed || echo uninstall",
    'code-server': "hash code-server > /dev/null 2>&1 && echo installed || echo uninstall"
}
const LaunchCommand = {
    'node-red': "export NVM_DIR=\"$HOME/.nvm\" && [ -s \"$NVM_DIR/nvm.sh\" ] && \\. \"$NVM_DIR/nvm.sh\" && echo $PATH && node-red ",
    'jupyter': "export PATH=\"$HOME/.local/bin:$PATH\" && jupyter notebook $path --no-browser --ip='0.0.0.0' --port=8888 --allow-root ",
    'code-server': "code-server $path --auth none --bind-addr 0.0.0.0:9888 --ignore-last-opened "
}
const LaunchCommandHTTPS = {
    'node-red': "export NVM_DIR=\"$HOME/.nvm\" && [ -s \"$NVM_DIR/nvm.sh\" ] && \\. \"$NVM_DIR/nvm.sh\" && echo $PATH && node-red --settings $settings",
    'jupyter': "",
    'code-server': ""
}

class ManageRemoteApp{
    constructor(){

    }

    installExample(device, example, cb){
        const assembledOptions = {
            host: device.ip,
            port: 22,
            username: device.userName,
            password: device.userName,
            readyTimeout: 5000
        };

        const queue = Array.from(example.install);
        this._runTaskQueue(assembledOptions, queue, (err, flag) => {
            if(err){
                cb(err);
                return;
            }
            cb(undefined, flag);
        });
    }

    _runTaskQueue(options, queue, cb){
        if(queue.length === 0){
            cb(undefined, true);
            return;
        }

        const command = queue.shift();
        const connection = new Client();
        let flag = true;
        connection.on('ready', () => {
            connection.exec(command, (err, stream) => {
                if(err){
                    cb(err);
                    return;
                }
                stream.on('close', () => {
                    console.log('example closed')
                    connection.end();
                    if(flag){
                        this._runTaskQueue(options, queue, cb);
                    }
                }).on('data', (data) => {
                    console.log(data.toString())
                }).on('end', () => {
                    console.log('example ended')
                }).stderr.on('data', (data) => {
                    console.log('example stderr: ', data.toString());
                })
            })
        }).on('error', (err) => {
            flag = false;
            cb(err);
        }).connect(options);
    }

    checkAppInstallation(appName, device, cb){
        const assembledOptions = {
            host: device.ip,
            port: 22,
            username: device.userName,
            password: device.userName,
            readyTimeout: 5000
        };

        const command = CheckCommand[appName];
        const keyword = 'uninstall';

        const connection = new Client();
        connection.on('ready', () => {
            connection.exec(command, (err, stream) => {
                if(err){
                    cb(err);
                }
    
                stream.on('close', () => {
                    connection.end();
                }).on('data', (data) => {
                    console.log(app.name, data.toString(), data.toString().trim() === keyword);
                    if(data.toString().trim() === keyword){
                        cb(undefined, false);
                    }
                    else{
                        cb(undefined, true);
                    }
                }).on('end', () => {
    
                })
            })
            
        }).on('error', (err) => {
            cb(err);
        }).connect(assembledOptions);
    }

    checkExampleInstallation(device, example, cb){
        const assembledOptions = {
            host: device.ip,
            port: 22,
            username: device.userName,
            password: device.userName,
            readyTimeout: 5000
        };

        const command = example.check.replace('$type', device.deviceType);
        const keyword = 'uninstall';

        const connection = new Client();
        connection.on('ready', () => {
            connection.exec(command, (err, stream) => {
                if(err){
                    cb(err);
                }
    
                stream.on('close', () => {
                    connection.end();
                }).on('data', (data) => {
                    console.log(command, data.toString(), data.toString().trim() === keyword);
                    if(data.toString().trim() === keyword){
                        cb(undefined, false);
                    }
                    else{
                        cb(undefined, true);
                    }
                }).on('end', () => {
    
                })
            })
            
        }).on('error', (err) => {
            cb(err);
        }).connect(assembledOptions);
    }

    launchApp(appName, device, appObject, appPath, cb, needsHttps=false, settingsFile=''){
    
        if(appObject?.connection){
            this._openAppWebPage(appObject, device);
        }
        else{
            let launchCommand = LaunchCommand[appName];
            if(needsHttps){
                launchCommand = LaunchCommandHTTPS[appName];
            }

            console.log(launchCommand)
            if(launchCommand.indexOf('$path') >= 0){
                launchCommand = launchCommand.replace('$path', appPath);
            }
            else{
                if(launchCommand.indexOf('$settings') >= 0){
                    launchCommand = launchCommand.replace('$settings', settingsFile);
                }
                launchCommand += ' ';
                launchCommand += appPath;
            }
            console.log(launchCommand)
            this._establishAppConnection(appObject, device, launchCommand, needsHttps);
        }
    }

    closeApp(app){
        console.log('close app');
        app.connection.exec('pkill -g ' + app.pid, () => {});
        app.pid = undefined;
        app.connection = undefined;
        app.connectionUrl = undefined;
    }

    _establishAppConnection(app, item, launchCommand, needsHttps){
        const assembledOptions = {
            host: item.ip,
            port: 22,
            username: item.userName,
            password: item.userName,
            readyTimeout: 5000
        };

        const connection = new Client();
        connection.on('ready', () => {
            console.log('app connection ready');
            connection.exec(`(sudo lsof -t -i :${app.port} > /dev/null 2>&1 && sudo kill $(sudo lsof -t -i :${app.port}) || :)` + ' && echo "EXEC PID: $$" && ' + launchCommand, (err, stream) => {

                if(err){
                    console.log('app connection shell error: ', err);
                    app.connection = undefined;
                    app.pid = undefined;
                    app.connectionUrl = undefined;
                }
                stream.on('close', () => {
                    console.log('app connection shell closed');
                    connection.end();
                    app.connection = undefined;
                    app.pid = undefined;
                    app.connectionUrl = undefined;
                }).on('data', (data) => {
                    const str = data.toString();
                    if(str.substr(0, 10) === 'EXEC PID: '){
                        app.pid = str.substr(10);
                    }
                    //node-red
                    if(str.indexOf('Server now running at') >= 0){
                        this._openAppWebPage(app, item, needsHttps);
                    }
                    //vscode
                    if(str.indexOf('HTTP server listening on') >= 0){
                        this._openAppWebPage(app, item);
                    }                    

                }).on('end', () => {
                    console.log('app stream ended');
                }).stderr.on('data', (data) => {
                    const str = data.toString();
                    const list = str.split('\n');
                    list.forEach((line) => {
                        //jupyter
                        console.log(line)
                        if(line.trim().indexOf('http://127.0.0.1:8888') === 0){
                            app.urlLink = line.replace('127.0.0.1', item.ip);
                            this._openAppWebPage(app, item);
                        }
                        //minio
                        if(line.indexOf('http://127.0.0.1:9000') >= 0){
                            setTimeout(() => {
                                this._openAppWebPage(app, item);
                            }, 20000)
                        }
                    })
                });
                app.connection = connection;
            })
        }).on('error', (err) => {
            console.log('app connection error: ', err)
            app.connection = undefined;
            app.pid = undefined;
            app.connectionUrl = undefined;
        }).connect(assembledOptions);
    }

    _openAppWebPage(appObject, device, needsHttps){
        let url = '';
        if(appObject?.urlLink){
            url = appObject.urlLink;
        }
        else{
            url = `http://${device.ip}:${appObject.port}`;
            if(needsHttps){
                url = `https://${device.ip}:${appObject.port}`;
            }
        }
        
        appObject.connectionUrl = url;

        console.log('open page: ', url);
        Config.sendMessage(MESSAGE_OPEN_URL, {
            url: url,
            ip: device.ip,
            name: appObject.name
        });

    }
}

export {
    ManageRemoteApp
}