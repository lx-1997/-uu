import {
    MESSAGE_OPEN_URL,
    MESSAGE_CLOSE_APP,
} from '@/constants/AppMessageNames';

import {
    OPEN_URL,
    OPEN_SUB_URL,
    OPEN_NEW_WINDOW,
    HIDE_URL,
    CLOSE_URL,
    ASK_CLOSE_TAB,
    GET_APP_VERSION
} from '@/constants/AppEventNames';

import { useRouter } from 'vue-router';

import {
    GlobalConfig
} from '@/global_configuration/GlobalConfig';
const Config = GlobalConfig.getInstance();

const { ipcRenderer } = require('electron');


class SideBarManager{
    constructor(updateOpenUrlCb){
        this.appVersion = '';
        this.router = useRouter();
        this.updateOpenUrlCb = updateOpenUrlCb;
        Config.registerMessageHandler(MESSAGE_OPEN_URL, this.handleOpenUrlMessage());
        this.initializeIpcRendererHandlers();
        this.initializeAppVersion();
    }

    get appVersionGetter(){
        return this.appVersion;
    }

    initializeIpcRendererHandlers(){
        ipcRenderer.on(OPEN_SUB_URL, (event, options) => {
            console.log('suburl: ', options)
            if(options){
                const msg = {
                    url: options,
                    ip: '',
                    name: 'WebPage'
                }
                this.updateOpenUrlCb(msg);
            }
        })
    }

    initializeAppVersion(){
        ipcRenderer.invoke(GET_APP_VERSION).then((version) => {
            this.appVersion = version;
        })
    }

    handleOpenInsideAppClicked(url){
        this.router.push(url);
    }

    handleOpenPluginAppClicked(url){
        this.router.push(url);
    }

    handleOpenOfficialAppClicked(url){
        ipcRenderer.send(OPEN_URL, {
            url: url
        });
    }

    handleHideOfficialAppClicked(url){
        ipcRenderer.send(HIDE_URL, {
            url: url
        })
    }

    handleOpenUrlClicked(url){
        ipcRenderer.send(OPEN_URL, {
            url: url
        });
    }

    handleCloseUrlClicked(url){
        ipcRenderer.send(CLOSE_URL, {
            url: url
        });
    }

    handleHideUrlClicked(url){
        ipcRenderer.send(HIDE_URL, {
            url: url
        })
    }

    handleOpenNewWindowClicked(url){
        // 传递当前语言，确保新窗口使用主窗口的当前语言
        ipcRenderer.send(OPEN_NEW_WINDOW, {
            url: url,
            lang: Config.langGetter || 'en'
        })
    }

    handleOpenUrlMessage(){
        return (msg) => {
            this.updateOpenUrlCb(msg);
        }
    }

    askCloseTab(closeAllCb, closePageCb){
        ipcRenderer.invoke(ASK_CLOSE_TAB).then((closeFlag) => {
            console.log('needs close: ', closeFlag)
            if(closeFlag){
                closeAllCb();
            }
            else{
                closePageCb();
            }
        })
    }

    sendCloseAppMessage(url){
        Config.sendMessage(MESSAGE_CLOSE_APP, url);
    }
}

export {
    SideBarManager
}