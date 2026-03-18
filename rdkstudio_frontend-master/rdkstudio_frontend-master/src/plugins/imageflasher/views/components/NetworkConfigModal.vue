<template>
    <a-modal
        v-model:open="modalVisible"
        :title="$t('plugins.imager.titles.networkConfigTitle')"
        :width="500"
        :ok-text="$t('plugins.imager.labels.save')"
        :cancel-text="$t('plugins.imager.labels.cancel')"
        @ok="handleSave"
        @cancel="handleCancel">
        <a-form
            :model="formState"
            :label-col="{ span: 6 }"
            :wrapper-col="{ span: 18 }">
            <a-form-item
                :label="$t('plugins.imager.labels.networkMode')"
                :rules="[{ required: true, message: $t('plugins.imager.errors.networkModeRequired') }]">
                <a-radio-group v-model:value="formState.networkMode">
                    <a-radio value="station">{{ $t('plugins.imager.labels.stationMode') }}</a-radio>
                    <a-radio value="ap">{{ $t('plugins.imager.labels.apMode') }}</a-radio>
                </a-radio-group>
            </a-form-item>
            <a-form-item
                :label="$t('plugins.imager.labels.wifiName')"
                :rules="[{ required: true, message: $t('plugins.imager.errors.wifiNameRequired') }]">
                <a-input
                    v-model:value="formState.wifiName"
                    :placeholder="$t('plugins.imager.labels.wifiNamePlaceholder')" />
            </a-form-item>
            <a-form-item
                :label="$t('plugins.imager.labels.wifiPassword')"
                :rules="[
                    { required: true, message: $t('plugins.imager.errors.wifiPasswordRequired') },
                    { min: 8, message: $t('plugins.imager.errors.wifiPasswordMinLength') }
                ]">
                <a-input-password
                    v-model:value="formState.wifiPassword"
                    :placeholder="$t('plugins.imager.labels.wifiPasswordPlaceholder')" />
            </a-form-item>
            <a-form-item
                :label="$t('plugins.imager.labels.mountPoint')"
                :rules="[{ required: true, message: $t('plugins.imager.errors.mountPointRequired') }]">
                <a-select
                    v-model:value="formState.mountPoint"
                    :placeholder="$t('plugins.imager.labels.mountPointPlaceholder')"
                    :loading="mountPointsLoading"
                    @focus="loadMountPoints">
                    <a-select-option v-for="mp in mountPoints" :key="mp" :value="mp">
                        {{ mp }}
                    </a-select-option>
                </a-select>
                <a-button 
                    type="link" 
                    size="small" 
                    @click="loadMountPoints"
                    style="padding: 0; margin-top: 4px;">
                    {{ $t('plugins.imager.labels.refreshMountPoints') }}
                </a-button>
            </a-form-item>
        </a-form>
    </a-modal>
</template>

<script setup>
import { ref, watch, computed, h } from 'vue';
import { message, Modal } from 'ant-design-vue';
import i18n from '@/locales';
import { GlobalConfig } from '@/global_configuration/GlobalConfig.js';

const fs = require('fs');
const path = require('path');
const Config = GlobalConfig.getInstance();

const { t } = i18n.global;

const props = defineProps({
    open: {
        type: Boolean,
        default: false
    },
    targetDevice: {
        type: String,
        default: ''
    },
    flashManager: {
        type: Object,
        required: true
    }
});

const emits = defineEmits(['update:open', 'save']);

const modalVisible = computed({
    get: () => props.open,
    set: (value) => emits('update:open', value)
});

const formState = ref({
    networkMode: 'station', // 默认选择station模式
    wifiName: '',
    wifiPassword: '',
    mountPoint: ''
});

const mountPoints = ref([]);
const mountPointsLoading = ref(false);

