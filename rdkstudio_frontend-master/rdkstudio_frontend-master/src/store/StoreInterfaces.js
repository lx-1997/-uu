import {
    HARDWARE_SETTINGS,
    TEAM_SETTINGS,
    LOCAL_COMPUTING_SETTINGS,
    SPACE_USERS,
    SPACE_TEAMS,
} from './StoreConstants';

const UserSettingsInterface = {
    currentUser: '',
    currentTeam: '',
    lastLogin: '',
    keepLogin: true,
    logout: false
}

const StudioSettingsInterface = {

}

const SettingsSpaceByUserInterface = {
    user: '',
    createTime: 0,
    [SPACE_TEAMS]: []
}

const SettingsSpaceByTeamInterface = {
    team: '',
    [HARDWARE_SETTINGS]: {},
    [TEAM_SETTINGS]: {},
    [LOCAL_COMPUTING_SETTINGS]: {}
}

export {
    UserSettingsInterface,
    StudioSettingsInterface,
    SettingsSpaceByUserInterface,
    SettingsSpaceByTeamInterface
}