import { LocalStore } from "./LocalStore";
import { CloudStore } from "./CloudStore";

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

    getExampleList(cb){
        this.localStore.getExampleList(cb);
    }

    getDeviceList(cb){
        this.localStore.getRDKDevices(cb);
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