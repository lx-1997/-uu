import {
    DecompressBehavior
} from './strategries/DecompressBehavior';

const fs = require('fs');
const path = require('path');

class XZFileManager{
    constructor(){
        this.decompressBehavior = new DecompressBehavior();
    }

    isXZFile(filepath){
        return path.extname(filepath) === '.xz';
    }

    isIMGFile(filepath){
        return path.extname(filepath) === '.img';
    }

    async decompressXZFileFromMainProcess(filePath){
        const imgPath = filePath.substring(0, filePath.lastIndexOf('.'));
        if(fs.existsSync(imgPath)){
            return undefined;
        }
        if(this.isIMGFile(imgPath)){
            const imgDir = path.dirname(imgPath);
            //await here
            console.log('before decompress: ', filePath, imgDir)
            const result = await this.decompressBehavior.decompressXZFile(filePath, imgDir);
            if(!result && fs.existsSync(imgPath)){
                fs.unlinkSync(imgPath);
            }
            console.log('result: ', result);
            return result;
        }
        else{
            return undefined;
        }
    }
}

export {
    XZFileManager
}