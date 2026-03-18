import {
    GlobalConfig
} from '@/global_configuration/GlobalConfig.js'
const Config = GlobalConfig.getInstance();

const sudo = require('sudo-prompt');
const exec = require('child_process').exec;
const execSync = require('child_process').execSync;


class ManageLocalApp{
    constructor(){
        this.osName = '';
        if(Config.isWinGetter){
            this.osName = 'win';
        }
        else if(Config.isMacGetter){
            this.osName = 'mac';
        }
        else if(Config.isLinuxGetter){
            this.osName = 'linux';
        }
    }

    launchApp(app, item, hintcb, errcb){
        if(app?.connection) return;

        if(app.operations.needsCheck && !app.operations.needsInstall){
            const checkObj = app.operations.check[this.osName];

            try{
                const ret = execSync(checkObj.cmd);
                if(ret.toString().length > 0){
                    if(ret.toString().indexOf(checkObj.keyword) >= 0){
                        hintcb(app.name, app.operations?.downloadUrl);
                        return;
                    }
                    else if(this.osName === 'mac' && app.operations.name === 'vscode local'){
                        const installRet = execSync(checkObj?.terminalCmd);
                        if(installRet.toString().indexOf(checkObj.keyword) >= 0){
                            //create link
                            const options = {
                                name: 'RDK Studio'
                            };
                            sudo.exec(checkObj?.createCmd, options, (err) => {
                                if(err){
                                    hintcb(app.name, app.operations?.downloadUrl)
                                }
                            })
                        }
                    }
                    console.log(app.name, 'is installed');
                }
                else{
                    hintcb(app.name, app.operations?.downloadUrl);
                    return;
                }
            }
            catch(e){
                hintcb(app.name, app.operations?.downloadUrl);
                return;
            }
        }

        let command = '';
        if(Object.hasOwnProperty.call(app.operations, 'additional')){
            command = app?.operations?.additional[this.osName];
        }
        else{
            command = app?.operations?.launch[this.osName];
        }
        
        if(command){
            if(command.indexOf('$user') >= 0) command = command.replace('$user', item.userName);
            if(command.indexOf('$password') >= 0) command = command.replace('$password', item.userName);
            if(command.indexOf('$ip') >= 0) command = command.replace('$ip', item.ip);
            if(command.indexOf('$path') >= 0) command = command.replace('$path', Config.pathResourcesGetter);
            console.log(command)
            const startTime = Date.now();

            //check ssh duplicate key for mac
            if(this.osName === 'mac' && command.indexOf('ssh') > 0){
                const existKeyCommand = `ssh-keygen -F ${item.ip} | grep ed25519`;
                const deviceKeyCommand = `ssh-keyscan -t ed25519 ${item.ip} 2>/dev/null`;

                try {
                    const encodingOption = {
                        encoding: 'utf8'
                    }
                    const existKey = execSync(existKeyCommand, encodingOption);
                    const deviceKey = execSync(deviceKeyCommand, encodingOption);
    
                    if(existKey !== '' && deviceKey !== '' && existKey != deviceKey){
                        let resetCommand = app.operations.reset;
                        if(resetCommand.indexOf('$ip') >= 0) resetCommand = resetCommand.replace('$ip', item.ip);
                        execSync(resetCommand);
                    }
                }
                catch(e){
                    console.log('ssh error');
                }
                
            }

            const child = exec(command);
            child.on('close', () => {
                const endTime = Date.now();
                const interval = endTime - startTime;
                if(Config.isWinGetter && interval < 2000 && app?.operations?.reset){
                    let resetCommand = app.operations.reset;
                    if(resetCommand.indexOf('$ip') >= 0) resetCommand = resetCommand.replace('$ip', item.ip);
                    execSync(resetCommand);
                    exec(command);
                }

                //how to check duplicate sshkey on mac?
            })
        }
    }
}

export {
    ManageLocalApp
}