const handleSave = async () => {
    // 验证表单
    if (!formState.value.wifiName || !formState.value.wifiPassword) {
        message.error(t('plugins.imager.errors.fillAllFields'));
        return;
    }

    if (formState.value.wifiPassword.length < 8) {
        message.error(t('plugins.imager.errors.wifiPasswordMinLength'));
        return;
    }
    
    if (!formState.value.mountPoint) {
        message.error(t('plugins.imager.errors.mountPointRequired'));
        return;
    }

    // 构建配置对象
    const networkConfig = {};
    if (formState.value.networkMode === 'ap') {
        networkConfig.wifi_type = 'ap';
        networkConfig.wifi_ap_ssid = formState.value.wifiName;
        networkConfig.wifi_ap_passwd = formState.value.wifiPassword;
        networkConfig.wifi_ap_band = 'auto';
        networkConfig.ethip_type = 'static';
        networkConfig.ethip_address = '192.168.127.10';
        networkConfig.ethip_netmask = '255.255.255.0';
        networkConfig.ethip_gateway = '192.168.127.1';
    } else {
        networkConfig.wifi_type = 'station';
        networkConfig.wifi_station_ssid = formState.value.wifiName;
        networkConfig.wifi_station_passwd = formState.value.wifiPassword;
        networkConfig.ethip_type = 'static';
        networkConfig.ethip_address = '192.168.127.10';
        networkConfig.ethip_netmask = '255.255.255.0';
        networkConfig.ethip_gateway = '192.168.127.1';
    }

    try {
        // 保存配置到设备
        const mountPoint = formState.value.mountPoint;
        console.log('开始保存网络配置到挂载点:', mountPoint);
        console.log('配置内容:', networkConfig);
        
        await props.flashManager.saveNetworkConfigToMountPoint(mountPoint, networkConfig);
        
        console.log('网络配置保存成功');
        message.success(t('plugins.imager.titles.networkConfigSaved'));
        emits('save');
        handleCancel();
    } catch (error) {
        console.error('保存网络配置失败:', error);
        message.error(t('plugins.imager.errors.saveNetworkConfigFailed') + ': ' + (error.message || error));
    }
};

