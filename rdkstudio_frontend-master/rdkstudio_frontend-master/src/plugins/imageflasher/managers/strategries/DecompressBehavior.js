const path = require('path');
const util = require('util');
const exec = util.promisify(require('child_process').exec);

import {
    GlobalConfig
} from '@/global_configuration/GlobalConfig.js'
const Config = GlobalConfig.getInstance();

class DecompressBase{
    constructor(){

    }

    async decompressXZFile(filePath, targetDir){}
}

let behavior = DecompressBase;

if(Config.isWinGetter){
    class DecompressWindows extends DecompressBase{
        constructor(){
            super();
        }

        async decompressXZFile(filePath, targetDir){
            const binName = path.resolve(Config.pathResourcesGetter, './examples/bin/7zr.exe')
            const assembledCommand = `${binName} e ${filePath} -o"${targetDir}"`;
            console.log('command: ', assembledCommand)
            try{
                const { stdout, stderr } = await exec(assembledCommand);
                console.log('stdout: ', stdout);
                console.log('stderr: ', stderr)
                if(stdout){
                    return filePath.substring(0, filePath.lastIndexOf('.'));
                }
                else{
                    return undefined;
                }
            } catch(e){
                return undefined;
            }
        }
    }

    behavior = DecompressWindows;
}
else if(Config.isMacGetter){
    class DecompressMac extends DecompressBase{
        constructor(){
            super();
        }

        async decompressXZFile(filePath, targetDir){
            const command = `/usr/bin/gunzip -dk ${filePath}`;
            try{
                await exec(command);
                return filePath.substring(0, filePath.lastIndexOf('.'));
            }
            catch(e){
                return undefined;
            }
        }
    }

    behavior = DecompressMac
}
else if(Config.isLinuxGetter){
    class DecompressLinux extends DecompressBase{
        constructor(){
            super();
        }

        async decompressXZFile(filePath, targetDir){
            const command = `/usr/bin/unxz -dk ${filePath}`;
            try{
                await exec(command);
                return filePath.substring(0, filePath.lastIndexOf('.'));
            }
            catch(e){
                return undefined;
            }
        }
    }

    behavior = DecompressLinux;
}

export {
    behavior as DecompressBehavior
}