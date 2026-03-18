import {
    StoreManager
} from '@/store/StoreManager';
const Store = StoreManager.getInstance();

import {
    UserSettingsInterface
} from '@/store/StoreInterfaces';

import {
    message
} from 'ant-design-vue';

import { getGPUTier } from 'detect-gpu';

import {
    MESSAGE_OPEN_URL,
    MESSAGE_CHANGE_LANG,
    MESSAGE_CLOSE_APP,
} from '@/constants/AppMessageNames';

import {
    GET_USER_DATA,
    CHANGE_LANGUAGE
} from '@/constants/AppEventNames';

import { ipcRenderer } from 'electron';

const path = require('path');

const InfoMessageCallback = (msg) => {
    message.success(msg);
}

const ErrorMessageCallback = (msg) => {
    message.error(msg);
}
class GlobalConfig{
    constructor(){
        this.preset = {
            etherIP: '192.168.127.10',
            pcEtherIP: '192.168.127.100',
            typecEtherIP: '192.168.128.10',
            pcTypecEtherIP: '192.168.128.100',
            pcNetMask: '255.255.255.0',
            
            defaultUser: 'sunrise',
            defaultPassword: 'sunrise'
        }

        this.platform = {
            isWeb: false,
            isMac: false,
            isWin: false,
            isLinux: false,
            isAndroid: false,
            isIOS: false
        }

        this.specifications = {
            cpu: '',
            gpu: '',
            memory: '',
            machine: ''
        }

        this.env = {
            isDevMode: false,
            appMode: 'prod', // 'test' 或 'prod'
            resourcesPath: '',
            cwd: '',
            home: '',
        }

        this.lang = '';

        this.messageCenter = {};

        this.userSettings = Object.assign({}, UserSettingsInterface);

        this.initializePlatform();
        this.initializeSpecifications();
        this.initializeEnv();
        this.initializeMessageCenter();
        (async () => {
            await this.initializeUserSettings();
        })();
    }

    async initializePlatform(){
        const webFlag = false;
        if(webFlag){

        }
        else{
            // const os = (await import('os')).default;
            const os = require('os')
            const platform = os.platform();
            this.platform.isMac = platform === 'darwin';
            this.platform.isWin = platform === 'win32';
            this.platform.isLinux = platform === 'linux';
        }
    }

    initializeEnv(){
        if(process?.env?.NODE_ENV){
            this.env.isDevMode = process.env.NODE_ENV === 'development';
        }
        // 设置应用模式：test 或 prod，默认为 prod
        if(process?.env?.APP_MODE){
            const mode = process.env.APP_MODE.toLowerCase();
            this.env.appMode = (mode === 'test' || mode === 'prod') ? mode : 'prod';
        } else {
            this.env.appMode = 'prod';
        }
        if(process?.resourcesPath){
            this.env.resourcesPath = process.resourcesPath;
        }
        if(process?.cwd){
            this.env.cwd = process.cwd();
        }
        ipcRenderer.invoke(GET_USER_DATA).then((userPath) => {
            if(userPath){
                this.env.home = userPath;
            }
        })
    }

    initializeSpecifications(){
        const os = require('os')

        const cpus = os.cpus();
        const mem = os.totalmem();
        const machine = os.machine();

        if(Array.isArray(cpus) && cpus.length > 0){
            const model = cpus[0]?.model;
            this.specifications.cpu = `${model}*${cpus.length}`;
        }
        if(mem){
            this.specifications.memory = `${(mem/1024/1024/1024).toFixed(0)}G`;
        }
        if(machine){
            this.specifications.machine = machine;
        }

        (async () => {
            const gpuTier = await getGPUTier();
          
            this.specifications.gpu = gpuTier.gpu;
        })();
    }

    async initializeUserSettings(){
        const udp = await this.getUserDataPath();
        Store.initializeStore(udp, ErrorMessageCallback);
        const userSettings = Store.getUserSettings();
        if(userSettings){
            this.userSettings = userSettings;
        }
    }

    initializeMessageCenter(){
        this.messageCenter[MESSAGE_OPEN_URL] = [];
        this.messageCenter[MESSAGE_CHANGE_LANG] = [];
        this.messageCenter[MESSAGE_CLOSE_APP] = [];
    }

    registerMessageHandler(name, handler){
        this.messageCenter[name].push(handler);
    }

    removeMessageHandler(name, handler){
        const idx = this.messageCenter[name].findIndex(h => h == handler);
        if(idx >= 0){
            this.messageCenter[name].splice(idx, 1);
        }
    }

    sendMessage(name, msg){
        this.messageCenter[name].forEach((cb) => {
            cb(msg);
        })
    }

    setLang(lang){
        if(lang !== 'zh' && lang !== 'en'){
            lang = 'en';
        }

        this.lang = lang;
        // 同步语言设置到主进程，确保弹窗使用正确的语言
        ipcRenderer.send(CHANGE_LANGUAGE, {
            lang: lang
        });
        setTimeout(() => {
            this.sendMessage(MESSAGE_CHANGE_LANG, this.lang);
        }, 500)
    }

    async getUserDataPath(){
        const udp = await ipcRenderer.invoke(GET_USER_DATA);
        return udp;
    }

    get currentUserGetter(){
        return this.userSettings.currentUser;
    }

    get currentTeamGetter(){
        return this.userSettings.currentTeam;
    }

    get etherIPGetter(){
        return this.preset.etherIP;
    }

    get pcEtherIPGetter(){
        return this.preset.pcEtherIP;
    }

    get typecEtherIPGetter(){
        return this.preset.typecEtherIP;
    }

    get pcTypecEtherIPGetter(){
        return this.preset.pcTypecEtherIP;
    }

    get pcNetMaskGetter(){
        return this.preset.pcNetMask;
    }

    get defaultUserGetter(){
        return this.preset.defaultUser;
    }

    get defaultPasswordGetter(){
        return this.preset.defaultPassword;
    }

    get isWinGetter(){
        return this.platform.isWin;
    }

    get isMacGetter(){
        return this.platform.isMac;
    }

    get isLinuxGetter(){
        return this.platform.isLinux;
    }

    get isDevModeGetter(){
        return this.env.isDevMode;
    }

    get appModeGetter(){
        return this.env.appMode;
    }

    get isTestModeGetter(){
        return this.env.appMode === 'test';
    }

    get isProdModeGetter(){
        return this.env.appMode === 'prod';
    }

    get pathResourcesGetter(){
        if(this.env.isDevMode){
            return path.resolve(this.env.cwd, './src/extraResources');
        }
        else{
            return this.env.resourcesPath;
        }
    }

    get pathHomeGetter(){
        return path.resolve(this.env.home, './.rdk_studio');
    }

    get localCpuGetter(){
        return this.specifications.cpu;
    }

    get localMemoryGetter(){
        return this.specifications.memory;
    }

    get localGpuGetter(){
        return this.specifications.gpu;
    }

    get langGetter(){
        return this.lang;
    }

    static instance = undefined;

    static getInstance(){
        if(GlobalConfig.instance === undefined){
            GlobalConfig.instance = new GlobalConfig();
        }
        return GlobalConfig.instance;
    }
}

export {
    GlobalConfig
}