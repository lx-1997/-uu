const { Client } = require("basic-ftp") 

async function example(){

    const client = new Client()
    client.ftp.verbose = true

    try{
        let totalSize = 0;
        client.trackProgress((info) => {
            console.log(info.bytesOverall);
        })
        await client.access({
            host: "vrftp.horizon.ai"
        })
        console.log(await client.list('/AIoT'))
        // totalSize = await client.size("/AIoT/convert_toolchain_1.0.tar.gz");
        // await client.downloadTo('/Users/wuyupei/Downloads/convert_toolchain_1.0.tar.gz', '/AIoT/convert_toolchain_1.0.tar.gz');

    }
    catch(e){
        console.log(e)
    }
}

example();