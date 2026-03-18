import {
    ConnectionAdapterEtherNet
} from './ConnectionAdapterEtherNet';

import {
    ConnectionBehaviorConfigEther
} from '@hardware/platform_strategies/connection_behaviors/ConnectionBehaviorConfigEther';

import {
    ConnectionBehaviorSSH
} from '@hardware/platform_strategies/connection_behaviors/ConnectionBehaviorSSH';

import {
    GlobalConfig
} from '@/global_configuration/GlobalConfig.js'
const Config = GlobalConfig.getInstance();
class ConnectionAdapterTypeC extends ConnectionAdapterEtherNet{
    constructor(oneTime=false, settingWlan=false){
        super(oneTime, settingWlan);

        console.log('before config ether: ', Config.pcTypecEtherIPGetter, Config.pcNetMaskGetter)

        this.configEtherBehavior = new ConnectionBehaviorConfigEther(Config.pcTypecEtherIPGetter, Config.pcNetMaskGetter, Config.typecEtherIPGetter);
        this.sshBehavior = new ConnectionBehaviorSSH(Config.typecEtherIPGetter);
    }
}

export {
    ConnectionAdapterTypeC
}