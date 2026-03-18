import {
    STORE_NAME,
    USER_SETTTINGS,
    HARDWARE_SETTINGS,
    SPACE_USERS,
    SPACE_TEAMS,
} from './StoreConstants';

import {
    UserSettingsInterface,
    SettingsSpaceByUserInterface,
    SettingsSpaceByTeamInterface,
} from './StoreInterfaces';

const fs = require('fs');
const path = require('path');

class LocalStore{
    constructor(){
        // this.store = new Store({
        //     name: STORE_NAME
        // });
        this.store = {};
        this.fullSettingsFile = '';
        this.needsUpdate = false;
    }

    initializeStore(localPath, errcb){
        if(!fs.existsSync(localPath)){
            fs.mkdirSync(localPath, { recursive: true});
        }

        const settingsFile = path.resolve(localPath, STORE_NAME);
        this.fullSettingsFile = settingsFile;
        console.log('fullpath: ', this.fullSettingsFile)
        if(!fs.existsSync(settingsFile)){
            const initObject = {
                createTime: Date.now(),
                [SPACE_USERS]: []
            }
            fs.writeFileSync(settingsFile, JSON.stringify(initObject));
        }

        console.log('before read file', settingsFile)
        let fdata = fs.readFileSync(settingsFile, 'utf-8');
        if(fdata){
            this.store = JSON.parse(fdata);
            console.log('step 1 store data: ', this.store);
        }
        else{
            errcb('Settings file error!')
        }
    }

    persistStore(){
        fs.writeFile(this.fullSettingsFile, JSON.stringify(this.store), 'utf8', (err) => {
            if(err){
                console.log('persist error: ', err);
            }
        });
        this.needsUpdate = false;
    }

    getUserSettings(){
        if(Object.hasOwnProperty.call(this.store, USER_SETTTINGS)){
            return this.store[USER_SETTTINGS];
        }
        else{
            const userSettings = this._generateUserSettings();
            this.store[USER_SETTTINGS] = userSettings;
            return userSettings;
        }
    }

    getHardwareSettings(user, team){
        console.log('get hardware: ', user, team);

        let needsGenerateUserSpace = true;
        let needsGenerateTeamSpace = true;
        let userSpace = {};
        let teamSpace = {};
        if(Object.hasOwnProperty.call(this.store, SPACE_USERS) 
            && this.store[SPACE_USERS].findIndex(item => item.user === user) >= 0){
            const idx = this.store[SPACE_USERS].findIndex(item => item.user === user);
            userSpace = this.store[SPACE_USERS][idx];
            needsGenerateUserSpace = false;

            if(Object.hasOwnProperty.call(userSpace, SPACE_TEAMS)
                && userSpace[SPACE_TEAMS].findIndex(item => item.team === team) >= 0){
                const tdx = userSpace[SPACE_TEAMS].findIndex(item => item.team === team);
                teamSpace = userSpace[SPACE_TEAMS][tdx];
                needsGenerateTeamSpace = false;

                return teamSpace[HARDWARE_SETTINGS];
            }
        }

        if(!Object.hasOwnProperty.call(this.store, SPACE_USERS)){
            this.store[SPACE_USERS] = [];
        }
        if(needsGenerateUserSpace){
            userSpace = this._generateUserSpace(user);
            this.store[SPACE_USERS].push(userSpace);
        }
        if(needsGenerateTeamSpace){
            teamSpace = this._generateTeamSpace(team);
            userSpace[SPACE_TEAMS].push(teamSpace);

            return teamSpace[HARDWARE_SETTINGS];
        }

    }

    _generateUserSettings(){
        const settings = Object.assign({}, UserSettingsInterface);
        settings.currentUser = 'TempUser';
        settings.currentTeam = 'Personal';
        settings.lastLogin = Date.now().toString();
        this.needsUpdate = true;

        return settings;
    }

    _generateUserSpace(user){
        const space = Object.assign({}, SettingsSpaceByUserInterface);
        space.user = user;
        space.createTime = Date.now().toString();
        this.needsUpdate = true;

        return space;
    }

    _generateTeamSpace(team){
        const space = Object.assign({}, SettingsSpaceByTeamInterface);
        space.team = team;
        this.needsUpdate = true;

        return space;
    }
}

export {
    LocalStore
}