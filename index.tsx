import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { showNotice } from "@api/Notices";
import { openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { ChannelType } from "@vencord/discord-types/enums";
import type { Channel } from "@vencord/discord-types";
import {
    ChannelStore,
    GuildStore,
    Menu,
    SelectedChannelStore,
    ChannelActions,
    React,
} from "@webpack/common";
import { Button } from "@components/Button";

import { settings } from "./settings";
import { isChannelFull } from "./utils";
import { FullChannelModal } from "./components/Modals";
import { waitingChannels, stopWaiting } from "./state";
import { handleVoiceStateUpdates } from "./events";

// --- Patches ---

function promptVoiceChannel(channel: Channel | null | undefined): boolean {
    if (!channel || (channel.type !== ChannelType.GUILD_VOICE && channel.type !== 13)) return false;

    // Only intercept if full
    if (!channel.userLimit) return false;
    if (!isChannelFull(channel)) {
        return false;
    }

    if (waitingChannels.has(channel.id)) return true; // Already waiting

    openModal(modalProps => (
        <FullChannelModal
            modalProps={modalProps}
            channel={channel}
            onWait={() => {
                waitingChannels.add(channel.id);
                // Notification that we started waiting
                if (settings.store.showNotice) {
                    showNotice(
                        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px" } }, [
                            React.createElement("span", {}, [`Waiting for slot in `, React.createElement("strong", {}, channel.name), `...`]),
                            React.createElement(Button, {
                                size: "small",
                                onClick: () => {
                                    ChannelActions.selectChannel(channel.id);
                                }
                            }, "Focus")
                        ]),
                        "Stop",
                        () => stopWaiting(channel.id)
                    );
                }
            }}
        />
    ));

    return true; // Intercepted
}

const VoiceChannelContext: NavContextMenuPatchCallback = (children, { channel }) => {
    if (!channel || (channel.type !== ChannelType.GUILD_VOICE && channel.type !== 13)) return;

    if (SelectedChannelStore.getVoiceChannelId() === channel.id) return;

    const isWaiting = waitingChannels.has(channel.id);
    const isFull = isChannelFull(channel);

    if (isWaiting) {
        children.splice(-1, 0, (
            <Menu.MenuItem
                key="stop-waiting-slot"
                id="stop-waiting-slot"
                label="Stop Waiting for Slot"
                action={() => stopWaiting(channel.id)}
            />
        ));
    } else {
        if (isFull) {
            children.splice(-1, 0, (
                <Menu.MenuItem
                    key="wait-for-slot"
                    id="wait-for-slot"
                    label="Wait for Slot"
                    action={() => {
                        waitingChannels.add(channel.id);
                        if (settings.store.showNotice) {
                            showNotice(`Waiting for slot in ${channel.name}...`, "Stop", () => stopWaiting(channel.id));
                        }
                    }}
                />
            ));
        }
    }
};

// --- Plugin Definition ---

export default definePlugin({
    name: "WaitForSlot (Merged)",
    description: "Multi-channel wait-for-slot functionality with high customizability.",
    authors: [{ name: "Bluscream", id: 467777925790564352n }],
    settings,

    contextMenus: {
        "channel-context": VoiceChannelContext,
    },

    patches: [
        {
            find: "VoiceChannel, transitionTo: Channel does not have a guildId",
            replacement: {
                match: /(?=\|\|\i\.\i\.selectVoiceChannel\((\i)\.id\))/,
                replace: "||$self.promptVoiceChannel($1)"
            }
        }
    ],

    promptVoiceChannel,

    start() {
        waitingChannels.clear();
    },

    stop() {
        waitingChannels.clear();
    },

    flux: {
        VOICE_STATE_UPDATES: handleVoiceStateUpdates
    },

    commands: [
        {
            name: "waiting",
            description: "List channels you are currently waiting for.",
            inputType: ApplicationCommandInputType.BOT,
            execute: (args, ctx) => {
                if (waitingChannels.size === 0) {
                    sendBotMessage(ctx.channel.id, { content: "You are not waiting for any channels." });
                    return;
                }

                let msg = "**Waiting for Slots:**\n";
                waitingChannels.forEach(id => {
                    const ch = ChannelStore.getChannel(id);
                    const guild = GuildStore.getGuild(ch?.guild_id);
                    msg += `- **${guild?.name || "Unknown"}** / #${ch?.name || id}\n`;
                });
                sendBotMessage(ctx.channel.id, { content: msg });
            }
        },
        {
            name: "stopwaiting",
            description: "Stop waiting for all channels.",
            inputType: ApplicationCommandInputType.BOT,
            execute: (args, ctx) => {
                const count = waitingChannels.size;
                waitingChannels.clear();
                sendBotMessage(ctx.channel.id, { content: `Stopped waiting for ${count} channels.` });
            }
        }
    ]
});
