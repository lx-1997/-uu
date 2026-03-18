import {
    GlobalConfig
} from '@/global_configuration/GlobalConfig.js'
const Config = GlobalConfig.getInstance();

const execSync = require('child_process').execSync;
const exec = require('child_process').exec;
const path = require('path');
const { shell } = require('electron');

class DockerBehavior{
    constructor(){

    }

    checkDockerStatus(){}
    installDocker(){}
    launchDocker(){}
    checkImageStatus(name, cb){
        const imageCommand = `docker images ${name} -q`;
        const containerCommand = `docker ps --filter "name=${name}" -q`;
        const ret = execSync(imageCommand).toString().trim();
        if(ret){
            const cret = execSync(containerCommand).toString().trim();
            if(cret){
                cb(true, true);
            }
            else{
                cb(true, false);
            }
        }
        else{
            cb(false, false);
        }
    }
    loadImage(dest, fileName, cb){
        dest = path.resolve(dest, fileName);

        const loadCommand = `docker load --input ${dest}`;

        const loadProcess = exec(loadCommand, (error, stdout, stderr) => {
            if(error){
                console.log('load error1: ', error);
            }
            if(stdout){
                console.log('stdout: ', stdout);
            }
            if(stderr){
                console.log('stderr: ', stderr);
            }
        });

        loadProcess.on('close', (params) => {
            console.log('load process closed: ', params);
            cb();
        })
    }
    launchImage(cmd, cb){
        console.log('launch: ', cmd);
        const imageProcess = exec(cmd, (err, stdout, stderr) => {
            if(stdout){
                console.log(stdout)
            }
        });

        imageProcess.on('close', () => {
            console.log('closed')
            cb(undefined);
        })

        cb(imageProcess.pid);

    }

    stopContainer(pid, name, cb){
        console.log('stop: ', pid);
        if(pid){
            const command = `docker stop $(docker ps -a --filter "name=${name}" -q) && docker rm $(docker ps -a --filter "name=${name}" -q)`;
            console.log(command)
            execSync(command);
            cb();
        }
    }
}

let behavior = DockerBehavior;

if(Config.isWinGetter){
    class DockerWinBehavior extends DockerBehavior{
        constructor(){
            super();
        }

        checkDockerStatus(cb){

            //  wsl --install Ubuntu --web-download
            // bios svm enabled

            const commandIsInstalled = "winget list --name docker";
            const commandIsRunning = 'docker ps';

            exec(commandIsInstalled, (error, stdout, stderr) => {
                if(error){
                    cb(false, false);
                    return;
                }
                if(stdout){
                    if(stdout.trim().split('\n').length > 2){
                        exec(commandIsRunning, (error, stdout, stderr) => {
                            if(error){
                                cb(true, false);
                                return;
                            }
                            if(stdout){
                                cb(true, true);
                            }
                            if(stderr){
                                cb(true, false);
                            }
                        })
                    }
                    else{
                        cb(false, false);
                    }
                }
                if(stderr){
                    cb(false, false);
                }
            })
        }

        installDocker(){
            shell.openExternal('https://docs.docker.com/desktop/install/windows-install/');
        }

        launchDocker(){
            const launchCommand = 'start "" "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe"';
            exec(launchCommand);
        }
    }

    behavior = DockerWinBehavior;
}
else if(Config.isMacGetter || Config.isLinuxGetter){
    class DockerMacBehavior extends DockerBehavior{
        constructor(){
            super();
        }

        checkDockerStatus(cb){
            const commandIsInstalled = "type docker";
            const commandIsRunning = 'docker ps';

            exec(commandIsInstalled, (error, stdout, stderr) => {
                if(error){
                    cb(false, false);
                    return;
                }
                if(stdout){
                    exec(commandIsRunning, (error, stdout, stderr) => {
                        if(error){
                            cb(true, false);
                            return;
                        }
                        if(stdout){
                            cb(true, true);
                        }
                        if(stderr){
                            cb(true, false);
                        }
                    })
                }
                if(stderr){
                    cb(false, false);
                }

            })
        
        }

        installDocker(){
            shell.openExternal('https://docs.docker.com/desktop/install/mac-install/')
        }

        launchDocker(){
            const launchCommand = 'open -a docker';

            exec(launchCommand);
        }

    }

    behavior = DockerMacBehavior;
}

export {
    behavior as LocalDockerBehavior
}