import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    autoJoin: {
        type: OptionType.BOOLEAN,
        description: "Automatically join the channel when a slot becomes available (skips confirmation).",
        default: false,
    },
    showModal: {
        type: OptionType.BOOLEAN,
        description: "Show a confirmation modal when a slot becomes available.",
        default: true,
    },
    showNotice: {
        type: OptionType.BOOLEAN,
        description: "Show a banner notice at the top of the client when a slot becomes available.",
        default: true,
    },
    notificationSound: {
        type: OptionType.BOOLEAN,
        description: "Play a notification sound when a slot becomes available.",
        default: true,
    },
    notificationSoundUrl: {
        type: OptionType.STRING,
        description: "URL for the notification sound.",
        default: "https://raw.githubusercontent.com/Equicord/Equibored/main/sounds/waitForSlot/notification.mp3",
    },
    sendBotMessage: {
        type: OptionType.BOOLEAN,
        description: "Send a local bot message to the text chat when a slot becomes available.",
        default: true,
    },
    stopOnDisconnect: {
        type: OptionType.BOOLEAN,
        description: "Stop waiting if you disconnect from voice entirely.",
        default: true,
    },
});
