<template>
    <section class="side-bar-main">
        <div class="team-area">
            <!-- <a-button shape="circle"
                      size="small"
                      style="background: orange; color: white;"
                      :icon="h(MoreOutlined)">
            </a-button>
            <div class="team-button">
                <TeamOutlined />
            </div>
            <a-button shape="circle"
                      size="small"
                      style="background: orange; color: white;"
                      :icon="h(PlusOutlined)">
            </a-button> -->
            <img src="@/assets/images/image-logo.png">
        </div>
        <div class="middle-content">
            <div class="inside-apps">
                <SideBarIcon v-for="item of insideAppRefs"
                             :key="`inside-${item.url}`"
                             :title="item.name"
                             :is-focused="item.focused"
                             @click="handleInsideAppClicked(item)">
                    <InboxOutlined />
                </SideBarIcon>
            </div>
            <div class="official-apps">
                <SideBarIcon v-for="item of officialAppRefs" 
                             :key="`official-${item.url}`" 
                             :title="item.name"
                             :is-focused="item.focused"
                             @click="handleOfficialAppClicked(item)">
                    <CommentOutlined />
                </SideBarIcon>
            </div>
            <div class="plugin-apps">
                <SideBarIcon v-for="item of pluginAppRefs" 
                             :key="`plugin-${item.url}`" 
                             :title="item.name"
                             :is-focused="item.focused"
                             @click="handlePluginAppClicked(item)">
                    <CommentOutlined />
                </SideBarIcon>
            </div>
        </div>

        <section class="bottom-area">
            <div class="open-urls">
                <a-tooltip v-for="item of openUrlRefs"
                            :key="`url-${item.url}`"
                            :title="item.ip"
                            placement="right">
                    <SideBarIcon :title="item.name"
                                 :needs-close="true"
                                 :is-focused="item.focused"
                                 @click="handleOpenUrlClicked(item)"
                                 @close="handleCloseUrlClicked(item)">
                        <LinkOutlined />
                    </SideBarIcon>
                </a-tooltip>
                
            </div>
            <div class="user-settings-area">
                <!-- <a-button shape="circle"
                        size="small"
                        style="background: orange; color: white;"
                        :icon="h(UserOutlined)">
                </a-button>
                <a-button shape="circle"
                        size="small"
                        style="background: orange; color: white;"
                        :icon="h(SettingOutlined)">
                </a-button> -->
                <a-dropdown placement="top"
                            :trigger="['click']">
                    <TranslationOutlined style="color: orangered;"/>
                    <template #overlay>
                        <a-menu @click="emits('changeLanguage', $event)">
                            <a-menu-item key="zh">中文</a-menu-item>
                            <a-menu-item key="en">English</a-menu-item>
                        </a-menu>
                    </template>
                </a-dropdown>
                <a-popover placement="rightBottom">
                    <template #title>
                        <span>{{ $t('studio.titles.learnMore') }}</span>
                    </template>
                    <template #content>
                        <!-- <a-button type="link" @click="handleExternalLinkClicked('https://developer.d-robotics.cc/rdk_doc/Basic_Application/studio')">{{ $t('studio.titles.document') }}</a-button><br> -->
                        <a-button type="link" @click="handleExternalLinkClicked('https://www.bilibili.com/opus/1058954797113147396')">{{ $t('studio.titles.videoTutorials') }}</a-button><br>
                        <a-button type="link" @click="handleExternalLinkClicked('https://developer.d-robotics.cc/forumList?id=155&title=RDK%20Studio')">{{ $t('studio.titles.document') }}</a-button><br>
                        <a-button type="link" @click="handleExternalLinkClicked('https://developer.d-robotics.cc/forumList?id=155&title=RDK%20Studio')">{{ $t('studio.titles.forum') }}</a-button><br>
                        <a-button type="link" @click="handleExternalLinkClicked('https://developer.d-robotics.cc/forumList?id=155&title=RDK%20Studio')">{{ $t('studio.titles.helpCenter') }}</a-button><br>
                        <!-- <a-button type="link" @click="handleExternalLinkClicked('https://developer.d-robotics.cc/rdk_doc/FAQ/studio')">{{ $t('studio.titles.helpCenter') }}</a-button><br> -->
                    </template>
                    <BookOutlined  class="blink-text"/>
                </a-popover>
                <a-tooltip placement="right" color="orangered">
                    <template #title>
                        <span>{{ $t('studio.copyright') }}</span>
                    </template>
                    <CopyrightCircleOutlined style="color: orangered;"/>
                </a-tooltip>
                <a-tooltip placement="right" color="orangered">
                    <template #title>
                        <span>{{ $t('studio.titles.changelog') }}</span>
                    </template>
                    <span style="color: orangered; font-size: 60%; cursor: pointer;" @click="handleChangelogClicked">v{{ versionRef }}</span>
                </a-tooltip>
            </div>
        </section>
        
        <ChangelogModal v-model:open="changelogModalVisible" />
    </section>
