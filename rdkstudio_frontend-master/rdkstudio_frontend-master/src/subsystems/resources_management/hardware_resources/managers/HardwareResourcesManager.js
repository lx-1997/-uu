import { HardwareConnectionManager } from "./HardwareConnectionManager"

import { StoreManager } from "@hardware/store/StoreManager";
class HardwareResourcesManager{
    constructor(itemListCallback){

        this.connectionManager = new HardwareConnectionManager();
        this.storeManager = StoreManager.getInstance();
        this.storeManager.getHardwareList(itemListCallback);
    }

    getConnectionObject(){
        return this.connectionManager.getConnectionObject();
    }

    addHardwareItem(item, cb){
        this.storeManager.addHardwareItem(item, cb);
    }

    deleteHardwareItem(item, cb){
        this.storeManager.deleteHardwareItem(item, cb);
    }

}


export {
    HardwareResourcesManager
}