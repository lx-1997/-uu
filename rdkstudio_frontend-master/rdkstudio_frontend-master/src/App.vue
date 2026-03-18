<template>
  <a-config-provider :locale="locale">
    <router-view />
  </a-config-provider>
</template>

<script setup>
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import enUS from 'ant-design-vue/es/locale/en_US';
import {
  MESSAGE_CHANGE_LANG
} from '@/constants/AppMessageNames';

import { ref } from 'vue';
import {
    GlobalConfig
} from '@/global_configuration/GlobalConfig';
const Config = GlobalConfig.getInstance();

const locale = ref(zhCN);

Config.registerMessageHandler(MESSAGE_CHANGE_LANG, (lang) => {
  console.log('recivie lang from message center: ', lang)
  if(lang === 'zh'){
    locale.value = zhCN;
  }
  else{
    locale.value = enUS;
  }
})

</script>

<style lang="less">
html,
body {
  padding: 0;
  margin: 0;
}

#app {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
  background: rgba(255, 248, 50, .15);
}

::-webkit-scrollbar {
  width: 4px;
  height: 5px;
}

::-webkit-scrollbar-thumb {
  border-radius: 2px;
  -webkit-box-shadow: inset 0 0 6px rgba(0, 0, 0, .3);
  background: rgba(255, 255, 255, 0.5);
}
</style>
