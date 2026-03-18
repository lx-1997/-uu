<template>
    <section class="machine-item">
        <span class="machine-name">{{ machineName }}</span>
        <span class="machine-info"><b>CPU: </b>{{ machineCpu ? machineCpu : '--' }}</span>
        <span class="machine-info"><b>Memory: </b>{{ machineMemory ? machineMemory : '--' }}</span>
        <span class="machine-info"><b>GPU: </b>{{ machineGpu ? machineGpu : '--' }}</span>
        <span class="machine-info"><b>Docker: </b>{{ !dockerInstalled ? 'not install' : dockerRunning ? 'working' : 'not working' }}</span>

        <div class="machine-operation">
            <a-button v-if="!dockerInstalled"
                      size="small" 
                      type="primary" 
                      style="background: orange;"
                      @click="emits('installDocker')">Install</a-button>
            <a-button v-else-if="!dockerRunning"
                      size="small" 
                      type="primary" 
                      style="background: green;"
                      @click="emits('launchDocker')">Launch</a-button>
            <a-button size="small" 
                      shape="circle"
                      :icon="h(ReloadOutlined)"
                      @click="emits('refreshStatus')"></a-button>
        </div>
    </section>
</template>

<script setup>
import { h } from 'vue';
import {
    ReloadOutlined
} from '@ant-design/icons-vue';

const props = defineProps({
    machineName: {
        type: String,
        required: true
    },
    machineCpu: {
        type: String,
        required: false
    },
    machineMemory: {
        type: String,
        required: false
    },
    machineGpu: {
        type: String,
        required: false
    },
    dockerInstalled: {
        type: Boolean,
        required: false
    },
    dockerRunning: {
        type: Boolean,
        required: false
    }
})

const emits = defineEmits([
    'installDocker',
    'launchDocker',
    'refreshStatus',
    'stopDocker'
])

</script>

<style lang="less" scoped>
@import url('@/assets/styles/common.less');

.machine-item{
    position: relative;
    .center;
    justify-content: flex-start;
    align-items: flex-end;
    height: 2rem;
    padding: 0 .5rem;
    background: rgba(255, 165, 10, .05);
    .machine-name{
        color: orange;
        font-weight: bold;
        font-size: 1.1rem;
    }
    .machine-info{
        font-size: .6rem;
        padding: 0 .3rem;
        text-align: bottom;
    }
    .machine-operation{
        position: absolute;
        top: 0;
        right: 0;
        height: 100%;
        padding: 0 .5rem;
        .center;
    }
}
</style>