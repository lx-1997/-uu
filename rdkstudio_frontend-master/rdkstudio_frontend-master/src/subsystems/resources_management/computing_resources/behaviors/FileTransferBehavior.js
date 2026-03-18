const { Client } = require("basic-ftp");
const path = require('path');

class FileTransferBehavior{
    constructor(){

    }

    async downloadFile(host, target, dest, name, cb, errcb){
        dest = path.resolve(dest, name);
        console.log(host, target, dest)

        const client = new Client();
        client.ftp.verbose = true;

        let totalSize = 0;
        let lastSize = 0;
        let interval = 0;
        let seconds = 0;
        client.trackProgress((info) => {
            if(totalSize > 0){
                const progress = Math.round(info.bytesOverall*100/totalSize);
                interval = info.bytesOverall - lastSize;
                if(interval === 0) interval = 1;
                seconds = Math.round((totalSize - info.bytesOverall)/interval);
                lastSize = info.bytesOverall;
                const speed = `${(interval/1024/1024).toFixed(1)}MB/s ${Math.floor(seconds/60)}m${seconds%60}s`;
                cb(progress, speed, false);
                if(totalSize > 0 && info.bytesOverall === totalSize){
                    client.trackProgress();
                    cb(progress, speed, true);
                }
            }
        })
        try{
            await client.access({
                host: host
            })
            totalSize = await client.size(target);
                    
            await client.downloadTo(dest, target);

            client.end();
        }
        catch(e){
            errcb(e);
        }
        
    }
}

export {
    FileTransferBehavior
}