const loadMountPoints = () => {
    mountPointsLoading.value = true;
    try {
        let validMountPoints = [];
        
        if (Config.isMacGetter) {
            // macOS: 挂载点在 /Volumes 目录下
            const volumesPath = '/Volumes';
            if (fs.existsSync(volumesPath)) {
                const dirs = fs.readdirSync(volumesPath);
                validMountPoints = dirs
                    .filter(dir => {
                        // 过滤系统卷和隐藏目录
                        if (dir.startsWith('.')) return false;
                        if (dir === 'Macintosh HD' || dir === 'Macintosh HD - Data') return false;
                        
                        const fullPath = path.join(volumesPath, dir);
                        try {
                            const stats = fs.statSync(fullPath);
                            return stats.isDirectory();
                        } catch (e) {
                            return false;
                        }
                    })
                    .map(dir => path.join(volumesPath, dir));
            }
        } else if (Config.isWinGetter) {
            // Windows: 挂载点是盘符，如 C:, D:, E: 等
            // 检查 A-Z 盘符，排除系统盘 C:（可选）
            const drives = [];
            for (let i = 65; i <= 90; i++) { // A-Z
                const driveLetter = String.fromCharCode(i) + ':';
                const drivePath = driveLetter + '\\';
                try {
                    if (fs.existsSync(drivePath)) {
                        const stats = fs.statSync(drivePath);
                        if (stats.isDirectory()) {
                            drives.push(drivePath);
                        }
                    }
                } catch (e) {
                    // 忽略无法访问的盘符
                }
            }
            validMountPoints = drives;
        } else if (Config.isLinuxGetter) {
            // Linux: 挂载点在 /media/ 和 /mnt/ 目录下
            const mediaPath = '/media';
            const mntPath = '/mnt';
            const mountPoints = [];
            
            // 检查 /media/username 目录
            if (fs.existsSync(mediaPath)) {
                try {
                    const mediaDirs = fs.readdirSync(mediaPath);
                    mediaDirs.forEach(dir => {
                        const userMediaPath = path.join(mediaPath, dir);
                        try {
                            if (fs.statSync(userMediaPath).isDirectory()) {
                                const subDirs = fs.readdirSync(userMediaPath);
                                subDirs.forEach(subDir => {
                                    const mountPoint = path.join(userMediaPath, subDir);
                                    try {
                                        if (fs.statSync(mountPoint).isDirectory()) {
                                            mountPoints.push(mountPoint);
                                        }
                                    } catch (e) {
                                        // 忽略无法访问的目录
                                    }
                                });
                            }
                        } catch (e) {
                            // 忽略无法访问的目录
                        }
                    });
                } catch (e) {
                    console.warn('[NetworkConfigModal] 无法读取 /media 目录:', e);
                }
            }
            
            // 检查 /mnt 目录
            if (fs.existsSync(mntPath)) {
                try {
                    const mntDirs = fs.readdirSync(mntPath);
                    mntDirs.forEach(dir => {
                        const mountPoint = path.join(mntPath, dir);
                        try {
                            if (fs.statSync(mountPoint).isDirectory()) {
                                mountPoints.push(mountPoint);
                            }
                        } catch (e) {
                            // 忽略无法访问的目录
                        }
                    });
                } catch (e) {
                    console.warn('[NetworkConfigModal] 无法读取 /mnt 目录:', e);
                }
            }
            
            validMountPoints = mountPoints;
        }
        
        mountPoints.value = validMountPoints;
        console.log('[NetworkConfigModal] 找到的挂载点:', validMountPoints);
        
        if (validMountPoints.length === 0) {
            const platformName = Config.isMacGetter ? 'macOS' : (Config.isWinGetter ? 'Windows' : 'Linux');
            message.warning(`未找到可用的挂载点（${platformName}）`);
        }
    } catch (error) {
        console.error('[NetworkConfigModal] 加载挂载点失败:', error);
        message.error('加载挂载点失败: ' + error.message);
        mountPoints.value = [];
    } finally {
        mountPointsLoading.value = false;
    }
};

const handleCancel = () => {
    // 重置表单
    formState.value = {
        networkMode: 'station', // 默认选择station模式
        wifiName: '',
        wifiPassword: '',
        mountPoint: ''
    };
    modalVisible.value = false;
};

// 监听弹窗打开，重置表单并加载挂载点
watch(() => props.open, (newVal) => {
    if (newVal) {
        formState.value = {
            networkMode: 'station', // 默认选择station模式
            wifiName: '',
            wifiPassword: '',
            mountPoint: ''
        };
        loadMountPoints();
    }
});
</script>

<style lang="less" scoped>
:deep(.ant-modal-content) {
    background: rgba(255, 255, 255, 0.95);
    color: black;
}

:deep(.ant-modal-header) {
    background: rgba(255, 255, 255, 0.95);
    border-bottom: 1px solid rgba(0, 0, 0, 0.1);
}

:deep(.ant-modal-title) {
    color: black !important;
}

:deep(.ant-modal-body) {
    background: rgba(255, 255, 255, 0.95);
    color: black;
}

:deep(.ant-form-item-label > label) {
    color: black !important;
}

:deep(.ant-input),
:deep(.ant-input-password) {
    background: rgba(255, 255, 255, 1);
    border-color: rgba(0, 0, 0, 0.2);
    color: black !important;
}

:deep(.ant-input::placeholder),
:deep(.ant-input-password::placeholder) {
    color: rgba(0, 0, 0, 0.5);
}

:deep(.ant-radio-wrapper) {
    color: black !important;
}

:deep(.ant-radio-wrapper-checked) {
    color: black !important;
}

:deep(.ant-modal-close) {
    color: black !important;
}

:deep(.ant-modal-close:hover) {
    color: rgba(0, 0, 0, 0.7) !important;
}
</style>

