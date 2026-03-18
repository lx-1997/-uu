const Client = require('ssh2').Client;

class TestSSH{
    constructor(){

    }

    connectSSH(){
        console.log('connect ssh')
        const client = new Client();
        const assembledOptions = {
            host: '192.168.127.10',
            port: 22,
            username: 'sunrise',
            password: 'sunrise'
        };

        client.on('ready', () => {
            client.exec('echo test', (err, stream) => {
                if(err){
                    throw err;
                }
                stream.on('data', (data) => {
                    console.log(data.toString());
                })
            })
        }).on('error', (err) => {
            console.log(err)
        }).connect(assembledOptions);
    }
}

const testSSH = new TestSSH();
testSSH.connectSSH();

// export {
//     TestSSH
// }