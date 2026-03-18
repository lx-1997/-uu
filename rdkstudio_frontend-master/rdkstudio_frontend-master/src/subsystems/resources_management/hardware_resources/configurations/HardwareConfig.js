import {
    NAME_HARDWARE_LIST,
    NAME_HARDWARE_OPERATION_LOG,
} from '@hardware/constants/LocalFileConstants.js';

import {
    GlobalConfig
} from '@/global_configuration/GlobalConfig.js';
const Config = GlobalConfig.getInstance();

const path = require('path');


class HardwareConfig{
    constructor(){
        this.hardwareListPath = '';
        this.hardwareOperationLogPath = '';

        this.refreshHardwarePaths();
    }

    refreshHardwarePaths(){
        const resources = Config.pathResourcesGetter;
        const user = Config.currentUserGetter;
        const team = Config.currentTeamGetter;
    }

    static instance = undefined;

    static getInstance(){
        if(HardwareConfig.instance === undefined){
            HardwareConfig.instance = new HardwareConfig();
        }

        return HardwareConfig.instance;
    }
}

export {
    HardwareConfig
}