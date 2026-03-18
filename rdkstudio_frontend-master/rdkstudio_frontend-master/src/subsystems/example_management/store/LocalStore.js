import {
    StoreManager
} from "@/store/StoreManager";
const Store = StoreManager.getInstance();

import {
    GlobalConfig
} from "@/global_configuration/GlobalConfig"
const Config = GlobalConfig.getInstance();

const path = require('path');
const fs = require('fs');

class LocalStore{
    constructor(){
        this.exampleListPath = path.resolve(Config.pathResourcesGetter, './examples/examplelist.json');
        this.exampleList = [];
        this.hasBeenLoaded = false;
    }

    initializeStore(){

    }

    getExampleList(cb){
        if(this.hasBeenLoaded){
            cb(this.exampleList)
        }
        else{
            fs.readFile(this.exampleListPath, 'utf-8', (err, data) => {
                this.exampleList = JSON.parse(data).list;
                for(const example of this.exampleList){
                    if(example?.images){
                        example.images = example.images.map((img) => {
                            return path.resolve(Config.pathResourcesGetter, img);
                        })
                    }
                    else{
                        example.iamges = [];
                    }
                    
                }
                this.hasBeenLoaded = true;
                cb(this.exampleList);
            })
        }
    }

    getRDKDevices(cb){
        const hardwareSettings = Store.getHardwareSettings(Config.currentUserGetter, Config.currentTeamGetter);
        cb(hardwareSettings.hardwarelist);
    }
}

export {
    LocalStore
}