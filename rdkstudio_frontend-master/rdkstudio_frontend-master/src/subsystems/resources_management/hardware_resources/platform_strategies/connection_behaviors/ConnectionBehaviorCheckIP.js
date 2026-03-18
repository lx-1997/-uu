import {
    GlobalConfig
} from '@/global_configuration/GlobalConfig.js'
const Config = GlobalConfig.getInstance();

const execSync = require('child_process').execSync;
const path = require('path');
const iconv = require('iconv-lite');


class BehaviorCheckIP{
    constructor(){
        this.script = path.resolve(Config.pathResourcesGetter, './scripts/TestIP.sh');
    }

    testIP(){}

}

let behavior = BehaviorCheckIP;

if(Config.isWinGetter){
    class BehaviorWindowsCheckIP extends BehaviorCheckIP{
        constructor(){
            super();
        }

        testIP(ip, finishedCallback, errorCallback){
            const encoding = 'cp936';
            const binaryEncoding = 'binary';
            const assembledCommand = `ping -n 1 ${ip}`;
            try{
                const buf = execSync(assembledCommand);
                const decodedbuf = iconv.decode(Buffer.from(buf, binaryEncoding), encoding);
                const str = decodedbuf.toString();
                console.log(str)
                if(str.indexOf('无法访问') >= 0){
                    finishedCallback();
                }
                else{
                    errorCallback(`${ip} is occupied!`);
                }
            }
            catch(e){
                finishedCallback()
            }
            
        }
    }

    behavior = BehaviorWindowsCheckIP;
}
else if(Config.isMacGetter || Config.isLinuxGetter){
    class BehaviorMacCheckIP extends BehaviorCheckIP{
        constructor(){
            super();
        }

        testIP(ip, finishedCallback, errorCallback){
            console.log('check ip: ', ip, this.script)
            const assembledCommand = `${this.script} ${ip}`;
            const str = execSync(assembledCommand).toString();
            if(str.indexOf('free') >= 0){
                finishedCallback();
            }
            else{
                errorCallback(`${ip} is occupied!`);
            }
        }
    }

    behavior = BehaviorMacCheckIP;
}


export {
    behavior as ConnectionBehaviorCheckIP
}