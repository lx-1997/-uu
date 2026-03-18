<template>
    <h1>💖 Hello Electron!</h1>
    <p>Welcome to your Electron application.</p>

    <a-button @click="handleSSHClicked">SSH</a-button>
    <router-view>
        
    </router-view>
</template>
  
<script setup>
import { TestSSH } from '@/testssh';

const testSSH = new TestSSH();

function handleSSHClicked(){
    testSSH.connectSSH();
}

console.log('👋 This message is being logged by "App.vue", included via Vite');
</script>