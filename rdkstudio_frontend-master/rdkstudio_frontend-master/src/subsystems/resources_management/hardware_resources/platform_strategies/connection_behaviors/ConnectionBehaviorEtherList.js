import {
    GlobalConfig
} from '@/global_configuration/GlobalConfig.js'
import { isNumber } from 'lodash';
const Config = GlobalConfig.getInstance();

const execSync = require('child_process').execSync;
const iconv = require('iconv-lite');

class BehaviorEtherList{
    constructor(){
        this.command = '';
    }

    getList(){
        const list = execSync(this.command);
        const str = list.toString();
        const array = str.split(/\s+/)
                         .map(item => item.trim())
                         .filter(item => item.indexOf('e') === 0)
                         .sort()
                         .reverse();
        console.log(array)
        return array;
    }
}

let behavior = BehaviorEtherList;

if(Config.isWinGetter){
    class BehaviorWindowsEtherList extends BehaviorEtherList{
        constructor(){
            super();
            this.command = 'netsh interface ipv4 show interfaces'
        }

        getList(){
            let encoding = 'cp936';
            const binaryEncoding = 'binary';

            const list = execSync(this.command);
            let str = list.toString();
            if(str.indexOf('�') >= 0){
                const chcpOutput = execSync('chcp', { encoding: 'utf-8' }).trim();
                const codePage = parseInt(chcpOutput.match(/\d+/)[0]);
                if(codePage){
                    encoding = 'cp' + codePage;
                }

                const decodedlist = iconv.decode(Buffer.from(list, binaryEncoding), encoding);
                str = decodedlist.toString();
            }
            
            const lines = str.split('\n')
                             .filter(line => line.indexOf('connected') >= 0 && line.indexOf('WLAN') < 0 && line.indexOf('disconnected') < 0);

            const names = lines.map((line) => {
                const idx = line.indexOf('connected');
                return line.substring(idx + 9).trim();
            });

            return names;
        }
    }

    behavior = BehaviorWindowsEtherList;
}
else if(Config.isMacGetter){
    class BehaviorMacEtherList extends BehaviorEtherList{
        constructor(){
            super();
            this.command = 'ifconfig -l';
        }
    }

    behavior = BehaviorMacEtherList;
}
else if(Config.isLinuxGetter){
    class BehaviorLinuxEtherList extends BehaviorEtherList{
        constructor(){
            super();
            this.command = 'ls /sys/class/net';
        }

        getList(){
            const list = execSync(this.command);
            const str = list.toString();
            const array = str.split(/\s+/)
                             .map(item => item.trim())
                             .filter(item => item.indexOf('e') === 0 || item.indexOf('u') === 0)
                             .sort()
                             .reverse();
            console.log(array)
            return array;
        }
    }

    behavior = BehaviorLinuxEtherList;
}


export {
    behavior as ConnectionBehaviorEtherList
}