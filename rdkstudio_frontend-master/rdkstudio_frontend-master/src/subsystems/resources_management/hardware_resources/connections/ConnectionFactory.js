import {
    CONNECTION_ETHERNET,
    CONNECTION_ETHERNET_ONE_TIME,
    CONNECTION_ETHERNET_SETTING_WLAN,
    CONNECTION_WLAN,
    CONNECTION_SERIALPORT,
    CONNECTION_TYPEC,
    CONNECTION_TYPEC_ONE_TIME,
    CONNECTION_TYPEC_SETTING_WLAN
} from '@hardware/constants/ConnectionConstants';


const SimpleConnectionFactory = async (type) => {
    let adapter = undefined;
    if(type === CONNECTION_ETHERNET){
        adapter = new (await import('./ConnectionAdapterEtherNet')).ConnectionAdapterEtherNet();
    }
    else if(type === CONNECTION_ETHERNET_ONE_TIME){
        adapter = new (await import('./ConnectionAdapterEtherNet')).ConnectionAdapterEtherNet(true);
    }
    else if(type === CONNECTION_ETHERNET_SETTING_WLAN){
        adapter = new (await import('./ConnectionAdapterEtherNet')).ConnectionAdapterEtherNet(false, true);
    }
    else if(type === CONNECTION_WLAN){
        adapter = new (await import('./ConnectionAdapterWlan')).ConnectionAdapterWlan();
    }
    else if(type === CONNECTION_SERIALPORT){

    }
    else if(type === CONNECTION_TYPEC){
        console.log('typec')
        adapter = new (await import('./ConnectionAdapterTypeC')).ConnectionAdapterTypeC();
    }
    else if(type === CONNECTION_TYPEC_ONE_TIME){
        adapter = new (await import('./ConnectionAdapterTypeC')).ConnectionAdapterTypeC(true);
    }
    else if(type === CONNECTION_TYPEC_SETTING_WLAN){
        adapter = new (await import('./ConnectionAdapterTypeC')).ConnectionAdapterTypeC(false, true);
    }
    
    return adapter;
}

export {
    SimpleConnectionFactory
}