<template>
    <div class="hardware-container">
        <HardwareItem v-for="(item, index) of itemList" 
                      :id="index"
                      :key="`designed-${item.ip}`"
                      :info="item"
                      @deleteItem="emits('deleteItem', index)"
                      @statusChanged="emits('statusChanged', index, $event)"/>
        
    </div>
</template>

<script setup>
import HardwareItem from './HardwareDesignedItem.vue';

const props = defineProps({
    itemList: {
        type: Array,
        required: true
    }
})

const emits = defineEmits([
    'deleteItem',
    'statusChanged'
])

</script>

<style lang="less" scoped>
.hardware-container{
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(45rem, 1fr));
    grid-gap: 1rem;
}
</style>