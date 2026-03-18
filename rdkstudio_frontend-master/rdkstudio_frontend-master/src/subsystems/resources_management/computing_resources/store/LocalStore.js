import {
    GlobalConfig
} from "@/global_configuration/GlobalConfig"
const Config = GlobalConfig.getInstance();

const path = require('path');
const fs = require('fs');

class LocalStore{
    constructor(){
        this.computingListPath = path.resolve(Config.pathResourcesGetter, './computing_local/computinglist.json');
        this.computingList = [];
        this.computingListReading = false;
        this.computingListReady = false;
        this.computingListQueue = [];
    }

    initializeStore(){

    }

    getComputingList(cb){
        if(this.computingListReady){
            cb(this.computingList);
        }
        else{
            this.computingListQueue.push(cb);
        }

        if(this.computingListReady === false && this.computingListReading === false){
            this.computingListReading = true;

            fs.readFile(this.computingListPath, 'utf-8', (err, data) => {
                this.computingList = JSON.parse(data).list;

                while(this.computingListQueue.length > 0){
                    const cb = this.computingListQueue.shift();
                    cb(this.computingList);
                }
                this.computingListReady = true;
            })
        }
    }
}

export {
    LocalStore
}