import {
    GlobalConfig
} from '@/global_configuration/GlobalConfig.js'
const Config = GlobalConfig.getInstance();

const sudo = require('sudo-prompt');
const exec = require('child_process').exec;
const execSync = require('child_process').execSync;

class BehaviorConfigEther{
    constructor(etherIp, netMask, rdkEtherIp){
        console.log('config ether: ', etherIp, netMask, rdkEtherIp)
        this.command = 'ifconfig';
        this.etherIp = etherIp ? etherIp : '192.168.127.100';
        this.etherMask = netMask ? netMask : '255.255.255.0';
        this.ip = rdkEtherIp ? rdkEtherIp : '192.168.127.10';

        this.checkedOnce = false;
    }

    get staticIPGetter(){
        return this.ip;
    }

    configEtherNet(){}
    _configEtherNet(assembledCommand, options, finishedCallback, errorCallback){
        try{
            sudo.exec(assembledCommand, options, (error) => {
                if (error) {
                    if(!this.checkedOnce){
                        this.checkedOnce = true;
                        this._configEtherNet(assembledCommand, options, finishedCallback, errorCallback);
                    }
                    else{
                        this.checkedOnce = false;
                        errorCallback(error);
                    }
                }
                else{
                    finishedCallback();
                }
            })
        }
        catch(e){
            if(!this.checkedOnce){
                this.checkedOnce = true;
                this._configEtherNet(assembledCommand, options, finishedCallback, errorCallback);
            }
            else{
                this.checkedOnce = false;
                errorCallback(e);
            }
        }
        
    }
}

let behavior = BehaviorConfigEther;

if(Config.isWinGetter){
    class BehaviorWindowsConfigEther extends BehaviorConfigEther{
        constructor(etherIp, netMask, rdkEtherIp){
            super(etherIp, netMask, rdkEtherIp);

            this.checkCommand = 'netsh interface ipv4 show addresses';
            this.command = 'netsh interface ipv4 set address';
        }

        configEtherNet(name, finishedCallback, errorCallback){
            const assembledCheckCommand = [this.checkCommand, `name="${name}"`].join(' ');
            let assembledCommand = [this.command, `name="${name}"`, 'static', this.etherIp, this.etherMask, this.ip].join(' ');
            const options = {
                name: 'RDK Studio'
            };

            const ret = execSync(this.checkCommand);
            let ipExistFlag = false;
            if(ret){
                if(ret.toString().indexOf(this.etherIp) >= 0){
                    ipExistFlag = true;
                }
            }

            const generateNewSegment = (segments) => {
                let seg = parseInt(segments[3]);
                seg += 1;
                segments[3] = seg.toString();
                const ip = segments.join('.');
                if(ret.toString().indexOf(ip) >= 0){
                    generateNewSegment(segments);
                }
            }

            exec(assembledCheckCommand, (err, stdout) => {
                if(err){
                    if(ipExistFlag){
                        const segments = this.etherIp.split('.');
                        generateNewSegment(segments);
                        this.etherIp = segments.join('.');
                        assembledCommand = [this.command, `name="${name}"`, 'static', this.etherIp, this.etherMask, this.ip].join(' ');
                    }
                    this._configEtherNet(assembledCommand, options, finishedCallback, errorCallback);
                    return;
                }

                if(stdout && stdout.indexOf(this.etherIp) >= 0){
                    console.log('ether ip exists')
                    finishedCallback();
                    return;
                }

                if(ipExistFlag){
                    const segments = this.etherIp.split('.');
                    generateNewSegment(segments);
                    this.etherIp = segments.join('.');
                    assembledCommand = [this.command, `name="${name}"`, 'static', this.etherIp, this.etherMask, this.ip].join(' ');
                }
                this._configEtherNet(assembledCommand, options, finishedCallback, errorCallback);
            })
        }
    }

    behavior = BehaviorWindowsConfigEther;
}
else if(Config.isMacGetter|| Config.isLinuxGetter){
    class BehaviorMacConfigEther extends BehaviorConfigEther{
        constructor(etherIp, netMask, rdkEtherIp){
            super(etherIp, netMask, rdkEtherIp);
        }

        configEtherNet(name, finishedCallback, errorCallback){
            const assembledCommand = [this.command, name, this.etherIp, 'netmask', this.etherMask, 'up'].join(' ');
            const options = {
                name: 'RDK Studio'
            };
            this._configEtherNet(assembledCommand, options, finishedCallback, errorCallback);
        }
    }

    behavior = BehaviorMacConfigEther;
}

export {
    behavior as ConnectionBehaviorConfigEther
}