</template>

<script setup>
import { ref, h, onMounted } from 'vue';
import {
    SideBarManager
} from '@/managers/SideBarManager';
import {
    ROUTE_PLUGIN_IMAGER,
    ROUTE_HARDWARE_RESOURCES,
    ROUTE_EXAMPLES,
} from '@/router/routes';
import {
    MoreOutlined,
    PlusOutlined,
    TeamOutlined,
    UserOutlined,
    SettingOutlined,
    InboxOutlined,
    CommentOutlined,
    LinkOutlined,
    TranslationOutlined,
    CopyrightCircleOutlined,
    BookOutlined,
} from '@ant-design/icons-vue';
import SideBarIcon from './SideBarIcon.vue';
import ChangelogModal from './ChangelogModal.vue';
import { shell } from 'electron';

const insideAppRefs = ref([]);
const officialAppRefs = ref([]);
const pluginAppRefs = ref([]);
const openUrlRefs = ref([]);
const versionRef = ref('');
const changelogModalVisible = ref(false);
let currentInsideApp = {};

const emits = defineEmits([
    'setWebviewOperations',
    'changeLanguage',
]);

const sideBarManager = new SideBarManager((msg) => {
    clearUrl(msg.url);

    const idx = openUrlRefs.value.findIndex((item) => item.url === msg.url);
    if(idx >= 0){
        openUrlRefs.value[idx].focused = true;
    }
    else{
        const obj = {
            url: msg.url,
            ip: msg.ip,
            name: msg.name,
            focused: true,
        };
        openUrlRefs.value.push(obj);
    }
    sideBarManager.handleOpenUrlClicked(msg.url);
    emits('setWebviewOperations', {
        needsOperations: true,
        url: msg.url,
        ip: msg.ip,
        name: msg.name
    });
});

const clearUrl = (url) => {
    insideAppRefs.value.forEach((obj) => {
        if(obj.focused && obj.url !== url){
            obj.focused = false;
        }
    })

    pluginAppRefs.value.forEach((obj) => {
        if(obj.focused && obj.url !== url){
            obj.focused = false;
        }
    })

    officialAppRefs.value.forEach((obj) => {
        if(obj.focused && obj.url !== url){
            obj.focused = false;
            sideBarManager.handleHideOfficialAppClicked(obj.url);
        }
    })

    openUrlRefs.value.forEach((obj) => {
        if(obj.focused && obj.url !== url){
            obj.focused = false;
            sideBarManager.handleHideUrlClicked(obj.url);
        }
    })
}

const handleExternalLinkClicked = (link) => {
    if(link){
        shell.openExternal(link);
    }
}

const handleInsideAppClicked = (item) => {
    clearUrl('');
    item.focused = true;
    currentInsideApp = item;

    emits('setWebviewOperations', {
        needsOperations: false,
        url: ''
    });

    sideBarManager.handleOpenInsideAppClicked(item.url);
}

const handlePluginAppClicked = (item) => {
    sideBarManager.handleOpenNewWindowClicked(item.url)
    // clearUrl(item.url);

    // item.focused = true;

    // emits('setWebviewOperations', {
    //     needsOperations: false,
    //     url: ''
    // });

    // sideBarManager.handleOpenPluginAppClicked(item.url);
}

const handleOfficialAppClicked = (item) => {
    console.log('official app: ', item)
    clearUrl(item.url);

    item.focused = true;
    sideBarManager.handleOpenOfficialAppClicked(item.url);

    emits('setWebviewOperations', {
        needsOperations: true,
        url: item.url
    });
}

