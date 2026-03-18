<template>
    <div class="computing-item">
        <div class="item-header">
            <span>{{ computingItem.name }}</span>
            <span style="font-size: .6rem;">Status: {{ !computingItem.isLoaded ? 'Unloaded' : computingItem.isRunning ? 'running' : 'not running'}}</span>
            <a-button v-if="!computingItem.isLoaded" 
                            size="small"
                            @click="emits('downloadItem')">Download</a-button>
            <a-button v-else-if="!computingItem.isRunning"
                            size="small"
                            @click="emits('launchItem')">Launch</a-button>
            <a-button v-else size="small"
                             @click="emits('closeItem')">Close</a-button>
        </div>
        <div class="item-info"></div>
        <div class="item-apps">
            <template v-if="computingItem.isRunning">
                <a-button size="small">ToolA</a-button>
                <a-button size="small">ToolB</a-button>
            </template>
        </div>

        <div v-if="computingItem.isDownloading" class="progress-mask">
            <div>Downloading...</div>
            <div>
                <a-progress :steps="100"
                        size="small"
                        :percent="computingItem.downloadProgress"></a-progress>
            </div>
            <div class="progress-speed">{{ computingItem.downloadSpeed }}</div>
        </div>

        <div v-if="computingItem.isLoading" class="loading-mask">
            <div>Loading...</div>
            <div>Please wait with patience!</div>
        </div>
    </div>
</template>

<script setup>
import { onMounted } from 'vue';

const props = defineProps({
    computingItem: {
        type: Object,
        required: true
    },
})

const emits = defineEmits([
    'checkStatus',
    'downloadItem',
    'launchItem',
    'closeItem'
])

onMounted(() => {
    emits('checkStatus');
})

</script>

<style lang="less" scoped>
@import url('@/assets/styles/common.less');

.computing-item{
    position: relative;
    height: 5rem;
    background: rgba(0,0,0,.01);
    border-radius: .5rem;
    box-shadow: 0 0 .2rem rgba(0,0,0,.3);
    margin: .5rem;
    .item-header{
        text-align: left;
        padding: 0 .5rem;
    }

    .progress-mask{
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 10;
        background: rgba(255, 255, 255, .8);
        .center;
        flex-direction: column;
        .progress-speed{
            font-size: .6rem;
        }
    }

    .loading-mask{
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 11;
        background: rgba(255, 255, 255, .8);
        .center;
        flex-direction: column;
    }
}
</style>