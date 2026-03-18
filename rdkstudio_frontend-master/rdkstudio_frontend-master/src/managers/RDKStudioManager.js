import {
    CHECK_WINDOW_TYPE,
    CHANGE_LANGUAGE,
    ASK_CLOSE_TAB,
} from '@/constants/AppEventNames';

import {
    GlobalConfig
} from '@/global_configuration/GlobalConfig';
const Config = GlobalConfig.getInstance();

const { shell, clipboard, ipcRenderer } = require('electron');

class RDKStudioManager{
    constructor(cb){
        this.webviewUrl = '';
        this.checkWindowType(cb);
    }

    get webviewUrlGetter(){
        return this.webviewUrl;
    }

    handleSettingWebviewOperations(options){
        this.webviewUrl = options.url;
    }

    handleOpenLinkClicked(){
        if(this.webviewUrl){
            shell.openExternal(this.webviewUrl);
        }
    }

    handleCopyLinkClicked(){
        if(this.webviewUrl){
            clipboard.writeText(this.webviewUrl);
        }
    }

    checkWindowType(cb){
        ipcRenderer.invoke(CHECK_WINDOW_TYPE).then((type) => {
            cb(type === 'main');
        })
    }

    changeLanguage(lang){
        // 同步语言设置到主进程
        Config.setLang(lang);
    }
}

export {
    RDKStudioManager
}