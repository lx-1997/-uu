import {
    MESSAGE_OPEN_URL
} from '@/constants/AppMessageNames';

import {
    GlobalConfig
} from '@/global_configuration/GlobalConfig.js'
const Config = GlobalConfig.getInstance();

const Client = require('ssh2').Client;
const { shell } = require('electron');
const execSync = require('child_process').execSync;

// macos vscode https://code.visualstudio.com/docs/setup/mac

class ManageRemoteApp{
    constructor(){

    }

    launchApp(app, item){
        console.log('launch app');
        if(app.operations.launch.indexOf('$id') >= 0){
            app.operations.launch = app.operations.launch.replace('$id', item.deviceID);
        }
        //check connection
        if(!app?.connection){
            this._establishAppConnection(app, item);
        }
        else{
            this._openAppWebPage(app, item);
        }
    }

    launchAppWithoutConnection(app, item){
        this._openAppWebPage(app, item);
    }

    launchService(app, item){
        const assembledOptions = {
            host: item.ip,
            port: 22,
            username: item.userName,
            password: item.userName,
            readyTimeout: 5000
        };

        const connection = new Client();
        connection.on('ready', () => {
            console.log(app.operations.launch)
            connection.exec(app.operations.launch, (err, stream) => {
                if(err){
                    console.log('launch service error')
                }
                stream.on('close', () => {
                    connection.end();
                })
            })
        }).connect(assembledOptions);
    }

    closeApp(app){
        console.log('close app');
        app.connection.exec('pkill -g ' + app.pid, () => {});
        app.pid = undefined;
        app.connection = undefined;
        app.connectionUrl = undefined;
    }

    installApp(app, item, updatecb, finishedcb, errcb, lang=""){
        const assembledOptions = {
            host: item.ip,
            port: 22,
            username: item.userName,
            password: item.userName,
            readyTimeout: 5000
        };

        let commandQueue = Array.from(app.operations.install);
        if(lang === "en" && Object.hasOwnProperty.call(app.operations, "install-en")){
            commandQueue = Array.from(app.operations["install-en"]);
            console.log(commandQueue);
        }

        this._runTaskQueue(assembledOptions, commandQueue, updatecb, finishedcb, errcb);
    }

    uninstallApp(app, item, finishedcb, errcb){
        const assembledOptions = {
            host: item.ip,
            port: 22,
            username: item.userName,
            password: item.userName,
            readyTimeout: 5000
        };

        const command = app.operations.uninstall;

        const connection = new Client();
        connection.on('ready', () => {
            connection.exec(command, (err, stream) => {
                if(err){
                    errcb(err);
                }

                stream.on('close', () => {
                    connection.end();
                }).on('data', (data) => {
                    // console.log(data.toString())
                    
                }).on('end', () => {
                    finishedcb();
                })
            })
        }).on('error', (err) => {
            errcb(err);
        }).connect(assembledOptions);
    }

    checkAppInstallation(app, item, updatecb, errcb){
        const assembledOptions = {
            host: item.ip,
            port: 22,
            username: item.userName,
            password: item.userName,
            readyTimeout: 5000
        };

        const command = app.operations.check.cmd;
        const keyword = app.operations.check.keyword;

        const connection = new Client();
        console.log('before check: ', item.ip, app.name)
        connection.on('ready', () => {
            connection.exec(command, (err, stream) => {
                if(err){
                    errcb(err);
                }
    
                stream.on('close', () => {
                    connection.end();
                }).on('data', (data) => {
                    console.log(app.name, data.toString(), data.toString().trim() === keyword);
                    if(data.toString().trim() === keyword){
                        updatecb(false);
                    }
                    else{
                        updatecb(true);
                    }
                }).on('end', () => {
    
                })
            })
            
        }).on('error', (err) => {
            errcb(err);
        }).connect(assembledOptions);
    }

    _runTaskQueue(options, queue, updatecb, finishedcb, errcb){
        if(queue.length === 0){
            finishedcb();
            return;
        }

        const command = queue.shift();
        const connection = new Client();
        connection.on('ready', () => {
            connection.exec(command, (err, stream) => {
                if(err){
                    errcb(err);
                }
                stream.on('close', () => {
                    console.log('app closed')
                    connection.end();
                    updatecb();
                    this._runTaskQueue(options, queue, updatecb, finishedcb, errcb);
                }).on('data', (data) => {
                    console.log(data.toString())
                }).on('end', () => {
                    console.log('app ended')
                }).stderr.on('data', (data) => {
                    console.log('stderr: ', data.toString());
                })
            })
        }).on('error', (err) => {
            errcb(err);
        }).connect(options);
    }

    _establishAppConnection(app, item){
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
            connection.exec(`(sudo lsof -t -i :${app.operations.port} > /dev/null 2>&1 && sudo kill $(sudo lsof -t -i :${app.operations.port}) || :)` + ' && echo "EXEC PID: $$" && ' + app.operations.launch, (err, stream) => {

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
                        // performance 应用：获取到 PID 后延迟打开网页（因为可能不会输出特定字符串）
                        if(app.name === 'performance'){
                            setTimeout(() => {
                                this._openAppWebPage(app, item);
                            }, 3000);
                        }
                    }
                    //node-red
                    if(str.indexOf('Server now running at') >= 0){
                        this._openAppWebPage(app, item);
                    }
                    //vscode
                    if(str.indexOf('HTTP server listening on') >= 0){
                        this._openAppWebPage(app, item);
                    }
                    //rdkllm
                    if(str.indexOf('http://0.0.0.0:7860') >= 0){
                        this._openAppWebPage(app, item);
                    }
                    //novnc
                    if(str.indexOf('http://ubuntu:6080/vnc.html') >= 0){
                        let newStr = str.substring(0, str.indexOf('?'));
                        newStr = newStr.replace('vnc.html', 'vnc.html?resize=scale')
                        app.urlLink = newStr.replace('ubuntu', item.ip);
                        this._openAppWebPage(app, item);
                    }
                    //image browser
                    if(str.indexOf('http://127.0.0.1:20100') >= 0){
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
                        //mjpg_streamer
                        if(line.indexOf(': 20200') >= 0){
                            this._openAppWebPage(app, item);
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

    _openAppWebPage(app, item){
        let url = '';
        if(Object.hasOwnProperty.call(app, 'urlLink') && app.urlLink){
            url = app.urlLink;
        }
        else{
            url = `http://${item.ip}:${app.operations.port}`;
        }

        if(app.operations?.params){
            url = url + "/?" + app.operations.params;
        }

        app.connectionUrl = url;

        console.log('open page: ', url);
        Config.sendMessage(MESSAGE_OPEN_URL, {
            url: url,
            ip: item.ip,
            name: app.name
        });

        // if(Config.isLinuxGetter){
        //     execSync('sensible-browser ' + url);
        // }
        // else{
        //     shell.openExternal(url);
        // }
    }
}

export {
    ManageRemoteApp
}