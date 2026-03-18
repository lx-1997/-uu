import { createRouter, createWebHashHistory } from "vue-router";

import RDKStudio from '@/views/RDKStudio.vue';
// import AppTest from '@/AppTest.vue'


const routes = [
    {
        path: "/",
        // component: AppTest,
        // redirect: '/rdkstudio',
        // children: [
        //     {
        //         path: 'rdkstudio',
        //         component: RDKStudio,
        //     }
        // ]
        component: RDKStudio,
        redirect: "/resource/hardware",
        children: [
            {
                path: "resource",
                component: () => import('@/subsystems/resources_management/views/ResourcesManagement.vue'),
                children: [
                    {
                        path: "hardware",
                        component: () => import('@hardware/views/HardwareResources.vue'),
                    },
                    {
                        path: "team",
                        component: () => import('@/subsystems/resources_management/team_resources/views/TeamResources.vue'),
                    },
                    {
                        path: "data",
                        component: () => import('@/subsystems/resources_management/data_resources/views/DataResources.vue'),
                    },
                    {
                        path: "computing",
                        component: () => import('@/subsystems/resources_management/computing_resources/views/ComputingResources.vue'),
                    },
                    {
                        path: "cloud",
                        component: () => import('@/subsystems/resources_management/cloud_resources/views/CloudResources.vue')
                    }
                ]
            },
            {
                path: "examples",
                component: () => import('@/subsystems/example_management/views/ExampleManagement.vue')
            },
            {
                path: "plugin/imager",
                component: () => import('@/plugins/imageflasher/views/Imager.vue')
            }
        ]
    }
    
];

const router = createRouter({
    history: createWebHashHistory(),
    routes
});

export default router;