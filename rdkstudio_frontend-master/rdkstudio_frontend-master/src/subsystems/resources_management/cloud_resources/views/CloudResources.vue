<template>
    <div class="cloud-main">
        <header class="cloud-header">
            <h3>Cloud Resources</h3>
            <a-button size="small"
                      type="primary"
                      style="background: rgba(255, 81, 28, 1);"
                      :icon="h(PlusOutlined)">Add Cloud</a-button>
        </header>
        <section class="cloud-section"></section>
    </div>
</template>

<script setup>
import { h, ref } from 'vue';

import {
    PlusOutlined,
} from '@ant-design/icons-vue';

</script>

<style lang="less" scoped>
@import url('@/assets/styles/common.less');

.cloud-main{
    height: 100%;
    background: whitesmoke;
    .cloud-header{
        height: 3rem;
        text-align: left;
        padding: .5rem;
        background: linear-gradient(to top, #06060a 0%,rgba(0,0,0,.95) 100%);
        .center;
        justify-content: space-between;
        color: white;
    }
}
</style>
