<template>
    <div class="sidebar-icon" :class="{'focused-icon': isFocused}">
        <slot></slot><br>
        <span>{{ $t(`studio.apps.${title}`).indexOf('studio.apps') === 0 ? title : $t(`studio.apps.${title}`) }}</span>
        <div v-if="needsClose"
             class="close-btn"
             @click.stop="emits('close')">x</div>
    </div>
</template>

<script setup>

const props = defineProps({
    title: {
        type: String,
        required: true
    },
    needsClose: {
        type: Boolean,
        required: false,
        default: false
    },
    isFocused: {
        type: Boolean,
        required: true,
        default: false
    }
})

const emits = defineEmits([
    'close'
])

</script>

<style lang="less" scoped>
@import url('@/assets/styles/common.less');
.sidebar-icon{
    position: relative;
    width: 100%;
    margin: .2rem .2rem;
    padding: .3rem .1rem;
    border: solid 1px rgba(200,200,200,.2);
    border-radius: .2rem;
    background: hsla(0, 0%, 100%, .15);
    transition: background .2s ease;
    color: white;

    .close-btn{
        position: absolute;
        top: -0.3rem;
        right: -0.25rem;
        width: 0.8rem;
        height: 0.8rem;
        padding-bottom: .1rem;
        border-radius: .4rem;
        border: solid 1px white;
        color: white;
        font-size: 0.6rem;
        user-select: none;
        background: hsla(0, 0%, 100%, .4);
        .center;
        &:hover{
            background: @theme-color;
            cursor: pointer;
        }
    }
    
    span{
        font-size: x-small;
        font-weight: bold;
        user-select: none;
        &:hover{
            cursor: pointer;
        }
    }
    
    &:hover{
        background: hsla(0, 0%, 100%, .1);
    }
}

.focused-icon{
    color: @theme-color !important;
    background: rgba(245, 108, 3, 0.2);
    border: solid 1px @theme-color;
}
</style>