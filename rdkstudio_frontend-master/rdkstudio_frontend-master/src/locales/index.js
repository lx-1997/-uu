import { createI18n } from "vue-i18n";

import zh from './languages/zh-CN';
import en from './languages/en-US';

import {
    GlobalConfig
} from '@/global_configuration/GlobalConfig';
const Config = GlobalConfig.getInstance();

let lang = Intl.DateTimeFormat().resolvedOptions().locale;
lang = lang.substr(0, 2);
if(lang !== 'en' && lang !== 'zh'){
    lang = 'en';
}

const customDataArg = process.argv.find(arg => arg.startsWith('--custom-data='));
if(customDataArg){
    const customData = JSON.parse(customDataArg.split('=')[1]);
    console.log('Received data:', customData);
    if(customData?.lang){
        lang = customData.lang;
    }
}

Config.setLang(lang);

const i18n = createI18n({
    legacy: false,
    globalInjection: true,
    locale: lang,
    messages: {
        zh,
        en
    }
});

export default i18n;