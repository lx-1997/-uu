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
        this.hardwareStore = {};
        this.appListPath = path.resolve(Config.pathResourcesGetter, './hardware_appspace/applist.json');
        this.appList = [];
        this.appListReading = false;
        this.appListReady = false;
        this.appListQueue = [];

        this.getAppSpaceList(()=>{});
    }

    initializeStore(){
        const hardwareSettings = Store.getHardwareSettings(Config.currentUserGetter, Config.currentTeamGetter);
        this.hardwareStore = hardwareSettings;
        console.log('step 2 get hardware settings: ', hardwareSettings);
    }

    getHardwareList(cb){
        if(!Object.hasOwnProperty.call(this.hardwareStore, 'hardwarelist')){
            this.hardwareStore['hardwarelist'] = [];
        }
        cb(this.hardwareStore['hardwarelist'])
        console.log('step 3 get hardware list: ', this.hardwareStore['hardwarelist'])
    }

    addHardwareItem(item, cb){
        //check validation first
        this.hardwareStore['hardwarelist'].push(item);
        cb();
        Store.persistStore();
    }

    deleteHardwareItem(item, cb){
        const idx = this.hardwareStore.hardwarelist.findIndex((hardwareItem) => {
            return hardwareItem.ip === item.ip && hardwareItem.name === item.name
        });
        if(idx >= 0){
            this.hardwareStore.hardwarelist.splice(idx, 1);
            cb();
            Store.persistStore();
        }
    }

    getAppSpaceList(cb){
        if(this.appListReady){
            cb(this.appList);
        }
        else{
            this.appListQueue.push(cb);
        }

        if(this.appListReady === false && this.appListReading === false){
            this.appListReading = true;

            fs.readFile(this.appListPath, 'utf-8', (err, data) => {
                this.appList = JSON.parse(data).list;

                this.appList.forEach((app) => {
                    const iconPath = path.resolve(Config.pathResourcesGetter, app.icon);
                    app.icon = iconPath;
                    const fullPath = path.resolve(Config.pathResourcesGetter, app.local);
                    const str = fs.readFileSync(fullPath, 'utf-8');
                    app.operations = JSON.parse(str);
                })

                while(this.appListQueue.length > 0){
                    const cb = this.appListQueue.shift();
                    cb(this.appList);
                }
                this.appListReady = true;
            })
        }
    }
}

export {
    LocalStore
}