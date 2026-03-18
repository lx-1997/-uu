<template>
    <div v-if="!isProdMode" class="submenu">
        <header>
            <a-button type="primary" style="margin: .5rem" @click="toggleCollapsed">
                <MenuUnfoldOutlined v-if="state.collapsed" />
                <MenuFoldOutlined v-else />
            </a-button>
            <h3 v-if="!state.collapsed">Resources</h3>
        </header>
        
        <a-menu v-model:selectedKeys="state.selectedKeys" 
                theme="dark"
                mode="inline"
                :items="items"
                :inline-collapsed="state.collapsed"
                @click="handleMenuClicked">
        </a-menu>
    </div>
    <div class="subcontent">
        <router-view />
    </div>
</template>

<script setup>
import { h, reactive, computed } from 'vue';
import router from '@/router';
import {
    AppstoreOutlined,
    LaptopOutlined,
    TeamOutlined,
    AntCloudOutlined,
    CloudServerOutlined,
    MenuUnfoldOutlined,
    MenuFoldOutlined
} from '@ant-design/icons-vue';
import {
    ROUTE_HARDWARE_RESOURCES,
    ROUTE_TEAM_RESOURCES,
    ROUTE_COMPUTING_RESOURCES,
    ROUTE_DATA_RESOURCES,
    ROUTE_CLOUD_RESOURCES,
} from '@/router/routes';
import {
    GlobalConfig
} from '@/global_configuration/GlobalConfig';

const Config = GlobalConfig.getInstance();

// 判断是否为生产模式
const isProdMode = computed(() => {
    return Config.isProdModeGetter;
});

const state = reactive({
    collapsed: true,
    selectedKeys: [ROUTE_HARDWARE_RESOURCES],
});

function getItem(label,key,icon,children,type,) {
    return {
        key,
        icon,
        children,
        label,
        type,
    }
}

const items = reactive([
  getItem('Hardware Resources', ROUTE_HARDWARE_RESOURCES, h(LaptopOutlined)),
//   getItem('Team Resources', ROUTE_TEAM_RESOURCES, h(TeamOutlined)),
//   getItem('Application Resources', ROUTE_DATA_RESOURCES, h(AppstoreOutlined)),
  getItem('Computing Resources', ROUTE_COMPUTING_RESOURCES, h(AntCloudOutlined)),
  getItem('Cloud Resources', ROUTE_CLOUD_RESOURCES, h(CloudServerOutlined))
]);

function handleMenuClicked(item){
    console.log(item.key)
    router.push(item.key);
}

const toggleCollapsed = () => {
  state.collapsed = !state.collapsed;
};
</script>

<style lang="less" scoped>
@import url('@/assets/styles/common.less');

.submenu {
    // width: 12rem;
    // width: 0;
    height: 100%;
    // visibility: hidden;
    // background: rgba(0, 0, 0, .05);
    text-align: left;
    header{
        .center;
        justify-content: flex-start;
    }
    h3{
        padding: .5rem;
        color: white;
    }
}

.subcontent {
    width: 100%;
    height: 100%;
    background: transparent;
}

// animations
.fade-enter-active,
.fade-leave-active {
    transition: opacity .1s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}
</style>