const handleOpenUrlClicked = (item) => {
    clearUrl(item.url);

    item.focused = true;
    sideBarManager.handleOpenUrlClicked(item.url);

    emits('setWebviewOperations', {
        needsOperations: true,
        url: item.url
    });
}

const handleCloseUrlClicked = (item) => {
    const idx = openUrlRefs.value.findIndex((obj) => {
        return obj.url === item.url;
    })
    if(idx >= 0){
        //test ip segment here
        if(item?.ip){
            sideBarManager.askCloseTab(() => {
                // close app
                sideBarManager.sendCloseAppMessage(item.url);

                openUrlRefs.value.splice(idx, 1);

                sideBarManager.handleCloseUrlClicked(item.url);
            }, () => {
                openUrlRefs.value.splice(idx, 1);

                sideBarManager.handleCloseUrlClicked(item.url);
            })
        }
        else{
            openUrlRefs.value.splice(idx, 1);

            sideBarManager.handleCloseUrlClicked(item.url);
        }
    }

    currentInsideApp.focused = true;
    emits('setWebviewOperations', {
        needsOperations: false,
        url: ''
    });
}

const handleCloseTabClicked = (url) => {
    console.log('close tab: ', url)
    const odx = officialAppRefs.value.findIndex((item) => {
        return item.url === url;
    });
    if(odx >= 0){
        handleInsideAppClicked();
        return;
    }

    const udx = openUrlRefs.value.findIndex((item) => {
        return item.url === url;
    });
    if(udx >= 0){
        const item = openUrlRefs.value[udx];
        handleCloseUrlClicked(item);
    }
}

const handleChangelogClicked = () => {
    changelogModalVisible.value = true;
}

setTimeout(() => {
    versionRef.value = sideBarManager.appVersionGetter;
}, 1500)

insideAppRefs.value.push({
    name: 'Resource',
    url: ROUTE_HARDWARE_RESOURCES,
    focused: true
})

insideAppRefs.value.push({
    name: 'Examples',
    url: ROUTE_EXAMPLES,
    focused: false
})

officialAppRefs.value.push({
    name: 'Community',
    url: 'https://developer.d-robotics.cc/forum',
    focused: false,
})

officialAppRefs.value.push({
    name: 'Nodehub',
    url: 'https://developer.d-robotics.cc/nodehub',
    focused: false,
})

pluginAppRefs.value.push({
    name: 'Imager',
    url: ROUTE_PLUGIN_IMAGER,
    focused: false
})

defineExpose({
    handleCloseTabClicked
})

onMounted(() => {
    currentInsideApp = insideAppRefs.value[0];
})
</script>

<style lang="less" scoped>
@import url('@/assets/styles/common.less');

.side-bar-main{
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    .team-area{
        flex-shrink: 0;
        .center;
        flex-direction: column;
        padding: 1.5rem 0;
        .team-button{
            border: solid 1px rgba(0,0,0,.2);
            border-radius: .2rem;
            margin: .5rem;
            width: 2.5rem;
            height: 2.5rem;
            background: rgba(0,0,0,.1);
            .center;
        }
        img{
            width: 2rem;
            height: 2rem;
        }
    }
    .middle-content{
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
    }
    .inside-apps{
        flex-shrink: 0;
        .center;
        flex-direction: column;
        padding: .3rem .2rem;
        border-bottom: solid 1px rgba(0,0,0,.2);
    }
    

    .official-apps{
        flex-shrink: 0;
        .center;
        flex-direction: column;
        padding: .3rem .2rem;
    }

    .plugin-apps{
        flex-shrink: 0;
        .center;
        flex-direction: column;
        padding: .3rem .2rem;
    }

    .bottom-area{
        flex-shrink: 0;
        width: 100%;
        z-index: 10;
        .open-urls{
            .center;
            flex-direction: column;
            padding: .3rem .2rem;
            border-top: solid 1px rgba(0,0,0,.1);
            max-height: 12rem;
            overflow-x: hidden;
            overflow-y: auto;
        }
        .user-settings-area{
            .center;
            flex-direction: column;
            padding-bottom: 1rem;
            gap: 1rem;
        }
    }
    
    .blink-text{
        color: orangered;
        animation: blink 1.5s 120;
    }

}
</style>