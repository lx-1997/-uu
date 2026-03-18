import {
    LocalStore
} from './LocalStore';

import {
    CloudStore
} from './CloudStore';

class StoreManager{
    constructor(){
        this.localStore = new LocalStore();
        this.cloudStore = new CloudStore();
    }

    // invoke by global config singleton
    initializeStore(localPath, errcb){
        this.localStore.initializeStore(localPath, errcb);
    }

    persistStore(){
        this.localStore.persistStore();
    }

    getUserSettings(){
        return this.localStore.getUserSettings();
    }

    getHardwareSettings(user, team){
        return this.localStore.getHardwareSettings(user, team);
    }

    getHardwareAppList(){
        
    }

    getHardwareItemList(){
        
    }

    addHardwareItem(item){
    }

    saveHardwareItemList(){

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