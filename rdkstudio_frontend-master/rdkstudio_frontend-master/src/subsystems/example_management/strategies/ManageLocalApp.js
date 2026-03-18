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

    launchApp(app, item, targetPath, hintcb, errcb){
        if(app?.connection) return;

        if(app.needsCheck){
            const checkObj = app.check[this.osName];

            try{
                const ret = execSync(checkObj.cmd);
                if(ret.toString().length > 0){
                    if(ret.toString().indexOf(checkObj.keyword) >= 0){
                        hintcb(app.name, app?.downloadUrl);
                        return;
                    }
                    console.log(app.name, 'is installed');
                }
                else{
                    hintcb(app.name, app?.downloadUrl);
                    return;
                }
            }
            catch(e){
                hintcb(app.name, app?.downloadUrl);
                return;
            }
        }

        let command = '';
        command = app?.launch[this.osName] + targetPath;
        
        
        if(command){
            if(command.indexOf('$user') >= 0) command = command.replace('$user', item.userName);
            if(command.indexOf('password') >= 0) command = command.replace('$password', item.userName);
            if(command.indexOf('$ip') >= 0) command = command.replace('$ip', item.ip);
            console.log(command)
            exec(command);
        }

    }
}

export {
    ManageLocalApp
}