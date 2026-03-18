import { LocalStore } from "./LocalStore";
import { CloudStore } from "./CloudStore";
import { HardwareConfig } from "@hardware/configurations/HardwareConfig";

class StoreManager{
    constructor(){
        this.localStore = new LocalStore();
        this.cloudStore = new CloudStore();

        this.initializeStore();
    }

    initializeStore(){
        this.localStore.initializeStore();
        //cloudStore
    }

    getHardwareList(cb){
        this.localStore.getHardwareList(cb);
    }

    addHardwareItem(item, cb){
        this.localStore.addHardwareItem(item, cb);
    }

    deleteHardwareItem(item, cb){
        this.localStore.deleteHardwareItem(item, cb);
    }

    getAppSpaceList(cb){
        this.localStore.getAppSpaceList(cb);
    }

    static instance = undefined;

    static getInstance(){
        if(StoreManager.instance === undefined){
            StoreManager.instance = new StoreManager();
        }

        return StoreManager.instance;
    }
}

export {
    StoreManager
}