const fs = require('fs');
const path = require('path');
const https = require('https');
const GBSize = 1024*1024*1024;
const Postfix = '.downloadcache';

const controller = new AbortController();
const signal = controller.signal;

class DownloadManager{
    constructor(infoCb, errorCb){
        this.infoCb = infoCb;
        this.errorCb = errorCb;
        
    }

    downloadFile(url, downloadPath, doneCb){
        if(!url){
            this.errorCb('Invalid URL!');
        }
        const urlObj = new URL(url);
        const host = urlObj.host;
        const fileName = path.parse(urlObj.pathname).base;
        const targetFilename = path.join(downloadPath, fileName);
        const cacheFileName = fileName + Postfix;
        const cacheTargetName = path.join(downloadPath, cacheFileName);
        console.log(host, targetFilename);

        if(fs.existsSync(targetFilename)){
            const stat = fs.statSync(targetFilename);
            this.infoCb(100, (stat.size/GBSize).toFixed(1) + 'GB', true)
            doneCb(targetFilename);
            return;
        }

        const options = {
            host,
            path: urlObj.pathname,
            method: 'GET',
            signal,
            rejectUnauthorized: false
        }

        const file = fs.createWriteStream(cacheTargetName);
        let totalSize = 0;
        let downloadedSize = 0;

        const request = https.get(options, (response) => {
            if(response.statusCode !== 200){
                this.errorCb('wrong status code: ' + response.statusCode)
            }
    
            response.on('data', (chunk) => {
                downloadedSize += chunk.length;
                // console.log('chunk: ', (downloadedSize/GBSize).toFixed(2) + 'GB', (downloadedSize/totalSize*100).toFixed(1) + '%')
                this.infoCb(Number((downloadedSize/totalSize*100).toFixed(1)), (downloadedSize/GBSize).toFixed(2)+'GB')
            })
        
            response.on('end', () => {
                console.log('response ended')
            })
    
            response.pipe(file);
        })
        
        request.on('response', (data) => {
            totalSize = data.headers['content-length'];
            console.log('response content-length: ', data.headers['content-length']);
        })
    
        request.on('error', (err) => {
            fs.unlink(cacheTargetName, () => this.errorCb(err.message));
        })
    
        request.on('end', () => {
            console.log('request ended')
        })
    
        file.on('finish', () => file.close(() => {
            console.log('file finished');
            fs.rename(cacheTargetName, targetFilename, (err) => {
                if(err){
                    this.errorCb('Error while rename file!');
                    return;
                }

                doneCb(targetFilename);
            })
        }));
    
        file.on('error', (err) => {
            fs.unlink(cacheTargetName, () => this.errorCb(err.message))
        })
    
    }

    cancelDownload(){
        console.log('abort')
        controller.abort();
    }

}

export {
    DownloadManager
}